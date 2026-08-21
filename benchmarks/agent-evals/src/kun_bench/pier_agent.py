from __future__ import annotations

from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from pier.agents.base import BaseAgent
from pier.environments.base import BaseEnvironment
from pier.models.agent.context import AgentContext
from pier.models.agent.network import NetworkAllowlist

from .artifacts import Redactor
from .config import ModelSettings
from .executor import KunCliExecutor, KunExecutionRequest
from .framework_support import (
    materialize_trajectory,
    populate_context,
    validate_framework_trajectory,
)


class KunPierAgent(BaseAgent):
    SUPPORTS_ATIF = True

    def __init__(
        self,
        *args: Any,
        archive_path: str,
        archive_sha256: str,
        workspace: str = "/app",
        timeout_seconds: int = 5400,
        extra_env: dict[str, str] | None = None,
        version: str = "0.1.0",
        **kwargs: Any,
    ) -> None:
        super().__init__(*args, **kwargs)
        self._archive = Path(archive_path).expanduser().resolve()
        self._archive_sha256 = archive_sha256
        self._workspace = workspace
        self._timeout_seconds = timeout_seconds
        self._version = version
        self._settings = ModelSettings.from_environment(extra_env)
        self._redactor = Redactor([self._settings.api_key])
        self._executor = KunCliExecutor()
        self._instruction = ""

    @staticmethod
    def name() -> str:
        return "kun"

    def version(self) -> str:
        return self._version

    def network_allowlist(self) -> NetworkAllowlist:
        hostname = urlparse(self._settings.base_url).hostname
        return NetworkAllowlist(domains=[hostname] if hostname else [])

    def _request(self, instruction: str) -> KunExecutionRequest:
        return KunExecutionRequest(
            instruction=instruction,
            workspace=self._workspace,
            archive=self._archive,
            archive_sha256=self._archive_sha256,
            model=self._settings,
            timeout_seconds=self._timeout_seconds,
            commit_worktree=True,
        )

    async def setup(self, environment: BaseEnvironment) -> None:
        await self._executor.setup(environment, self._request("setup"))

    async def run(
        self,
        instruction: str,
        environment: BaseEnvironment,
        context: AgentContext,
    ) -> None:
        self._instruction = instruction
        await self._executor.run(environment, self._request(instruction))

    def populate_context_post_run(self, context: AgentContext) -> None:
        parsed = materialize_trajectory(
            logs_dir=self.logs_dir,
            instruction=self._instruction,
            model_name=self._settings.model,
            version=self._version,
            redactor=self._redactor,
        )
        if parsed is None:
            return
        validate_framework_trajectory(parsed.trajectory, "pier")
        populate_context(context, parsed)
