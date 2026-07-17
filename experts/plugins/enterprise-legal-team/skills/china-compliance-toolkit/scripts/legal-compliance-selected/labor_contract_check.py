#!/usr/bin/env python3
"""
labor_contract_check.py — 劳动合同审查技能 (Skill #19)
审查劳动合同是否符合《劳动合同法》等法规要求。

用法: python labor_contract_check.py <contract_file> [--output report.md]
"""

import sys
import re
import json
from datetime import datetime
from pathlib import Path

# ─── 劳动合同审查规则 ───
LABOR_RULES = [
    {
        "id": "L001",
        "category": "必备条款",
        "check": "employer_info",
        "description": "缺少用人单位基本信息（名称、住所、法定代表人）",
        "severity": "high",
        "legal_basis": "《劳动合同法》第17条",
    },
    {
        "id": "L002",
        "category": "必备条款",
        "check": "employee_info",
        "description": "缺少劳动者基本信息（姓名、住址、身份证号）",
        "severity": "high",
        "legal_basis": "《劳动合同法》第17条",
    },
    {
        "id": "L003",
        "category": "必备条款",
        "check": "contract_term",
        "description": "缺少合同期限约定",
        "severity": "high",
        "legal_basis": "《劳动合同法》第17条",
    },
    {
        "id": "L004",
        "category": "必备条款",
        "check": "job_description",
        "description": "缺少工作内容和工作地点",
        "severity": "high",
        "legal_basis": "《劳动合同法》第17条",
    },
    {
        "id": "L005",
        "category": "必备条款",
        "check": "working_hours",
        "description": "缺少工作时间和休息休假",
        "severity": "high",
        "legal_basis": "《劳动合同法》第17条",
    },
    {
        "id": "L006",
        "category": "必备条款",
        "check": "salary",
        "description": "缺少劳动报酬约定",
        "severity": "high",
        "legal_basis": "《劳动合同法》第17条",
    },
    {
        "id": "L007",
        "category": "必备条款",
        "check": "social_insurance",
        "description": "缺少社会保险条款",
        "severity": "high",
        "legal_basis": "《劳动合同法》第17条",
    },
    {
        "id": "L008",
        "category": "试用期",
        "pattern": r"试用期.{0,10}([一二三四五六七八九十\d]+)个?月",
        "description": "试用期时长需与合同期限匹配",
        "severity": "high",
        "legal_basis": "《劳动合同法》第19条",
        "suggestion": "合同期限3个月-1年：试用期≤1个月；1-3年：≤2个月；3年以上：≤6个月",
    },
    {
        "id": "L009",
        "category": "试用期",
        "pattern": r"试用期.{0,10}工资.{0,20}(\d+)%|试用期.{0,10}(底薪|基本工资)",
        "description": "试用期工资不得低于约定工资的80%且不低于最低工资标准",
        "severity": "medium",
        "legal_basis": "《劳动合同法》第20条",
    },
    {
        "id": "L010",
        "category": "竞业限制",
        "pattern": r"竞业限制.{0,20}([一二三四五六七八九十\d]+)年",
        "description": "竞业限制期限最长不超过2年",
        "severity": "high",
        "legal_basis": "《劳动合同法》第24条",
    },
    {
        "id": "L011",
        "category": "竞业限制",
        "pattern": r"竞业限制.{0,50}经济补偿",
        "severity": "low",
        "description": "竞业限制需约定经济补偿（月均工资30%以上）",
        "legal_basis": "《劳动合同法》第23条",
    },
    {
        "id": "L012",
        "category": "违约金",
        "pattern": r"违约金.{0,20}([\d,]+)\s*(?:元|万)",
        "description": "劳动合同违约金仅限于培训费和竞业限制两种情形",
        "severity": "high",
        "legal_basis": "《劳动合同法》第25条",
    },
    {
        "id": "L013",
        "category": "加班",
        "pattern": r"加班.{0,10}(不支付|无偿|包含在工资内)",
        "description": "加班必须支付加班费，不能约定免除",
        "severity": "high",
        "legal_basis": "《劳动法》第44条",
    },
    {
        "id": "L014",
        "category": "解除",
        "pattern": r"(用人单位|甲方).{0,10}可随时.{0,10}(解除|辞退)",
        "description": "用人单位不得随意解除劳动合同",
        "severity": "high",
        "legal_basis": "《劳动合同法》第39-41条",
    },
    {
        "id": "L015",
        "category": "社会保险",
        "pattern": r"(放弃社保|不缴纳社保|社保补贴|社保折现)",
        "description": "不得约定放弃社保或以补贴代替社保缴纳",
        "severity": "high",
        "legal_basis": "《社会保险法》第58条",
    },
]


def load_contract(file_path: str) -> str:
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"文件不存在: {file_path}")
    return path.read_text(encoding="utf-8")


def check_mandatory_clauses(text: str) -> list[dict]:
    """Check for mandatory clause presence."""
    findings = []
    keyword_map = {
        "employer_info": ["甲方", "用人单位", "公司名称", "法定代表人"],
        "employee_info": ["乙方", "劳动者", "姓名", "身份证"],
        "contract_term": ["合同期限", "合同有效期", "固定期限", "无固定期限"],
        "job_description": ["工作内容", "工作岗位", "工作地点", "职位"],
        "working_hours": ["工作时间", "工时制度", "标准工时", "休息休假"],
        "salary": ["工资", "薪酬", "劳动报酬", "薪资"],
        "social_insurance": ["社会保险", "社保", "五险一金", "养老保险"],
    }
    
    for rule in LABOR_RULES:
        if rule.get("check") and rule["check"] in keyword_map:
            keywords = keyword_map[rule["check"]]
            if not any(kw in text for kw in keywords):
                findings.append({
                    "rule_id": rule["id"],
                    "category": rule["category"],
                    "severity": rule["severity"],
                    "description": rule["description"],
                    "legal_basis": rule["legal_basis"],
                    "matched_text": None,
                    "suggestion": f"请补充{rule['description'].split('缺少')[1] if '缺少' in rule['description'] else '相关条款'}",
                })
    
    return findings


