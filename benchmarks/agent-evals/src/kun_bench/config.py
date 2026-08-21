from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

from pydantic import BaseModel, Field, model_validator

from .constants import CONFIG_ROOT, DEFAULT_AGENT_TIMEOUT_SECONDS

SuiteName = Literal["swebench", "deepswe", "terminal-bench"]
SuiteChoice = Literal["swebench", "deepswe", "terminal-bench", "all"]


class SuiteSelection(BaseModel):
    tasks: list[str] | None = None
    limit: int | None = Field(default=None, gt=0)
    sample_seed: int = 0
    all: bool = False

    @model_validator(mode="after")
    def validate_selector(self) -> SuiteSelection:
        selectors = int(bool(self.tasks)) + int(self.limit is not None) + int(self.all)
        if selectors != 1:
            raise ValueError("suite selection requires exactly one of tasks, limit, or all")
        if self.tasks and len(set(self.tasks)) != len(self.tasks):
            raise ValueError("suite task ids must be unique")
        return self


class Preset(BaseModel):
    name: str
    attempts: int = Field(gt=0)
    concurrency: int = Field(gt=0)
    suites: dict[SuiteName, SuiteSelection]

    @model_validator(mode="after")
    def validate_suites(self) -> Preset:
        expected = {"swebench", "deepswe", "terminal-bench"}
        if set(self.suites) != expected:
            raise ValueError(f"preset suites must be exactly {sorted(expected)}")
        return self


class ModelSettings(BaseModel):
    base_url: str
    api_key: str
    model: str
    endpoint_format: str
    reasoning_effort: Literal["auto", "off", "low", "medium", "high", "max"] | None = None
    service_tier: Literal["priority"] | None = None

    @model_validator(mode="after")
    def validate_values(self) -> ModelSettings:
        parsed = urlparse(self.base_url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise ValueError("KUN_BENCH_BASE_URL must be an absolute HTTP(S) URL")
        for key in ("api_key", "model", "endpoint_format"):
            if not getattr(self, key).strip():
                raise ValueError(f"{key} must not be blank")
        return self

    @classmethod
    def from_environment(cls, env: dict[str, str] | None = None) -> ModelSettings:
        values = dict(os.environ) if env is None else env
        return cls(
            base_url=values.get("KUN_BENCH_BASE_URL", ""),
            api_key=values.get("KUN_BENCH_API_KEY", ""),
            model=values.get("KUN_BENCH_MODEL", ""),
            endpoint_format=values.get("KUN_BENCH_ENDPOINT_FORMAT", ""),
            reasoning_effort=values.get("KUN_BENCH_REASONING_EFFORT") or None,
            service_tier=values.get("KUN_BENCH_SERVICE_TIER") or None,
        )

    def public_dict(self) -> dict[str, object]:
        parsed = urlparse(self.base_url)
        return {
            "endpoint_host": parsed.hostname,
            "model": self.model,
            "endpoint_format": self.endpoint_format,
            "reasoning_effort": self.reasoning_effort,
            "service_tier": self.service_tier,
        }


class RunOptions(BaseModel):
    suite: SuiteChoice
    preset: str
    run_id: str
    dry_run: bool = False
    kun_archive: Path | None = None
    env_file: Path | None = None
    artifact_root: Path
    agent_timeout_seconds: int = Field(default=DEFAULT_AGENT_TIMEOUT_SECONDS, gt=0)

    @property
    def selected_suites(self) -> list[SuiteName]:
        return ["swebench", "deepswe", "terminal-bench"] if self.suite == "all" else [self.suite]


def load_preset(name: str, root: Path = CONFIG_ROOT) -> Preset:
    path = root / f"{name}.json"
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        available = sorted(candidate.stem for candidate in root.glob("*.json"))
        raise ValueError(f"unknown preset {name!r}; available: {', '.join(available)}") from exc
    return Preset.model_validate(raw)
