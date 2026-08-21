import json
from pathlib import Path

import pytest

from kun_bench.artifacts import Redactor, RunLayout, RunState, create_manifest, stable_digest
from kun_bench.config import ModelSettings, SuiteSelection, load_preset


def test_all_presets_are_valid_and_cover_three_suites() -> None:
    for name in ("smoke", "pilot", "full"):
        preset = load_preset(name)
        assert set(preset.suites) == {"swebench", "deepswe", "terminal-bench"}


def test_suite_selection_requires_one_selector() -> None:
    with pytest.raises(ValueError):
        SuiteSelection()
    with pytest.raises(ValueError):
        SuiteSelection(tasks=["a"], limit=1)


def test_model_settings_are_redacted_from_public_metadata() -> None:
    settings = ModelSettings(
        base_url="https://provider.example/v1",
        api_key="super-secret",
        model="model-a",
        endpoint_format="openai-chat-completions",
        reasoning_effort="max",
    )
    public = settings.public_dict()
    assert public["endpoint_host"] == "provider.example"
    assert "super-secret" not in json.dumps(public)
    redactor = Redactor([settings.api_key])
    assert redactor.value({"message": "token=super-secret"}) == {"message": "token=[REDACTED]"}


def test_run_state_rebuilds_deterministic_results_and_summary(tmp_path: Path) -> None:
    layout = RunLayout(tmp_path / "run")
    state = RunState(layout, Redactor(["secret"]))
    state.write_task(
        "swebench",
        "b",
        {
            "suite": "swebench",
            "task_id": "b",
            "terminal": True,
            "status": "evaluated",
            "evaluated": True,
            "reward": 0,
            "detail": "secret",
        },
    )
    state.write_task(
        "deepswe",
        "a",
        {
            "suite": "deepswe",
            "task_id": "a",
            "terminal": True,
            "status": "infrastructure_failed",
            "infrastructure_error": True,
        },
    )
    state.write_task(
        "deepswe",
        "__suite__",
        {"suite": "deepswe", "task_id": "__suite__", "terminal": True, "status": "evaluated"},
    )
    summary = state.write_summary()
    assert summary == {
        "tasks": 2,
        "status_counts": {"infrastructure_failed": 1, "evaluated": 1},
        "infrastructure_errors": 1,
        "official_failures": 1,
    }
    assert "secret" not in layout.results.read_text()


def test_manifest_identity_excludes_creation_time(tmp_path: Path) -> None:
    preset = load_preset("smoke").model_dump(mode="json")
    manifest = create_manifest(
        run_id="run-1",
        repository_commit="a" * 40,
        preset=preset,
        selected_suites=["swebench"],
        model=None,
        archive=None,
        dry_run=True,
    )
    assert manifest["preset_digest"] == stable_digest(preset)
    assert len(manifest["identity_digest"]) == 64
