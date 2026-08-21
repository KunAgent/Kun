from pathlib import Path
from types import SimpleNamespace

import pytest

from kun_bench.config import RunOptions
from kun_bench.environment import load_benchmark_environment
from kun_bench.host import HostReport, SystemResources, detect_host, normalize_host_path
from kun_bench.preflight import DockerReport, disk_requirement, run_preflight


def report(kind: str, root: str = "/home/user/repo", machine: str = "x86_64") -> HostReport:
    return HostReport(
        kind=kind,
        system="Linux" if kind != "native-windows" else "Windows",
        machine=machine,
        kernel_release="microsoft-standard-WSL2" if kind == "wsl2" else "kernel",
        wsl_distribution="Ubuntu" if kind.startswith("wsl") else None,
        repository_root=root,
        repository_on_windows_mount=root.startswith("/mnt/"),
    )


def options(tmp_path: Path, *, preset: str = "smoke", dry_run: bool = False) -> RunOptions:
    return RunOptions(
        suite="all",
        preset=preset,
        run_id="windows-test",
        dry_run=dry_run,
        artifact_root=tmp_path,
    )


def model_environment() -> dict[str, str]:
    return {
        "KUN_BENCH_BASE_URL": "https://provider.example/v1",
        "KUN_BENCH_API_KEY": "secret",
        "KUN_BENCH_MODEL": "model",
        "KUN_BENCH_ENDPOINT_FORMAT": "openai-chat-completions",
    }


def linux_docker(**overrides: object) -> DockerReport:
    values = {
        "available": True,
        "message": "ok",
        "server_version": "28.0",
        "os_type": "linux",
        "architecture": "amd64",
        **overrides,
    }
    return DockerReport.model_validate(values)


def test_detects_native_windows_wsl1_and_wsl2(tmp_path: Path) -> None:
    native = detect_host(tmp_path, system="Windows", machine="AMD64", kernel_release="10", env={})
    assert native.kind == "native-windows"
    wsl1 = detect_host(
        tmp_path,
        system="Linux",
        machine="x86_64",
        kernel_release="4.4.0-Microsoft",
        env={"WSL_DISTRO_NAME": "Ubuntu"},
    )
    assert wsl1.kind == "wsl1"
    wsl2 = detect_host(
        tmp_path,
        system="Linux",
        machine="x86_64",
        kernel_release="5.15.0-microsoft-standard-WSL2",
        env={"WSL_DISTRO_NAME": "Ubuntu"},
    )
    assert wsl2.kind == "wsl2"


def test_normalizes_windows_paths_with_wslpath(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(
        "kun_bench.host.subprocess.run",
        lambda *args, **kwargs: SimpleNamespace(
            returncode=0, stdout=f"{tmp_path}/archive.tar.gz\n", stderr=""
        ),
    )
    normalized = normalize_host_path(Path(r"C:\bench\archive.tar.gz"), report("wsl2"))
    assert normalized == (tmp_path / "archive.tar.gz").resolve()


def test_env_file_is_mode_600_and_process_environment_wins(tmp_path: Path) -> None:
    env_file = tmp_path / "benchmark.env"
    env_file.write_text("KUN_BENCH_API_KEY=file-secret\nKUN_BENCH_MODEL=file-model\n")
    env_file.chmod(0o600)
    loaded = load_benchmark_environment(
        env_file,
        base={"KUN_BENCH_MODEL": "process-model"},
        host=report("linux"),
    )
    assert loaded["KUN_BENCH_API_KEY"] == "file-secret"
    assert loaded["KUN_BENCH_MODEL"] == "process-model"
    env_file.chmod(0o644)
    with pytest.raises(ValueError, match="mode 600"):
        load_benchmark_environment(env_file, base={}, host=report("linux"))


def test_windows_preflight_enforces_wsl_filesystem_docker_and_full_disk(tmp_path: Path) -> None:
    result = run_preflight(
        options(tmp_path, preset="full"),
        env=model_environment(),
        repository_root=tmp_path,
        host=report("wsl2", "/mnt/c/repo"),
        docker=linux_docker(os_type="windows"),
        resources=SystemResources(cpu_count=4, memory_bytes=8 * 1024**3),
        free_disk_bytes=100 * 1024**3,
    )
    codes = {blocker.code for blocker in result.blockers}
    assert {"wsl_windows_filesystem", "docker_linux_engine_required", "disk_space"} <= codes
    assert {item.code for item in result.recommendations} == {
        "cpu_capacity",
        "memory_capacity",
    }
    assert result.ok is False
    assert disk_requirement("full") == 120 * 1024**3


def test_dry_run_defers_native_windows_blockers(tmp_path: Path) -> None:
    result = run_preflight(
        options(tmp_path, dry_run=True),
        env={},
        repository_root=tmp_path,
        host=report("native-windows", "C:/repo", "AMD64"),
        docker=DockerReport(available=False, message="not running"),
        resources=SystemResources(cpu_count=8, memory_bytes=16 * 1024**3),
        free_disk_bytes=1,
    )
    assert result.ok is True
    assert all(item.deferred for item in result.blockers)


def test_env_file_on_windows_mount_is_rejected(tmp_path: Path) -> None:
    env_file = Path("/mnt/c/benchmark.env")
    with pytest.raises(ValueError, match="WSL Linux filesystem"):
        load_benchmark_environment(env_file, base={}, host=report("wsl2"))
