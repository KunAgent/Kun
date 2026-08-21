from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .artifacts import (
    Redactor,
    RunLayout,
    RunState,
    atomic_write_json,
    create_manifest,
    sha256_file,
)
from .builder import build_archive, build_command
from .config import ModelSettings, RunOptions, load_preset
from .constants import DEFAULT_ARTIFACT_ROOT, REPOSITORY_ROOT
from .environment import load_benchmark_environment
from .framework_results import ingest_framework_results
from .host import detect_host, normalize_host_path
from .preflight import docker_available, run_preflight
from .suites import (
    build_suite_run,
    command_text,
    ensure_deepswe_checkout,
    run_suite,
    swebench_request,
)


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(prog="kun-bench")
    subcommands = root.add_subparsers(dest="command", required=True)
    for name in ("preflight", "run"):
        command = subcommands.add_parser(name)
        add_run_options(command)
    build = subcommands.add_parser("build-kun")
    build.add_argument("--output", type=Path)
    build.add_argument("--dry-run", action="store_true")
    resume = subcommands.add_parser("resume")
    resume.add_argument("--run-id", required=True)
    resume.add_argument("--artifact-root", type=Path, default=DEFAULT_ARTIFACT_ROOT)
    resume.add_argument("--env-file", type=Path)
    for name in ("validate", "summarize"):
        command = subcommands.add_parser(name)
        command.add_argument("--run-id", required=True)
        command.add_argument("--artifact-root", type=Path, default=DEFAULT_ARTIFACT_ROOT)
    return root


def add_run_options(command: argparse.ArgumentParser) -> None:
    command.add_argument(
        "--suite",
        choices=("swebench", "deepswe", "terminal-bench", "all"),
        default="all",
    )
    command.add_argument("--preset", choices=("smoke", "pilot", "full"), default="smoke")
    command.add_argument("--run-id")
    command.add_argument("--kun-archive", type=Path)
    command.add_argument("--env-file", type=Path)
    command.add_argument("--artifact-root", type=Path, default=DEFAULT_ARTIFACT_ROOT)
    command.add_argument("--dry-run", action="store_true")


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        if args.command == "preflight":
            return preflight_command(args)
        if args.command == "build-kun":
            return build_command_cli(args)
        if args.command == "run":
            return run_command(args)
        if args.command == "resume":
            return resume_command(args)
        if args.command == "validate":
            return validate_command(args)
        if args.command == "summarize":
            return summarize_command(args)
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, sort_keys=True), file=sys.stderr)
        return 1
    return 2


def run_options(args: argparse.Namespace) -> RunOptions:
    run_id = args.run_id or datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    host = detect_host(REPOSITORY_ROOT)
    return RunOptions(
        suite=args.suite,
        preset=args.preset,
        run_id=run_id,
        dry_run=args.dry_run,
        kun_archive=normalize_host_path(args.kun_archive, host),
        env_file=normalize_host_path(args.env_file, host),
        artifact_root=normalize_host_path(args.artifact_root, host),
    )


def preflight_command(args: argparse.Namespace) -> int:
    options = run_options(args)
    environment = load_benchmark_environment(options.env_file, host=detect_host(REPOSITORY_ROOT))
    report = run_preflight(options, env=environment, repository_root=REPOSITORY_ROOT)
    print(report.model_dump_json(indent=2))
    return 0 if report.ok else 1


def build_command_cli(args: argparse.Namespace) -> int:
    ok, detail = docker_available()
    if not ok and not args.dry_run:
        raise RuntimeError(detail)
    commit = repository_commit()
    output = (args.output or DEFAULT_ARTIFACT_ROOT / "builds" / commit[:12]).resolve()
    plan = build_command(commit, output)
    if args.dry_run:
        print(json.dumps({"ok": True, "command": plan.command, "output": str(output)}, indent=2))
        return 0
    archive, checksum = build_archive(plan)
    print(json.dumps({"ok": True, "archive": str(archive), "sha256": checksum}, indent=2))
    return 0


