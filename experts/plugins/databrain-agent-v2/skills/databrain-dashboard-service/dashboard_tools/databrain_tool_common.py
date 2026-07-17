class Agent:
    @classmethod
    def __class_getitem__(cls, _item):
        return cls


import importlib

try:
    _agents = importlib.import_module("agents")
    RunContextWrapper = _agents.RunContextWrapper
except Exception:
    class RunContextWrapper:
        def __init__(self, context):
            self.context = context

        @classmethod
        def __class_getitem__(cls, _item):
            return cls


class Tool:
    @classmethod
    def __class_getitem__(cls, _item):
        return cls


def original_function_tool(*args, **kwargs):
    raise RuntimeError('agents.original_function_tool is unavailable in Hermes runtime')

import asyncio
import inspect
import re as _re
from loguru import logger
import time
import traceback
import json
from typing import Dict, List, Optional, Any, Callable, get_type_hints, get_origin, get_args, Union
from typing_extensions import Callable as TypingCallable

from dashboard_strategy.context import AgentContext as GameContext
from dashboard_tools.databrain_registry import registry

# Global context for tools to access if needed
_current_game_context = None

def set_current_game_context(ctx):
    global _current_game_context
    _current_game_context = ctx


# ---------------------------------------------------------------------------
# Schema builder: Python type annotations → JSON Schema types
# ---------------------------------------------------------------------------

def _python_type_to_json_schema(annotation) -> dict:
    """Convert a Python type annotation to a JSON Schema fragment."""
    if annotation is inspect.Parameter.empty or annotation is Any:
        return {"type": "string"}

    origin = get_origin(annotation)
    args = get_args(annotation)

    # Optional[X] is Union[X, None]
    if origin is Union:
        non_none = [a for a in args if a is not type(None)]
        if len(non_none) == 1:
            return _python_type_to_json_schema(non_none[0])
        return {"type": "string"}

    # X | Y syntax (Python 3.10+)
    if hasattr(annotation, "__origin__") and str(annotation).startswith("typing.Union"):
        non_none = [a for a in args if a is not type(None)]
        if len(non_none) == 1:
            return _python_type_to_json_schema(non_none[0])
        return {"type": "string"}

    if origin in (list, List):
        if args:
            return {"type": "array", "items": _python_type_to_json_schema(args[0])}
        return {"type": "array", "items": {"type": "string"}}

    if origin in (dict, Dict):
        return {"type": "object"}

    if annotation is str:
        return {"type": "string"}
    if annotation is int:
        return {"type": "integer"}
    if annotation is float:
        return {"type": "number"}
    if annotation is bool:
        return {"type": "boolean"}

    # str | None etc. (PEP 604)
    if hasattr(annotation, "__args__"):
        non_none = [a for a in annotation.__args__ if a is not type(None)]
        if len(non_none) == 1:
            return _python_type_to_json_schema(non_none[0])

    return {"type": "string"}


def _parse_arg_descriptions(docstring: str) -> Dict[str, str]:
    """Extract per-parameter descriptions from an Args/Parameters docstring block."""
    descriptions: Dict[str, str] = {}
    if not docstring:
        return descriptions

    # Find the Args: / Parameters: block
    lines = docstring.split("\n")
    in_args = False
    current_param = None
    current_desc_lines: list = []
    current_param_indent = 0

    for line in lines:
        stripped = line.strip()
        if stripped.lower().startswith(("args:", "parameters:", "arguments:")):
            in_args = True
            continue
        if not in_args:
            continue

        # New top-level section header (Returns:, Raises:, etc.) ends args block.
        # Must be non-indented to avoid breaking on nested blocks like "PC:".
        if stripped and not line[:1].isspace() and not stripped.startswith("-") and stripped.endswith(":"):
            break

        # Try to match "param_name: description" or "param_name (type): description"
        m = _re.match(r"^\s{2,}-?\s*(\w+)\s*(?:\([^)]*\))?\s*[:\-–]\s*(.*)", line)
        if m:
            indent = len(line) - len(line.lstrip(" "))
            # Nested headings inside a parameter (e.g. "PC:", "Console:")
            # should be treated as continuation text, not new params.
            if current_param and indent > current_param_indent:
                if stripped:
                    current_desc_lines.append(stripped)
                continue

            if current_param:
                descriptions[current_param] = " ".join(current_desc_lines).strip()
            current_param = m.group(1)
            current_param_indent = indent
            current_desc_lines = [m.group(2).strip()] if m.group(2).strip() else []
        elif current_param and stripped:
            current_desc_lines.append(stripped)
        elif not stripped and current_param:
            # Blank line may end current param
            pass

    if current_param:
        descriptions[current_param] = " ".join(current_desc_lines).strip()

    return descriptions


