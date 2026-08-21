from __future__ import annotations

import hashlib
import json
import os
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .constants import (
    DEEPSWE_COMMIT,
    DEEPSWE_VERSION,
    HARBOR_VERSION,
    HARNESS_VERSION,
    PIER_VERSION,
    SWE_BENCH_COMMIT,
    SWE_BENCH_VERSION,
    TERMINAL_BENCH_COMMIT,
    TERMINAL_BENCH_DATASET,
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def stable_digest(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(encoded.encode()).hexdigest()


def atomic_write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def atomic_write_text(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(value, encoding="utf-8")
    os.replace(temporary, path)


class Redactor:
    def __init__(self, secrets: Iterable[str]):
        self._secrets = sorted({secret for secret in secrets if secret}, key=len, reverse=True)

    def text(self, value: str) -> str:
        for secret in self._secrets:
            value = value.replace(secret, "[REDACTED]")
        return value

    def value(self, value: Any) -> Any:
        if isinstance(value, str):
            return self.text(value)
        if isinstance(value, list):
            return [self.value(item) for item in value]
        if isinstance(value, dict):
            return {key: self.value(item) for key, item in value.items()}
        return value


@dataclass(frozen=True)
class RunLayout:
    root: Path

    @property
    def manifest(self) -> Path:
        return self.root / "run-manifest.json"

    @property
    def results(self) -> Path:
        return self.root / "generation-results.jsonl"

    @property
    def summary(self) -> Path:
        return self.root / "summary.json"

    def suite(self, name: str) -> Path:
        return self.root / "suites" / name

    def task(self, suite: str, task_id: str) -> Path:
        safe_id = task_id.replace("/", "__")
        return self.suite(suite) / "tasks" / safe_id


def create_manifest(
    *,
    run_id: str,
    repository_commit: str,
    preset: dict[str, Any],
    selected_suites: list[str],
    model: dict[str, object] | None,
    archive: Path | None,
    dry_run: bool,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "schema_version": 1,
        "harness_version": HARNESS_VERSION,
        "run_id": run_id,
        "created_at": datetime.now(UTC).isoformat(),
        "repository_commit": repository_commit,
        "dry_run": dry_run,
        "selected_suites": selected_suites,
        "preset": preset,
        "preset_digest": stable_digest(preset),
        "model": model,
        "pins": {
            "swebench": {"version": SWE_BENCH_VERSION, "commit": SWE_BENCH_COMMIT},
            "deepswe": {
                "version": DEEPSWE_VERSION,
                "commit": DEEPSWE_COMMIT,
                "pier": PIER_VERSION,
            },
            "terminal_bench": {
                "dataset": TERMINAL_BENCH_DATASET,
                "commit": TERMINAL_BENCH_COMMIT,
                "harbor": HARBOR_VERSION,
            },
        },
    }
    if archive:
        payload["kun_archive"] = {
            "name": archive.name,
            "path": str(archive.resolve()),
            "sha256": sha256_file(archive),
        }
    payload["identity_digest"] = stable_digest(
        {key: value for key, value in payload.items() if key not in {"created_at"}}
    )
    return payload


class RunState:
    def __init__(self, layout: RunLayout, redactor: Redactor):
        self.layout = layout
        self.redactor = redactor

    def write_task(self, suite: str, task_id: str, result: dict[str, Any]) -> None:
        path = self.layout.task(suite, task_id) / "result.json"
        atomic_write_json(path, self.redactor.value(result))

    def read_task(self, suite: str, task_id: str) -> dict[str, Any] | None:
        path = self.layout.task(suite, task_id) / "result.json"
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))

    def completed(self, suite: str, task_id: str) -> bool:
        result = self.read_task(suite, task_id)
        return bool(
            result
            and result.get("terminal") is True
            and result.get("infrastructure_error") is not True
        )

    def rebuild_results(self) -> list[dict[str, Any]]:
        results = []
        suites_root = self.layout.root / "suites"
        for path in sorted(suites_root.glob("*/tasks/*/result.json")):
            results.append(json.loads(path.read_text(encoding="utf-8")))
        suites_with_trials = {
            str(item.get("suite")) for item in results if item.get("task_id") != "__suite__"
        }
        results = [
            item
            for item in results
            if item.get("task_id") != "__suite__" or item.get("suite") not in suites_with_trials
        ]
        lines = "".join(json.dumps(item, sort_keys=True) + "\n" for item in results)
        atomic_write_text(self.layout.results, lines)
        return results

    def write_summary(self) -> dict[str, Any]:
        results = self.rebuild_results()
        counts: dict[str, int] = {}
        infrastructure_errors = 0
        for result in results:
            status = str(result.get("status", "unknown"))
            counts[status] = counts.get(status, 0) + 1
            if result.get("infrastructure_error") is True:
                infrastructure_errors += 1
        summary = {
            "tasks": len(results),
            "status_counts": counts,
            "infrastructure_errors": infrastructure_errors,
            "official_failures": sum(
                1 for item in results if item.get("evaluated") is True and item.get("reward") == 0
            ),
        }
        atomic_write_json(self.layout.summary, summary)
        return summary
