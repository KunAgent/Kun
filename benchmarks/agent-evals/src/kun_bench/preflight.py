from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

from pydantic import BaseModel

from .artifacts import sha256_file
from .config import ModelSettings, RunOptions
from .constants import (
    FULL_FREE_DISK_BYTES,
    MIN_FREE_DISK_BYTES,
    PILOT_FREE_DISK_BYTES,
    RECOMMENDED_CPU_COUNT,
    RECOMMENDED_MEMORY_BYTES,
    REQUIRED_MODEL_ENV,
)
from .host import HostReport, SystemResources, amd64_compatible, detect_host, system_resources


class Blocker(BaseModel):
    code: str
    message: str
    deferred: bool = False


class Recommendation(BaseModel):
    code: str
    message: str


class DockerReport(BaseModel):
    available: bool
    message: str
    server_version: str | None = None
    os_type: str | None = None
    architecture: str | None = None


class PreflightReport(BaseModel):
    ok: bool
    dry_run: bool
    blockers: list[Blocker]
    recommendations: list[Recommendation]
    checks: dict[str, object]


def run_preflight(
    options: RunOptions,
    *,
    env: dict[str, str],
    repository_root: Path,
    host: HostReport | None = None,
    docker: DockerReport | None = None,
    resources: SystemResources | None = None,
    free_disk_bytes: int | None = None,
) -> PreflightReport:
    blockers: list[Blocker] = []
    recommendations: list[Recommendation] = []
    checks: dict[str, object] = {}
    host_report = host or detect_host(repository_root, env=env)
    docker_report = docker or inspect_docker()
    resource_report = resources or system_resources()
    checks["host"] = host_report.model_dump(mode="json")
    checks["resources"] = resource_report.model_dump(mode="json")
    add_host_blockers(blockers, options, host_report)

    uv_path = shutil.which("uv")
    checks["uv"] = uv_path
    if not uv_path:
        blockers.append(
            deferred_blocker(options, "uv_missing", "Install uv before running benchmarks")
        )

    free_bytes = (
        free_disk_bytes if free_disk_bytes is not None else shutil.disk_usage(repository_root).free
    )
    required_disk = disk_requirement(options.preset)
    checks["free_disk_bytes"] = free_bytes
    checks["required_disk_bytes"] = required_disk
    if free_bytes < required_disk:
        blockers.append(
            deferred_blocker(
                options,
                "disk_space",
                f"Preset {options.preset} requires {required_disk} free bytes; found {free_bytes}",
            )
        )

    add_resource_recommendations(recommendations, resource_report)
    checks["docker"] = docker_report.model_dump(mode="json")
    add_docker_blockers(blockers, options, docker_report)
    add_model_blockers(blockers, checks, options, env)

    if options.kun_archive:
        archive = options.kun_archive
        if not archive.is_file():
            blockers.append(
                Blocker(code="archive_missing", message=f"Archive not found: {archive}")
            )
        else:
            checks["kun_archive_sha256"] = sha256_file(archive)

    fatal = [blocker for blocker in blockers if not blocker.deferred]
    return PreflightReport(
        ok=not fatal,
        dry_run=options.dry_run,
        blockers=blockers,
        recommendations=recommendations,
        checks=checks,
    )


def add_host_blockers(blockers: list[Blocker], options: RunOptions, host: HostReport) -> None:
    if host.kind == "native-windows":
        blockers.append(
            deferred_blocker(
                options,
                "native_windows_unsupported",
                "Run benchmarks inside a WSL2 Ubuntu distribution, not native Windows Python",
            )
        )
    elif host.kind == "wsl1":
        blockers.append(
            deferred_blocker(
                options,
                "wsl2_required",
                "WSL1 is unsupported; upgrade it with wsl --set-version <name> 2",
            )
        )
    elif host.kind == "wsl2" and host.repository_on_windows_mount:
        blockers.append(
            deferred_blocker(
                options,
                "wsl_windows_filesystem",
                "Clone the repository under the WSL home filesystem, not /mnt/<drive>",
            )
        )
    if host.kind == "wsl2" and not amd64_compatible(host.machine):
        blockers.append(
            deferred_blocker(
                options,
                "wsl_architecture",
                f"The pinned benchmark images require amd64-compatible WSL; found {host.machine}",
            )
        )


