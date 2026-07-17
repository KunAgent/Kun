from __future__ import annotations
from run_context_wrapper import RunContextWrapper
from loguru import logger
from datetime import datetime, timedelta, timezone
from dateutil import parser
import time
import traceback

from utils.cls import log_metrics
from utils.context import GameContext
from utils.constants import ToolName
from utils.tool_common import get_tool_enabled, function_tool
from utils.helper import default_tool_error_function
from utils.databrain_api import async_send_request_with_token, MGMT_MILESTONES_API
from utils.sensitive_data import set_sensitive_data_flag
from utils.mgmt_reference_utils import append_mgmt_reference_for_module
from utils.util import is_chinese_language


# Default lower bound when user asks about a specific project but gives no time window.
DEFAULT_FAR_PAST_DATE = "2000-01-01"

# Supported milestone query types for MGMT_MILESTONES_API `type` parameter.
# Keep in sync with the backend contract of /api/v1/mgmt_pc/chatbi/get_milestones.
MILESTONE_TYPE_LAUNCH = "launch"      # 即将上线 / Soft Launch / Global Launch / Early Access ...
MILESTONE_TYPE_GR = "gr"              # Gate Review meeting (高管团队 GMs+Michelle 做 Go/No-Go 决策、批下一阶段预算)
MILESTONE_TYPE_CHECKIN = "checkin"    # Check-in meeting (审查特定领域进展、确认/讨论 mandate 项目授权变更)
MILESTONE_TYPE_ALL = "all"            # 默认：所有里程碑（launch / gr / checkin / major update event 等）

ALLOWED_MILESTONE_TYPES = (
    MILESTONE_TYPE_LAUNCH,
    MILESTONE_TYPE_GR,
    MILESTONE_TYPE_CHECKIN,
    MILESTONE_TYPE_ALL,
)

# Human-readable description per milestone type, used for header/error messages.
MILESTONE_TYPE_DESC = {
    MILESTONE_TYPE_LAUNCH: "launch milestones (Soft Launch / Global Launch / Early Access etc.)",
    MILESTONE_TYPE_GR: "Gate Review (GR) meeting milestones",
    MILESTONE_TYPE_CHECKIN: "Check-in meeting milestones",
    MILESTONE_TYPE_ALL: "all milestones (launch / GR / check-in / major update event etc.)",
}


def _normalize_milestone_type(mtype: str | None) -> tuple[str, str]:
    """Validate / normalize the user-supplied ``type`` argument.

    Returns:
        ``(normalized_type, warning_note)``. ``warning_note`` is empty when the input
        was already a valid type; otherwise it contains a human-readable warning that
        should be surfaced via the tool message.
    """
    if mtype is None or str(mtype).strip() == "":
        return MILESTONE_TYPE_ALL, ""
    normalized = str(mtype).strip().lower()
    if normalized in ALLOWED_MILESTONE_TYPES:
        return normalized, ""
    return (
        MILESTONE_TYPE_ALL,
        f"Warning: invalid type '{mtype}', fallback to '{MILESTONE_TYPE_ALL}'. "
        f"Allowed: {', '.join(ALLOWED_MILESTONE_TYPES)}. ",
    )


def _safe_parse_date(value: str) -> datetime | None:
    """Parse a YYYY-MM-DD-ish string. Return None if unparseable."""
    if not value:
        return None
    try:
        return parser.parse(value)
    except Exception:
        return None


def _today_utc() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _add_years(dt: datetime, years: int) -> datetime:
    """Naive years arithmetic (Feb 29 -> Feb 28 on non-leap years)."""
    try:
        return dt.replace(year=dt.year + years)
    except ValueError:
        # Leap-day fallback
        return dt.replace(year=dt.year + years, day=28)