def run_command(args: argparse.Namespace) -> int:
    options = run_options(args)
    preset = load_preset(options.preset)
    environment = load_benchmark_environment(options.env_file, host=detect_host(REPOSITORY_ROOT))
    report = run_preflight(options, env=environment, repository_root=REPOSITORY_ROOT)
    if not report.ok:
        print(report.model_dump_json(indent=2), file=sys.stderr)
        return 1
    model = placeholder_model() if options.dry_run else ModelSettings.from_environment(environment)
    layout = RunLayout(options.artifact_root / options.run_id)
    if layout.manifest.exists():
        raise RuntimeError(f"Run already exists: {layout.root}; use resume")
    layout.root.mkdir(parents=True, exist_ok=False)
    archive, checksum = resolve_archive(options, layout)
    manifest = create_manifest(
        run_id=options.run_id,
        repository_commit=repository_commit(),
        preset=preset.model_dump(mode="json"),
        selected_suites=options.selected_suites,
        model=None if options.dry_run else model.public_dict(),
        archive=None if options.dry_run else archive,
        dry_run=options.dry_run,
    )
    atomic_write_json(layout.manifest, manifest)
    redactor = Redactor([model.api_key])
    state = RunState(layout, redactor)
    if "deepswe" in options.selected_suites:
        ensure_deepswe_checkout(layout, dry_run=options.dry_run)
    failures = 0
    for suite_name in options.selected_suites:
        selection = preset.suites[suite_name]
        if suite_name == "swebench":
            atomic_write_json(
                layout.root / "swebench-request.json",
                swebench_request(
                    selection=selection,
                    layout=layout,
                    archive=archive,
                    archive_sha256=checksum,
                    model=model,
                    run_id=options.run_id,
                    concurrency=preset.concurrency,
                ),
            )
        suite = build_suite_run(
            name=suite_name,
            selection=selection,
            attempts=preset.attempts,
            concurrency=preset.concurrency,
            layout=layout,
            archive=archive,
            archive_sha256=checksum,
            model=model,
            run_id=options.run_id,
        )
        suite.output_dir.mkdir(parents=True, exist_ok=True)
        atomic_write_json(
            suite.output_dir / "command.json",
            {
                "argv": redactor.value(suite.command),
                "display": redactor.text(command_text(suite.command)),
            },
        )
        if options.dry_run:
            result = suite_result(suite_name, "dry_run", evaluated=False)
        else:
            return_code = run_suite(suite)
            if return_code == 0 and suite_name in {"deepswe", "terminal-bench"}:
                ingest_framework_results(suite_name, suite.output_dir / "jobs", state)
            status = "evaluated" if return_code == 0 else "infrastructure_failed"
            result = suite_result(
                suite_name,
                status,
                evaluated=return_code == 0,
                infrastructure_error=return_code != 0,
                return_code=return_code,
            )
            failures += int(return_code != 0)
        state.write_task(suite_name, "__suite__", result)
    summary = state.write_summary()
    print(json.dumps({"ok": failures == 0, "run_id": options.run_id, "summary": summary}, indent=2))
    return 0 if failures == 0 else 1


