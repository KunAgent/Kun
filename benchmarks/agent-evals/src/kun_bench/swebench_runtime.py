from __future__ import annotations

import argparse
import io
import json
import shutil
import tarfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any

from swebench.harness.docker_utils import cleanup_container, copy_to_container
from swebench.harness.run_evaluation import (
    create_container,
)
from swebench.harness.run_evaluation import (
    main as run_official_evaluation,
)
from swebench.harness.utils import load_swebench_dataset, make_test_spec
from swebench.image_builder.constants import CONTAINER_WORKDIR
from swebench.logger import close_logger, setup_logger

import docker

from .artifacts import Redactor, atomic_write_json, atomic_write_text
from .config import ModelSettings, SuiteSelection
from .executor import KunCliExecutor, KunExecutionError, KunExecutionRequest


@dataclass
class DockerResult:
    return_code: int
    stdout: str
    stderr: str


class DockerBackend:
    def __init__(self, container: Any):
        self.container = container

    async def upload_file(self, source: Path, target: str) -> None:
        copy_to_container(self.container, source, PurePosixPath(target))

    async def exec(
        self,
        command: str,
        *,
        user: str | int | None = None,
        env: dict[str, str] | None = None,
        cwd: str | None = None,
        timeout_sec: int | None = None,
    ) -> DockerResult:
        del timeout_sec
        result = self.container.exec_run(
            ["/bin/bash", "-lc", command],
            user=user,
            workdir=cwd,
            environment=env,
            demux=True,
        )
        stdout_raw, stderr_raw = result.output or (b"", b"")
        return DockerResult(
            result.exit_code,
            (stdout_raw or b"").decode("utf-8", errors="replace"),
            (stderr_raw or b"").decode("utf-8", errors="replace"),
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", type=Path, required=True)
    return parser.parse_args()


def choose_instances(
    dataset: list[dict[str, Any]], selection: SuiteSelection
) -> list[dict[str, Any]]:
    if selection.tasks:
        wanted = set(selection.tasks)
        chosen = [item for item in dataset if item["instance_id"] in wanted]
        missing = wanted - {item["instance_id"] for item in chosen}
        if missing:
            raise ValueError(f"Unknown SWE-bench instances: {sorted(missing)}")
        return chosen
    ordered = sorted(dataset, key=lambda item: item["instance_id"])
    return ordered[: selection.limit] if selection.limit else ordered


async def generate_prediction(
    *,
    instance: dict[str, Any],
    request: dict[str, Any],
    client: Any,
    redactor: Redactor,
) -> dict[str, Any]:
    spec = make_test_spec(instance)
    output_dir = Path(request["output_dir"])
    task_dir = output_dir / "tasks" / instance["instance_id"]
    task_dir.mkdir(parents=True, exist_ok=True)
    logger = setup_logger(instance["instance_id"], task_dir / "generation.log")
    container = None
    try:
        container = create_container(spec, client, request["run_id"], logger)
        container.start()
        settings = ModelSettings.from_environment()
        execution = KunExecutionRequest(
            instruction=swe_prompt(instance),
            workspace=CONTAINER_WORKDIR,
            archive=Path(request["archive"]),
            archive_sha256=str(request["archive_sha256"]),
            model=settings,
            timeout_seconds=1800,
        )
        backend = DockerBackend(container)
        executor = KunCliExecutor()
        await executor.setup(backend, execution)
        agent_error = None
        try:
            await executor.run(backend, execution)
        except KunExecutionError as exc:
            agent_error = str(exc)
        copy_agent_logs(container, task_dir / "agent")
        patch = extract_patch(container, instance["base_commit"])
        atomic_write_text(task_dir / "patch.diff", patch)
        if patch:
            validate_patch(container, instance["base_commit"], task_dir / "patch.diff")
        result = {
            "suite": "swebench",
            "task_id": instance["instance_id"],
            "terminal": True,
            "status": (
                "agent_failed_with_patch"
                if agent_error and patch
                else "agent_failed"
                if agent_error
                else "patch_validated"
                if patch
                else "empty_patch"
            ),
            "infrastructure_error": False,
            "evaluated": False,
            "patch_bytes": len(patch.encode()),
            "agent_error": redactor.text(agent_error) if agent_error else None,
        }
        atomic_write_json(task_dir / "result.json", redactor.value(result))
        return {
            "instance_id": instance["instance_id"],
            "model_name_or_path": f"kun/{request['model_name']}",
            "model_patch": patch,
        }
    finally:
        cleanup_container(client, container, logger)
        close_logger(logger)


def extract_patch(container: Any, base_commit: str) -> str:
    container.exec_run(["git", "add", "-N", "--", "."], workdir=CONTAINER_WORKDIR)
    result = container.exec_run(
        [
            "git",
            "-c",
            "core.fileMode=false",
            "diff",
            "--binary",
            "--no-ext-diff",
            "--full-index",
            base_commit,
            "--",
        ],
        workdir=CONTAINER_WORKDIR,
    )
    if result.exit_code != 0:
        raise RuntimeError(result.output.decode("utf-8", errors="replace"))
    return result.output.decode("utf-8", errors="strict")


def validate_patch(container: Any, base_commit: str, patch: Path) -> None:
    copy_to_container(container, patch, PurePosixPath("/tmp/kun-model.patch"))
    command = (
        "set -euo pipefail; candidate=$(mktemp -d); "
        f'git worktree add --detach "$candidate" {base_commit}; '
        'git -C "$candidate" apply --check /tmp/kun-model.patch; '
        'git worktree remove "$candidate"'
    )
    result = container.exec_run(["/bin/bash", "-lc", command], workdir=CONTAINER_WORKDIR)
    if result.exit_code != 0:
        raise RuntimeError(f"Generated patch is not applicable: {result.output!r}")


def copy_agent_logs(container: Any, destination: Path) -> None:
    stream, _ = container.get_archive("/logs/agent")
    payload = io.BytesIO(b"".join(stream))
    destination.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=payload, mode="r:*") as archive:
        root = destination.resolve()
        for member in archive.getmembers():
            if not member.isfile():
                continue
            relative = Path(member.name)
            if relative.parts and relative.parts[0] == "agent":
                relative = Path(*relative.parts[1:])
            target = (destination / relative).resolve()
            if root not in target.parents:
                raise RuntimeError(f"Unsafe agent log archive path: {member.name}")
            source = archive.extractfile(member)
            if source is None:
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open("wb") as output:
                shutil.copyfileobj(source, output)