def _build_openai_function_schema(
    func,
    tool_name: str,
    description: str,
) -> dict:
    """Build a complete OpenAI function-calling schema from a Python function."""
    sig = inspect.signature(func)

    # Try to get type hints; fall back to annotations on failure
    try:
        hints = get_type_hints(func)
    except Exception:
        hints = {}

    # Parse per-param descriptions from docstring
    docstring = func.__doc__ or ""
    arg_descs = _parse_arg_descriptions(docstring)

    properties: Dict[str, Any] = {}
    required: List[str] = []

    # Skip the first parameter (context: RunContextWrapper)
    params = list(sig.parameters.values())
    skip_first = (
        params
        and params[0].name in ("context", "self", "ctx")
    )
    if skip_first:
        params = params[1:]

    for param in params:
        annotation = hints.get(param.name, param.annotation)
        prop = _python_type_to_json_schema(annotation)

        # Add description from docstring
        if param.name in arg_descs and arg_descs[param.name]:
            prop["description"] = arg_descs[param.name]

        properties[param.name] = prop

        # Required if no default value and not Optional
        if param.default is inspect.Parameter.empty:
            origin = get_origin(annotation)
            args = get_args(annotation)
            is_optional = (
                origin is Union
                and type(None) in args
            )
            if not is_optional:
                required.append(param.name)

    schema = {
        "name": tool_name,
        "description": description.strip()[:4096] if description else tool_name,
        "parameters": {
            "type": "object",
            "properties": properties,
            "required": required,
        },
    }
    return schema


def function_tool(
    func: Any = None,
    *,
    name_override: str | None = None,
    description_override: str | None = None,
    docstring_style: Any = None,
    use_docstring_info: bool = True,
    failure_error_function: Any = None,
    strict_mode: bool = True,
    is_enabled: bool | TypingCallable[[RunContextWrapper[Any], Any], bool] = True,
    readable_name_map: Dict[str, str] | None = None,
    concurrency: int = 5,
    toolset: str = "databrain"
) -> Any:
    def decorator(f: Any) -> Any:
        tool_name = name_override or f.__name__

        # Build the full description: prefer description_override, then docstring
        raw_desc = description_override or f.__doc__ or ""
        # For the schema description, use the first paragraph (before Args:)
        desc_for_schema = raw_desc
        if desc_for_schema:
            # Trim to text before "Args:" section for a cleaner schema description
            args_idx = None
            for marker in ("\nArgs:", "\n    Args:", "\nargs:", "\nParameters:"):
                idx = desc_for_schema.find(marker)
                if idx != -1:
                    if args_idx is None or idx < args_idx:
                        args_idx = idx
            if args_idx:
                desc_for_schema = desc_for_schema[:args_idx].strip()

        # Build OpenAI-compatible function schema from signature + docstring
        schema = _build_openai_function_schema(f, tool_name, desc_for_schema)

        # Hermes adapter handler: wraps the async DataBrain tool for sync dispatch
        def hermes_handler(args: Dict[str, Any], **kw) -> str:
            from dashboard_strategy.context import AgentContext as GameContext
            ctx = _current_game_context or GameContext()
            wrapper = RunContextWrapper(ctx)

            try:
                if asyncio.iscoroutinefunction(f):
                    from model_tools import _run_async
                    result = _run_async(f(wrapper, **args))
                else:
                    result = f(wrapper, **args)

                if isinstance(result, str):
                    return result
                return json.dumps(result, ensure_ascii=False)
            except Exception as e:
                logger.error(f"Error executing tool {tool_name}: {e}")
                if failure_error_function:
                    try:
                        return failure_error_function(e)
                    except Exception:
                        pass
                return json.dumps({"error": str(e)}, ensure_ascii=False)

        # Register with Hermes tool registry (full schema)
        registry.register(
            name=tool_name,
            toolset=toolset,
            schema=schema,
            handler=hermes_handler,
            description=desc_for_schema.strip()[:500] if desc_for_schema else "",
            is_async=False,  # handler is sync (bridges async internally)
        )

        # Preserve original function metadata
        f._hermes_tool_name = tool_name
        f._hermes_schema = schema
        return f

    if func is None:
        return decorator
    else:
        return decorator(func)

