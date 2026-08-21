from __future__ import annotations

import os
import platform
import re
import subprocess
from pathlib import Path
from typing import Literal

from pydantic import BaseModel

HostKind = Literal["linux", "wsl1", "wsl2", "native-windows", "other"]
WINDOWS_PATH = re.compile(r"^[A-Za-z]:[\\/]")
WSL_WINDOWS_MOUNT = re.compile(r"^/mnt/[a-z](?:/|$)", re.IGNORECASE)


class HostReport(BaseModel):
    kind: HostKind
    system: str
    machine: str
    kernel_release: str
    wsl_distribution: str | None = None
    repository_root: str
    repository_on_windows_mount: bool

    @property
    def is_wsl(self) -> bool:
        return self.kind in {"wsl1", "wsl2"}


class SystemResources(BaseModel):
    cpu_count: int
    memory_bytes: int | None


def detect_host(
    repository_root: Path,
    *,
    system: str | None = None,
    machine: str | None = None,
    kernel_release: str | None = None,
    env: dict[str, str] | None = None,
) -> HostReport:
    resolved_system = system or platform.system()
    resolved_machine = machine or platform.machine()
    resolved_kernel = kernel_release if kernel_release is not None else read_kernel_release()
    values = dict(os.environ) if env is None else env
    lower_kernel = resolved_kernel.lower()
    if resolved_system == "Windows":
        kind: HostKind = "native-windows"
    elif resolved_system == "Linux" and (
        "microsoft" in lower_kernel or values.get("WSL_DISTRO_NAME")
    ):
        kind = "wsl2" if "wsl2" in lower_kernel or "microsoft-standard" in lower_kernel else "wsl1"
    elif resolved_system == "Linux":
        kind = "linux"
    else:
        kind = "other"
    root = repository_root.expanduser().resolve()
    return HostReport(
        kind=kind,
        system=resolved_system,
        machine=resolved_machine,
        kernel_release=resolved_kernel,
        wsl_distribution=values.get("WSL_DISTRO_NAME") or None,
        repository_root=str(root),
        repository_on_windows_mount=bool(WSL_WINDOWS_MOUNT.match(root.as_posix())),
    )


def normalize_host_path(path: Path | None, host: HostReport) -> Path | None:
    if path is None:
        return None
    raw = str(path)
    if host.is_wsl and WINDOWS_PATH.match(raw):
        result = subprocess.run(
            ["wslpath", "-a", raw], capture_output=True, text=True, timeout=10, check=False
        )
        if result.returncode != 0 or not result.stdout.strip():
            detail = result.stderr.strip() or "wslpath returned no path"
            raise ValueError(f"Unable to translate Windows path {raw!r}: {detail}")
        return Path(result.stdout.strip()).expanduser().resolve()
    return path.expanduser().resolve()


def system_resources() -> SystemResources:
    cpu_count = os.cpu_count() or 1
    memory_bytes = linux_memory_bytes() if platform.system() == "Linux" else None
    return SystemResources(cpu_count=cpu_count, memory_bytes=memory_bytes)


def linux_memory_bytes(path: Path = Path("/proc/meminfo")) -> int | None:
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.startswith("MemTotal:"):
                return int(line.split()[1]) * 1024
    except (OSError, ValueError, IndexError):
        return None
    return None


def read_kernel_release(path: Path = Path("/proc/sys/kernel/osrelease")) -> str:
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError:
        return platform.release()


def amd64_compatible(machine: str) -> bool:
    return machine.strip().lower() in {"amd64", "x86_64"}
