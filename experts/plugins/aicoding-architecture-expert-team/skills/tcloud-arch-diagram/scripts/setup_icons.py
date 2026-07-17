#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
腾讯云图标库初始化脚本
======================
从腾讯云官方图标包下载并提取 SVG 图标，生成：
  1. references/icons/icons-{分类}.md  ← 9 个分类文件（按需加载，节省 token）
  2. references/tcloud-icons.md        ← 轻量索引文件（仅列 key/分类/文件路径）

用法：
    python scripts/setup_icons.py                  # 下载并生成
    python scripts/setup_icons.py --no-download    # 仅用本地 assets/icons/ 重新生成

图标文件结构：
    assets/icons/<key>.svg             原始 SVG 文件
    references/icons/icons-{分类}.md  分类图标文件（含压缩后的完整 style 字符串）
    references/tcloud-icons.md         轻量索引（不含 style，仅供 AI 查 key→分类→文件路径）
"""

import sys
import zipfile
import re
import argparse
import urllib.request
from pathlib import Path
from urllib.parse import quote

# ── 路径 ───────────────────────────────────────────────────
SKILL_DIR   = Path(__file__).parent.parent
ASSETS_DIR  = SKILL_DIR / "assets" / "icons"
REFS_DIR    = SKILL_DIR / "references"
ICONS_DIR   = REFS_DIR / "icons"          # 新：分类文件目录
ICONS_MD    = REFS_DIR / "tcloud-icons.md"
ZIP_CACHE   = SKILL_DIR / "assets" / "tcloud_icons.zip"

SVG_ZIP_URL = (
    "https://dscache.tencent-cloud.cn/upload/uploader/"
    "tencent_cloud_product_icons_svg-cabb63b49a754a7417b973bec8724623f0414854.zip"
)

# ── 产品分类配置 ────────────────────────────────────────────
# 格式: key -> (显示名, 分类, 精确文件名列表[优先级从高到低，无需扩展名])
PRODUCTS = {
    # 外部 / 通用（官方包无通用用户/互联网图标，使用内置 fallback）
    "user":           ("用户",              "外部",   []),
    "internet":       ("互联网",            "外部",   []),
    # 网络
    "cdn":            ("CDN 内容分发",      "网络",   ["Content Delivery Network"]),
    "clb":            ("CLB 负载均衡",      "网络",   ["Cloud Load Balancer"]),
    "nat":            ("NAT 网关",          "网络",   ["NAT Gateway"]),
    "vpc":            ("VPC 私有网络",      "网络",   ["Virtual Private Cloud"]),
    "direct_connect": ("专线接入",          "网络",   ["Direct Connect"]),
    "eip":            ("弹性公网 IP",       "网络",   ["Elastic IP"]),
    # 安全
    "waf":            ("WAF 应用防火墙",    "安全",   ["Web Application Firewall"]),
    "ddos":           ("DDoS 防护",         "安全",   ["Anti-DDoS-1"]),
    "ssl":            ("SSL 证书",          "安全",   ["SSL Certificate Service-1", "SSL Certificate Service"]),
    "cwp":            ("主机安全 CWP",      "安全",   ["Cloud Workload Protection"]),
    "tcss":           ("容器安全 TCSS",     "安全",   ["Tencent Container Security Service"]),
    # 计算
    "cvm":            ("CVM 云服务器",      "计算",   ["Cloud Virtual Machine"]),
    "lighthouse":     ("Lighthouse 轻量",   "计算",   ["TencentCloud Lighthouse"]),
    "scf":            ("SCF 云函数",        "计算",   ["Serverless Cloud Function-1"]),
    "tke":            ("TKE 容器服务",      "计算",   ["Tencent Kubernetes Engine-1"]),
    "as":             ("弹性伸缩 AS",       "计算",   ["Auto Scaling"]),
    # 存储
    "cos":            ("COS 对象存储",      "存储",   ["Cloud Object Storage"]),
    "cbs":            ("CBS 云硬盘",        "存储",   ["Cloud Block Storage"]),
    "cfs":            ("CFS 文件存储",      "存储",   ["Cloud File Storage"]),
    # 数据库
    "mysql":          ("TencentDB MySQL",   "数据库", ["TencentDB for MySQL"]),
    "redis":          ("TencentDB Redis",   "数据库", ["TencentDB for Redis"]),
    "tdsql":          ("TDSQL 分布式DB",    "数据库", ["Tencent Distributed MySQL"]),
    "mongodb":        ("TencentDB MongoDB", "数据库", ["TencentDB for MongoDB"]),
    "cynosdb":        ("TDSQL-C",           "数据库", ["Cloud Native Database TDSQL-C"]),
    # 中间件
    "apigw":          ("API 网关",          "中间件", ["API Gateway"]),
    "ckafka":         ("CKafka 消息队列",   "中间件", ["TDMQ for CKafka"]),
    "cmq":            ("CMQ 消息队列",      "中间件", ["Cloud Message Queue (CMQ)"]),
    "tsf":            ("TSF 微服务平台",    "中间件", ["Tencent Service Framework"]),
    # 监控运维
    "cm":             ("云监控",            "监控",   ["Cloud Monitor-1"]),
    "cls":            ("CLS 日志服务",      "监控",   ["Cloud Log Service-1"]),
    "cat":            ("云拨测 CAT",        "监控",   ["Cloud Automated Testing"]),
    # 大数据
    "emr":            ("EMR 弹性 MapReduce","大数据", ["Elastic MapReduce"]),
    "es":             ("Elasticsearch",     "大数据", ["Elasticsearch Service"]),
}

# 分类排序
CATEGORY_ORDER = ["外部", "网络", "安全", "计算", "存储", "数据库", "中间件", "监控", "大数据"]


# ── 工具函数 ───────────────────────────────────────────────

def download_zip(dest: Path):
    """下载官方 SVG 图标包"""
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"下载图标包: {SVG_ZIP_URL}")
    print("（文件约 1.1 MB，请稍候...）")
    urllib.request.urlretrieve(SVG_ZIP_URL, dest)
    print(f"已保存到: {dest}")


def svg_compress(svg_str: str) -> str:
    """
    压缩 SVG 字符串，去除对渲染无用的冗余内容，减少 URL 编码后的长度。
    只做安全操作，不改变路径/形状数据。
    """
    s = svg_str
    # 1. 删除 XML 注释 <!-- ... -->
    s = re.sub(r'<!--.*?-->', '', s, flags=re.DOTALL)
    # 2. 删除 <title>...</title> 和 <desc>...</desc>（对渲染无用）
    s = re.sub(r'<title[^>]*>.*?</title>', '', s, flags=re.DOTALL)
    s = re.sub(r'<desc[^>]*>.*?</desc>', '', s, flags=re.DOTALL)
    # 3. 删除 SVG 元素内的 id 属性（Draw.io 不依赖 SVG 内部 id）
    s = re.sub(r'\s+id="[^"]*"', '', s)
    # 4. 删除 data-name 属性
    s = re.sub(r'\s+data-name="[^"]*"', '', s)
    # 5. 折叠多余空白为单个空格
    s = re.sub(r'\s+', ' ', s.strip())
    # 6. 删除标签间多余空格（> < 之间）
    s = re.sub(r'>\s+<', '><', s)
    return s


def svg_to_style(svg_str: str) -> str:
    """将 SVG 字符串压缩并转为 Draw.io image style（URL 编码，无分号问题）"""
    svg_clean = svg_compress(svg_str)
    encoded   = quote(svg_clean, safe='')
    return (
        f"shape=image;verticalLabelPosition=bottom;labelBackgroundColor=none;"
        f"verticalAlign=top;align=center;"
        f"image=data:image/svg+xml,{encoded};"
        f"fontSize=11;fontColor=#333333;"
    )


def find_svg_in_zip(z: zipfile.ZipFile, filenames: list[str]) -> tuple[str, str] | tuple[None, None]:
    """按精确文件名（不含扩展名）在 en 目录中查找 SVG，返回 (文件名, SVG内容)"""
    prefix = "tencent_cloud_product_icons_en/"
    en_entries = {
        n[len(prefix):]: n
        for n in z.namelist()
        if n.startswith(prefix) and n.endswith(".svg")
    }
    for name in filenames:
        target = f"{name}.svg"
        if target in en_entries:
            full_path = en_entries[target]
            try:
                svg = z.read(full_path).decode("utf-8")
                return target, svg
            except Exception:
                continue
    return None, None


# ── 主流程 ─────────────────────────────────────────────────

def build_icons(zip_path: Path):
    """从 zip 中提取图标，保存到 assets/icons/"""
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)

    extracted: dict[str, tuple[str, str]] = {}

    print(f"\n从 {zip_path.name} 提取图标...")
    with zipfile.ZipFile(zip_path) as z:
        for key, (display_name, category, filenames) in PRODUCTS.items():
            if not filenames:
                extracted[key] = (None, None)
                print(f"  [FB] {key:20s} (使用内置 fallback)")
                continue
            fname, svg = find_svg_in_zip(z, filenames)
            if fname and svg:
                extracted[key] = (fname, svg)
                (ASSETS_DIR / f"{key}.svg").write_text(svg, encoding="utf-8")
                print(f"  [OK] {key:20s} <- {fname}")
            else:
                extracted[key] = (None, None)
                print(f"  [--] {key:20s} 未找到（将使用 fallback）")

    ok = sum(1 for v in extracted.values() if v[0])
    print(f"\n提取完成：{ok}/{len(PRODUCTS)} 个图标")
    return extracted


def build_icons_from_assets():
    """从 assets/icons/ 中读取已有的 SVG 文件（--no-download 模式）"""
    extracted: dict[str, tuple[str, str]] = {}

    print("\n从 assets/icons/ 读取已有图标...")
    for key, (display_name, category, filenames) in PRODUCTS.items():
        svg_path = ASSETS_DIR / f"{key}.svg"
        if svg_path.exists():
            svg = svg_path.read_text(encoding="utf-8")
            extracted[key] = (f"{key}.svg", svg)
            print(f"  [OK] {key:20s} <- {key}.svg")
        else:
            extracted[key] = (None, None)
            print(f"  [--] {key:20s} 未找到")

    ok = sum(1 for v in extracted.values() if v[0])
    print(f"\n读取完成：{ok}/{len(PRODUCTS)} 个图标")
    return extracted


# 官方包中没有的通用图标使用内置简洁 SVG
FALLBACK_SVGS: dict[str, str] = {
    "user": (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
        '<rect width="64" height="64" rx="8" fill="#5B8DB8"/>'
        '<circle cx="32" cy="22" r="11" fill="white"/>'
        '<path d="M9 56c0-12.7 10.3-23 23-23s23 10.3 23 23" fill="white"/>'
        '</svg>'
    ),
    "internet": (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
        '<rect width="64" height="64" rx="8" fill="#607D8B"/>'
        '<circle cx="32" cy="32" r="18" fill="none" stroke="white" stroke-width="2.5"/>'
        '<ellipse cx="32" cy="32" rx="8" ry="18" fill="none" stroke="white" stroke-width="2"/>'
        '<line x1="14" y1="32" x2="50" y2="32" stroke="white" stroke-width="2"/>'
        '<line x1="16" y1="22" x2="48" y2="22" stroke="white" stroke-width="1.5"/>'
        '<line x1="16" y1="42" x2="48" y2="42" stroke="white" stroke-width="1.5"/>'
        '</svg>'
    ),
}


def apply_fallbacks(extracted: dict):
    """将 fallback SVG 填充到 extracted 中缺失的条目"""
    for key, svg in FALLBACK_SVGS.items():
        if key in extracted and extracted[key][0] is None:
            fname = f"{key}-fallback.svg"
            (ASSETS_DIR / f"{key}.svg").write_text(svg, encoding="utf-8")
            extracted[key] = (fname, svg)
    return extracted


def generate_category_files(extracted: dict):
    """
    生成 9 个分类图标文件到 references/icons/ 目录。
    每个文件只包含该分类的产品，含压缩后的完整 style 字符串。
    AI 按需读取，大幅减少 context token。
    """
    ICONS_DIR.mkdir(parents=True, exist_ok=True)

    # 按分类分组
    by_cat: dict[str, list] = {c: [] for c in CATEGORY_ORDER}
    for key, (display_name, category, _) in PRODUCTS.items():
        fname, svg = extracted.get(key, (None, None))
        style = svg_to_style(svg) if svg else None
        if category in by_cat:
            by_cat[category].append((key, display_name, fname, style))

    generated = 0
    for cat in CATEGORY_ORDER:
        items = by_cat.get(cat, [])
        if not items:
            continue

        lines = [
            f"# 腾讯云图标 - {cat}类",
            "",
            f"> 本文件由 `scripts/setup_icons.py` 自动生成。",
            f"> **AI 使用时：直接复制下方产品对应的 style 字符串到 mxCell 的 style= 属性，禁止自行编码。**",
            "",
            "**节点标准尺寸**：`width=60, height=60`（`verticalLabelPosition=bottom`）",
            "",
            "---",
            "",
            "## 产品列表",
            "",
            "| 产品 key | 显示名 | 状态 |",
            "|---------|--------|------|",
        ]
        for key, display_name, fname, _ in items:
            status = "✅" if fname else "❌"
            lines.append(f"| `{key}` | {display_name} | {status} |")
        lines += ["", "---", ""]

        for key, display_name, fname, style in items:
            if not style:
                lines += [f"### {display_name}（`{key}`）", "", "> ❌ 未找到图标，使用通用占位样式", ""]
                continue
            lines += [
                f"### {display_name}（`{key}`）",
                "",
                "```",
                style,
                "```",
                "",
            ]

        out_path = ICONS_DIR / f"icons-{cat}.md"
        out_path.write_text("\n".join(lines), encoding="utf-8")
        size_kb = out_path.stat().st_size / 1024
        print(f"  [生成] icons-{cat}.md  ({size_kb:.1f} KB, {len(items)} 个图标)")
        generated += 1

    print(f"\n分类文件生成完成：{generated} 个文件 → {ICONS_DIR}")
    return by_cat


def generate_index_md(extracted: dict):
    """
    生成轻量索引文件 references/tcloud-icons.md。
    只含 key/分类/文件路径表，不含任何 style 字符串（大幅减少 token）。
    """
    lines = [
        "# 腾讯云产品图标索引",
        "",
        "> 本文件由 `scripts/setup_icons.py` 自动生成。",
        "> **本文件仅为索引，不含 style 字符串。**",
        "> AI 生成架构图时，根据布局表中用到的产品分类，读取 `references/icons/icons-{分类}.md` 获取完整 style。",
        "",
        "---",
        "",
        "## 使用方式",
        "",
        "1. 确定架构图中用到的产品分类（如：计算、网络、数据库）",
        "2. 读取对应的分类文件，例如：",
        "   - `references/icons/icons-计算.md`",
        "   - `references/icons/icons-网络.md`",
        "   - `references/icons/icons-数据库.md`",
        "3. 从分类文件中按 key 复制完整 style 字符串",
        "4. **禁止加载不需要的分类文件**（节省 token）",
        "",
        "---",
        "",
        "## 产品 key 速查表",
        "",
        "| 产品 key | 显示名 | 分类 | 分类文件 | 状态 |",
        "|---------|--------|------|---------|------|",
    ]

    for key, (display_name, category, _) in PRODUCTS.items():
        fname = extracted.get(key, (None,))[0]
        status = "✅" if fname else "❌"
        cat_file = f"`references/icons/icons-{category}.md`"
        lines.append(f"| `{key}` | {display_name} | {category} | {cat_file} | {status} |")

    lines += [
        "",
        "---",
        "",
        "## 可用分类文件",
        "",
        "| 分类 | 文件路径 | 包含产品 |",
        "|------|---------|---------|",
    ]

    # 按分类统计
    cat_keys: dict[str, list] = {c: [] for c in CATEGORY_ORDER}
    for key, (_, category, _) in PRODUCTS.items():
        if category in cat_keys:
            cat_keys[category].append(f"`{key}`")

    for cat in CATEGORY_ORDER:
        keys = cat_keys.get(cat, [])
        if keys:
            lines.append(f"| {cat} | `references/icons/icons-{cat}.md` | {' '.join(keys)} |")

    lines += [
        "",
        "---",
        "",
        "## 更新图标库",
        "",
        "```bash",
        "python scripts/setup_icons.py",
        "```",
        "",
        "此命令将重新下载腾讯云官方图标包，重新生成分类文件和本索引文件。",
    ]

    ICONS_MD.write_text("\n".join(lines), encoding="utf-8")
    size_kb = ICONS_MD.stat().st_size / 1024
    print(f"\n已生成索引: {ICONS_MD}  ({size_kb:.1f} KB)")


def main():
    parser = argparse.ArgumentParser(description="腾讯云图标库初始化")
    parser.add_argument("--no-download", action="store_true",
                        help="跳过下载，使用本地 assets/icons/ 中已有的 SVG 文件重新生成")
    args = parser.parse_args()

    print("=" * 60)
    print("腾讯云架构图 - 图标库初始化")
    print("=" * 60)

    if args.no_download:
        # 直接从 assets/icons/ 读取，无需 zip
        if not ASSETS_DIR.exists() or not any(ASSETS_DIR.glob("*.svg")):
            print(f"错误：{ASSETS_DIR} 中没有找到 SVG 文件，请先运行不带 --no-download 的命令下载。")
            sys.exit(1)
        extracted = build_icons_from_assets()
    else:
        download_zip(ZIP_CACHE)
        extracted = build_icons(ZIP_CACHE)

    # 填充 fallback
    extracted = apply_fallbacks(extracted)

    # 生成分类文件（核心优化：AI 按需读取）
    print("\n生成分类文件...")
    generate_category_files(extracted)

    # 生成轻量索引（替换原 tcloud-icons.md）
    generate_index_md(extracted)

    # 仅在下载模式下清理 zip 缓存
    if not args.no_download:
        ZIP_CACHE.unlink(missing_ok=True)
        print("\n已清理 zip 缓存")

    print("\n完成！AI 生成架构图时：")
    print("  1. 查阅 references/tcloud-icons.md 找到产品所属分类")
    print("  2. 只读取用到的 references/icons/icons-{分类}.md 文件")
    print("  3. 从分类文件复制 style 字符串到 XML")


if __name__ == "__main__":
    main()
