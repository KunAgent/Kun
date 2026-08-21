from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .artifacts import Redactor
from .trajectory import ParsedRun, convert_kun_jsonl, read_jsonl, write_redacted_trajectory


def populate_context(context: Any, parsed: ParsedRun) -> None:
    values = {
        "n_input_tokens": parsed.usage.prompt_tokens,
        "n_output_tokens": parsed.usage.completion_tokens,
        "n_cache_tokens": parsed.usage.cached_tokens,
        "cost_usd": parsed.usage.cost_usd or None,
        "peak_context_tokens": parsed.trajectory.get("final_metrics", {})
        .get("extra", {})
        .get("peak_context_tokens"),
        "summarization_count": parsed.trajectory.get("final_metrics", {})
        .get("extra", {})
        .get("summarization_count"),
        "n_agent_steps": max(0, len(parsed.trajectory.get("steps", [])) - 1),
    }
    for key, value in values.items():
        if value is not None and hasattr(context, key):
            setattr(context, key, value)
    metadata = dict(getattr(context, "metadata", None) or {})
    metadata.update(
        {
            "kun_terminal_status": parsed.terminal_status,
            "kun_runtime_errors": parsed.errors,
        }
    )
    context.metadata = metadata


def materialize_trajectory(
    *,
    logs_dir: Path,
    instruction: str,
    model_name: str,
    version: str,
    redactor: Redactor,
) -> ParsedRun | None:
    events_path = logs_dir / "kun-events.jsonl"
    if not events_path.exists():
        return None
    parsed = convert_kun_jsonl(
        read_jsonl(events_path),
        instruction=instruction,
        model_name=model_name,
        agent_version=version,
    )
    write_redacted_trajectory(logs_dir / "trajectory.json", parsed, redactor)
    return parsed


def validate_framework_trajectory(trajectory: dict[str, Any], framework: str) -> None:
    if framework == "harbor":
        from harbor.models.trajectories import Trajectory
    elif framework == "pier":
        from pier.models.trajectories import Trajectory
    else:
        raise ValueError(f"Unsupported framework: {framework}")
    Trajectory.model_validate(trajectory)


def read_result(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))
