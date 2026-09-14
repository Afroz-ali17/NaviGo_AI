"""Formats everything the other agents produced into the user-facing answer."""

from langchain_core.messages import HumanMessage, SystemMessage

from src.agents.prompts import FINAL_AGENT_PROMPT, FINAL_SYSTEM_PROMPT
from src.clients.llm import get_llm
from src.graph.state import TravelState
from src.utils.async_utils import bump_llm_calls, format_chat_history


def _trim(val: str | None, max_chars: int = 1200) -> str:
    if not val:
        return ""
    val_str = str(val)
    return val_str[:max_chars] if len(val_str) > max_chars else val_str


def final_agent(state: TravelState):
    chat_hist = format_chat_history(state.get("messages", []))

    prompt = FINAL_AGENT_PROMPT.format(
        chat_history=chat_hist,
        user_query=state["user_query"],
        flight_results=_trim(state.get("flight_results"), 1200),
        train_results=_trim(state.get("train_results"), 1200),
        hotel_results=_trim(state.get("hotel_results"), 1200),
        weather_results=_trim(state.get("weather_results"), 800),
        itinerary=_trim(state.get("itinerary"), max_chars=2000),
    )

    response = get_llm().invoke([
        SystemMessage(content=FINAL_SYSTEM_PROMPT),
        HumanMessage(content=prompt),
    ])

    return {
        "messages": [response],
        "llm_calls": bump_llm_calls(state),
    }
