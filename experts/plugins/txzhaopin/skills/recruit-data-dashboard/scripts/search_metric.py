#!/usr/bin/env python3
"""
指标检索工具：自然语言问句 -> 候选指标列表（top-5，含打分）

用法：
    python search_metric.py "今年5月集团本部社招入职多少人"

输出：
    [
      {"id": "recruit-entry-cnt", "name_zh": "入职数", "score": 10.5, "matched": ["入职"]},
      ...
    ]
"""
import json
import re
import sys
from pathlib import Path


def find_index_path():
    """优先在 skill 内部 knowledge/ 查找；兼容沙箱 .knowledge/ 旧路径"""
    skill_dir = Path(__file__).resolve().parent.parent
    candidates = [
        # 1. skill 自包含路径（打包后的标准位置）
        skill_dir / 'knowledge/_audit/metrics-search-index.json',
        # 2. 当前工作目录（万一 cwd 是 skill 目录）
        Path.cwd() / 'knowledge/_audit/metrics-search-index.json',
        # 3. 沙箱开发期：父目录的 .knowledge（兼容回退）
        skill_dir.parent / '.knowledge/_audit/metrics-search-index.json',
    ]
    for p in candidates:
        if p.exists():
            return p
    raise FileNotFoundError(f'倒排索引未找到，已尝试: {[str(p) for p in candidates]}')


def score(query, info):
    """打分：综合名称、别名、业务过程、类型"""
    q = query.lower()
    matched = []
    s = 0.0

    # 中文名匹配
    name = (info.get('name_zh') or '').lower()
    if name and name in q:
        s += 10
        matched.append(f'name:{name}')
    elif name:
        # 部分子串
        for token in re.findall(r'[\u4e00-\u9fa5a-z]+', name):
            if len(token) >= 2 and token in q:
                s += 3
                matched.append(f'name_token:{token}')

    # 别名匹配
    for alias in info.get('aliases') or []:
        a = alias.lower().strip()
        if not a:
            continue
        if a in q:
            s += 8
            matched.append(f'alias:{a}')

    # 业务过程匹配
    bp = (info.get('business_node') or '').lower()
    if bp and bp in q:
        s += 4
        matched.append(f'business:{bp}')

    # 类型相关词
    t = info.get('type') or ''
    if t == 'composite' and any(w in q for w in ['率', '比例', '转化', '通过率']):
        s += 2
        matched.append('type:rate')
    if t == 'derived' and any(w in q for w in ['总', '在招', '进展', '需求']):
        s += 2
        matched.append('type:derived')

    return s, matched


def search(query, top_k=5):
    index_path = find_index_path()
    with open(index_path, encoding='utf-8') as f:
        index = json.load(f)

    scored = []
    for mid, info in index.items():
        s, matched = score(query, info)
        if s > 0:
            scored.append({
                'id': mid,
                'name_zh': info.get('name_zh'),
                'type': info.get('type'),
                'business_node': info.get('business_node'),
                'score': round(s, 2),
                'matched': matched,
                'card_file': info.get('card_file'),
            })

    scored.sort(key=lambda x: -x['score'])
    return scored[:top_k]


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python search_metric.py "<查询问句>"', file=sys.stderr)
        sys.exit(1)
    query = ' '.join(sys.argv[1:])
    results = search(query)
    print(json.dumps(results, ensure_ascii=False, indent=2))