def _sanitize_date_window(start_date: str, end_date: str) -> tuple[str, str, list[str]]:
    """Validate / fall back the LLM-supplied date window.

    Behavior:
        - If `start_date` is unparseable, fall back to `2000-01-01`.
        - If `end_date` is unparseable, fall back to `today + 5 years`.
        - If `start_date > end_date`, swap them.

    Returns:
        (normalized_start, normalized_end, notes) where `notes` are human-readable
        warnings to be appended to the tool message.
    """
    notes: list[str] = []
    today = _today_utc()

    sd = _safe_parse_date(start_date)
    ed = _safe_parse_date(end_date)

    if sd is None:
        sd = parser.parse(DEFAULT_FAR_PAST_DATE)
        notes.append(
            f"Warning: invalid start_date '{start_date}', fallback to {DEFAULT_FAR_PAST_DATE}. "
        )
    if ed is None:
        fallback_end = _add_years(today, 5)
        ed = fallback_end
        notes.append(
            f"Warning: invalid end_date '{end_date}', fallback to {fallback_end.strftime('%Y-%m-%d')} (today+5y). "
        )

    if sd > ed:
        notes.append(
            f"Warning: start_date {sd.strftime('%Y-%m-%d')} > end_date {ed.strftime('%Y-%m-%d')}, swapped. "
        )
        sd, ed = ed, sd

    return sd.strftime("%Y-%m-%d"), ed.strftime("%Y-%m-%d"), notes


async def _call_milestones_api(
    context: RunContextWrapper[GameContext],
    start_date: str,
    end_date: str,
    combine_id: str | None = None,
    language: str = "en",
    mtype: str = MILESTONE_TYPE_ALL,
):
    """Call MGMT get_milestones API once.

    Returns the raw `data` dict from the backend (typically `{"projects": [...]}`),
    or None if the call failed.

    Args:
        mtype: Milestone type filter sent as the backend ``type`` parameter.
            One of: ``launch`` / ``gr`` / ``checkin`` / ``all`` (default ``all``).
    """
    filters: dict = {}
    if combine_id:
        filters["combine_id"] = str(combine_id)

    payload = {
        "start_date": start_date,
        "end_date": end_date,
        "filters": filters,
        "language": language,
        "type": mtype,
    }

    logger.info(f"[API call]-[mgmt_milestones]: payload={payload}")
    print(f"\033[93m[API call]-[mgmt_milestones]: Calling API with data: {payload}\033[0m")

    response = await async_send_request_with_token(
        MGMT_MILESTONES_API,
        payload,
        context.context.token,
        MGMT_MILESTONES_API,
        "POST",
        1,
        context.context.message_id,
    )

    response_json = response.json()
    code = response_json.get("code", -1)
    if code == 0:
        data = response_json.get("data", {}) or {}
        logger.info(f"[API return success]-[mgmt_milestones]: data={data}")
        return data
    logger.warning(f"[API return failed]-[mgmt_milestones]: {response_json.get('msg', 'unknown')}")
    return None


def _merge_projects(all_projects: list[dict], new_projects: list[dict]) -> list[dict]:
    """Merge `new_projects` into `all_projects` by combine_id; dedupe milestones by (milestone, date)."""
    if not isinstance(new_projects, list):
        return all_projects

    by_id: dict[str, dict] = {}
    for proj in all_projects:
        if not isinstance(proj, dict):
            continue
        cid = str(proj.get("combine_id", "") or "").strip()
        if cid:
            by_id[cid] = proj

    for proj in new_projects:
        if not isinstance(proj, dict):
            continue
        cid = str(proj.get("combine_id", "") or "").strip()
        new_milestones = proj.get("launch_milestones") or []
        if not isinstance(new_milestones, list):
            new_milestones = []

        if cid and cid in by_id:
            existing = by_id[cid]
            existing_ms = existing.get("launch_milestones") or []
            if not isinstance(existing_ms, list):
                existing_ms = []
            seen = {(str(m.get("milestone", "")), str(m.get("date", ""))) for m in existing_ms if isinstance(m, dict)}
            for m in new_milestones:
                if not isinstance(m, dict):
                    continue
                key = (str(m.get("milestone", "")), str(m.get("date", "")))
                if key not in seen:
                    existing_ms.append(m)
                    seen.add(key)
            existing["launch_milestones"] = existing_ms
            # Prefer non-empty name
            if not str(existing.get("name", "") or "").strip():
                existing["name"] = proj.get("name", "")
        else:
            if cid:
                by_id[cid] = dict(proj)
            else:
                # No combine_id from backend: keep as-is, use name as fallback key
                fallback_key = f"__noid__{str(proj.get('name', '') or '').strip()}"
                by_id[fallback_key] = dict(proj)

    return list(by_id.values())


