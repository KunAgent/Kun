from __future__ import annotations
from enum import Enum

DATE_FORMAT = "%Y-%m-%d %H:%M:%S"


class AgentName(Enum):
    MgmtAgent = "Mgmt Agent"


class ChatSource(Enum):
    Databrain = "databrain"
    Iwiki = "iwiki"
    Skill = "skill"
    Wecom = "wecom"


class ToolName(Enum):
    MgmtMetricsQueryTool = "mgmt_metrics_query_tool"
    MgmtTopNTool = "mgmt_topn_query_tool"
    MgmtMilestonesTool = "mgmt_milestones_query_tool"
