from __future__ import annotations

from pathlib import Path
from typing import Any, override

from harbor.agents.base import BaseAgent
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext

from .artifacts import Redactor
from .config import ModelSettings
from .executor import KunCliExecutor, KunExecutionRequest
from .framework_support import (
    materialize_trajectory,
    populate_context,
    validate_framework_trajectory,
)


class KunHarborAgent(BaseAgent):
    SUPPORTS_ATIF = True

    def __init__(
        self,
        *args: Any,
        archive_path: str,
        archive_sha256: str,
        workspace: str = "/app",
        timeout_seconds: int = 1800,
        extra_env: dict[str, str] | None = None,
        version: str = "0.1.0",
        **kwargs: Any,
    ) -> None:
        super().__init__(*args, extra_env=extra_env, **kwargs)
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
    @override
    def name() -> str:
        return "kun"

    @override
    def version(self) -> str:
        return self._version

    def _request(self, instruction: str) -> KunExecutionRequest:
        return KunExecutionRequest(
            instruction=instruction,
            workspace=self._workspace,
            archive=self._archive,
            archive_sha256=self._archive_sha256,
            model=self._settings,
            timeout_seconds=self._timeout_seconds,
        )

    @override
    async def setup(self, environment: BaseEnvironment) -> None:
        await self._executor.setup(environment, self._request("setup"))

    @override
    async def run(
        self,
        instruction: str,
        environment: BaseEnvironment,
        context: AgentContext,
    ) -> None:
        self._instruction = instruction
        await self._executor.run(environment, self._request(instruction))

    @override
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
        validate_framework_trajectory(parsed.trajectory, "harbor")
        populate_context(context, parsed)
