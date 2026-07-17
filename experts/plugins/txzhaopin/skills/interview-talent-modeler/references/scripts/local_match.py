#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
本地词典匹配脚本（Skill 场景简化版）
=====================================

用途：interview-talent-modeler Skill 的混合模式 B1 步骤
输入：清洗后的数据 JSON + 同义词词典 + 职位名称
输出：每条记录匹配到的能力要素列表 + 基础统计

使用方式：
  python3 local_match.py --data cleaned_data.json --position 招聘调配
  python3 local_match.py --data cleaned_data.json --position 后台开发 --recruit-type 社招

说明：
  - 纯子串匹配，不依赖 Trie 引擎
  - 按职位过滤专业技能（只保留该职位的词条）
  - 背景资质/通用技能/软素质/文化匹配不做职位过滤
  - 输出 JSON 格式，供 Skill 后续统计和 LLM 补充使用
"""

import json
import re
import sys
import os
from collections import defaultdict
from pathlib import Path

# ============================================================================
# 配置
# ============================================================================

# 泛化词黑名单（匹配到也丢弃）
VAGUE_TERMS = {
    '综合能力', '综合素质', '岗位匹配度', '整体表现', '总体评价',
    '综合评价', '面试表现', '基本能力', '技术能力', '技术水平',
    '综合表现', '基本条件', '硬技能', '软素质', '文化匹配',
}

# ============================================================================
# 词典加载
# ============================================================================

def load_synonyms(synonyms_path):
    """
    加载同义词词典，构建 { 同义词 → (标准名, 维度, 分组) } 的扁平映射
    """
    with open(synonyms_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    mapping = {}  # synonym_lower → { stdName, dimension, group }
    
    for dimension, groups in data.items():
        for group_or_skill, sub in groups.items():
            for std_name, synonyms in sub.items():
                if not isinstance(synonyms, list):
                    continue
                # 标准名本身也作为触发词
                key = std_name.lower()
                if key not in mapping:
                    mapping[key] = {
                        'stdName': std_name,
                        'dimension': dimension,
                        'group': group_or_skill
                    }
                # 同义词列表
                for syn in synonyms:
                    key = syn.lower().strip()
                    if key and len(key) >= 2:
                        mapping[key] = {
                            'stdName': std_name,
                            'dimension': dimension,
                            'group': group_or_skill
                        }
    
    return mapping


def load_position_skills(taxonomy_source, position):
    """
    从标准能力词条体系中提取指定职位的专业技能列表
    返回 set，如果找不到该职位返回 None（不做过滤）

    taxonomy_source 可以是：
      - 本地路径（向后兼容旧用法）
      - 字符串内容（已通过 MCP 拉到的正文，避免落盘）
    """
    if isinstance(taxonomy_source, str) and (taxonomy_source.startswith('# ') or '\n' in taxonomy_source):
        # 直接是正文字符串
        content = taxonomy_source
    else:
        # 当作路径处理
        with open(taxonomy_source, 'r', encoding='utf-8') as f:
            content = f.read()

    # 匹配 **职位名**：技能1、技能2、...
    pattern = rf'\*\*{re.escape(position)}\*\*：(.+)'
    match = re.search(pattern, content)
    if not match:
        return None  # 未匹配到，不做过滤

    skills_str = match.group(1)
    skills = {s.strip() for s in skills_str.split('、') if s.strip()}
    return skills


def fetch_taxonomy_via_mcp():
    """
    通过 mcporter 调用 MCP get_document(documentId=39) 拉取标准能力词条体系正文。
    返回正文字符串；失败返回 None。
    """
    import subprocess
    try:
        result = subprocess.run(
            ['mcporter', 'call', 'recruit-mcp', 'CallAPI',
             "apiId=recruit.recruit-ai-service.get_document",
             'params={"documentId":"39"}'],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0:
            return None
        import json as _json
        r = _json.loads(result.stdout, strict=False)
        return r.get('data', {}).get('data') or None
    except Exception:
        return None


# ============================================================================
# 匹配引擎
# ============================================================================

def match_comment(comment, synonym_map, position_skills):
    """
    对单条评价做子串匹配
    
    Args:
        comment: 评价文本
        synonym_map: { synonym_lower → {stdName, dimension, group} }
        position_skills: set of 该职位专业技能名，None 表示不过滤
    
    Returns:
        list of { stdName, dimension, group, sentiment, matchedWord }
    """
    if not comment or len(comment.strip()) < 5:
        return []
    
    text = comment.lower()
    matched = {}  # stdName → match_info（去重：同一标准名只计一次）
    
    # 按同义词长度降序匹配（长词优先，避免短词误匹配）
    sorted_synonyms = sorted(synonym_map.keys(), key=len, reverse=True)
    
    for syn in sorted_synonyms:
        if syn in text:
            info = synonym_map[syn]
            std_name = info['stdName']
            
            # 去重
            if std_name in matched:
                continue
            
            # 泛化词过滤
            if std_name in VAGUE_TERMS:
                continue
            
            # 职位专业技能过滤
            dimension = info['dimension']
            if dimension == '硬技能' and info['group'] != '通用技能':
                # 是专业技能，需要按职位过滤
                if position_skills is not None and std_name not in position_skills:
                    continue
            
            # 简单情感判断：检查匹配位置附近是否有否定词
            sentiment = 'positive'
            idx = text.find(syn)
            context_before = text[max(0, idx-5):idx]
            if any(neg in context_before for neg in ['不', '没', '缺', '弱', '差', '欠']):
                sentiment = 'negative'
            
            matched[std_name] = {
                'stdName': std_name,
                'dimension': dimension,
                'group': info['group'],
                'sentiment': sentiment,
                'matchedWord': syn
            }
    
    return list(matched.values())


# ============================================================================
# 统计计算
# ============================================================================

def compute_stats(records, elements_per_record):
    """
    计算 F / R_total / R_admit / Phi
    
    Args:
        records: 清洗后的记录列表
        elements_per_record: { record_index → [matched_elements] }
    
    Returns:
        list of { stdName, dimension, group, F, R_total, R_admit, Phi, pValue }
    """
    total = len(records)
    passed = sum(1 for r in records if r.get('resultNorm') == 'pass')
    failed = total - passed
    
    if total == 0:
        return []
    
    # 统计每个标准名的 a/b/c/d（2×2列联表）
    term_stats = defaultdict(lambda: {'a': 0, 'b': 0, 'c': 0, 'd': 0, 
                                       'dimension': '', 'group': ''})
    
    for i, record in enumerate(records):
        is_pass = record.get('resultNorm') == 'pass'
        elements = elements_per_record.get(i, [])
        mentioned_terms = {e['stdName'] for e in elements}
        
        for e in elements:
            name = e['stdName']
            term_stats[name]['dimension'] = e['dimension']
            term_stats[name]['group'] = e['group']
        
        # 更新所有已知 term 的列联表
        for name in term_stats:
            mentioned = name in mentioned_terms
            if mentioned and is_pass:
                term_stats[name]['a'] += 1
            elif not mentioned and is_pass:
                term_stats[name]['b'] += 1
            elif mentioned and not is_pass:
                term_stats[name]['c'] += 1
            else:
                term_stats[name]['d'] += 1
    
    # 计算指标
    results = []
    import math
    
    for name, s in term_stats.items():
        a, b, c, d = s['a'], s['b'], s['c'], s['d']
        F = a + c
        R_total = round(F / total * 100, 1) if total > 0 else 0
        R_admit = round(a / passed * 100, 1) if passed > 0 else 0
        
        # Phi
        denom = math.sqrt((a+b) * (c+d) * (a+c) * (b+d)) if (a+b)*(c+d)*(a+c)*(b+d) > 0 else 0
        phi = round((a*d - b*c) / denom, 3) if denom > 0 else 0
        
        # Phi 标签
        abs_phi = abs(phi)
        if abs_phi >= 0.3:
            phi_label = '强正向' if phi > 0 else '强负向'
        elif abs_phi >= 0.15:
            phi_label = '中等正向' if phi > 0 else '中等负向'
        elif abs_phi >= 0.05:
            phi_label = '弱正向' if phi > 0 else '弱负向'
        else:
            phi_label = '无关联'
        
        results.append({
            'stdName': name,
            'dimension': s['dimension'],
            'group': s['group'],
            'F': F,
            'R_total': R_total,
            'R_admit': R_admit,
            'Phi': phi,
            'PhiLabel': phi_label,
            'F_admit': a,
            'F_reject': c
        })
    
    # 按 F 降序
    results.sort(key=lambda x: -x['F'])
    return results


# ============================================================================
# 主流程
# ============================================================================

def main():
    import argparse
    
    parser = argparse.ArgumentParser(description='本地词典匹配（Skill 简化版）')
    parser.add_argument('--data', required=True, help='清洗后的数据 JSON 文件路径')
    parser.add_argument('--position', required=True, help='职位名称（如"招聘调配"、"后台开发"）')
    parser.add_argument('--recruit-type', default='', help='招聘类型（社招/校招），留空不过滤')
    parser.add_argument('--output', default='match_result.json', help='输出文件路径')
    parser.add_argument('--synonyms', default=None, help='同义词词典路径（默认自动查找）')
    parser.add_argument('--taxonomy', default=None,
                        help='词条体系路径（可选；若不指定则通过 MCP get_document(id=39) 远程拉取）')
    args = parser.parse_args()
    
    # 自动查找 references 目录
    script_dir = Path(__file__).parent
    refs_dir = script_dir.parent if script_dir.name == 'scripts' else script_dir
    
    synonyms_path = args.synonyms or str(refs_dir / 'skill-synonyms.json')
    
    if not os.path.exists(synonyms_path):
        print(f'❌ 词典文件不存在: {synonyms_path}', file=sys.stderr)
        sys.exit(1)
    
    # 1. 加载词典
    print(f'加载词典: {synonyms_path}')
    synonym_map = load_synonyms(synonyms_path)
    print(f'  同义词总数: {len(synonym_map)}')
    
    # 2. 加载职位专业技能（远程优先）
    position_skills = None
    if args.taxonomy and os.path.exists(args.taxonomy):
        # 显式传入的本地路径（开发/调试用）
        print(f'  从本地路径加载词条体系: {args.taxonomy}')
        position_skills = load_position_skills(args.taxonomy, args.position)
    else:
        # 走远程 MCP
        print(f'  通过 MCP 拉取标准能力词条体系（远程权威版本）...')
        taxonomy_text = fetch_taxonomy_via_mcp()
        if taxonomy_text:
            position_skills = load_position_skills(taxonomy_text, args.position)
        else:
            print(f'  ⚠️ MCP 拉取失败（可能未配置 mcporter / 鉴权过期），跳过专业技能过滤')

    if position_skills:
        print(f'  职位「{args.position}」专业技能: {len(position_skills)} 项')
    else:
        print(f'  职位「{args.position}」未匹配到专业技能列表，不做专业技能过滤')
    
    # 3. 加载数据
    with open(args.data, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    records = data if isinstance(data, list) else data.get('records', [])
    print(f'加载数据: {len(records)} 条记录')
    
    # 4. 按招聘类型过滤（如指定）
    if args.recruit_type:
        rt = args.recruit_type
        filtered = [r for r in records if rt in (r.get('recruitCategory', '') or '')
                                       or rt in (r.get('sourceType', '') or '')]
        if len(filtered) == 0:
            print(f'  ⚠️ 按招聘类型「{rt}」过滤后为0条，改为不过滤使用全量数据')
        else:
            records = filtered
            print(f'  按招聘类型「{rt}」过滤后: {len(records)} 条')
    
    # 5. 逐条匹配
    elements_per_record = {}
    total_elements = 0
    zero_match_count = 0
    
    for i, record in enumerate(records):
        comment = record.get('comment', '')
        elements = match_comment(comment, synonym_map, position_skills)
        elements_per_record[i] = elements
        total_elements += len(elements)
        if len(elements) == 0:
            zero_match_count += 1
    
    print(f'匹配完成: 共提取 {total_elements} 个要素，{zero_match_count} 条零匹配')
    
    # 6. 统计
    stats = compute_stats(records, elements_per_record)
    
    # 7. 输出
    output = {
        'position': args.position,
        'recruitType': args.recruit_type or '全部',
        'totalRecords': len(records),
        'passedRecords': sum(1 for r in records if r.get('resultNorm') == 'pass'),
        'totalElements': total_elements,
        'zeroMatchCount': zero_match_count,
        'zeroMatchRate': round(zero_match_count / max(1, len(records)) * 100, 1),
        'elementStats': stats,
        'elementsPerRecord': {
            str(i): elems for i, elems in elements_per_record.items()
        }
    }
    
    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    
    print(f'\n结果已保存: {args.output}')
    print(f'\n=== 统计摘要 ===')
    print(f'  记录数: {len(records)}')
    print(f'  通过率: {output["passedRecords"]}/{len(records)} ({round(output["passedRecords"]/max(1,len(records))*100,1)}%)')
    print(f'  提取要素数: {total_elements}')
    print(f'  零匹配记录: {zero_match_count} ({output["zeroMatchRate"]}%)')
    print(f'  标准词条数: {len(stats)}')
    print(f'\n=== Top 15 能力项 ===')
    for s in stats[:15]:
        print(f'  {s["stdName"]:12s}  F={s["F"]:3d}  R_total={s["R_total"]:5.1f}%  R_admit={s["R_admit"]:5.1f}%  Phi={s["Phi"]:+.3f}({s["PhiLabel"]})')


if __name__ == '__main__':
    main()
