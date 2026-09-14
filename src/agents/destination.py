"""Pulls the destination out of a free-form travel query."""

from src.agents.prompts import DESTINATION_EXTRACTION_PROMPT
from src.clients.cache import cached
from src.clients.llm import get_llm
from src.config.settings import CACHE_TTL_DESTINATION


def extract_destination(query: str, chat_history: str = "") -> str:
    """
    Extracts destination city or country, taking into account previous chat history for follow-up questions.
    """
    combined_context = f"Chat History:\n{chat_history}\n\nLatest Query:\n{query}" if chat_history else query

    prompt = DESTINATION_EXTRACTION_PROMPT.format(query=combined_context)

    response = get_llm().invoke(prompt)

    return response.content.strip()
