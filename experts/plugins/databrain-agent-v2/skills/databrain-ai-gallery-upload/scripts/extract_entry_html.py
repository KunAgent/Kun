#!/usr/bin/env python3
"""从用户给定的输入（.html / .zip / 目录）抽取入口 HTML 文件路径。

供 SKILL Step 2.3 串接 Step 3 的 extract_html_text.py 使用。

输入逻辑：
    - .html / .htm  → 直接 stdout 该路径
    - .zip          → 列 entries 过滤 __MACOSX/ .DS_Store，按
                      (路径深度↑, 路径长度↑, basename≤'index.htm*'↑) 排序后取
                      第一个 .html / .htm，解到 /tmp/extract_entry_<random>.html
    - 目录          → find 同样规则，stdout 该 .html 路径（**不复制到 /tmp**，
                      直接用源路径，调用方不需要清理）

CLI: --input <path>

stdout: 选定入口 HTML 的路径（绝对路径或保留用户输入形式）
stderr: 简短状态行（哪个分支被选中）

退出码：
    0  成功
    2  入参错误 / 找不到入口 HTML
"""

from __future__ import annotations

import argparse
import os
import sys
import tempfile
import zipfile
from pathlib import Path

EXIT_OK = 0
EXIT_USAGE = 2

SKIP_NAMES = ("__MACOSX",)
SKIP_FILE_NAMES = (".DS_Store",)


def _is_html(name: str) -> bool:
    lower = name.lower()
    return lower.endswith(".html") or lower.endswith(".htm")


def _entry_sort_key(name: str) -> tuple:
    """排序键：层级浅 + 是 index.html* 优先 + 路径短。"""
    parts = name.replace("\\", "/").split("/")
    depth = len(parts) - 1
    basename = parts[-1].lower()
    is_index = 0 if basename in ("index.html", "index.htm") else 1
    return (depth, is_index, len(name), name)


def _pick_entry_in_zip(zip_path: Path) -> int:
    try:
        zf = zipfile.ZipFile(zip_path, "r")
    except (zipfile.BadZipFile, OSError) as exc:
        print(f"[extract_entry_html] zip open error: {exc}", file=sys.stderr)
        return EXIT_USAGE

    try:
        candidates: list[str] = []
        for info in zf.infolist():
            if info.is_dir():
                continue
            try:
                name = info.filename.encode("cp437").decode("utf-8")
            except (UnicodeDecodeError, UnicodeEncodeError):
                name = info.filename
            if any(part in SKIP_NAMES for part in name.replace("\\", "/").split("/")):
                continue
            base = name.replace("\\", "/").split("/")[-1]
            if base in SKIP_FILE_NAMES:
                continue
            if _is_html(name):
                candidates.append(info.filename)
        if not candidates:
            print(f"[extract_entry_html] no entry html in zip: {zip_path}", file=sys.stderr)
            return EXIT_USAGE
        # 排序时按 utf-8 显示名，但 extract 时用原始 info.filename
        candidates.sort(
            key=lambda raw: _entry_sort_key(
                raw.encode("cp437").decode("utf-8", errors="replace")
                if not _is_ascii(raw)
                else raw
            )
        )
        picked_raw = candidates[0]
        try:
            picked_display = picked_raw.encode("cp437").decode("utf-8")
        except (UnicodeDecodeError, UnicodeEncodeError):
            picked_display = picked_raw

        suffix = Path(picked_display).suffix or ".html"
        with tempfile.NamedTemporaryFile(
            prefix="extract_entry_",
            suffix=suffix,
            delete=False,
            dir="/tmp" if Path("/tmp").is_dir() else None,
        ) as tmp:
            tmp_path = Path(tmp.name)
            with zf.open(picked_raw) as src:
                tmp.write(src.read())
        print(f"[extract_entry_html] zip entry picked: {picked_display}", file=sys.stderr)
        print(str(tmp_path))
        return EXIT_OK
    finally:
        zf.close()


def _is_ascii(s: str) -> bool:
    try:
        s.encode("ascii")
        return True
    except UnicodeEncodeError:
        return False


def _pick_entry_in_dir(dir_path: Path) -> int:
    found: list[str] = []
    for root, dirs, files in os.walk(dir_path):
        # 剔除 __MACOSX 子树
        dirs[:] = [d for d in dirs if d not in SKIP_NAMES]
        for f in files:
            if f in SKIP_FILE_NAMES:
                continue
            if _is_html(f):
                found.append(os.path.join(root, f))
    if not found:
        print(f"[extract_entry_html] no html in directory: {dir_path}", file=sys.stderr)
        return EXIT_USAGE
    found.sort(key=lambda p: _entry_sort_key(os.path.relpath(p, dir_path)))
    picked = found[0]
    print(f"[extract_entry_html] dir entry picked: {picked}", file=sys.stderr)
    print(picked)
    return EXIT_OK


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Extract entry HTML path from .html / .zip / directory.",
        allow_abbrev=False,
    )
    parser.add_argument("--input", required=True, help="local path (.html / .zip / dir)")
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"[extract_entry_html] path not found: {input_path}", file=sys.stderr)
        return EXIT_USAGE

    if input_path.is_file():
        suffix = input_path.suffix.lower()
        if suffix in (".html", ".htm"):
            print(f"[extract_entry_html] direct html: {input_path}", file=sys.stderr)
            print(str(input_path))
            return EXIT_OK
        if suffix == ".zip":
            return _pick_entry_in_zip(input_path)
        print(
            f"[extract_entry_html] unsupported file type: {suffix or '(no extension)'}",
            file=sys.stderr,
        )
        return EXIT_USAGE

    if input_path.is_dir():
        return _pick_entry_in_dir(input_path)

    print(f"[extract_entry_html] not a file or directory: {input_path}", file=sys.stderr)
    return EXIT_USAGE


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except AttributeError:
        pass
    sys.exit(main())
