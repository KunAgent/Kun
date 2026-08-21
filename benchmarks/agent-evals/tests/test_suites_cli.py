from pathlib import Path

from kun_bench.artifacts import RunLayout
from kun_bench.builder import build_command
from kun_bench.cli import main
from kun_bench.config import ModelSettings, SuiteSelection
from kun_bench.constants import DEEPSWE_COMMIT, HARBOR_VERSION, PIER_VERSION, SWE_BENCH_VERSION
from kun_bench.suites import build_suite_run, selection_flags


def model() -> ModelSettings:
    return ModelSettings(
        base_url="https://provider.example/v1",
        api_key="secret",
        model="model-a",
        endpoint_format="openai-chat-completions",
    )


def test_suite_commands_pin_agents_and_do_not_contain_secrets(tmp_path: Path) -> None:
    layout = RunLayout(tmp_path / "run")
    archive = tmp_path / "kun.tar.gz"
    archive.write_bytes(b"archive")
    deep = build_suite_run(
        name="deepswe",
        selection=SuiteSelection(tasks=["task-a"]),
        attempts=1,
        concurrency=1,
        layout=layout,
        archive=archive,
        archive_sha256="a" * 64,
        model=model(),
        run_id="run",
    )
    terminal = build_suite_run(
        name="terminal-bench",
        selection=SuiteSelection(limit=10),
        attempts=1,
        concurrency=1,
        layout=layout,
        archive=archive,
        archive_sha256="a" * 64,
        model=model(),
        run_id="run",
    )
    assert "kun_bench.pier_agent:KunPierAgent" in deep.command
    assert "kun_bench.harbor_agent:KunHarborAgent" in terminal.command
    assert "secret" not in " ".join(deep.command + terminal.command)
    assert selection_flags(SuiteSelection(limit=10), supports_seed=True) == [
        "--n-tasks",
        "10",
        "--sample-seed",
        "0",
    ]
    assert selection_flags(SuiteSelection(limit=10), supports_seed=False) == [
        "--n-tasks",
        "10",
    ]


def test_builder_is_linux_amd64_and_records_commit(tmp_path: Path) -> None:
    plan = build_command("a" * 40, tmp_path)
    assert "linux/amd64" in plan.command
    assert f"KUN_COMMIT={'a' * 40}" in plan.command


def test_all_suite_dry_run_succeeds_without_docker_or_model_env(tmp_path: Path) -> None:
    code = main(
        [
            "run",
            "--suite",
            "all",
            "--preset",
            "smoke",
            "--dry-run",
            "--run-id",
            "dry",
            "--artifact-root",
            str(tmp_path),
        ]
    )
    assert code == 0
    manifest = tmp_path / "dry" / "run-manifest.json"
    assert manifest.exists()
    assert main(["validate", "--run-id", "dry", "--artifact-root", str(tmp_path)]) == 0
    assert main(["summarize", "--run-id", "dry", "--artifact-root", str(tmp_path)]) == 0
    assert main(["resume", "--run-id", "dry", "--artifact-root", str(tmp_path)]) == 0


def test_dependency_pins_are_explicit() -> None:
    assert SWE_BENCH_VERSION == "v5.0.1"
    assert DEEPSWE_COMMIT == "3cda4081fed96103a6395de39c85e9b20275e307"
    assert PIER_VERSION == "0.3.0"
    assert HARBOR_VERSION == "0.21.0"
