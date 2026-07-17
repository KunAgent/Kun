#!/usr/bin/env python3
"""render.py — 把 agent 写好的 body 片段套进 shell.html，输出最终 HTML（已嵌头像）。

用法:
    python3 render.py <body_file> <output_html> --title="<报告标题>" [--date=YYYY-MM-DD] [--no-embed] [--keep-body]

参数:
    body_file      agent 写的 body 片段（含 nav / hero / 4 模块）
    output_html    最终 HTML 输出路径
    --title        <title> 标签内容（也是浏览器标签页标题）
    --date         报告日期，默认今天
    --no-embed     跳过头像内嵌（调试用，正常情况不要加）
    --keep-body    渲染完不删除 body 片段（默认会删，调试时加这个）

行为:
    1. 读 shell.html（同目录的上级）
    2. 读 body_file
    3. 替换 {{TITLE}} / {{BODY}} / {{DATE}}
    4. 写到 output_html
    5. 默认调用 embed_avatars.py 内嵌头像（覆盖 output_html）
    6. 默认删除 body_file（除非 --keep-body）

依赖:
    Python 3.8+ 标准库。embed_avatars.py 需要 Pillow。
"""

from __future__ import annotations

import argparse
import datetime
import subprocess
import sys
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
SHELL_PATH = SCRIPT_DIR.parent / "shell.html"
EMBED_SCRIPT = SCRIPT_DIR / "embed_avatars.py"


def render(body_file: Path, output_html: Path, title: str, date: str) -> None:
    if not SHELL_PATH.is_file():
        print(f"[render] shell.html 缺失: {SHELL_PATH}", file=sys.stderr)
        raise SystemExit(2)
    if not body_file.is_file():
        print(f"[render] body 文件不存在: {body_file}", file=sys.stderr)
        raise SystemExit(2)

    shell = SHELL_PATH.read_text(encoding="utf-8")
    body = body_file.read_text(encoding="utf-8")

    for placeholder in ("{{TITLE}}", "{{BODY}}", "{{DATE}}"):
        if placeholder not in shell:
            print(f"[render] shell.html 缺少占位符 {placeholder}", file=sys.stderr)
            raise SystemExit(3)

    final = (
        shell
        .replace("{{TITLE}}", title)
        .replace("{{BODY}}", body)
        .replace("{{DATE}}", date)
    )

    output_html.parent.mkdir(parents=True, exist_ok=True)
    output_html.write_text(final, encoding="utf-8")
    size_kb = output_html.stat().st_size // 1024
    print(f"[render] 已合成 → {output_html} ({size_kb} KB)", flush=True)


def embed_avatars(html_path: Path) -> None:
    if not EMBED_SCRIPT.is_file():
        print(f"[render] embed_avatars.py 缺失: {EMBED_SCRIPT}", file=sys.stderr)
        raise SystemExit(2)
    cmd = [sys.executable, str(EMBED_SCRIPT), str(html_path)]
    result = subprocess.run(cmd, check=False)
    if result.returncode != 0:
        print(f"[render] embed_avatars 退出码 {result.returncode}", file=sys.stderr)
        raise SystemExit(result.returncode)


def main() -> None:
    parser = argparse.ArgumentParser(description="圆桌报告 body → 完整 HTML")
    parser.add_argument("body_file", help="agent 写的 body 片段路径")
    parser.add_argument("output_html", help="最终 HTML 输出路径")
    parser.add_argument("--title", required=True, help="HTML <title> 标签内容")
    parser.add_argument("--date", default=None, help="报告日期 YYYY-MM-DD，默认今天")
    parser.add_argument("--no-embed", action="store_true", help="跳过头像内嵌（调试用）")
    parser.add_argument("--keep-body", action="store_true", help="保留 body 片段文件（默认渲染完即删）")
    args = parser.parse_args()

    body_file = Path(args.body_file).resolve()
    output_html = Path(args.output_html).resolve()
    date = args.date or datetime.date.today().isoformat()

    render(body_file, output_html, args.title, date)

    if not args.no_embed:
        embed_avatars(output_html)

    if not args.keep_body:
        try:
            body_file.unlink()
            print(f"[render] 已清理 body 片段: {body_file.name}", flush=True)
        except OSError as exc:
            print(f"[render] 删除 body 片段失败（忽略）: {exc}", file=sys.stderr)


if __name__ == "__main__":
    main()
