#!/usr/bin/env python3
"""
管道就绪校验模块（pipeline_guard）。

业务脚本在 main() 入口处调用 check_pipeline_ready()，
如果管道未就绪（.pipeline_ready 标记文件不存在），
则输出醒目的管道引导信息并拒绝执行。

这是代码级的强制保障，确保模型不会跳过 Step 1（热更新）和 Step 2（权限校验）
直接执行业务脚本。

用法（在业务脚本中）：
    from pipeline_guard import check_pipeline_ready

    def main():
        check_pipeline_ready()  # 管道未就绪时自动退出
        # ... 业务逻辑 ...
"""

import json
import sys
from pathlib import Path


def _find_project_root(start: Path) -> Path:
    """从当前脚本位置向上查找项目根目录（包含 sub-skills 目录的那一层）。

    查找策略：向上遍历，找到包含 'sub-skills' 子目录的目录即为项目根。
    最多向上查找 10 层，防止无限循环。
    """
    current = start.resolve()
    for _ in range(10):
        if (current / "sub-skills").is_dir():
            return current
        parent = current.parent
        if parent == current:
            break
        current = parent
    # 回退：假设脚本在 sub-skills/{subsystem}/{skill}/scripts/ 下，向上 4 层
    return start.resolve().parent.parent.parent.parent


def check_pipeline_ready() -> None:
    """检查管道是否就绪，未就绪则输出引导信息并退出。

    检查逻辑：
    1. 查找项目根目录下的 .pipeline_ready 标记文件
    2. 如果标记文件存在且内容有效 → 通过，正常返回
    3. 如果标记文件不存在 → 输出管道引导信息，以退出码 2 退出

    退出码说明：
    - 0: 管道就绪，正常执行（函数正常返回）
    - 2: 管道未就绪，拒绝执行（函数内部 sys.exit(2)）
    """
    # 从当前调用者的脚本位置开始查找项目根
    # 使用 sys._getframe 获取调用者的文件路径
    caller_file = Path(sys._getframe(1).f_globals.get("__file__", __file__))
    project_root = _find_project_root(caller_file.parent)
    pipeline_ready_file = project_root / ".pipeline_ready"

    if pipeline_ready_file.exists():
        try:
            content = pipeline_ready_file.read_text(encoding="utf-8")
            marker = json.loads(content)
            if marker.get("pipeline_ready"):
                return  # 管道就绪，正常继续
        except (json.JSONDecodeError, OSError, KeyError):
            pass  # 标记文件损坏，视为未就绪

    # ── 管道未就绪，输出引导信息并拒绝执行 ──
    print("=" * 70)
    print("❌ [pipeline] 管道未就绪 — 禁止直接执行业务脚本")
    print("=" * 70)
    print()
    print("必须先完成以下管道步骤，才能执行业务脚本：")
    print()
    print("  Step 1 — 全局热更新：")
    print("    python3 sub-skills/SkillBase/skill-context/scripts/hot_update.py")
    print()
    print("  Step 2 — 权限校验：")
    print("    python3 sub-skills/SkillBase/skill-context/scripts/context.py init")
    print()
    print("  Step 3 — 然后才能执行业务脚本")
    print()
    print("  Step 4 — 业务脚本执行后（无论成功或失败）必须执行上报：")
    print("    python3 sub-skills/SkillBase/skill-context/scripts/context.py execute \\")
    print('      --skill-source "子系统/skill名" --api-path "接口路径" --user-query "用户问题"')
    print()
    print("详见: sub-skills/SkillBase/SKILL.md")
    print("=" * 70)
    sys.exit(2)