def swe_prompt(instance: dict[str, Any]) -> str:
    return (
        "Solve this SWE-bench issue autonomously in /testbed. Inspect the repository, "
        "implement the smallest correct fix, run relevant tests, and leave changes in the "
        "working tree. Do not search for a gold patch or ask for user input.\n\n"
        f"Instance: {instance['instance_id']}\nRepository: {instance['repo']}\n"
        f"Base commit: {instance['base_commit']}\n\n{instance['problem_statement']}"
    )


async def async_main() -> int:
    request = json.loads(parse_args().request.read_text(encoding="utf-8"))
    selection = SuiteSelection.model_validate(request["selection"])
    dataset = load_swebench_dataset(request["dataset"], request["split"])
    instances = choose_instances(dataset, selection)
    client = docker.from_env()
    redactor = Redactor([ModelSettings.from_environment().api_key])
    predictions = []
    for instance in instances:
        predictions.append(
            await generate_prediction(
                instance=instance, request=request, client=client, redactor=redactor
            )
        )
    output = Path(request["output_dir"])
    predictions_path = output / "predictions.jsonl"
    atomic_write_text(
        predictions_path,
        "".join(json.dumps(prediction, sort_keys=True) + "\n" for prediction in predictions),
    )
    report_path = run_official_evaluation(
        dataset_name=request["dataset"],
        split=request["split"],
        instance_ids=[item["instance_id"] for item in instances],
        predictions_path=str(predictions_path),
        max_workers=int(request["concurrency"]),
        open_file_limit=4096,
        run_id=request["run_id"],
        timeout=1800,
        rewrite_reports=False,
        modal=False,
        report_dir=str(output / "official"),
        task_repo=None,
    )
    report = json.loads(Path(report_path).read_text(encoding="utf-8"))
    resolved = set(report.get("resolved_ids", []))
    infrastructure = set(report.get("infra_failure_ids", [])) | set(report.get("error_ids", []))
    empty = set(report.get("empty_patch_ids", []))
    for instance in instances:
        instance_id = instance["instance_id"]
        result_path = output / "tasks" / instance_id / "result.json"
        result = json.loads(result_path.read_text(encoding="utf-8"))
        result.update(
            {
                "evaluated": instance_id not in infrastructure,
                "infrastructure_error": instance_id in infrastructure,
                "reward": 1 if instance_id in resolved else 0,
                "status": (
                    "resolved"
                    if instance_id in resolved
                    else "infrastructure_failed"
                    if instance_id in infrastructure
                    else "empty_patch"
                    if instance_id in empty
                    else "unresolved"
                ),
            }
        )
        atomic_write_json(result_path, redactor.value(result))
    return 0


def main() -> int:
    import asyncio

    return asyncio.run(async_main())


if __name__ == "__main__":
    raise SystemExit(main())
