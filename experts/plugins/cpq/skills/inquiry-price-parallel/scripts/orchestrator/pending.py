"""pending.json 生成（spec §6.4）：基于 task_states 直接分组。"""
from typing import Dict, List

_INSTRUCTION = (
    "请按 SKILL.md 步骤 6 的『回应用户模板』把上述内容原样转给用户，"
    "并收集回复写入 answers.json（task_answers 一对一映射）。"
)

_EXCERPT_LEN = 300


def _truncate(text: str, limit: int = _EXCERPT_LEN) -> str:
    if not text:
        return ""
    if len(text) <= limit:
        return text
    return text[:limit] + "…"


def _task_id_to_row(tasks: Dict) -> Dict[str, int]:
    return {t["task_id"]: t["source_row_index"] for t in tasks.get("tasks", [])}


def _task_id_to_message(tasks: Dict) -> Dict[str, str]:
    return {t["task_id"]: t["message"] for t in tasks.get("tasks", [])}


def build_pending(round_no: int, tasks: Dict, task_states: Dict) -> Dict:
    """构造 pending.json。

    Args:
        round_no: 当前轮次
        tasks: tasks.json 内容（取 source_row / source_row_md）
        task_states: task_states.json 内容
    """
    tid_to_row = _task_id_to_row(tasks)
    tid_to_msg = _task_id_to_message(tasks)

    counts = {"concluded": 0, "failed": 0, "asking": 0,
              "timeout": 0, "exception_will_retry": 0}
    asking_tasks: List[Dict] = []
    failed_tasks: List[Dict] = []
    timeouts: List[Dict] = []

    for tid, st in task_states.items():
        status = st.get("status", "")
        if status == "concluded":
            counts["concluded"] += 1
        elif status == "failed":
            counts["failed"] += 1
            failed_tasks.append({
                "task_id": tid,
                "source_row": tid_to_row.get(tid),
                "source_row_md": tid_to_msg.get(tid, ""),
                "result_info_excerpt": _truncate(st.get("result_info", "")),
            })
        elif status == "asking":
            counts["asking"] += 1
            asking_tasks.append({
                "task_id": tid,
                "source_row": tid_to_row.get(tid),
                "source_row_md": tid_to_msg.get(tid, ""),
                "remote_question": st.get("result_info", ""),
            })
        elif status == "timeout":
            counts["timeout"] += 1
            timeouts.append({
                "task_id": tid,
                "source_row": tid_to_row.get(tid),
                "source_row_md": tid_to_msg.get(tid, ""),
                "timeout_text": st.get("last_round_error", ""),
            })
        elif status == "exception":
            counts["exception_will_retry"] += 1

    return {
        "round": round_no,
        "summary": {"total": len(task_states), **counts},
        "asking_tasks": asking_tasks,
        "failed_tasks": failed_tasks,
        "timeouts": timeouts,
        "instruction_to_llm": _INSTRUCTION,
    }
