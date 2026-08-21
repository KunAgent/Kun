from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path


def collect_patch(repository: Path, base_commit: str) -> str:
    subprocess.run(["git", "add", "-N", "--", "."], cwd=repository, check=True)
    result = subprocess.run(
        [
            "git",
            "-c",
            "core.fileMode=false",
            "diff",
            "--binary",
            "--no-ext-diff",
            "--full-index",
            base_commit,
            "--",
        ],
        cwd=repository,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout


def validate_patch(repository: Path, base_commit: str, patch: str) -> None:
    if not patch:
        return
    with tempfile.TemporaryDirectory(prefix="kun-patch-check-") as temporary:
        checkout = Path(temporary) / "checkout"
        patch_path = Path(temporary) / "candidate.patch"
        patch_path.write_text(patch, encoding="utf-8")
        subprocess.run(
            ["git", "worktree", "add", "--detach", str(checkout), base_commit],
            cwd=repository,
            check=True,
            capture_output=True,
        )
        try:
            subprocess.run(
                ["git", "apply", "--check", str(patch_path)],
                cwd=checkout,
                check=True,
                capture_output=True,
            )
        finally:
            subprocess.run(
                ["git", "worktree", "remove", str(checkout)],
                cwd=repository,
                check=True,
                capture_output=True,
            )