def check_pattern_rules(text: str) -> list[dict]:
    """Check contract against pattern-based rules."""
    findings = []
    
    for rule in LABOR_RULES:
        if not rule.get("pattern"):
            continue
        
        for match in re.finditer(rule["pattern"], text, re.IGNORECASE):
            finding = {
                "rule_id": rule["id"],
                "category": rule["category"],
                "severity": rule["severity"],
                "description": rule["description"],
                "legal_basis": rule.get("legal_basis", ""),
                "matched_text": match.group(0),
                "suggestion": rule.get("suggestion", "请核实并修改此条款"),
            }
            
            # Special check for probation period
            if rule["id"] == "L008":
                months_str = match.group(1) if match.lastindex else ""
                months = parse_chinese_number(months_str) if months_str else 0
                if months > 6:
                    finding["description"] = f"试用期{months}个月超过法定最长期限6个月"
                    finding["severity"] = "high"
                elif months > 2:
                    finding["description"] = f"试用期{months}个月，需确认合同期限是否为3年以上"
                    finding["severity"] = "medium"
            
            # Special check for non-compete period
            if rule["id"] == "L010":
                years_str = match.group(1) if match.lastindex else ""
                years = parse_chinese_number(years_str) if years_str else 0
                if years > 2:
                    finding["description"] = f"竞业限制{years}年超过法定最长期限2年"
            
            findings.append(finding)
    
    return findings


def parse_chinese_number(s: str) -> int:
    """Parse Chinese/Arabic number string to int."""
    mapping = {"一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5,
               "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}
    if s in mapping:
        return mapping[s]
    try:
        return int(s)
    except ValueError:
        return 0


def calculate_score(findings: list[dict]) -> dict:
    weights = {"high": 12, "medium": 6, "low": 2}
    total = sum(weights.get(f["severity"], 5) for f in findings)
    score = max(0, 100 - total)
    
    counts = {}
    for f in findings:
        counts[f["severity"]] = counts.get(f["severity"], 0) + 1
    
    return {
        "score": score,
        "grade": "A" if score >= 80 else "B" if score >= 60 else "C" if score >= 40 else "D",
        "total": len(findings),
        "counts": counts,
    }


def generate_report(findings: list[dict], score: dict) -> str:
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    
    lines = [
        "# 劳动合同审查报告",
        "",
        f"**生成时间**: {now}",
        f"**审查依据**: 《劳动合同法》《劳动法》《社会保险法》",
        "",
        "---",
        "",
        "## 审查评分",
        "",
        f"| 指标 | 结果 |",
        f"|------|------|",
        f"| 综合评分 | **{score['score']}/100** ({score['grade']}级) |",
        f"| 发现问题 | {score['total']} 项 |",
        f"| 🔴 高风险 | {score['counts'].get('high', 0)} 项 |",
        f"| 🟡 中风险 | {score['counts'].get('medium', 0)} 项 |",
        f"| 🟢 低风险 | {score['counts'].get('low', 0)} 项 |",
        "",
        "## 问题详情",
        "",
    ]
    
    if not findings:
        lines.append("✅ 劳动合同审查通过，未发现明显问题。")
    else:
        for severity, emoji in [("high", "🔴"), ("medium", "🟡"), ("low", "🟢")]:
            sev_list = [f for f in findings if f["severity"] == severity]
            if sev_list:
                label = {"high": "高风险", "medium": "中风险", "low": "低风险"}[severity]
                lines.append(f"### {emoji} {label}")
                lines.append("")
                for f in sev_list:
                    lines.append(f"**{f['rule_id']} — {f['category']}**")
                    lines.append(f"- 问题: {f['description']}")
                    lines.append(f"- 法律依据: {f['legal_basis']}")
                    if f.get("matched_text"):
                        lines.append(f"- 原文: `{f['matched_text']}`")
                    if f.get("suggestion"):
                        lines.append(f"- 建议: {f['suggestion']}")
                    lines.append("")
    
    lines.extend([
        "---",
        "",
        "## 免责声明",
        "",
        "本报告由AI自动生成，仅供参考，不构成法律意见。",
        "劳动合同审查建议由专业律师或人力资源专家进行最终确认。",
        "",
        f"*Generated by Legal Compliance Skill Bundle v1.0.0*",
    ])
    
    return "\n".join(lines)


def main():
    if len(sys.argv) < 2:
        print("用法: python labor_contract_check.py <contract_file> [--output report.md]")
        sys.exit(1)
    
    contract_file = sys.argv[1]
    output_file = None
    
    if "--output" in sys.argv:
        idx = sys.argv.index("--output")
        if idx + 1 < len(sys.argv):
            output_file = sys.argv[idx + 1]
    
    try:
        text = load_contract(contract_file)
        print(f"已加载: {contract_file} ({len(text)} 字)")
        
        findings = check_mandatory_clauses(text)
        findings.extend(check_pattern_rules(text))
        print(f"发现 {len(findings)} 个问题")
        
        score = calculate_score(findings)
        print(f"评分: {score['score']}/100 ({score['grade']}级)")
        
        report = generate_report(findings, score)
        
        if output_file:
            Path(output_file).write_text(report, encoding="utf-8")
            print(f"报告已保存: {output_file}")
        else:
            print("\n" + report)
    
    except Exception as e:
        print(f"[ERROR] {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
