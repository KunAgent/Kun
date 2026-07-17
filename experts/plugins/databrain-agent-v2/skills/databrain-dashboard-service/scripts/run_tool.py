#!/usr/bin/env python3
"""Generic entry script for standalone dashboard skill tools.

Token is read from DATABRAIN_TOKEN env var (user sets it once).
All other config is loaded from Rainbow automatically.

Usage:
    export DATABRAIN_TOKEN="your_token"
    python scripts/run_tool.py --tool dashboard_metrics_query_tool \
        --game_names '["Honor of Kings"]' --metrics '["revenue"]' \
        --start_date 20260401 --end_date 20260430

Supported tools:
    dashboard_metrics_query_tool, dashboard_metric_percentage_tool,
    dashboard_mcp_describe_data_tool, dashboard_mcp_read_data_tool
"""
import argparse
import asyncio
import inspect
import json
import sys
import os

_SKILL_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _SKILL_ROOT)

from context_loader import get_context
from run_context_wrapper import RunContextWrapper

_MCP_TOOL_NAMES = {"dashboard_mcp_describe_data_tool", "dashboard_mcp_read_data_tool"}
_TOOL_MAP = None


async def _ensure_entities_resolved(context: RunContextWrapper, game_names: list):
    """Ensure entities are resolved before tool execution.

    If context already has dashboard_game_code_and_filters populated (e.g. from
    AGENT_CONTEXT_JSON), skip resolution. Otherwise, run the full entity linking
    + dashboard permission pipeline automatically.
    """
    if context.context.dashboard_game_code_and_filters:
        return  # Already resolved by agent or previous call

    if not game_names:
        return  # No games to resolve

    from entity.entity import resolve_game_entities
    await resolve_game_entities(context.context, game_names)


async def _invoke_with_mcp_lifecycle(tool_name: str, tool_func, context, filtered_kwargs):
    should_manage_mcp = tool_name in _MCP_TOOL_NAMES

    if should_manage_mcp:
        from databrain_agents.mcp_utils import has_mcp_server, restart_mcp_servers, MCPServerException
        context.context.dashboard_inner_vars.setdefault("dashboard_mcp_server", [])
        if not has_mcp_server(context) and not context.context.dashboard_inner_vars.get("no_mcp_available"):
            try:
                await restart_mcp_servers(
                    context,
                    max_retries=3,
                    retry_delay=2,
                    reason=f"run_tool on_start init for {tool_name}",
                    caller="scripts/run_tool.py::_invoke_with_mcp_lifecycle",
                )
            except ImportError as e:
                return (
                    f"[MCP Error] MCP tools require the 'openai-agents' package which is not installed in this environment. "
                    f"Please install it with: pip install openai-agents\n"
                    f"Detail: {e}"
                )
            except MCPServerException as e:
                # Surface the root cause (often ImportError from missing openai-agents)
                root_cause = e.__cause__ or e
                cause_detail = str(root_cause)
                if "openai-agents" in cause_detail or "No module named" in cause_detail:
                    hint = " Please install with: pip install openai-agents"
                else:
                    hint = ""
                return (
                    f"[MCP Error] Failed to start MCP server for tool '{tool_name}'.{hint}\n"
                    f"Detail: {e}\n"
                    f"Root cause: {cause_detail}"
                )

    try:
        return await tool_func(context, **filtered_kwargs)
    finally:
        if should_manage_mcp:
            try:
                from databrain_agents.mcp_utils import cleanup_mcp_servers
                await cleanup_mcp_servers(
                    context,
                    reason=f"run_tool on_end cleanup for {tool_name}",
                    caller="scripts/run_tool.py::_invoke_with_mcp_lifecycle",
                )
            except Exception:
                pass


def _load_tool_map():
    global _TOOL_MAP
    if _TOOL_MAP is not None:
        return _TOOL_MAP
    from dashboard_tools.dashboard.dashboard_metrics_query_tool import dashboard_metrics_query_tool
    from dashboard_tools.dashboard.dashboard_metric_percentage_tool import dashboard_metric_percentage_tool
    from dashboard_tools.dashboard.dashboard_mcp_tools import dashboard_mcp_describe_data_tool, dashboard_mcp_read_data_tool
    _TOOL_MAP = {
        "dashboard_metrics_query_tool": dashboard_metrics_query_tool,
        "dashboard_metric_percentage_tool": dashboard_metric_percentage_tool,
        "dashboard_mcp_describe_data_tool": dashboard_mcp_describe_data_tool,
        "dashboard_mcp_read_data_tool": dashboard_mcp_read_data_tool,
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

    # Load and validate tool
    tool_map = _load_tool_map()
    tool_func = tool_map.get(known.tool)
    if tool_func is None:
        print(json.dumps({"error": f"Unknown tool: {known.tool}", "available": sorted(tool_map.keys())}))
        sys.exit(1)

    # Auto-resolve entities if needed (default internal pipeline)
    game_names = kwargs.get("game_names", [])
    if isinstance(game_names, str):
        game_names = [game_names]
    if game_names:
        asyncio.run(_ensure_entities_resolved(context, game_names))

        # Check if entity linking resolved to different names
        resolved_names = context.context.game_names or []
        if resolved_names and set(resolved_names) != set(game_names):
            # Names don't match — return info for agent to confirm with user
            mapping = {}
            for orig in game_names:
                matched = None
                for resolved in resolved_names:
                    if orig.lower() in resolved.lower() or resolved.lower() in orig.lower():
                        matched = resolved
                        break
                mapping[orig] = matched or "(not found)"
            # Replace game_names in kwargs with the resolved names so tool can proceed
            kwargs["game_names"] = resolved_names
            from loguru import logger
            logger.info(f"[run_tool] game_names resolved: {mapping}")

    # Filter kwargs to only include parameters the tool function accepts
    sig = inspect.signature(tool_func)
    valid_params = set(sig.parameters.keys()) - {"context"}
    has_var_keyword = any(
        p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values()
    )
    if not has_var_keyword:
        filtered_kwargs = {k: v for k, v in kwargs.items() if k in valid_params}
    else:
        filtered_kwargs = kwargs

    result = asyncio.run(_invoke_with_mcp_lifecycle(known.tool, tool_func, context, filtered_kwargs))

    if isinstance(result, str):
        print(result)
    else:
        print(json.dumps(result, ensure_ascii=False, default=str))


if __name__ == "__main__":
    import logging
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    main()
