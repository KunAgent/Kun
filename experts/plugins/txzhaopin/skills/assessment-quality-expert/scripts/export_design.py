#!/usr/bin/env python3
"""
岗位面试设计方案导出脚本
将甄选专家 A-3 生成的岗位面试设计方案按用户选择分发到：
  1. 本地（只留在甄选专家 designs/，默认会做）
  2. 本机招聘助手（references/interview-designs/）
  3. 独立文件到工作区（用于发给其他面试官）

核心原则：绝不做静默同步，每次都向调用方汇报要做的事。

用法:
  python3 export_design.py <design_file> --mode <mode> [--workspace <path>]

参数:
  design_file   设计方案文件路径（通常在甄选专家 designs/ 下）
  --mode        导出模式: local / sync / file / all
                  local - 只留本地（不做额外动作，仅打印清单）
                  sync  - 同步到本机招聘助手
                  file  - 导出独立文件到工作区
                  all   - 以上全部
  --workspace   当 mode=file 时的工作区路径（默认 $PWD）
  --target-dir  招聘助手根目录（默认 ~/.workbuddy/skills/recruiting-assistant）
"""

import argparse
import os
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path


RECRUITING_ASSISTANT_DEFAULT = Path.home() / ".workbuddy" / "skills" / "recruiting-assistant"


# ------------------------- 探测/工具函数 ------------------------- #

def detect_recruiting_assistant(target_dir: str | None = None) -> Path | None:
    """探测本机招聘助手是否安装。"""
    if target_dir:
        p = Path(target_dir)
        return p if p.exists() else None
    if RECRUITING_ASSISTANT_DEFAULT.exists():
        return RECRUITING_ASSISTANT_DEFAULT
    return None


def extract_design_meta(design_path: Path) -> dict:
    """从设计方案文件中提取关键元信息，用于索引和日志。"""
    content = design_path.read_text(encoding="utf-8")
    meta = {
        "filename": design_path.name,
        "title": "",
        "position": "",
        "model": "",
        "covered_phases": "",
        "last_update": "",
    }

    title_match = re.search(r"^#\s+(.+)$", content, re.MULTILINE)
    if title_match:
        meta["title"] = title_match.group(1).strip()

    # 从第一章表格里抓几个关键字段
    for key, label in [
        ("position", "岗位名称"),
        ("model", "关联胜任力模型"),
        ("covered_phases", "已覆盖环节"),
        ("last_update", "最近更新日期"),
    ]:
        m = re.search(rf"\|\s*{label}\s*\|\s*(.+?)\s*\|", content)
        if m:
            meta[key] = m.group(1).strip()

    return meta


def print_divider(title: str = "") -> None:
    print("\n" + ("=" * 60))
    if title:
        print(title)
        print("=" * 60)


# ------------------------- 三种分发动作 ------------------------- #

def action_local(design_path: Path, meta: dict) -> None:
    """local 模式：只留本地，不做额外复制。"""
    print_divider("📂 [local] 只保留本地")
    print(f"  文件路径：{design_path}")
    print("  未做任何对外写入。本地方案可随时再次导出。")


def action_sync(design_path: Path, meta: dict, recruiter_dir: Path) -> bool:
    """sync 模式：同步到本机招聘助手 references/interview-designs/"""
    print_divider("🔗 [sync] 同步到本机招聘助手")

    if recruiter_dir is None:
        print("  ❌ 未检测到本机招聘助手，跳过。")
        print(f"     默认查找路径：{RECRUITING_ASSISTANT_DEFAULT}")
        print("     若招聘助手安装在其他位置，请用 --target-dir 指定。")
        return False

    target_dir = recruiter_dir / "references" / "interview-designs"
    target_dir.mkdir(parents=True, exist_ok=True)

    target_file = target_dir / design_path.name
    shutil.copy2(design_path, target_file)
    print(f"  ✅ 已同步：{target_file}")

    # 顺手刷新索引
    refresh_recruiter_index(target_dir)
    return True


def action_file(design_path: Path, meta: dict, workspace: Path) -> None:
    """file 模式：导出独立文件到工作区，方便打包/邮件发给面试官。"""
    print_divider("📤 [file] 导出独立文件到工作区")

    workspace.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d-%H%M")
    out_name = f"interview-design__{design_path.stem}__{ts}.md"
    out_path = workspace / out_name
    shutil.copy2(design_path, out_path)

    print(f"  ✅ 已导出：{out_path}")
    print("")
    print("  💡 发给面试官的提示话术（可直接复制）：")
    print("  --------")
    print(f"  这是 {meta.get('title') or meta.get('filename')} 的面试设计方案。")
    print("  如果你装了「招聘助手」skill，请把这份文件放到以下目录：")
    print("    ~/.workbuddy/skills/recruiting-assistant/references/interview-designs/")
    print("  之后招聘助手会自动读取，出题时会按本方案的骨架，结合候选人简历做个性化。")
    print("  --------")


