#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
腾讯云架构图 - 图标注入脚本
============================
将 AI 生成的 .drawio 文件中的图标占位符替换为真实的腾讯云产品图标 style。

占位符格式（安全格式，无特殊字符）：
    style="tcloud-icon:key"
    例如：style="tcloud-icon:cvm"
         style="tcloud-icon:clb"

支持的 key 列表（33 个）：
    外部：  user, internet
    网络：  cdn, clb, nat, vpc, direct_connect, eip
    安全：  waf, ddos, cwp, tcss
    计算：  cvm, lighthouse, scf, tke, as
    存储：  cos, cbs, cfs
    数据库：mysql, redis, tdsql, mongodb, cynosdb
    中间件：apigw, ckafka, tsf
    监控：  cm, cls, cat
    大数据：emr, es

用法：
    python scripts/inject_icons.py <file.drawio>
    python scripts/inject_icons.py <file.drawio> --dry-run   # 只预览，不写入

示例：
    python scripts/inject_icons.py my-arch.drawio
    python scripts/inject_icons.py output/arch.drawio --dry-run
"""

import re
import sys
import argparse
from pathlib import Path
from urllib.parse import quote

# ── 路径配置 ────────────────────────────────────────────────
SKILL_DIR  = Path(__file__).parent.parent
ASSETS_DIR = SKILL_DIR / "assets" / "icons"

# ── 占位符格式 ──────────────────────────────────────────────
# 格式：style="tcloud-icon:key" 或 style="tcloud-icon:key;额外属性;"
# 纯小写字母 + 冒号，XML 属性值完全安全，无任何特殊字符
# 匹配 style=" 开头含有 tcloud-icon:key 的整个 style 属性值
PLACEHOLDER_PATTERN = re.compile(r'style="tcloud-icon:([\w]+)([^"]*)"')

# ── 产品 key → 分类映射（仅用于报告）──────────────────────
KEY_CATEGORY = {
    "user": "外部", "internet": "外部",
    "cdn": "网络", "clb": "网络", "nat": "网络", "vpc": "网络",
    "direct_connect": "网络", "eip": "网络",
    "waf": "安全", "ddos": "安全", "cwp": "安全", "tcss": "安全",
    "cvm": "计算", "lighthouse": "计算", "scf": "计算",
    "tke": "计算", "as": "计算",
    "cos": "存储", "cbs": "存储", "cfs": "存储",
    "mysql": "数据库", "redis": "数据库", "tdsql": "数据库",
    "mongodb": "数据库", "cynosdb": "数据库",
    "apigw": "中间件", "ckafka": "中间件", "tsf": "中间件",
    "cm": "监控", "cls": "监控", "cat": "监控",
    "emr": "大数据", "es": "大数据",
}


# ── SVG 处理函数 ────────────────────────────────────────────

def svg_compress(svg_str: str) -> str:
    """
    压缩 SVG：去除注释、title、desc、内部 id、data-name，折叠空白。
    只做安全操作，不改变路径/形状数据。
    """
    s = svg_str
    s = re.sub(r'<!--.*?-->', '', s, flags=re.DOTALL)
    s = re.sub(r'<title[^>]*>.*?</title>', '', s, flags=re.DOTALL)
    s = re.sub(r'<desc[^>]*>.*?</desc>', '', s, flags=re.DOTALL)
    s = re.sub(r'\s+id="[^"]*"', '', s)
    s = re.sub(r'\s+data-name="[^"]*"', '', s)
    s = re.sub(r'\s+', ' ', s.strip())
    s = re.sub(r'>\s+<', '><', s)
    return s


def svg_to_style(svg_str: str) -> str:
    """将 SVG 压缩并转为 Draw.io image style（URL 编码，无分号截断问题）"""
    compressed = svg_compress(svg_str)
    encoded = quote(compressed, safe='')
    return (
        f"shape=image;verticalLabelPosition=bottom;labelBackgroundColor=none;"
        f"verticalAlign=top;align=center;"
        f"image=data:image/svg+xml,{encoded};"
        f"fontSize=11;fontColor=#333333;"
    )


# ── 核心注入逻辑 ────────────────────────────────────────────

def inject_icons(drawio_path: Path, dry_run: bool = False) -> bool:
    """
    扫描并替换 .drawio 文件中的 style="tcloud-icon:key" 占位符。

    Returns:
        True if any replacement was made (or would be made in dry-run)
    """
    if not drawio_path.exists():
        print(f"[ERROR] File not found: '{drawio_path}'")
        return False

    content = drawio_path.read_text(encoding="utf-8")

    # 统计所有占位符（findall 返回 (key, extra) 的 tuple 列表）
    all_tuples = PLACEHOLDER_PATTERN.findall(content)
    all_matches = [t[0] for t in all_tuples]  # 只取 key 部分
    if not all_matches:
        print("[INFO] No tcloud-icon:... placeholders found. Nothing to do.")
        return False

    unique_keys = sorted(set(all_matches))
    print(f"[FOUND] {len(all_matches)} placeholder(s), {len(unique_keys)} unique key(s): {unique_keys}")

    # 缓存已加载的 style（避免重复读取同一 key）
    style_cache: dict[str, str | None] = {}

    replaced_count = 0
    missing_keys: list[str] = []
    not_tcloud_keys: list[str] = []

    def replace_fn(m: re.Match) -> str:
        nonlocal replaced_count
        key = m.group(1)
        extra = m.group(2)  # 额外 style 属性，如 ";html=0;" 或 ""

        # 检查是否为已知的腾讯云 key
        if key not in KEY_CATEGORY:
            if key not in not_tcloud_keys:
                not_tcloud_keys.append(key)
            return m.group(0)  # 保留占位符原样

        # 从缓存或文件获取 style
        if key not in style_cache:
            svg_path = ASSETS_DIR / f"{key}.svg"
            if svg_path.exists():
                try:
                    svg = svg_path.read_text(encoding="utf-8")
                    style_cache[key] = svg_to_style(svg)
                except Exception as e:
                    print(f"  [WARN] Failed to read {key}.svg: {e}")
                    style_cache[key] = None
            else:
                style_cache[key] = None

        style = style_cache[key]
        if style is None:
            if key not in missing_keys:
                missing_keys.append(key)
            return m.group(0)  # 找不到 SVG 时保留占位符

        replaced_count += 1
        # 整体替换，保留额外属性（如 html=0）
        full_style = style.rstrip(';') + extra
        return f'style="{full_style}"'

    new_content = PLACEHOLDER_PATTERN.sub(replace_fn, content)

    # 打印报告
    print()
    if replaced_count > 0:
        success_keys = [k for k in unique_keys if k in KEY_CATEGORY and style_cache.get(k) is not None]
        for k in success_keys:
            cat = KEY_CATEGORY.get(k, "?")
            count = all_matches.count(k)
            print(f"  [OK] {k:20s} ({cat}, {count} occurrence(s))")

    if missing_keys:
        print()
        for k in missing_keys:
            print(f"  [WARN] {k:20s} -> SVG not found (run: python scripts/setup_icons.py)")

    if not_tcloud_keys:
        print()
        for k in not_tcloud_keys:
            print(f"  [SKIP] {k:20s} -> Not a TCloud key, placeholder kept as-is")

    print()
    if dry_run:
        print(f"[DRY RUN] Would replace {replaced_count} placeholder(s). File not modified.")
    else:
        drawio_path.write_text(new_content, encoding="utf-8")
        print(f"[DONE] Replaced {replaced_count} icon placeholder(s) -> {drawio_path}")
        if missing_keys or not_tcloud_keys:
            print(f"       {len(missing_keys) + len(not_tcloud_keys)} placeholder(s) kept (not replaced)")

    return replaced_count > 0


def main():
    parser = argparse.ArgumentParser(
        description="将 Draw.io 文件中的 style=\"tcloud-icon:key\" 占位符替换为真实腾讯云图标 style",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python scripts/inject_icons.py my-arch.drawio
  python scripts/inject_icons.py output/arch.drawio --dry-run

占位符格式:
  style="tcloud-icon:cvm"    -> 替换为 CVM 完整图标 style
  style="tcloud-icon:clb"    -> 替换为 CLB 完整图标 style

支持的 key（在 SKILL.md 速查表中查找）:
  user, internet, cdn, clb, nat, vpc, direct_connect, eip,
  waf, ddos, cwp, tcss, cvm, lighthouse, scf, tke, as,
  cos, cbs, cfs, mysql, redis, tdsql, mongodb, cynosdb,
  apigw, ckafka, tsf, cm, cls, cat, emr, es
        """,
    )
    parser.add_argument("input", help=".drawio 文件路径")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="预览模式：只显示将要替换的内容，不修改文件",
    )

    args = parser.parse_args()
    input_path = Path(args.input)

    print(f"\nTCloud Arch Diagram - Icon Injection Tool")
    print(f"{'=' * 50}")
    print(f"Input file: {input_path}")
    if args.dry_run:
        print(f"Mode:       DRY RUN (file will not be modified)")
    print()

    inject_icons(input_path, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
