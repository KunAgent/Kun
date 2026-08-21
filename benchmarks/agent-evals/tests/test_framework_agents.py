from pathlib import Path

from kun_bench.harbor_agent import KunHarborAgent
from kun_bench.pier_agent import KunPierAgent


def environment() -> dict[str, str]:
    return {
        "KUN_BENCH_BASE_URL": "https://provider.example/v1",
        "KUN_BENCH_API_KEY": "secret",
        "KUN_BENCH_MODEL": "model-a",
        "KUN_BENCH_ENDPOINT_FORMAT": "openai-chat-completions",
    }


def test_harbor_and_pier_import_path_agents_share_identity(tmp_path: Path) -> None:
    archive = tmp_path / "kun.tar.gz"
    archive.write_bytes(b"archive")
    kwargs = {
        "logs_dir": tmp_path,
        "model_name": "provider/model-a",
        "archive_path": str(archive),
        "archive_sha256": "a" * 64,
        "extra_env": environment(),
    }
    harbor = KunHarborAgent(**kwargs)
    pier = KunPierAgent(**kwargs)
    assert harbor.name() == pier.name() == "kun"
    assert harbor.version() == pier.version() == "0.1.0"
    assert pier.network_allowlist().domains == ["provider.example"]
