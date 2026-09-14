import time
from functools import lru_cache

import psycopg
from psycopg.rows import dict_row

from langgraph.checkpoint.memory import MemorySaver
from langgraph.checkpoint.postgres import PostgresSaver

from src.config.session import require, resolve_database_url

_memory_checkpointer = MemorySaver()


def get_connection(database_url: str) -> psycopg.Connection:
    return psycopg.connect(
        database_url,
        autocommit=True,
        row_factory=dict_row,
    )


@lru_cache(maxsize=4)
def get_checkpointer(database_url: str):
    for attempt in range(3):
        try:
            conn = get_connection(database_url)
            checkpointer = PostgresSaver(conn)
            checkpointer.setup()
            return checkpointer
        except Exception as e:
            print(f"Postgres checkpointer attempt {attempt + 1} failed: {e}")
            if attempt < 2:
                time.sleep(1.0)

    print("Falling back to MemorySaver for conversation thread checkpointer.")
    return _memory_checkpointer


def get_session_checkpointer():
    """Checkpointer for whichever database URL the current session resolves to."""

    require("DATABASE_URL")

    return get_checkpointer(resolve_database_url())
