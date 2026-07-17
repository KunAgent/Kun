#!/usr/bin/env python3
"""
单向同步：沙箱 .knowledge/ → skill 内 knowledge/

- 源：<sandbox-root>/.knowledge/
- 目标：<skill-root>/knowledge/
- 行为：清空目标后整目录复制（保证不留陈旧文件）
- 排除：__MACOSX、.DS_Store、source/ 目录下的表格原档（*.xlsx/*.xls，太大且非必需）

使用：
    python3 scripts/sync_knowledge.py
"""
import shutil
import sys
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
SANDBOX_ROOT = SKILL_DIR.parent
SRC = SANDBOX_ROOT / '.knowledge'
DST = SKILL_DIR / 'knowledge'

# 排除规则
EXCLUDE_DIRS = {'__MACOSX'}
EXCLUDE_FILES = {'.DS_Store'}
# source/ 下的表格原档不带（用户拿到 skill 不需要原始表格文件）
EXCLUDE_PATTERNS = {'*.xlsx', '*.xls'}


def should_exclude(path: Path) -> bool:
    if path.name in EXCLUDE_DIRS or path.name in EXCLUDE_FILES:
        return True
    for pat in EXCLUDE_PATTERNS:
        if path.match(pat):
            return True
    return False


def copy_tree(src: Path, dst: Path):
    """递归复制，应用排除规则。"""
    if should_exclude(src):
        return
    if src.is_dir():
        dst.mkdir(parents=True, exist_ok=True)
        for child in src.iterdir():
            copy_tree(child, dst / child.name)
    else:
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)


def fix_index_paths():
    """修复倒排索引里的 card_file 字段：.knowledge/ -> knowledge/

    因为源头索引（沙箱用）路径是 .knowledge/，复制到 skill 内后必须改成
    skill 自包含路径 knowledge/，否则 skill 安装到别处后路径失效。
    """
    import json
    idx_path = DST / '_audit/metrics-search-index.json'
    if not idx_path.exists():
        return
    with open(idx_path, encoding='utf-8') as f:
        idx = json.load(f)
    fixed = 0
    for info in idx.values():
        cf = info.get('card_file', '')
        if cf.startswith('.knowledge/'):
            info['card_file'] = cf.replace('.knowledge/', 'knowledge/', 1)
            fixed += 1
    if fixed:
        with open(idx_path, 'w', encoding='utf-8') as f:
            json.dump(idx, f, ensure_ascii=False, indent=2)
        print(f'🔧 修复倒排索引 card_file 路径：{fixed} 处')


def main():
    if not SRC.exists():
        print(f'❌ 源目录不存在：{SRC}', file=sys.stderr)
        sys.exit(1)

    if DST.exists():
        print(f'🧹 清空旧目标：{DST}')
        shutil.rmtree(DST)

    print(f'📁 源：{SRC}')
    print(f'📁 目标：{DST}')
    print('🔄 同步中...')

    copy_tree(SRC, DST)

    # 同步后修复倒排索引路径
    fix_index_paths()

    # 统计
    file_cnt = sum(1 for _ in DST.rglob('*') if _.is_file())
    size_kb = sum(f.stat().st_size for f in DST.rglob('*') if f.is_file()) / 1024
    print(f'✅ 完成：{file_cnt} 个文件，{size_kb:.1f} KB')

    # ============ 同步后自动跑回归测试 ============
    print('\n🔍 同步后自动回归测试...')
    print('─' * 60)
    import subprocess
    regression_script = Path(__file__).parent / 'regression_check.py'
    if regression_script.exists():
        result = subprocess.run(
            [sys.executable, str(regression_script)],
            capture_output=False,
        )
        if result.returncode == 1:
            print('\n❌ 回归测试发现致命问题，请修复后再使用 skill', file=sys.stderr)
            sys.exit(1)
        elif result.returncode == 2:
            print('\n⚠️  回归测试有警告（不阻塞）', file=sys.stderr)
        # returncode == 0：通过，继续
    else:
        print(f'⏭️  未找到 regression_check.py，跳过回归测试')


if __name__ == '__main__':
    main()
