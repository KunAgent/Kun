from __future__ import annotations

import subprocess
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from .artifacts import sha256_file
from .constants import PACKAGE_ROOT, REPOSITORY_ROOT


@dataclass(frozen=True)
class ArchiveBuild:
    command: list[str]
    output_dir: Path
    app_version: str
    artifact_version: str
    tag: str
    commit: str


def build_command(commit: str, output_dir: Path, now: datetime | None = None) -> ArchiveBuild:
    instant = now or datetime.now(UTC)
    artifact_version = instant.strftime("%Y%m%d.%H%M")
    app_version = f"0.0.0-dev-{artifact_version.replace('.', '-')}"
    tag = f"dev-{artifact_version}"
    dockerfile = PACKAGE_ROOT / "docker" / "KunBenchmark.Dockerfile"
    command = [
        "docker",
        "buildx",
        "build",
        "--platform",
        "linux/amd64",
        "--file",
        str(dockerfile),
        "--build-arg",
        f"KUN_APP_VERSION={app_version}",
        "--build-arg",
        f"KUN_ARTIFACT_VERSION={artifact_version}",
        "--build-arg",
        f"KUN_TAG={tag}",
        "--build-arg",
        f"KUN_COMMIT={commit}",
        "--output",
        f"type=local,dest={output_dir}",
        str(REPOSITORY_ROOT),
    ]
    return ArchiveBuild(command, output_dir, app_version, artifact_version, tag, commit)


def build_archive(plan: ArchiveBuild) -> tuple[Path, str]:
    plan.output_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run(plan.command, check=True)
    archives = sorted(plan.output_dir.glob("Kun-TUI-*-linux-x64.tar.gz"))
    if len(archives) != 1:
        raise RuntimeError(f"Expected one Linux x64 Kun archive, found {len(archives)}")
    archive = archives[0]
    checksum = sha256_file(archive)
    sidecar = Path(f"{archive}.sha256")
    if sidecar.exists() and not sidecar.read_text(encoding="utf-8").startswith(checksum):
        raise RuntimeError("Packaged archive checksum sidecar does not match the archive")
    return archive, checksum
