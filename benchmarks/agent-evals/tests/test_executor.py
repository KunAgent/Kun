from dataclasses import dataclass
from pathlib import Path

import pytest

from kun_bench.config import ModelSettings
from kun_bench.executor import KunCliExecutor, KunExecutionRequest, file_sha256


@dataclass
class Result:
    return_code: int = 0
    stdout: str = ""
    stderr: str = ""


class FakeEnvironment:
    def __init__(self) -> None:
        self.uploads: dict[str, bytes] = {}
        self.commands: list[tuple[str, dict[str, str] | None]] = []

    async def upload_file(self, source: Path, target: str) -> None:
        self.uploads[target] = source.read_bytes()

    async def exec(self, command: str, **kwargs: object) -> Result:
        env = kwargs.get("env")
        self.commands.append((command, env if isinstance(env, dict) else None))
        return Result(stdout='{"type":"run_finished","status":"completed"}\n')


def request(archive: Path, *, commit: bool = False) -> KunExecutionRequest:
    return KunExecutionRequest(
        instruction="fix the task",
        workspace="/app",
        archive=archive,
        archive_sha256=file_sha256(archive),
        model=ModelSettings(
            base_url="https://provider.example/v1",
            api_key="secret-key",
            model="model-a",
            endpoint_format="openai-chat-completions",
        ),
        timeout_seconds=120,
        commit_worktree=commit,
    )


@pytest.mark.asyncio
async def test_executor_uploads_files_and_keeps_secret_out_of_commands(tmp_path: Path) -> None:
    archive = tmp_path / "kun.tar.gz"
    archive.write_bytes(b"archive")
    environment = FakeEnvironment()
    executor = KunCliExecutor()
    item = request(archive)

    await executor.setup(environment, item)
    result = await executor.run(environment, item)

    assert result.return_code == 0
    assert executor.prompt_target in environment.uploads
    assert environment.uploads[executor.prompt_target] == b"fix the task"
    assert b"secret-key" not in environment.uploads[executor.config_target]
    assert all("secret-key" not in command for command, _ in environment.commands)
    assert any(env and env["DEEPSEEK_API_KEY"] == "secret-key" for _, env in environment.commands)


@pytest.mark.asyncio
async def test_pier_execution_commits_after_agent_run(tmp_path: Path) -> None:
    archive = tmp_path / "kun.tar.gz"
    archive.write_bytes(b"archive")
    environment = FakeEnvironment()
    executor = KunCliExecutor()
    await executor.run(environment, request(archive, commit=True))
    assert any(
        "git commit -m 'kun benchmark solution'" in command for command, _ in environment.commands
    )
