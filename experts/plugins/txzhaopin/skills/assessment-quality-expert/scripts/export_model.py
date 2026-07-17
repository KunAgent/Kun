#!/usr/bin/env python3
"""
模型+JD 导出脚本
将活跃模型和对应 JD 导出到招聘助手（recruiting-assistant）格式。

用法:
  python3 export_model.py <model_file> [--jd <jd_file>] [--target-dir <path>]

参数:
  model_file   模型文件路径
  --jd         JD 文件路径（可选）
  --target-dir 招聘助手根目录（默认 ~/.workbuddy/skills/recruiting-assistant）
"""

import argparse
import os
import sys
import re
import shutil
from pathlib import Path
from datetime import datetime


def find_target_skill() -> str:
    """查找招聘助手 Skill 目录"""
    home = Path.home()
    
    # 先找新名字
    new_path = home / ".workbuddy" / "skills" / "recruiting-assistant"
    if new_path.exists():
        return str(new_path)
    
    # 再找旧名字（向后兼容）
    old_path = home / ".workbuddy" / "skills" / "hr-interview-assistant-pro"
    if old_path.exists():
        return str(old_path)
    
    return ""


def extract_model_meta(model_path: str) -> dict:
    """从模型文件中提取元信息"""
    with open(model_path, "r", encoding="utf-8") as f:
        content = f.read()
    
    meta = {
        "name": "",
        "level": "",
        "scope": "",
        "nature": "",
        "filename": Path(model_path).stem
    }
    
    # 提取标题
    title_match = re.search(r"^#\s+(.+)$", content, re.MULTILINE)
    if title_match:
        meta["name"] = title_match.group(1).strip()
    
    # 提取层级
    level_match = re.search(r"\*\*层级\*\*[：:]\s*(.+)", content)
    if level_match:
        meta["level"] = level_match.group(1).strip()
    
    # 提取适用范围
    scope_match = re.search(r"\*\*适用范围\*\*[：:]\s*(.+)", content)
    if scope_match:
        meta["scope"] = scope_match.group(1).strip()
    
    # 提取性质
    nature_match = re.search(r"\*\*性质\*\*[：:]\s*(.+)", content)
    if nature_match:
        meta["nature"] = nature_match.group(1).strip()
    
    return meta


def update_index(models_dir: str, jds_dir: str):
    """更新 _index.md 索引文件"""
    index_path = os.path.join(models_dir, "_index.md")
    
    # 扫描 models 目录
    model_files = sorted([
        f for f in os.listdir(models_dir)
        if f.endswith(".md") and f != "_index.md"
    ])
    
    # 扫描 jds 目录
    jd_files = sorted([
        f for f in os.listdir(jds_dir)
        if f.endswith(".md")
    ]) if os.path.exists(jds_dir) else []
    
    lines = [
        "# 模型索引（由 export_model.py 自动维护）\n",
        f"> 最后更新：{datetime.now().strftime('%Y-%m-%d %H:%M')}\n",
        "## 可用模型\n",
        "| 文件名 | 模型名称 | 层级 | 适用范围 |",
        "|--------|---------|------|---------|",
    ]
    
    for f in model_files:
        fpath = os.path.join(models_dir, f)
        meta = extract_model_meta(fpath)
        lines.append(f"| `{f}` | {meta['name']} | {meta['level']} | {meta['scope']} |")
    
    if jd_files:
        lines.extend([
            "\n## 可用 JD\n",
            "| 文件名 |",
            "|--------|",
        ])
        for f in jd_files:
            lines.append(f"| `{f}` |")
    
    lines.append(f"\n## 加载策略\n")
    lines.append("1. 启动时扫描本目录读取所有模型文件")
    lines.append("2. 用户选择目标模型后加载使用")
    lines.append("3. 简历筛选场景从 jds/ 目录读取 JD 文件")
    
    with open(index_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    
    print(f"✅ 索引已更新：{index_path}")


def export_model(model_path: str, jd_path: str = None, target_dir: str = None):
    """导出模型和 JD 到招聘助手"""
    # 确定目标目录
    if not target_dir:
        target_dir = find_target_skill()
    
    if not target_dir:
        print("❌ 未找到招聘助手 Skill。请确认已安装 recruiting-assistant 或 hr-interview-assistant-pro。")
        sys.exit(1)
    
    # 确保目标目录存在
    models_dir = os.path.join(target_dir, "references", "models")
    jds_dir = os.path.join(target_dir, "references", "jds")
    os.makedirs(models_dir, exist_ok=True)
    os.makedirs(jds_dir, exist_ok=True)
    
    # 复制模型文件
    model_filename = Path(model_path).name
    target_model = os.path.join(models_dir, model_filename)
    shutil.copy2(model_path, target_model)
    print(f"✅ 模型已导出：{target_model}")
    
    # 复制 JD 文件（如有）
    if jd_path and os.path.exists(jd_path):
        jd_filename = Path(jd_path).name
        target_jd = os.path.join(jds_dir, jd_filename)
        shutil.copy2(jd_path, target_jd)
        print(f"✅ JD 已导出：{target_jd}")
    
    # 更新索引
    update_index(models_dir, jds_dir)
    
    print(f"\n🎉 导出完成！招聘助手可以使用新模型了。")


def main():
    parser = argparse.ArgumentParser(description="模型+JD 导出工具")
    parser.add_argument("model_file", help="模型文件路径")
    parser.add_argument("--jd", default=None, help="JD 文件路径（可选）")
    parser.add_argument("--target-dir", default=None, help="招聘助手根目录")
    
    args = parser.parse_args()
    
    if not os.path.exists(args.model_file):
        print(f"❌ 模型文件不存在：{args.model_file}", file=sys.stderr)
        sys.exit(1)
    
    export_model(args.model_file, args.jd, args.target_dir)


if __name__ == "__main__":
    main()
