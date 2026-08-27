"""
Redis cache for expensive external calls.

Design notes
------------
* Redis is treated as a pure optimisation. If it is down, unreachable or
  disabled, every decorated function falls through to the real call. A
  cache outage must never take the travel planner down with it.
* Values are stored as JSON (``default=str``) rather than pickled, so a
  compromised or shared Redis can never execute code on deserialisation.
* On a cache miss the value is round-tripped through JSON before being
  returned, so callers get exactly the same shape on a hit and a miss.
"""

import functools
import hashlib
import json
import logging
from typing import Any, Callable, Optional

import redis

from src.config.settings import (
    CACHE_ENABLED,
    CACHE_KEY_PREFIX,
    REDIS_URL,
)

logger = logging.getLogger(__name__)


_client: Optional[redis.Redis] = None
_client_initialised = False


def get_client() -> Optional[redis.Redis]:
    """Return a shared Redis client, or None when caching is unavailable."""

    global _client, _client_initialised

    if not CACHE_ENABLED:
        return None

    if _client_initialised:
        return _client

    _client_initialised = True

    try:
        client = redis.Redis.from_url(
            REDIS_URL,
            decode_responses=True,
            socket_connect_timeout=2,
            socket_timeout=2,
        )
        client.ping()

        _client = client
        logger.info("Redis cache connected: %s", REDIS_URL)

    except Exception as error:
        _client = None
        logger.warning(
            "Redis cache unavailable (%s). Continuing without cache.",
            error,
        )

    return _client


def reset_client() -> None:
    """Force the next call to re-connect. Used by tests."""

    global _client, _client_initialised

    _client = None
    _client_initialised = False


def build_key(prefix: str, args: tuple, kwargs: dict) -> str:
    """Deterministic cache key from a function's arguments."""

    fingerprint = json.dumps(
        [args, sorted(kwargs.items())],
        default=str,
        sort_keys=True,
    )

    digest = hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()

    return f"{CACHE_KEY_PREFIX}:{prefix}:{digest}"


def _read(key: str) -> tuple[bool, Any]:
    """Return (hit, value). Never raises."""

    client = get_client()

    if client is None:
        return False, None

    try:
        payload = client.get(key)
    except Exception as error:
        logger.warning("Redis read failed for %s: %s", key, error)
        return False, None

    if payload is None:
        return False, None

    try:
        return True, json.loads(payload)
    except (TypeError, ValueError):
        # Corrupt or legacy entry. Treat it as a miss.
        return False, None


def _write(key: str, value: Any, ttl: int) -> Any:
    """Store the value and return its JSON round-trip. Never raises."""

    try:
        payload = json.dumps(value, default=str)
    except (TypeError, ValueError) as error:
        logger.warning("Value for %s is not cacheable: %s", key, error)
        return value

    client = get_client()

    if client is not None:
        try:
            client.setex(key, ttl, payload)
        except Exception as error:
            logger.warning("Redis write failed for %s: %s", key, error)

    return json.loads(payload)


def cached(prefix: str, ttl: int) -> Callable:
    """Cache the result of a synchronous function in Redis."""

    def decorator(func: Callable) -> Callable:

        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            key = build_key(prefix, args, kwargs)

            hit, value = _read(key)

            if hit:
                logger.debug("Cache hit: %s", key)
                return value

            return _write(key, func(*args, **kwargs), ttl)

        wrapper.cache_prefix = prefix
        wrapper.cache_ttl = ttl
        wrapper.uncached = func

        return wrapper

    return decorator


def async_cached(prefix: str, ttl: int) -> Callable:
    """Cache the result of an async function in Redis."""

    def decorator(func: Callable) -> Callable:

        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            key = build_key(prefix, args, kwargs)

            hit, value = _read(key)

            if hit:
                logger.debug("Cache hit: %s", key)
                return value

            return _write(key, await func(*args, **kwargs), ttl)

        wrapper.cache_prefix = prefix
        wrapper.cache_ttl = ttl
        wrapper.uncached = func

        return wrapper

    return decorator


def clear(prefix: str = "*") -> int:
    """Delete cached entries for one prefix. Returns how many were removed."""

    client = get_client()

    if client is None:
        return 0

    pattern = f"{CACHE_KEY_PREFIX}:{prefix}:*"
    removed = 0

    try:
        for key in client.scan_iter(match=pattern, count=500):
            removed += client.delete(key)
    except Exception as error:
        logger.warning("Redis clear failed for %s: %s", pattern, error)

    return removed