# agent type should be AgentBase not Agent
def get_tool_enabled(tool_name: str, additional_condition: Callable[[GameContext], bool] = lambda _: True) -> Callable[[RunContextWrapper[GameContext], Agent], bool]:
    def is_tool_enabled(context: RunContextWrapper[GameContext], agent: Agent) -> bool:
        return additional_condition(context.context) and context.context.is_tool_enabled_by_agent.get("{}_{}".format(context.context.agent_stage_index, agent.name), {}).get(tool_name, True)
    return is_tool_enabled

async def set_tools_enabled_using_plan(agent_registry: Dict[str, Agent[GameContext]], game_context: GameContext):
    from dashboard_common.cls import log_metrics
    from dashboard_strategy.constants import AgentExecutionType, AgentName

    last_agent_index = 1
    tasks = []
    time_start = time.time()
    for task in game_context.plan_items_strict:
        mode = task.mode
        offset = 1
        match mode:
            case AgentExecutionType.Serial.value:
                pass
            case AgentExecutionType.Parallel.value:
                offset = 0
            case _:
                logger.error("uknown execution mode: {}".format(mode))
        items = task.agents
        for agent_index, item in enumerate(items):
            agent_name = item.agent
            # tools for these agents are set elsewhere
            if agent_name in [AgentName.WorkflowAgent.value]:
                continue
            input_text = item.input
            current_agent = agent_registry.get(agent_name)
            if not current_agent:
                logger.warning(f"Agent {agent_name} not found")
                continue
            if len(current_agent.tools) <= 6:
                continue
            tasks.append(set_tools_enabled_for_agent(game_context, current_agent, last_agent_index + offset * agent_index, input_text))
        last_agent_index += len(items)
    await asyncio.gather(*tasks)
    log_metrics("func_enable_tools", "0", round((time.time() - time_start) * 1000, 2))