# ------------------------- 索引维护 ------------------------- #

def refresh_recruiter_index(designs_dir: Path) -> None:
    """刷新招聘助手侧的 interview-designs/_index.md"""
    index_path = designs_dir / "_index.md"

    design_files = sorted(
        [f for f in designs_dir.iterdir()
         if f.is_file() and f.suffix == ".md" and f.name != "_index.md"]
    )

    lines = [
        "# 岗位面试设计方案索引（招聘助手侧）",
        "",
        f"> 本索引由甄选专家的 export_design.py 自动维护。",
        f"> 最后同步时间：{datetime.now().strftime('%Y-%m-%d %H:%M')}",
        "",
        "## 可用方案",
        "",
        "| 文件名 | 岗位名称 | 已覆盖环节 | 最近更新 |",
        "|--------|---------|-----------|---------|",
    ]

    if not design_files:
        lines.append("| — | (暂无) | — | — |")
    else:
        for f in design_files:
            m = extract_design_meta(f)
            lines.append(
                f"| `{f.name}` | {m.get('position') or m.get('title') or '—'} "
                f"| {m.get('covered_phases') or '—'} "
                f"| {m.get('last_update') or '—'} |"
            )

    lines.extend([
        "",
        "## 招聘助手如何使用",
        "",
        "- 场景 C（面试计划）会按候选人投递岗位匹配本目录下的方案文件",
        "- 匹配到 → 以该方案的环节维度/题型/参考题为骨架，结合候选人简历做个性化",
        "- 未匹配到 → 降级使用 `references/campus-interview-flow-fallback.md` 作为骨架",
        "",
    ])

    index_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"  ✅ 索引已刷新：{index_path}")


# ------------------------- 主流程 ------------------------- #

def run(design_path: Path, mode: str, workspace: Path, target_dir: str | None) -> None:
    if not design_path.exists():
        print(f"❌ 设计方案文件不存在：{design_path}", file=sys.stderr)
        sys.exit(1)

    meta = extract_design_meta(design_path)
    recruiter_dir = detect_recruiting_assistant(target_dir)

    # 打印计划（先说要做什么，再做——绝不静默）
    print_divider("📋 导出计划")
    print(f"  方案文件：{design_path}")
    print(f"  岗位名称：{meta.get('position') or meta.get('title') or '未知'}")
    print(f"  已覆盖环节：{meta.get('covered_phases') or '—'}")
    print(f"  最近更新：{meta.get('last_update') or '—'}")
    print(f"  导出模式：{mode}")
    print(f"  本机招聘助手：{'✅ 已检测到 ' + str(recruiter_dir) if recruiter_dir else '❌ 未检测到'}")
    print(f"  工作区路径：{workspace}")

    # 分发
    if mode in ("local", "all"):
        action_local(design_path, meta)

    if mode in ("sync", "all"):
        if recruiter_dir is None and mode == "sync":
            print_divider("⚠️ sync 模式但未装招聘助手")
            print("  当前模式是 sync，但没检测到招聘助手。已跳过。")
            print("  如仍需分发给其他面试官，请改用 --mode file 导出独立文件。")
        else:
            action_sync(design_path, meta, recruiter_dir)

    if mode in ("file", "all"):
        action_file(design_path, meta, workspace)

    print_divider("🎉 完成")


def main():
    parser = argparse.ArgumentParser(description="岗位面试设计方案导出工具")
    parser.add_argument("design_file", help="设计方案文件路径")
    parser.add_argument(
        "--mode",
        choices=["local", "sync", "file", "all"],
        required=True,
        help="导出模式（local/sync/file/all）",
    )
    parser.add_argument(
        "--workspace",
        default=None,
        help="当 mode=file 或 all 时使用的工作区输出目录（默认当前目录）",
    )
    parser.add_argument(
        "--target-dir",
        default=None,
        help="招聘助手根目录（默认 ~/.workbuddy/skills/recruiting-assistant）",
    )

    args = parser.parse_args()

    design_path = Path(args.design_file).expanduser().resolve()
    workspace = Path(args.workspace or os.getcwd()).expanduser().resolve()

    run(design_path, args.mode, workspace, args.target_dir)


if __name__ == "__main__":
    main()
