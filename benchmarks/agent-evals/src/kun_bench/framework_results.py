from __future__ import annotations

from pathlib import Path
from typing import Any

from .artifacts import RunState


def ingest_framework_results(suite: str, jobs_dir: Path, state: RunState) -> int:
    trial_result = trial_result_type(suite)
    ingested = 0
    for path in sorted(jobs_dir.glob("**/result.json")):
        try:
            parsed = trial_result.model_validate_json(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        rewards = parsed.verifier_result.rewards if parsed.verifier_result else None
        reward = standard_reward(rewards)
        infrastructure_error = parsed.exception_info is not None or parsed.verifier_result is None
        result: dict[str, Any] = {
            "suite": suite,
            "task_id": parsed.task_name,
            "trial_name": parsed.trial_name,
            "terminal": True,
            "status": "infrastructure_failed" if infrastructure_error else "evaluated",
            "evaluated": not infrastructure_error,
            "infrastructure_error": infrastructure_error,
            "reward": reward,
            "rewards": rewards,
            "exception": (
                parsed.exception_info.model_dump(mode="json") if parsed.exception_info else None
            ),
            "agent_result": (
                parsed.agent_result.model_dump(mode="json") if parsed.agent_result else None
            ),
        }
        state.write_task(suite, parsed.trial_name, result)
        ingested += 1
    return ingested


def trial_result_type(suite: str) -> Any:
    if suite == "deepswe":
        from pier.models.trial.result import TrialResult
    elif suite == "terminal-bench":
        from harbor.models.trial.result import TrialResult
    else:
        raise ValueError(f"Unsupported framework suite: {suite}")
    return TrialResult


def standard_reward(rewards: dict[str, float | int] | None) -> float | int | None:
    if not rewards:
        return None
    if "reward" in rewards:
        return rewards["reward"]
    if "pass" in rewards:
        return rewards["pass"]
    return next(iter(rewards.values())) if len(rewards) == 1 else None