def resume_command(args: argparse.Namespace) -> int:
    host = detect_host(REPOSITORY_ROOT)
    artifact_root = normalize_host_path(args.artifact_root, host)
    env_file = normalize_host_path(args.env_file, host)
    if artifact_root is None:
        raise ValueError("Artifact root is required")
    layout = RunLayout(artifact_root / args.run_id)
    manifest = load_manifest(layout)
    preset_name = str(manifest.get("preset", {}).get("name", ""))
    preset = load_preset(preset_name)
    if manifest.get("preset_digest") != create_manifest_digest(preset):
        raise RuntimeError("Cannot resume: preset digest drifted")
    if manifest.get("repository_commit") != repository_commit():
        raise RuntimeError("Cannot resume: repository commit drifted")
    selected = list(manifest.get("selected_suites", []))
    if not selected:
        raise RuntimeError("Cannot resume: manifest has no selected suites")
    if manifest.get("dry_run") is True:
        return summarize_layout(layout)
    environment = load_benchmark_environment(env_file, host=host)
    model = ModelSettings.from_environment(environment)
    if manifest.get("model") != model.public_dict():
        raise RuntimeError("Cannot resume: public model configuration drifted")
    archive_record = manifest.get("kun_archive")
    if not isinstance(archive_record, dict):
        raise RuntimeError("Cannot resume: archive identity is missing")
    archive = Path(str(archive_record.get("path", ""))).expanduser().resolve()
    checksum = sha256_file(archive)
    if checksum != archive_record.get("sha256"):
        raise RuntimeError("Cannot resume: archive checksum drifted")
    state = RunState(layout, Redactor([model.api_key]))
    failures = 0
    if "deepswe" in selected:
        ensure_deepswe_checkout(layout, dry_run=False)
    for suite_name in selected:
        if state.completed(suite_name, "__suite__"):
            continue
        selection = preset.suites[suite_name]
        if suite_name == "swebench":
            atomic_write_json(
                layout.root / "swebench-request.json",
                swebench_request(
                    selection=selection,
                    layout=layout,
                    archive=archive,
                    archive_sha256=checksum,
                    model=model,
                    run_id=args.run_id,
                    concurrency=preset.concurrency,
                ),
            )
        suite = build_suite_run(
            name=suite_name,
            selection=selection,
            attempts=preset.attempts,
            concurrency=preset.concurrency,
            layout=layout,
            archive=archive,
            archive_sha256=checksum,
            model=model,
            run_id=args.run_id,
        )
        return_code = run_suite(suite)
        if return_code == 0 and suite_name in {"deepswe", "terminal-bench"}:
            ingest_framework_results(suite_name, suite.output_dir / "jobs", state)
        state.write_task(
            suite_name,
            "__suite__",
            suite_result(
                suite_name,
                "evaluated" if return_code == 0 else "infrastructure_failed",
                evaluated=return_code == 0,
                infrastructure_error=return_code != 0,
                return_code=return_code,
            ),
        )
        failures += int(return_code != 0)
    summary = state.write_summary()
    print(json.dumps({"ok": failures == 0, "run_id": args.run_id, "summary": summary}, indent=2))
    return 0 if failures == 0 else 1


def validate_command(args: argparse.Namespace) -> int:
    layout = RunLayout(args.artifact_root.expanduser().resolve() / args.run_id)
    manifest = load_manifest(layout)
    results = RunState(layout, Redactor([])).rebuild_results()
    expected = set(manifest.get("selected_suites", []))
    actual = {item.get("suite") for item in results}
    missing = sorted(expected - actual)
    validation = {"ok": not missing, "missing_suites": missing, "results": len(results)}
    print(json.dumps(validation, indent=2))
    return 0 if validation["ok"] else 1


def summarize_command(args: argparse.Namespace) -> int:
    layout = RunLayout(args.artifact_root.expanduser().resolve() / args.run_id)
    return summarize_layout(layout)


def summarize_layout(layout: RunLayout) -> int:
    load_manifest(layout)
    summary = RunState(layout, Redactor([])).write_summary()
    print(json.dumps(summary, indent=2))
    return 0


def resolve_archive(options: RunOptions, layout: RunLayout) -> tuple[Path, str]:
    if options.kun_archive:
        archive = options.kun_archive.expanduser().resolve()
        return archive, sha256_file(archive)
    if options.dry_run:
        return Path("/tmp/kun-benchmark-dry-run.tar.gz"), "0" * 64
    plan = build_command(repository_commit(), layout.root / "build")
    return build_archive(plan)


def repository_commit() -> str:
    return subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=REPOSITORY_ROOT, text=True
    ).strip()


def placeholder_model() -> ModelSettings:
    return ModelSettings(
        base_url="https://benchmark.invalid/v1",
        api_key="dry-run-secret",
        model="dry-run-model",
        endpoint_format="openai-chat-completions",
    )


def suite_result(
    suite: str,
    status: str,
    *,
    evaluated: bool,
    infrastructure_error: bool = False,
    return_code: int = 0,
) -> dict[str, Any]:
    return {
        "suite": suite,
        "task_id": "__suite__",
        "terminal": True,
        "status": status,
        "evaluated": evaluated,
        "infrastructure_error": infrastructure_error,
        "return_code": return_code,
    }


def load_manifest(layout: RunLayout) -> dict[str, Any]:
    if not layout.manifest.exists():
        raise ValueError(f"Run manifest not found: {layout.manifest}")
    return json.loads(layout.manifest.read_text(encoding="utf-8"))


def create_manifest_digest(preset: Any) -> str:
    from .artifacts import stable_digest

    return stable_digest(preset.model_dump(mode="json"))


if __name__ == "__main__":
    raise SystemExit(main())
