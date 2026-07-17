"""Agent 运行时上下文定义。

AgentContext 随每次 query 通过 LangGraph config 注入，
全链路可通过 ctx.runtime.context 访问。
"""

from __future__ import annotations

import html
import json
from dataclasses import dataclass
from enum import Enum

from pydantic import BaseModel, Field
from typing import Any, Dict, List

try:
    from pydantic import field_validator  # pydantic v2
    _FIELD_VALIDATOR_KW = {"mode": "before"}
except ImportError:  # pydantic v1
    from pydantic import validator as field_validator
    _FIELD_VALIDATOR_KW = {"pre": True}


@dataclass(frozen=True)
class ReferenceItem:
    """工具产出的引用链接条目。"""
    type: str
    url: str
    title: str
    name: str
    favicon: str = ""
    image_url: str = ""
    mobile_url: str = ""

    def __hash__(self):
        return hash(self.url)

    def get(self, key, default_value=""):
        return self.to_dict().get(key, default_value)

    def to_dict(self):
        return {
            "url": self.url,
            "image_url": self.image_url,
            "favicon": self.favicon,
            "type": self.type,
            "title": html.unescape(self.title),
            "name": html.unescape(self.name),
            "mobile_url": self.mobile_url,
        }

    def to_json(self):
        return json.dumps(self.to_dict(), indent=4)


class BiDataCsvEntry(BaseModel):
    """完整 BI 数据 CSV 条目，供 Analyst Agent 沙箱使用。"""
    data_id: str
    full_csv: str = ""


class GameType(Enum):
    DATABRAIN = "databrain"
    WEBSITE = "website"


class _PlannerContext:
    """Minimal planner context shim. Tools access context.context.planner_context.rephrased_question."""

    def __init__(self, rephrased_question: str = "", use_excel: bool = False, intention: int = -1):
        self.rephrased_question = rephrased_question
        self.use_excel = use_excel
        self.intention = intention


class _IntelligenceContext(BaseModel):
    """Minimal intelligence context with entity tracking."""
    entity_ids: List[str] = []
    entity_names: List[str] = []
    align_to_release: bool = False


class _ChatFunctions:
    """Minimal chat_functions shim. Tools check context.context.chat_functions.function_source."""

    def __init__(self):
        # ChatFunctionSource.Empty = ""
        self.function_source = ""


