import json
from pathlib import Path

from kun_bench.cli import main

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]


def test_powershell_wrapper_uses_argument_arrays_without_secrets() -> None:
    script = (REPOSITORY_ROOT / "scripts" / "benchmarks" / "Invoke-KunBench.ps1").read_text()
    assert (
        "[ValidateSet('preflight', 'build-kun', 'run', 'resume', 'validate', 'summarize')]"
        in script
    )
    assert "--exec', 'npm'" in script
    assert "bash -lc" not in script
    assert "KUN_BENCH_API_KEY" not in script


def test_cli_loads_env_file_without_persisting_secret(tmp_path: Path) -> None:
    env_file = tmp_path / "benchmark.env"
    env_file.write_text(
        "KUN_BENCH_BASE_URL=https://provider.example/v1\n"
        "KUN_BENCH_API_KEY=windows-secret\n"
        "KUN_BENCH_MODEL=model-a\n"
        "KUN_BENCH_ENDPOINT_FORMAT=openai-chat-completions\n"
    )
    env_file.chmod(0o600)
    assert (
        main(
            [
                "run",
                "--suite",
                "all",
                "--preset",
                "smoke",
                "--dry-run",
                "--env-file",
                str(env_file),
                "--run-id",
                "windows-dry",
                "--artifact-root",
                str(tmp_path),
            ]
        )
        == 0
    )
    manifest = json.loads((tmp_path / "windows-dry" / "run-manifest.json").read_text())
    assert "windows-secret" not in json.dumps(manifest)
