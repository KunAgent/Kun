import subprocess
from pathlib import Path

from kun_bench.git_patch import collect_patch, validate_patch


def test_patch_includes_untracked_files_and_validates(tmp_path: Path) -> None:
    repository = tmp_path / "repo"
    repository.mkdir()
    subprocess.run(["git", "init"], cwd=repository, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.name", "Test"], cwd=repository, check=True)
    subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=repository, check=True)
    (repository / "existing.txt").write_text("before\n")
    subprocess.run(["git", "add", "."], cwd=repository, check=True)
    subprocess.run(["git", "commit", "-m", "base"], cwd=repository, check=True, capture_output=True)
    base = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repository, text=True).strip()
    (repository / "existing.txt").write_text("after\n")
    (repository / "new.txt").write_text("new\n")
    patch = collect_patch(repository, base)
    assert "existing.txt" in patch
    assert "new.txt" in patch
    validate_patch(repository, base, patch)
