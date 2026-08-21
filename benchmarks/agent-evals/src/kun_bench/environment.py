from __future__ import annotations

import os
import stat
from pathlib import Path

from dotenv import dotenv_values

from .host import WSL_WINDOWS_MOUNT, HostReport, normalize_host_path


def load_benchmark_environment(
    env_file: Path | None,
    *,
    base: dict[str, str] | None = None,
    host: HostReport | None = None,
) -> dict[str, str]:
    environment = dict(os.environ) if base is None else dict(base)
    if env_file is None:
        return environment
    resolved = normalize_host_path(env_file, host) if host else env_file.expanduser().resolve()
    if host and host.is_wsl and WSL_WINDOWS_MOUNT.match(resolved.as_posix()):
        raise ValueError("Benchmark env file must be stored in the WSL Linux filesystem")
    if resolved is None or not resolved.is_file():
        raise ValueError(f"Benchmark env file not found: {resolved}")
    if os.name != "nt" and stat.S_IMODE(resolved.stat().st_mode) & 0o077:
        raise ValueError(f"Benchmark env file must be mode 600: chmod 600 {resolved}")
    file_values = {
        key: value for key, value in dotenv_values(resolved).items() if value is not None
    }
    return {**file_values, **environment}
