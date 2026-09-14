"""
Helpers for calling async MCP tools from the synchronous graph nodes.

app.py applies nest_asyncio, which is what makes asyncio.run() safe to
call from inside FastAPI's already-running event loop.
"""

import asyncio
from typing import Any, Awaitable, TypeVar

T = TypeVar("T")


def run_async(coroutine: Awaitable[T]) -> T:
    """Run a coroutine to completion from synchronous code."""

    return asyncio.run(coroutine)


def bump_llm_calls(state: dict, count: int = 1) -> int:
    """Return the incremented LLM call counter for a node's state update."""

    return state.get("llm_calls", 0) + count


def truncate(value: Any, limit: int) -> str:
    """Stringify a tool payload and clip it so prompts stay within budget."""

    return str(value)[:limit]


def format_chat_history(messages: list, max_messages: int = 6) -> str:
    """Format recent human and AI messages into a text summary for context window."""
    if not messages:
        return "No previous chat history."

    history_lines = []
    for msg in messages:
        sender = getattr(msg, "type", None) or msg.__class__.__name__
        content = getattr(msg, "content", "")
        if content and sender in ("human", "ai", "HumanMessage", "AIMessage"):
            role = "User" if sender in ("human", "HumanMessage") else "Assistant"
            text_snippet = str(content)[:250].replace("\n", " ")
            history_lines.append(f"{role}: {text_snippet}")

    recent = history_lines[-max_messages:]
    return "\n".join(recent) if recent else "No previous chat history."
