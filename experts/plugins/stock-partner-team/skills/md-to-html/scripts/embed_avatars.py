#!/usr/bin/env python3
"""embed_avatars.py — 把圆桌报告 HTML 里的 <img src="avatars/*.png"> 就地替换成 base64 data URI。

用法:
    python3 embed_avatars.py <html_file> [avatars_dir]

参数:
    html_file     目标 HTML 路径（例如 reports/2026-04-24/腾讯-圆桌报告.html）
                  脚本会就地改写这个文件。
    avatars_dir   头像目录（默认: <脚本同级>/../../../avatars，即插件根的 avatars/）

行为:
    1. 扫描 HTML 里所有 src="avatars/<name>.png"
    2. 压缩对应 PNG → 128×128 WebP (quality 85)
    3. 用 data:image/webp;base64,... 替换原相对路径
    4. 就地覆盖写回 html_file

依赖:
    Pillow >= 9.0 (pip install pillow)
"""

from __future__ import annotations

import argparse
import base64
import io
import re
import sys
from pathlib import Path


def build_data_uri(png_path: Path, max_size: int = 128, quality: int = 85) -> str:
    """把 PNG 压成 WebP 再 base64，返回 data URI 字符串。"""
    try:
        from PIL import Image  # type: ignore
    except ImportError:
        print("[embed_avatars] 缺少依赖 Pillow，请执行: pip install pillow", file=sys.stderr)
        raise SystemExit(1)

    img = Image.open(png_path).convert("RGBA")
    img.thumbnail((max_size, max_size), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="WEBP", quality=quality, method=6)
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/webp;base64,{b64}"


def embed(html_path: Path, avatars_dir: Path) -> None:
    if not html_path.is_file():
        print(f"[embed_avatars] HTML 文件不存在: {html_path}", file=sys.stderr)
        raise SystemExit(2)
    if not avatars_dir.is_dir():
        print(f"[embed_avatars] avatars 目录不存在: {avatars_dir}", file=sys.stderr)
        raise SystemExit(2)

    html = html_path.read_text(encoding="utf-8")

    pattern = re.compile(r'src="avatars/([^"/]+\.png)"')
    names = sorted(set(pattern.findall(html)))

    if not names:
        print("[embed_avatars] 未发现 src=\"avatars/*.png\" 的引用，无需处理。")
        return

    replaced = 0
    missing: list[str] = []
    cache: dict[str, str] = {}

    for name in names:
        png = avatars_dir / name
        if not png.is_file():
            missing.append(name)
            continue
        cache[name] = build_data_uri(png)

    def _sub(match: re.Match[str]) -> str:
        nonlocal replaced
        name = match.group(1)
        if name in cache:
            replaced += 1
            return f'src="{cache[name]}"'
        return match.group(0)

    new_html = pattern.sub(_sub, html)

    html_path.write_text(new_html, encoding="utf-8")

    size_kb = html_path.stat().st_size // 1024
    print(f"[embed_avatars] 已内嵌 {len(cache)} 张头像，替换 {replaced} 处引用 → {html_path} ({size_kb} KB)")
    if missing:
        print(f"[embed_avatars] 警告: 以下头像文件缺失，保留相对路径不变: {missing}", file=sys.stderr)


def main() -> None:
    parser = argparse.ArgumentParser(description="就地内嵌圆桌报告 HTML 中的头像")
    parser.add_argument("html_file", help="目标 HTML 文件路径")
    parser.add_argument(
        "avatars_dir",
        nargs="?",
        default=None,
        help="头像目录（默认: 脚本相对的 ../../../avatars）",
    )
    args = parser.parse_args()

    if args.avatars_dir:
        avatars_dir = Path(args.avatars_dir).resolve()
    else:
        avatars_dir = (Path(__file__).resolve().parent / "../../../avatars").resolve()

    embed(Path(args.html_file).resolve(), avatars_dir)


if __name__ == "__main__":
    main()