class AgentContext(BaseModel):
    """per-query 上下文，随 LangGraph config 注入，全链路可通过 ctx.runtime.context 访问。"""

    class Config:
        arbitrary_types_allowed = True

    user_id: str | None = None
    query: str | None = None
    session_id: str | None = None
    message_id: str | None = None
    metadata: dict = Field(default_factory=dict)
    token: str | None = Field(
        default=None,
        description="请求鉴权 token（由调用方传入；main._get_user_env 注入 DATABRAIN_TOKEN）",
    )
    sql_token: str = ""
    databrain_host: str | None = Field(
        default=None,
        description="DataBrain API 主机基址（由调用方传入；main._get_user_env 注入 DATABRAIN_HOST）",
    )
    sql_databrain_host: str = ""
    databrain_display_host: str | None = Field(
        default=None,
        description="DataBrain 系统链接展示主机（由调用方传入；优先用于拼接系统链接）",
    )
    # skill agent 产出目录
    session_output_dir: str | None = None
    # request 内维护的 todo 列表快照（用于流式兜底输出）
    todo_list: list[dict] = Field(default_factory=list)

    # ── 工具需要的运行时字段 ──
    mode: str = "deepthink"  # DatabrainMode: all / auto / fastqa / deepthink
    is_summary: bool = False
    chat_source: str = ""
    system_language: str = ""  # ISO code e.g. "zh-CN", 由 LanguageDetector 填充

    # ── DataBrain GameContext 字段（从 hermes 迁移）──
    game_names: List[str] = []
    additional_game_names: List[str] = []
    ner_game_names: List[dict] = []
    company_names: List[str] = []
    ner_company_names: List[dict] = []
    entities: List[dict] = []
    company_entities: List[dict] = []
    entity_ids: List[str] | None = []
    entity_names: List[str] | None = []
    entity_release_dates: Dict[str, List[dict]] = {}
    game_competitors: Dict[str, List[str]] = {}
    series_games: Dict[str, List[str]] = {}
    business_models: Dict[str, Any] = {}
    roblox_games: List[dict] = Field(default_factory=list)

    @field_validator("roblox_games", **_FIELD_VALIDATOR_KW)
    def _normalize_roblox_games(cls, value):
        """兼容历史输入：[]/null/false/单对象/字符串。"""
        if value is None or value is False:
            return []
        if value is True:
            return [{"name": "roblox"}]
        if isinstance(value, list):
            return value
        if isinstance(value, dict):
            return [value]
        return []

    language: str = "the same language as the user's input"
    country: List[str] | None = []
    region: List[str] | None = []

    # query pattern (NER/EL)
    query_pattern: str = ""
    query_pattern_args: Dict[str, str] = {}

    # intelligence context
    intelligence_context: _IntelligenceContext = Field(default_factory=_IntelligenceContext)
    data_describe_info: Dict[str, List[str]] = Field(default_factory=lambda: {"Intelligence Agent": []})

    # dashboard info
    dashboard_game_code_and_filters: dict = {}
    #dashboard_pc_enable_game_list_raw: Dict[str, str] = Field(default_factory=dict)
    dashboard_pc_enable_game_list_raw: Dict[str, dict] = {}  # {game_code: {"game_name_en": str, "game_type": str}}
    game_icon_mapping: dict = {}
    key_country: dict = {}
    dashboard_inner_vars: dict = Field(default_factory=dict)
    had_describe_data: bool = False
    mcp_fallback_required: bool = False
    mcp_fallback_game_info: dict = Field(default_factory=dict)

    # opinion info
    game_info_dict: Dict[str, dict] = {}
    topics: Dict[str, dict] = {}
    opinion_topic_selection: dict = {}
    opinion_filtered_tables: List[str] = []
    opinion_table_schema: str = ""
    opinion_report_card: List[dict] = Field(default_factory=list)

    # mgmt info
    mgmt_info: dict = {}
    studio_id_to_name: Dict[str, str] = Field(default_factory=dict)
    combine_id_to_name: Dict[str, str] = Field(default_factory=dict)
    topn_tool_called: bool = False

    # chart generation map
    chart_generation_map: dict = {}

    has_dashboard_data_list: List[dict] = []
    has_intelligence_data_list: List[dict] = []
    has_mgmt_data: List[dict] = []

    # bi_data for sandbox (工具运行时 append)
    bi_data_for_sandbox: List[Any] = Field(default_factory=list)

    # following will be set to empty on single agent result
    data: List[dict] = []
    additional_data: List[dict] = []
    additional_unstructured_data: List[str] = []
    additional_structured_data: List[dict] = []

    references: List[dict] = []

    # ── Rainbow 配置透传（服务启动时加载，通过 AGENT_CONTEXT_JSON 传入 skill）──
    rb_config: dict = Field(
        default_factory=dict,
        description=(
            "Rainbow 配置快照，包含 http_config / opinion_cube / rerank_retrieval / "
            "agent_config / url_map / supported_metrics_and_sources 等子项。"
            "skill 内部通过 context.rb_config['xxx'] 读取，不再直接依赖 Rainbow SDK。"
        ),
    )

    # ── 兼容性字段（工具代码通过这些属性名访问）──
    # user_input: alias for query — 工具代码用 context.context.user_input
    @property
    def user_input(self) -> str:
        return self.query or ""

    @user_input.setter
    def user_input(self, value: str):
        self.query = value

    # planner_context: 工具用 context.context.planner_context.rephrased_question
    @property
    def planner_context(self) -> _PlannerContext:
        if not hasattr(self, "_planner_context_cache"):
            object.__setattr__(self, "_planner_context_cache", _PlannerContext(self.query or ""))
        return self._planner_context_cache

    @planner_context.setter
    def planner_context(self, value):
        object.__setattr__(self, "_planner_context_cache", value)

    # chat_functions: 工具用 context.context.chat_functions.function_source
    @property
    def chat_functions(self) -> _ChatFunctions:
        if not hasattr(self, "_chat_functions_cache"):
            object.__setattr__(self, "_chat_functions_cache", _ChatFunctions())
        return self._chat_functions_cache


# Alias for backward compatibility: skill zip tools use `GameContext`
GameContext = AgentContext
