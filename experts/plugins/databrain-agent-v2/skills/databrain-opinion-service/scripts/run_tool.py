#!/usr/bin/env python3
"""Generic entry script for opinion skill tools.

Usage:
    python scripts/run_tool.py --tool get_opinion_summary_report --game_names '["Honor of Kings"]'

Supported tools:
    get_opinion_summary_report, get_opinion_analysis_by_topic,
    youtube_url_analysis_tool, opinion_redirect_tool, get_game_info
"""
import argparse
import asyncio
import inspect
import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from context_loader import get_context
from run_context_wrapper import RunContextWrapper
from opinion_utils.exceptions import NoResultException

_TOOL_MAP = None


def _load_tool_map():
    global _TOOL_MAP
    if _TOOL_MAP is not None:
        return _TOOL_MAP
    from opinion_tools.opinion.summary_tool_v2 import get_opinion_summary_report
    from opinion_tools.opinion.topic_analysis_tool import get_opinion_analysis_by_topic
    from opinion_tools.opinion.youtube_tools import youtube_url_analysis_tool
    from opinion_tools.opinion.opinion_tools import opinion_redirect_tool, get_game_info
    _TOOL_MAP = {
        "get_opinion_summary_report": get_opinion_summary_report,
        "get_opinion_analysis_by_topic": get_opinion_analysis_by_topic,
        "youtube_url_analysis_tool": youtube_url_analysis_tool,
        "opinion_redirect_tool": opinion_redirect_tool,
        "get_game_info": get_game_info,
    }
    return _TOOL_MAP


def _parse_value(value: str):
    """Try to parse a CLI value as JSON (for lists/dicts/bools/numbers).
    Falls back to string if not valid JSON."""
    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return value


def main():
    pre_parser = argparse.ArgumentParser(add_help=False)
    pre_parser.add_argument("--tool", required=True)
    known, remaining = pre_parser.parse_known_args()

    tool_map = _load_tool_map()
    tool_func = tool_map.get(known.tool)
    if tool_func is None:
        print(json.dumps({"error": f"Unknown tool: {known.tool}", "available": sorted(tool_map.keys())}))
        sys.exit(1)

    kwargs = {}
    i = 0
    while i < len(remaining):
        arg = remaining[i]
        if arg.startswith("--"):
            key = arg[2:]
            if i + 1 < len(remaining) and not remaining[i + 1].startswith("--"):
                kwargs[key] = _parse_value(remaining[i + 1])
                i += 2
            else:
                kwargs[key] = True
                i += 1
        else:
            i += 1

    context = RunContextWrapper(get_context())

    # Filter out kwargs not accepted by the tool function to avoid TypeError
    sig = inspect.signature(tool_func)
    params = sig.parameters
    if any(p.kind == inspect.Parameter.VAR_KEYWORD for p in params.values()):
        # Function accepts **kwargs, pass everything
        filtered_kwargs = kwargs
    else:
        accepted_keys = set(params.keys()) - {"context"}
        filtered_kwargs = {k: v for k, v in kwargs.items() if k in accepted_keys}
        dropped = set(kwargs.keys()) - set(filtered_kwargs.keys())
        if dropped:
            print(json.dumps({"warning": f"Ignored unsupported arguments: {sorted(dropped)}"}), file=sys.stderr)

    try:
        result = asyncio.run(tool_func(context, **filtered_kwargs))
    except NoResultException as exc:
        result = {
            "code": 0,
            "status": "needs_web_search",
            "message": exc.message or str(exc),
            "search_query": exc.search_query,
            "use_web_search": exc.use_web_search,
            "next_action": "Call llm_websearch with search_query to supplement this skill result.",
        }

    if isinstance(result, str):
        print(result)
    else:
        print(json.dumps(result, ensure_ascii=False, default=str))


if __name__ == "__main__":
    import logging
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    main()