async def set_tools_enabled_for_agent(game_context: GameContext, agent: Agent, agent_stage_index: int, input_text: str):
    from dashboard_strategy.constants import ToolName, AgentName, HandledException, UserIntention

    desc_list = ["{}. {}: {}".format(i + 1, tool.name, get_tool_description(tool)) for i, tool in enumerate(agent.tools)]
    tool_num_min = 3 if game_context.intention==UserIntention.Easy.value else 4
    tool_num_max = 4 if game_context.intention==UserIntention.Easy.value else 6
    toolname_list = [tool.name for tool in agent.tools]
    rules = "Note: - entities_info_search_tool should be included in your anser if user instruction asks for games data since release/on it's first month/上线后/首月/首年/历史以来; - get_topN_games_by_filters should be included if user instruction ask for top games sorted by metrics; - get_topN_games_by_filters MUST be included (NOT get_leaderboard) if user asks for top games by wishlist count/愿望单数量, because get_topN_games_by_filters returns actual wishlist metric values while get_leaderboard only returns rankings without values" if agent.name in (AgentName.IntelligenceAgent.value, AgentName.SimplifiedIntelligenceAgent.value) else ""
    tool_select_prompt = agent.handoff_description + (
        f"You will be given a user instruction and a list of helpful tools. Rerank the tools and select the most useful {tool_num_min} to {tool_num_max} tools to help you execute the instruction.\n"
        "{}\nThe user instruction is: {}\n The provided helpful tools are: {}\n"
        f"##Output Format: Return useful tools' original index, at least {tool_num_min} tools, at most {tool_num_max} tools, separated by English comma. Only output the indexes, nothing redundant.").format(rules,input_text, "\n".join(desc_list))
    is_tool_enabled: Dict[str, bool] = {}
    try:
        # Lazy import to avoid heavy dependency chain during tool module import.
        # Only needed when planner actually performs dynamic tool selection.
        from dashboard_utils.llm_proxy import request_tool_check_config_llm

        result = await request_tool_check_config_llm(game_context.message_id, tool_select_prompt)
        hit_indexes = [int(index)-1 for index in result.split(',')]
        selected_tool_names = [toolname_list[x] for x in hit_indexes]
        if ToolName.GetGenreMarketSize.value in selected_tool_names:
            selected_tool_names.append(ToolName.GetGameMarketSize.value)
        if ToolName.GetGameMarketSize.value in selected_tool_names:
            selected_tool_names.append(ToolName.GetGenreMarketSize.value)
        if ToolName.TopicRatioAnalysis.value in selected_tool_names:
            selected_tool_names.append(ToolName.GetTopContentByTopic.value)
        if any(keyword in input_text.lower() for keyword in ["release", "first month", "首月","首年","上线", "历史以来"]) or agent.name in (AgentName.IntelligenceAgent.value, AgentName.SimplifiedIntelligenceAgent.value):
            selected_tool_names.append(ToolName.GameInfoSearchTool.value)
        # Force enable metrics_query_tool when metrics-related keywords detected
        if any(keyword in input_text.lower() for keyword in ["revenue", "download", "units", "sales", "rpd", "rpu", "arpu", "收入", "下载", "metrics", "营收", "销量", "销售",
                                                              "dau", "mau", "wau", "active user", "active users", "月活", "日活", "周活", "活跃用户", "活跃人数",
                                                              "playtime", "play time", "游戏时长", "时长", "retention", "留存",
                                                              "installs", "install", "安装量", "安装", "wishlist", "愿望单"]):
            selected_tool_names.append(ToolName.MetricsQueryTool.value)
        # Force enable get_topN_games_by_filters (GetCommonTopCharts) for wishlist top-games queries
        # Wishlist leaderboard queries need actual metric values, NOT just rankings from get_leaderboard
        if any(keyword in input_text.lower() for keyword in ["wishlist", "wish list", "愿望单", "wishlists"]):
            selected_tool_names.append(ToolName.GetCommonTopCharts.value)
        # Force enable get_company_games when company-related queries detected
        # Includes: generic terms + possessive patterns (e.g., "Voodoo's releases") + common publisher names
        company_keywords = ["company", "publisher", "发行商", "公司", "studio", "工作室", "developer", "开发商", "厂商", "旗下"]
        # More specific patterns to avoid false positives like "shooter's game"
        # These patterns require the possessive to be followed by company-related nouns
        company_pattern_indicators = ["'s releases", "'s games", "'s titles", "'s portfolio", "的游戏", "的发行", "发布的", "'s latest release"]
        if any(keyword in input_text.lower() for keyword in company_keywords) or \
           any(pattern in input_text.lower() for pattern in company_pattern_indicators):
            selected_tool_names.append(ToolName.GetCompanyGames.value)
        # Force enable websearch_tool for opinion agents — always needed for date/context lookups
        if agent.name in (AgentName.OpinionAgent.value, AgentName.SimplifiedOpinionAgent.value):
            selected_tool_names.append(ToolName.WebsearchTool.value)
        
        # Tool Dependency Binding: tools whose descriptions reference each other must be enabled together
        # Prevents "Tool not found" errors when LLM follows description guidance to call referenced tools
        if ToolName.GetCommonTopCharts.value in selected_tool_names:
            selected_tool_names.append(ToolName.GetGameStoreLeaderboard.value)
        if ToolName.GetGameStoreLeaderboard.value in selected_tool_names:
            selected_tool_names.append(ToolName.GetCommonTopCharts.value)
        if ToolName.GetGameLeaderboardRank.value in selected_tool_names:
            selected_tool_names.append(ToolName.GetGameStoreLeaderboard.value)
        
        logger.info("dynamic tool select:"+str([toolname_list[x] for x in hit_indexes]))
        for index in range(len(agent.tools)):
            tool_name = agent.tools[index].name
            is_tool_enabled[tool_name] = tool_name in selected_tool_names
        set_tools_enabled(game_context, "{}_{}".format(agent_stage_index, agent.name), is_tool_enabled)
    except asyncio.CancelledError as e:
        raise e
    except HandledException as e:
        logger.error(str(e))
    except:
        logger.error(traceback.format_exc())

