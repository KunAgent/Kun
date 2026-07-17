#!/usr/bin/env python3
"""
面评质量审计 CLI 工具
可独立调用，也可被招聘助手（recruiting-assistant）跨 Skill 调用。

用法:
  python3 audit_evaluation.py --input <file> [--model <model>] [--format json|markdown] [--patterns <patterns_json>]

参数:
  --input     面评文件路径（Markdown 格式）
  --model     模型文件路径（可选，提供则做维度对标校验）
  --format    输出格式，json 或 markdown（默认 markdown）
  --patterns  空话模式库路径（默认为同 Skill 下的 references/empty-talk-patterns.json）
"""

import argparse
import json
import re
import os
import sys
from pathlib import Path


def load_patterns(patterns_path: str) -> dict:
    """加载空话模式库"""
    if not os.path.exists(patterns_path):
        # 尝试相对于脚本位置查找
        script_dir = Path(__file__).parent.parent
        alt_path = script_dir / "references" / "empty-talk-patterns.json"
        if alt_path.exists():
            patterns_path = str(alt_path)
        else:
            print(f"Warning: patterns file not found at {patterns_path}", file=sys.stderr)
            return {}
    
    with open(patterns_path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_model(model_path: str) -> dict:
    """解析模型文件，提取维度清单"""
    if not model_path or not os.path.exists(model_path):
        return {}
    
    with open(model_path, "r", encoding="utf-8") as f:
        content = f.read()
    
    # 简单解析：从维度总览表格中提取维度名
    dimensions = []
    in_table = False
    for line in content.split("\n"):
        if "维度" in line and "|" in line and "序号" in line or "维度" in line and "核心考察点" in line:
            in_table = True
            continue
        if in_table and line.startswith("|") and "---" not in line:
            cells = [c.strip() for c in line.split("|") if c.strip()]
            if len(cells) >= 2:
                dim_name = cells[1] if cells[0].isdigit() else cells[0]
                dimensions.append(dim_name)
        elif in_table and not line.startswith("|"):
            in_table = False
    
    return {"dimensions": dimensions}


def detect_empty_talk(text: str, patterns: dict) -> list:
    """检测空话"""
    issues = []
    categories = patterns.get("categories", {})
    
    for cat_name, cat_data in categories.items():
        for pattern_item in cat_data.get("patterns", []):
            regex = pattern_item.get("regex", "")
            suggestion = pattern_item.get("suggestion", "")
            try:
                matches = re.finditer(regex, text)
                for match in matches:
                    issues.append({
                        "type": "empty_talk",
                        "category": cat_name,
                        "matched_text": match.group(),
                        "position": match.start(),
                        "suggestion": suggestion
                    })
            except re.error:
                continue
    
    return issues


def check_evidence(text: str) -> dict:
    """检查证据完整性——通过检测 STAR 要素的存在"""
    # 简单启发式：有具体时间/数字/人名/地点的段落认为有证据
    evidence_indicators = [
        r"\d+%",           # 百分比
        r"\d+分钟",         # 具体时间
        r"\d+个月",         # 具体时长
        r"\d+人",           # 具体人数
        r"具体",            # 明确提到"具体"
        r"案例",            # 提到案例
        r"项目",            # 提到项目
        r"当时",            # 时间标记
        r"过程中",          # 过程描述
        r"结果",            # 结果描述
    ]
    
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip() and len(p.strip()) > 20]
    total = len(paragraphs) if paragraphs else 1
    with_evidence = 0
    
    for para in paragraphs:
        for indicator in evidence_indicators:
            if re.search(indicator, para):
                with_evidence += 1
                break
    
    return {
        "total_paragraphs": total,
        "with_evidence": with_evidence,
        "completeness": round(with_evidence / total, 2) if total > 0 else 0
    }


def check_dimension_alignment(text: str, model: dict) -> dict:
    """检查维度对标"""
    if not model or "dimensions" not in model:
        return {"aligned": True, "missing": [], "extra": []}
    
    model_dims = model["dimensions"]
    found_dims = []
    
    for dim in model_dims:
        if dim in text:
            found_dims.append(dim)
    
    missing = [d for d in model_dims if d not in found_dims]
    
    return {
        "model_dimensions": len(model_dims),
        "found_dimensions": len(found_dims),
        "missing": missing,
        "alignment_rate": round(len(found_dims) / len(model_dims), 2) if model_dims else 1.0
    }