def add_resource_recommendations(
    recommendations: list[Recommendation], resources: SystemResources
) -> None:
    if resources.cpu_count < RECOMMENDED_CPU_COUNT:
        recommendations.append(
            Recommendation(
                code="cpu_capacity",
                message=(
                    f"At least {RECOMMENDED_CPU_COUNT} CPUs are recommended; "
                    f"the environment reports {resources.cpu_count}"
                ),
            )
        )
    if resources.memory_bytes is not None and resources.memory_bytes < RECOMMENDED_MEMORY_BYTES:
        recommendations.append(
            Recommendation(
                code="memory_capacity",
                message=(
                    f"At least {RECOMMENDED_MEMORY_BYTES} bytes RAM are recommended; "
                    f"the environment reports {resources.memory_bytes}"
                ),
            )
        )


def add_docker_blockers(blockers: list[Blocker], options: RunOptions, docker: DockerReport) -> None:
    if not docker.available:
        blockers.append(deferred_blocker(options, "docker_unavailable", docker.message))
    elif docker.os_type and docker.os_type.lower() != "linux":
        blockers.append(
            deferred_blocker(
                options,
                "docker_linux_engine_required",
                f"Docker must use Linux containers; it reports {docker.os_type}",
            )
        )
    elif docker.architecture and docker.architecture.lower() not in {"amd64", "x86_64"}:
        blockers.append(
            deferred_blocker(
                options,
                "docker_architecture",
                f"Docker must support amd64 images; it reports {docker.architecture}",
            )
        )


def add_model_blockers(
    blockers: list[Blocker],
    checks: dict[str, object],
    options: RunOptions,
    env: dict[str, str],
) -> None:
    missing = [name for name in REQUIRED_MODEL_ENV if not env.get(name, "").strip()]
    checks["model_environment"] = "configured" if not missing else {"missing": missing}
    if missing:
        blockers.append(
            deferred_blocker(
                options,
                "model_environment",
                f"Missing required environment variables: {', '.join(missing)}",
            )
        )
        return
    try:
        ModelSettings.from_environment(env)
    except ValueError as exc:
        blockers.append(deferred_blocker(options, "model_environment_invalid", str(exc)))


def disk_requirement(preset: str) -> int:
    if preset == "full":
        return FULL_FREE_DISK_BYTES
    if preset == "pilot":
        return PILOT_FREE_DISK_BYTES
    return MIN_FREE_DISK_BYTES


def inspect_docker() -> DockerReport:
    if not shutil.which("docker"):
        return DockerReport(available=False, message="Docker CLI is not installed")
    template = "{{json .ServerVersion}}|{{json .OSType}}|{{json .Architecture}}"
    try:
        result = subprocess.run(
            ["docker", "info", "--format", template],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return DockerReport(available=False, message=f"Docker check failed: {exc}")
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or "daemon is unavailable"
        return DockerReport(available=False, message=f"Docker daemon is unavailable: {detail}")
    parts = result.stdout.strip().split("|")
    if len(parts) != 3:
        return DockerReport(
            available=False,
            message="Docker daemon is unavailable: server details were not reported",
        )
    version, os_type, architecture = (decode_docker_value(part) for part in parts)
    if not version:
        return DockerReport(
            available=False,
            message="Docker daemon is unavailable: server version was not reported",
        )
    return DockerReport(
        available=True,
        message=f"Docker server {version} ({os_type}/{architecture})",
        server_version=version,
        os_type=os_type,
        architecture=architecture,
    )


def docker_available() -> tuple[bool, str]:
    report = inspect_docker()
    return report.available, report.message


def decode_docker_value(value: str) -> str | None:
    if not value or value in {'""', "null"}:
        return None
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        parsed = value
    return str(parsed) if parsed else None


def deferred_blocker(options: RunOptions, code: str, message: str) -> Blocker:
    return Blocker(code=code, message=message, deferred=options.dry_run)
