from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass
from pathlib import Path

from .artifacts import RunLayout
from .config import ModelSettings, SuiteName, SuiteSelection
from .constants import (
    DEEPSWE_COMMIT,
    DEEPSWE_REPOSITORY,
    PACKAGE_ROOT,
    REPOSITORY_ROOT,
    SWE_BENCH_DATASET,
    TERMINAL_BENCH_DATASET,
)


@dataclass(frozen=True)
class SuiteRun:
    name: SuiteName
    command: list[str]
    cwd: Path
    env: dict[str, str]
    output_dir: Path


def build_suite_run(
    *,
    name: SuiteName,
    selection: SuiteSelection,
    attempts: int,
    concurrency: int,
    layout: RunLayout,
    archive: Path,
    archive_sha256: str,
    model: ModelSettings,
    run_id: str,
) -> SuiteRun:
    env = dict(os.environ)
    env.update(
        {
            "KUN_BENCH_BASE_URL": model.base_url,
            "KUN_BENCH_API_KEY": model.api_key,
            "KUN_BENCH_MODEL": model.model,
            "KUN_BENCH_ENDPOINT_FORMAT": model.endpoint_format,
            "PYTHONPATH": str(PACKAGE_ROOT / "src"),
        }
    )
    if model.reasoning_effort:
        env["KUN_BENCH_REASONING_EFFORT"] = model.reasoning_effort
    if model.service_tier:
        env["KUN_BENCH_SERVICE_TIER"] = model.service_tier
    output = layout.suite(name)
    agent_import = (
        "kun_bench.pier_agent:KunPierAgent"
        if name == "deepswe"
        else "kun_bench.harbor_agent:KunHarborAgent"
    )
    common_agent = [
        "--model",
        model.model,
        "--agent-import-path" if name == "deepswe" else "--agent",
        agent_import,
        "--ak",
        f"archive_path={archive}",
        "--ak",
        f"archive_sha256={archive_sha256}",
        "--ak",
        "workspace=/app",
    ]
    if name == "deepswe":
        deep_root = layout.root / "cache" / "deep-swe"
        command = [
            "pier",
            "run",
            "--path",
            str(deep_root / "tasks"),
            "--jobs-dir",
            str(output / "jobs"),
            "--job-name",
            run_id,
            "--n-attempts",
            str(attempts),
            "--n-concurrent",
            str(concurrency),
            "--env",
            "docker",
            "--yes",
            *common_agent,
            *selection_flags(selection, supports_seed=True),
        ]
    elif name == "terminal-bench":
        command = [
            "harbor",
            "run",
            "--dataset",
            TERMINAL_BENCH_DATASET,
            "--jobs-dir",
            str(output / "jobs"),
            "--job-name",
            run_id,
            "--n-attempts",
            str(attempts),
            "--n-concurrent",
            str(concurrency),
            "--env",
            "docker",
            "--yes",
            *common_agent,
            *selection_flags(selection, supports_seed=False),
        ]
    else:
        spec = layout.root / "swebench-request.json"
        command = [
            "uv",
            "run",
            "--project",
            str(PACKAGE_ROOT / "swebench"),
            "python",
            "-m",
            "kun_bench.swebench_runtime",
            "--request",
            str(spec),
        ]
    return SuiteRun(name=name, command=command, cwd=REPOSITORY_ROOT, env=env, output_dir=output)


def selection_flags(selection: SuiteSelection, *, supports_seed: bool) -> list[str]:
    if selection.tasks:
        flags: list[str] = []
        for task in selection.tasks:
            flags.extend(["--include-task-name", task])
        return flags
    if selection.limit:
        flags = ["--n-tasks", str(selection.limit)]
        if supports_seed:
            flags.extend(["--sample-seed", str(selection.sample_seed)])
        return flags
    return []


def ensure_deepswe_checkout(layout: RunLayout, *, dry_run: bool) -> Path:
    target = layout.root / "cache" / "deep-swe"
    if dry_run:
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    if not (target / ".git").exists():
        subprocess.run(
            ["git", "clone", "--filter=blob:none", DEEPSWE_REPOSITORY, str(target)], check=True
        )
    subprocess.run(["git", "-C", str(target), "fetch", "origin", DEEPSWE_COMMIT], check=True)
    subprocess.run(["git", "-C", str(target), "checkout", "--detach", DEEPSWE_COMMIT], check=True)
    actual = subprocess.check_output(
        ["git", "-C", str(target), "rev-parse", "HEAD"], text=True
    ).strip()
    if actual != DEEPSWE_COMMIT:
        raise RuntimeError(f"DeepSWE checkout drifted: expected {DEEPSWE_COMMIT}, found {actual}")
    return target


def swebench_request(
    *,
    selection: SuiteSelection,
    layout: RunLayout,
    archive: Path,
    archive_sha256: str,
    model: ModelSettings,
    run_id: str,
    concurrency: int,
) -> dict[str, object]:
    return {
        "schema_version": 1,
        "dataset": SWE_BENCH_DATASET,
        "split": "test",
        "selection": selection.model_dump(exclude_none=True),
        "output_dir": str(layout.suite("swebench")),
        "archive": str(archive),
        "archive_sha256": archive_sha256,
        "model_name": model.model,
        "run_id": run_id,
        "concurrency": concurrency,
    }


def run_suite(suite: SuiteRun) -> int:
    suite.output_dir.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(suite.command, cwd=suite.cwd, env=suite.env, check=False)
    return result.returncode


def command_text(command: list[str]) -> str:
    return " ".join(subprocess.list2cmdline([part]) for part in command)