def _format_projects_for_output(projects: list[dict]) -> str:
    """Render projects/milestones as a Markdown-ish table for the agent's tool output."""
    if not projects:
        return "No milestones found in the searched window."

    lines: list[str] = []
    lines.append("| Project | combine_id | Milestone | Date |")
    lines.append("| --- | --- | --- | --- |")
    for proj in projects:
        if not isinstance(proj, dict):
            continue
        name = str(proj.get("name", "") or "").strip() or "-"
        cid = str(proj.get("combine_id", "") or "").strip() or "-"
        ms_list = proj.get("launch_milestones") or []
        if not isinstance(ms_list, list) or not ms_list:
            lines.append(f"| {name} | {cid} | - | - |")
            continue
        for m in ms_list:
            if not isinstance(m, dict):
                continue
            milestone = str(m.get("milestone", "") or "").strip() or "-"
            date = str(m.get("date", "") or "").strip() or "-"
            lines.append(f"| {name} | {cid} | {milestone} | {date} |")
    return "\n".join(lines)


@function_tool(
    failure_error_function=default_tool_error_function,
    is_enabled=get_tool_enabled(ToolName.MgmtMilestonesTool.value),
    readable_name_map={
        "English": "MGMT Milestones Query Tool",
        "Chinese": "MGMT 项目里程碑查询工具",
    },
)
async def mgmt_milestones_query_tool(
    context: RunContextWrapper[GameContext],
    start_date: str,
    end_date: str,
    type: str = MILESTONE_TYPE_ALL,
) -> str:
    """Query project milestones (e.g. Soft Launch / Global Launch / Early Access, Gate
    Review meetings, Check-in meetings, etc.) and their dates.

    Use this tool when the user asks:
        - "When does <project> launch / soft-launch / globally launch / early-access?"
        - "Which projects are launching in <time window>?"
        - "Which projects are about to launch / upcoming launches?"
        - "When is the next GR (Gate Review) meeting for <project>?"
        - "Which projects have GR / check-in meetings in <time window>?"

    Args:
        start_date (str): Inclusive lower bound of the milestone window. Format: YYYY-MM-DD.
        end_date   (str): Inclusive upper bound of the milestone window. Format: YYYY-MM-DD. Must be >= start_date.
        type (str): Milestone type to query. One of:
            - ``"launch"``  → 即将上线/已上线类里程碑（Soft Launch / Global Launch / Early Access 等）。
                              用户问"上线/soft launch/global launch/EA/公测/即将上线/最近上线"时使用。
            - ``"gr"``      → Gate Review (GR) 评审会里程碑。GR 用于项目评审与反馈，涉及各相关评估团队
                              参与；会议由**高管团队（GMs 和 Michelle）作出 Go/No-Go 决策**，并审批下一个
                              GR 阶段的预算，同时对齐下一次 GR 的交付内容和工作重点。
                              用户问"GR / Gate Review / 管理层评审 / Go/No-Go / 预算审批 / 阶段评审 / 立项评审"时使用。
            - ``"checkin"`` → Check-in meeting 里程碑。Check-in 用于审查特定领域的项目进展，并**确认项目
                              授权（mandate）的变更情况**；该会议也是发起和讨论 mandate 变更申请的重要沟通渠道。
                              用户问"check-in / checkin / 项目同步会 / 进展同步会 / mandate 变更 / 项目授权变更 / mandate change"时使用。
            - ``"all"``     → 默认值，返回所有类型的里程碑（launch / GR / check-in / major update event 等）。
                              当用户问得宽泛、未指明里程碑类型时使用。
            非法值会自动 fallback 到 ``"all"`` 并在 message 中给出 warning。

    Time window default rules (LLM MUST follow):
        - If the user explicitly gives a time window, use it as-is.
        - If the user asks about ONE specific project but gives NO time window:
            start_date = 2000-01-01, end_date = today + 5 years.
        - If the user asks about projects "about to launch / upcoming / 即将上线" without a time window:
            start_date = today, end_date = today + 1 year.
        - If the user asks about "recently launched / 最近上线" type questions without a time window:
            start_date = today - 1 year, end_date = today + 1 year.
        - For GR / check-in queries without an explicit time window:
            start_date = today, end_date = today + 1 year (look forward at upcoming meetings).

    combine_id is auto-injected from context (do NOT pass it manually):
        - If context has one or more combine_ids, the tool calls the API once per combine_id and merges results.
        - If context has no combine_id, the tool queries ALL projects (no filter).

    The tool's output explicitly states the searched time window AND the milestone type.
    The agent MUST repeat both in its final answer.
    """
    logger.info(
        f"[Functool Call]-[mgmt_milestones_query_tool]: start_date={start_date}, "
        f"end_date={end_date}, type={type}"
    )

    start_time = time.time()
    message = ""
    merged_projects: list[dict] = []
    combine_ids: list[str] = []
    norm_type = MILESTONE_TYPE_ALL

    try:
        # Sanitize the time window first.
        norm_start, norm_end, sanitize_notes = _sanitize_date_window(start_date, end_date)
        if sanitize_notes:
            message += "".join(sanitize_notes)

        # Validate / normalize milestone type.
        norm_type, type_warning = _normalize_milestone_type(type)
        if type_warning:
            message += type_warning

        # Pull combine_ids from context (auto-inject; do NOT trust LLM input here).
        combine_id_to_name = getattr(context.context, "combine_id_to_name", {}) or {}
        if isinstance(combine_id_to_name, dict):
            combine_ids = [str(k).strip() for k in combine_id_to_name.keys() if str(k).strip()]

        # Resolve API language code (matches mgmt_topn_query_tool convention).
        display_language = context.context.language or "en"
        api_language = "zh" if is_chinese_language(display_language) else "en"

        # Fan out: per-combine_id call if we have IDs; otherwise one global call.
        if combine_ids:
            for cid in combine_ids:
                try:
                    res = await _call_milestones_api(
                        context, norm_start, norm_end, cid, api_language, norm_type
                    )
                    if res is None:
                        message += f"Failed to fetch milestones (type={norm_type}) for combine_id={cid}. "
                        continue
                    new_projects = res.get("projects") or []
                    if isinstance(new_projects, list):
                        merged_projects = _merge_projects(merged_projects, new_projects)
                except Exception as e:
                    err = f"Failed to query milestones (type={norm_type}) for combine_id={cid}: {str(e)}. "
                    logger.error(f"[Functool Error]-[mgmt_milestones_query_tool]: {err}")
                    message += err
        else:
            try:
                res = await _call_milestones_api(
                    context, norm_start, norm_end, None, api_language, norm_type
                )
                if res is None:
                    message += f"Failed to fetch milestones (type={norm_type}, no combine_id filter). "
                else:
                    new_projects = res.get("projects") or []
                    if isinstance(new_projects, list):
                        merged_projects = _merge_projects(merged_projects, new_projects)
            except Exception as e:
                err = f"Failed to query milestones (type={norm_type}, all projects): {str(e)}. "
                logger.error(f"[Functool Error]-[mgmt_milestones_query_tool]: {err}")
                message += err

        # Mark sensitive data + add MGMT reference (use the most generic 'business' link).
        if merged_projects:
            set_sensitive_data_flag(context.context)
            append_mgmt_reference_for_module(context, "business")

        formatted_table = _format_projects_for_output(merged_projects)

    except Exception as e:
        logger.warning(
            f"[mgmt_milestones_query_tool Exception]: {str(e)}, traceback={traceback.format_exc()}"
        )
        message += f"Encounter error in retrieving MGMT milestones: {str(e)}. \n"
        formatted_table = "No milestones returned due to an error."
        norm_start = start_date
        norm_end = end_date

    log_metrics(
        "mgmt_milestones_query_tool",
        "0",
        round((time.time() - start_time) * 1000, 2),
    )

    cid_display = ", ".join(combine_ids) if combine_ids else "ALL"
    type_desc = MILESTONE_TYPE_DESC.get(norm_type, norm_type)
    header = (
        f"[mgmt_milestones_query_tool] Searched {type_desc} (type={norm_type}) from "
        f"{norm_start} to {norm_end} (combine_ids={cid_display}). "
        f"Projects returned: {len(merged_projects)}."
    )
    logger.info(
        f"[Functool Return]-[mgmt_milestones_query_tool]: start_date={norm_start}, "
        f"end_date={norm_end}, type={norm_type}, combine_ids={combine_ids}, "
        f"projects_count={len(merged_projects)}, projects={merged_projects}, message={message}"
    )
    return f"{header}\n\n{formatted_table}\n\n{message}"[:8000000]
