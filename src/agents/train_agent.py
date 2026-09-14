"""Researches train routes, IRCTC station options, train classes, and fares using live IRCTC RapidAPI & web search."""

import json
import re
from langchain_core.messages import HumanMessage, SystemMessage

from src.agents.prompts import TRAIN_AGENT_PROMPT, TRAIN_SEARCH_QUERY, TRAIN_SYSTEM_PROMPT
from src.clients.llm import get_llm
from src.graph.state import TravelState
from src.mcp_servers.irctc import get_trains_between_stations, search_station
from src.mcp_servers.remote import tavily_mcp_search
from src.utils.async_utils import bump_llm_calls, run_async


def _extract_cities(query: str) -> tuple[str | None, str | None]:
    """Helper to extract origin and destination city names from query."""
    q_lower = query.lower()

    # Pattern 1: from X to Y
    m1 = re.search(r"from\s+([a-zA-Z\s]+?)\s+to\s+([a-zA-Z\s]+?)(?:\s+by|\s+in|\s+for|\s+with|\.|$)", q_lower)
    if m1:
        return m1.group(1).strip().split()[0], m1.group(2).strip().split()[0]

    # Pattern 2: X to Y
    m2 = re.search(r"([a-zA-Z]+)\s+to\s+([a-zA-Z]+)", q_lower)
    if m2:
        return m2.group(1).strip(), m2.group(2).strip()

    return None, None


def train_agent(state: TravelState):
    user_query = state["user_query"]

    irctc_data_str = ""
    from_city, to_city = _extract_cities(user_query)

    if from_city and to_city:
        from_code = search_station(from_city)
        to_code = search_station(to_city)
        if from_code and to_code:
            live_trains = get_trains_between_stations(from_code, to_code)
            if live_trains:
                lines = [f"VERIFIED LIVE IRCTC TRAINS ({from_code} -> {to_code}):"]
                for t in live_trains[:8]:
                    train_num = t.get("train_number")
                    train_name = t.get("train_name")
                    from_sta = t.get("from_station_name", from_code)
                    to_sta = t.get("to_station_name", to_code)
                    dep = t.get("from_std")
                    arr = t.get("to_sta")
                    dur = t.get("duration")
                    days = ", ".join(t.get("run_days", [])) if isinstance(t.get("run_days"), list) else str(t.get("run_days"))
                    lines.append(f"- Train #{train_num}: {train_name} | From: {from_sta} ({dep}) -> To: {to_sta} ({arr}) | Duration: {dur} | Days: {days}")
                irctc_data_str = "\n".join(lines)

    search_query = TRAIN_SEARCH_QUERY.format(user_query=user_query)
    try:
        raw_search = run_async(tavily_mcp_search(search_query))
        tavily_data_str = str(raw_search)[:800] if raw_search else ""
    except Exception as e:
        tavily_data_str = f"Search info: {e}"

    combined_search_data = (irctc_data_str + "\n\nWeb Reference:\n" + tavily_data_str)[:1600]

    prompt = TRAIN_AGENT_PROMPT.format(
        query=user_query,
        search_data=combined_search_data,
    )

    response = get_llm().invoke([
        SystemMessage(content=TRAIN_SYSTEM_PROMPT),
        HumanMessage(content=prompt),
    ])

    return {
        "train_results": response.content,
        "messages": [response],
        "llm_calls": bump_llm_calls(state),
    }
