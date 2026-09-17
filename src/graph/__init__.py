from src.graph.state import TravelState, initial_state


def build_graph():
    from src.graph.graph import build_graph as _build_graph
    return _build_graph()


def get_travel_graph():
    from src.graph.graph import get_travel_graph as _get_travel_graph
    return _get_travel_graph()


def run_travel_agent(*args, **kwargs):
    from src.graph.runner import run_travel_agent as _run_travel_agent
    return _run_travel_agent(*args, **kwargs)


__all__ = [
    "TravelState",
    "build_graph",
    "get_travel_graph",
    "initial_state",
    "run_travel_agent",
]