# if value already exists, resolves using OR (will enable tool when not sure)
def set_tools_enabled(game_context: GameContext, index_with_agent_name: str, is_tool_enabled: Dict[str, bool]):
    if index_with_agent_name not in game_context.is_tool_enabled_by_agent:
        game_context.is_tool_enabled_by_agent[index_with_agent_name] = is_tool_enabled
        return
    existing_tool_enabled: Dict[str, bool] = game_context.is_tool_enabled_by_agent[index_with_agent_name]
    for tool_name, is_enabled in is_tool_enabled.items():
        existing_tool_enabled[tool_name] = existing_tool_enabled.get(tool_name, True) or is_enabled


def is_tool_enabled_for_current_step(context: 'RunContextWrapper[GameContext]', tool_name: str, agent_name: Optional[str] = None) -> bool:
    """
    Check if a specific tool is enabled for the current agent step.

    This function is designed to be called from within tool implementations (e.g., game_info_service)
    to conditionally include prompts that reference other tools. This ensures prompt content
    is consistent with the actual available tools, avoiding LLM hallucinations.

    IMPORTANT: This function uses the same lookup logic as get_tool_enabled() to ensure
    consistency. It only checks the CURRENT step's tool settings, not all steps.

    Args:
        context: The run context wrapper containing GameContext
        tool_name: The name of the tool to check (use ToolName enum values)
        agent_name: Optional agent name. If not provided, will try to infer from context.

    Returns:
        True if the tool is enabled, False if disabled.
        Defaults to True if no explicit setting exists (conservative approach).

    Usage Example:
        from dashboard_tools.tool_common import is_tool_enabled_for_current_step
        from dashboard_strategy.constants import ToolName

        if is_tool_enabled_for_current_step(context, ToolName.MetricsQueryTool.value):
            output += METRICS_TOOL_PROMPT

    Note:
        The key format is "{agent_stage_index}_{agent_name}" which is set during
        set_tools_enabled_for_agent() in the planning phase.
    """
    game_context = context.context


    # Try to determine the current agent name
    current_agent_name = agent_name
    if current_agent_name is None:
        # Try to get from context's current_agent_name if available
        current_agent_name = getattr(game_context, 'current_agent_name', None)

    if current_agent_name is None:
        # Fallback: search all step configurations for this tool
        # This is less accurate but maintains backward compatibility
        for index_with_agent_name, tool_settings in game_context.is_tool_enabled_by_agent.items():
            # Only check entries that match the current agent_stage_index
            if index_with_agent_name.startswith(f"{game_context.agent_stage_index}_"):
                if tool_name in tool_settings:
                    return tool_settings.get(tool_name, True)
        # If no matching step found, default to True
        return True

    # Use the same lookup logic as get_tool_enabled() for consistency
    # Key format: "{agent_stage_index}_{agent_name}"
    key = f"{game_context.agent_stage_index}_{current_agent_name}"
    return game_context.is_tool_enabled_by_agent.get(key, {}).get(tool_name, True)


def get_tool_description(tool: Tool) -> str:
    core_desc = tool.description
    for desc in tool.description.split('\n'):
        if len(desc) > 5:
            core_desc = desc
            break
    return core_desc

