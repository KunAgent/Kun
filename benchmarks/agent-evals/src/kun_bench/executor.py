from __future__ import annotations

import hashlib
import json
import shlex
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from .config import ModelSettings
from .constants import DEFAULT_GRACE_SECONDS


class EnvironmentBackend(Protocol):
    async def upload_file(self, source: Path, target: str) -> None: ...

    async def exec(
        self,
        command: str,
        *,
        user: str | int | None = None,
        env: dict[str, str] | None = None,
        cwd: str | None = None,
        timeout_sec: int | None = None,
    ) -> Any: ...


@dataclass(frozen=True)
class NormalizedExecResult:
    return_code: int
    stdout: str
    stderr: str


@dataclass(frozen=True)
class KunExecutionResult:
    return_code: int
    stdout: str
    stderr: str
    events_path: str
    stderr_path: str


@dataclass(frozen=True)
class KunExecutionRequest:
    instruction: str
    workspace: str
    archive: Path
    archive_sha256: str
    model: ModelSettings
    timeout_seconds: int
    max_steps: int = 100
    max_tool_calls_per_step: int = 16
    commit_worktree: bool = False


class KunExecutionError(RuntimeError):
    def __init__(self, result: KunExecutionResult):
        super().__init__(f"Kun exited with code {result.return_code}: {result.stderr[-1000:]}")
        self.result = result


class KunCliExecutor:
    archive_target = "/tmp/kun-benchmark.tar.gz"
    config_target = "/logs/agent/kun-config.json"
    prompt_target = "/logs/agent/prompt.txt"
    events_target = "/logs/agent/kun-events.jsonl"
    stderr_target = "/logs/agent/kun-stderr.log"
    data_dir = "/logs/agent/kun-data"
    binary = "/opt/kun/bin/kun"

    async def setup(self, environment: EnvironmentBackend, request: KunExecutionRequest) -> None:
        await environment.upload_file(request.archive, self.archive_target)
        expected = shlex.quote(request.archive_sha256)
        archive = shlex.quote(self.archive_target)
        await checked_exec(
            environment,
            (
                "set -euo pipefail; mkdir -p /logs/agent /opt; "
                f"test \"$(sha256sum {archive} | awk '{{print $1}}')\" = {expected}; "
                "rm -rf /opt/kun; "
                f"tar -xzf {archive} -C /opt; "
                f"test -x {self.binary}; {self.binary} --version"
            ),
            user="root",
        )
        config = benchmark_config(request)
        await upload_text(environment, self.config_target, json.dumps(config, indent=2) + "\n")

    async def run(
        self,
        environment: EnvironmentBackend,
        request: KunExecutionRequest,
    ) -> KunExecutionResult:
        await upload_text(environment, self.prompt_target, request.instruction)
        process_env = {
            "DEEPSEEK_API_KEY": request.model.api_key,
            "KUN_BASE_URL": request.model.base_url,
            "KUN_MODEL": request.model.model,
            "KUN_ENDPOINT_FORMAT": request.model.endpoint_format,
        }
        timeout = request.timeout_seconds
        args = [
            self.binary,
            "run",
            "--config",
            self.config_target,
            "--data-dir",
            self.data_dir,
            "--workspace",
            request.workspace,
            "--model",
            request.model.model,
            "--approval-policy",
            "auto",
            "--sandbox-mode",
            "workspace-write",
            "--prompt-file",
            self.prompt_target,
            "--reasoning-effort",
            request.model.reasoning_effort or "auto",
            "--max-steps",
            str(request.max_steps),
            "--max-wall-time-ms",
            str(timeout * 1000),
            "--max-tool-calls-per-step",
            str(request.max_tool_calls_per_step),
            "--jsonl",
        ]
        if request.model.service_tier:
            args.extend(["--service-tier", request.model.service_tier])
        command = (
            "set -o pipefail; mkdir -p /logs/agent; "
            f"timeout --signal=TERM --kill-after={DEFAULT_GRACE_SECONDS}s "
            f"{timeout + DEFAULT_GRACE_SECONDS}s {shlex.join(args)} "
            f"2> >(tee {shlex.quote(self.stderr_target)} >&2) "
            f"| tee {shlex.quote(self.events_target)}"
        )
        raw = await environment.exec(
            command,
            env=process_env,
            cwd=request.workspace,
            timeout_sec=timeout + DEFAULT_GRACE_SECONDS * 2,
        )
        normalized = normalize_exec_result(raw)
        if request.commit_worktree:
            await commit_changes(environment, request.workspace)
        result = KunExecutionResult(
            return_code=normalized.return_code,
            stdout=normalized.stdout,
            stderr=normalized.stderr,
            events_path=self.events_target,
            stderr_path=self.stderr_target,
        )
        if result.return_code != 0:
            raise KunExecutionError(result)
        return result


def benchmark_config(request: KunExecutionRequest) -> dict[str, object]:
    return {
        "serve": {
            "baseUrl": request.model.base_url,
            "endpointFormat": request.model.endpoint_format,
            "model": request.model.model,
            "approvalPolicy": "auto",
            "sandboxMode": "workspace-write",
            "approvalReviewer": "user",
        },
        "runtime": {
            "streamIdleTimeoutMs": min(request.timeout_seconds * 1000, 450_000),
            "turnLimits": {
                "maxSteps": request.max_steps,
                "maxWallTimeMs": request.timeout_seconds * 1000,
                "maxToolCallsPerStep": request.max_tool_calls_per_step,
            },
            "llmDebug": {"enabled": False},
        },
    }


async def upload_text(environment: EnvironmentBackend, target: str, content: str) -> None:
    with tempfile.TemporaryDirectory(prefix="kun-bench-upload-") as temporary:
        source = Path(temporary) / Path(target).name
        source.write_text(content, encoding="utf-8")
        await environment.upload_file(source, target)


async def checked_exec(
    environment: EnvironmentBackend,
    command: str,
    *,
    user: str | int | None = None,
) -> NormalizedExecResult:
    result = normalize_exec_result(await environment.exec(command, user=user))
    if result.return_code != 0:
        raise RuntimeError(f"Environment command failed ({result.return_code}): {result.stderr}")
    return result


def normalize_exec_result(result: Any) -> NormalizedExecResult:
    code = getattr(result, "return_code", getattr(result, "exit_code", 0))
    stdout = getattr(result, "stdout", "") or ""
    stderr = getattr(result, "stderr", "") or ""
    if isinstance(stdout, bytes):
        stdout = stdout.decode("utf-8", errors="replace")
    if isinstance(stderr, bytes):
        stderr = stderr.decode("utf-8", errors="replace")
    return NormalizedExecResult(int(code), str(stdout), str(stderr))


async def commit_changes(environment: EnvironmentBackend, workspace: str) -> None:
    command = (
        f"set -euo pipefail; cd {shlex.quote(workspace)}; "
        "git config user.name 'Kun Benchmark'; "
        "git config user.email 'benchmark@kun.local'; "
        "git add -A; "
        "if ! git diff --cached --quiet; then git commit -m 'kun benchmark solution'; fi"
    )
    await checked_exec(environment, command, user=None)


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