def calculate_grade(empty_talk_rate: float, evidence_completeness: float, score_consistency: float) -> str:
    """计算质量等级"""
    if empty_talk_rate < 0.05 and evidence_completeness > 0.95 and score_consistency > 0.95:
        return "A"
    elif empty_talk_rate < 0.15 and evidence_completeness > 0.80 and score_consistency > 0.80:
        return "B"
    elif empty_talk_rate < 0.30 and evidence_completeness > 0.60 and score_consistency > 0.60:
        return "C"
    else:
        return "D"


def audit(input_path: str, model_path: str = None, patterns_path: str = None) -> dict:
    """执行面评审计"""
    # 加载面评
    with open(input_path, "r", encoding="utf-8") as f:
        content = f.read()
    
    # 加载模式库
    if not patterns_path:
        script_dir = Path(__file__).parent.parent
        patterns_path = str(script_dir / "references" / "empty-talk-patterns.json")
    patterns = load_patterns(patterns_path)
    
    # 加载模型
    model = load_model(model_path) if model_path else {}
    
    # 空话检测
    empty_talk_issues = detect_empty_talk(content, patterns)
    paragraphs = [p.strip() for p in content.split("\n\n") if p.strip() and len(p.strip()) > 10]
    total_paras = len(paragraphs) if paragraphs else 1
    empty_talk_paras = len(set(issue["position"] // 100 for issue in empty_talk_issues))
    empty_talk_rate = round(min(empty_talk_paras / total_paras, 1.0), 2)
    
    # 证据完整性
    evidence = check_evidence(content)
    
    # 维度对标
    alignment = check_dimension_alignment(content, model)
    
    # 评分一致性（简化：检查分数是否有对应证据）
    score_consistency = evidence["completeness"]
    
    # 计算等级
    grade = calculate_grade(empty_talk_rate, evidence["completeness"], score_consistency)
    
    result = {
        "quality_grade": grade,
        "empty_talk_rate": empty_talk_rate,
        "evidence_completeness": evidence["completeness"],
        "score_consistency": score_consistency,
        "dimension_alignment": alignment.get("alignment_rate", 1.0),
        "issues": [
            {
                "type": issue["type"],
                "category": issue["category"],
                "detail": f"检测到空话：「{issue['matched_text']}」",
                "suggestion": issue["suggestion"]
            }
            for issue in empty_talk_issues[:20]  # 最多展示20条
        ],
        "evidence_detail": evidence,
        "alignment_detail": alignment,
        "summary": f"面评质量等级：{grade}。空话率 {empty_talk_rate*100:.0f}%，证据完整性 {evidence['completeness']*100:.0f}%，评分一致性 {score_consistency*100:.0f}%。"
    }
    
    if alignment.get("missing"):
        result["summary"] += f" 缺失维度：{'、'.join(alignment['missing'])}。"
    
    return result


def format_markdown(result: dict) -> str:
    """输出 Markdown 格式报告"""
    grade_emoji = {"A": "🟢", "B": "🟡", "C": "🟠", "D": "🔴"}
    g = result["quality_grade"]
    
    lines = [
        f"# 📋 面评质量审核报告\n",
        f"## 总评\n",
        f"| 指标 | 结果 |",
        f"|------|------|",
        f"| **质量等级** | {grade_emoji.get(g, '')} {g} |",
        f"| 空话率 | {result['empty_talk_rate']*100:.0f}% |",
        f"| 证据完整性 | {result['evidence_completeness']*100:.0f}% |",
        f"| 评分一致性 | {result['score_consistency']*100:.0f}% |",
        f"| 维度对标率 | {result['dimension_alignment']*100:.0f}% |",
        f"",
    ]
    
    if result["issues"]:
        lines.append("## 问题清单\n")
        lines.append("| # | 类型 | 问题 | 建议 |")
        lines.append("|---|------|------|------|")
        for i, issue in enumerate(result["issues"], 1):
            lines.append(f"| {i} | {issue['category']} | {issue['detail']} | {issue['suggestion']} |")
    
    lines.append(f"\n## 总结\n\n{result['summary']}")
    
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="面评质量审计 CLI")
    parser.add_argument("--input", required=True, help="面评文件路径")
    parser.add_argument("--model", default=None, help="模型文件路径（可选）")
    parser.add_argument("--format", choices=["json", "markdown"], default="markdown", help="输出格式")
    parser.add_argument("--patterns", default=None, help="空话模式库路径")
    
    args = parser.parse_args()
    
    if not os.path.exists(args.input):
        print(f"Error: input file not found: {args.input}", file=sys.stderr)
        sys.exit(1)
    
    result = audit(args.input, args.model, args.patterns)
    
    if args.format == "json":
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(format_markdown(result))


if __name__ == "__main__":
    main()
