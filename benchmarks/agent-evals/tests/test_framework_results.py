from pathlib import Path
from types import SimpleNamespace

from kun_bench.artifacts import Redactor, RunLayout, RunState
from kun_bench.framework_results import ingest_framework_results, standard_reward


class FakeTrialResult:
    @classmethod
    def model_validate_json(cls, _text: str) -> SimpleNamespace:
        return SimpleNamespace(
            task_name="task-a",
            trial_name="trial-a",
            verifier_result=SimpleNamespace(rewards={"reward": 0}),
            exception_info=None,
            agent_result=None,
        )


def test_framework_results_preserve_reward_zero_as_evaluated(tmp_path: Path, monkeypatch) -> None:
    jobs = tmp_path / "jobs" / "job" / "trials" / "trial-a"
    jobs.mkdir(parents=True)
    (jobs / "result.json").write_text("{}")
    state = RunState(RunLayout(tmp_path / "run"), Redactor([]))
    monkeypatch.setattr(
        "kun_bench.framework_results.trial_result_type", lambda _suite: FakeTrialResult
    )
    assert ingest_framework_results("terminal-bench", tmp_path / "jobs", state) == 1
    result = state.read_task("terminal-bench", "trial-a")
    assert result is not None
    assert result["evaluated"] is True
    assert result["infrastructure_error"] is False
    assert result["reward"] == 0


def test_standard_reward_prefers_canonical_keys() -> None:
    assert standard_reward({"reward": 0, "other": 1}) == 0
    assert standard_reward({"pass": 1}) == 1
    assert standard_reward({"partial": 0.5}) == 0.5
    assert standard_reward({"a": 1, "b": 0}) is None
