#!/usr/bin/env python3
"""
contract_review.py — 合同审查技能 (Skill #1)
自动审查合同文本，标记风险条款，给出修改建议。

用法: python contract_review.py <contract_text_file> [--output report.md]
"""

import os
import sys
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Optional

# ─── 风险规则库 ───
RISK_RULES = [
    {
        "id": "R001",
        "category": "违约责任",
        "pattern": r"违约金.{0,20}(合同总[金额价款]+.{0,10}[百分比%]+|[0-9]+[万元])",
        "severity": "high",
        "description": "违约金比例过高，可能被法院调整",
        "suggestion": "建议违约金不超过合同总额的30%，参考《民法典》第585条"
    },
    {
        "id": "R002",
        "category": "管辖约定",
        "pattern": r"(管辖|仲裁).{0,30}(对方|甲方).{0,10}(所在地|注册地)",
        "severity": "medium",
        "description": "管辖约定对我方不利",
        "suggestion": "建议约定在我方所在地法院管辖，或选择中立仲裁机构"
    },
    {
        "id": "R003",
        "category": "免责条款",
        "pattern": r"(不承担|免除).{0,20}(一切|任何|所有).{0,10}(责任|赔偿|损失)",
        "severity": "high",
        "description": "免责条款过于宽泛，可能被认定为无效格式条款",
        "suggestion": "免责条款应具体明确，不能免除故意或重大过失责任（《民法典》第506条）"
    },
    {
        "id": "R004",
        "category": "付款条件",
        "pattern": r"(预付|先付|全款).{0,10}(100%|全部|全额)",
        "severity": "medium",
        "description": "全款预付对我方资金风险较大",
        "suggestion": "建议分期付款（如30%预付+70%验收后付），降低资金风险"
    },
    {
        "id": "R005",
        "category": "知识产权",
        "pattern": r"(所有|全部).{0,10}(知识产权|著作权|版权).{0,10}(归|属于).{0,10}(甲方|对方)",
        "severity": "high",
        "description": "知识产权全部归属对方，我方丧失权利",
        "suggestion": "建议明确约定：背景IP归各自所有，新产生IP按贡献分配"
    },
    {
        "id": "R006",
        "category": "保密条款",
        "pattern": r"保密期限.{0,10}(永久|无限期|不设期限)",
        "severity": "medium",
        "description": "保密期限过长，增加长期合规负担",
        "suggestion": "建议保密期限不超过3-5年，商业秘密除外"
    },
    {
        "id": "R007",
        "category": "合同解除",
        "pattern": r"(甲方|对方).{0,10}(单方|随时).{0,10}(解除|终止)",
        "severity": "high",
        "description": "对方享有单方解除权，对我方极为不利",
        "suggestion": "建议约定双方对等的解除权，或增加提前通知期和补偿条款"
    },
    {
        "id": "R008",
        "category": "争议解决",
        "pattern": r"(仲裁|诉讼).{0,5}(费用|成本).{0,10}(各自|由败诉方)",
        "severity": "low",
        "description": "争议解决费用分担方式需确认",
        "suggestion": "这是标准表述，但建议确认仲裁/诉讼成本预估"
    },
    {
        "id": "R009",
        "category": "不可抗力",
        "pattern": None,  # Special: checked by absence
        "absence_check": True,
        "severity": "medium",
        "description": "合同缺少不可抗力条款",
        "suggestion": "建议增加不可抗力条款，明确范围、通知义务和后果（参考《民法典》第180条）"
    },
    {
        "id": "R010",
        "category": "个人信息",
        "pattern": r"(收集|使用|共享|转让).{0,20}(个人信息|用户数据|客户信息)",
        "severity": "high",
        "description": "涉及个人信息处理，需符合《个人信息保护法》",
        "suggestion": "需明确个人信息处理的目的、方式、范围，并取得个人同意（PIPL第13/14条）"
    },
]


def load_contract(file_path: str) -> str:
    """Load contract text from file."""
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"合同文件不存在: {file_path}")

    content = path.read_text(encoding="utf-8")
    return content


def extract_basic_info(text: str) -> dict:
    """Extract basic contract information."""
    info = {}

    # Contract title
    title_match = re.search(r"^(.+?(?:合同|协议|合约))", text, re.MULTILINE)
    info["title"] = title_match.group(1).strip() if title_match else "未识别"

    # Party A
    party_a = re.search(r"甲方[：:]\s*(.+?)(?:\n|（|\()", text)
    info["party_a"] = party_a.group(1).strip() if party_a else "未识别"

    # Party B
    party_b = re.search(r"乙方[：:]\s*(.+?)(?:\n|（|\()", text)
    info["party_b"] = party_b.group(1).strip() if party_b else "未识别"

    # Amount
    amount = re.search(r"(?:合同[总金金]+额|价款|费用)[：:]\s*(.+?)(?:元|人民币)", text)
    info["amount"] = amount.group(1).strip() if amount else "未识别"

    # Duration
    duration = re.search(r"(?:合同期限|有效期)[：:]\s*(.+?)(?:\n|$)", text)
    info["duration"] = duration.group(1).strip() if duration else "未识别"

    return info


def scan_risks(text: str) -> list[dict]:
    """Scan contract text against risk rules."""
    findings = []

    for rule in RISK_RULES:
        # Check for absence of required clauses
        if rule.get("absence_check"):
            if rule["pattern"] is None:
                # Check if the clause category is mentioned at all
                category_keywords = {
                    "R009": ["不可抗力", "force majeure"],
                }
                keywords = category_keywords.get(rule["id"], [rule["category"]])
                if not any(kw in text for kw in keywords):
                    findings.append({
                        "rule_id": rule["id"],
                        "category": rule["category"],
                        "severity": rule["severity"],
                        "description": rule["description"],
                        "suggestion": rule["suggestion"],
                        "matched_text": None,
                        "position": None,
                    })
            continue

        # Pattern matching
        if rule["pattern"]:
            for match in re.finditer(rule["pattern"], text, re.IGNORECASE):
                findings.append({
                    "rule_id": rule["id"],
                    "category": rule["category"],
                    "severity": rule["severity"],
                    "description": rule["description"],
                    "suggestion": rule["suggestion"],
                    "matched_text": match.group(0),
                    "position": match.start(),
                })

    return findings


def calculate_risk_score(findings: list[dict]) -> dict:
    """Calculate overall risk score from findings."""
    severity_weights = {"high": 15, "medium": 8, "low": 3}
    total_deduction = sum(severity_weights.get(f["severity"], 5) for f in findings)
    score = max(0, 100 - total_deduction)

    severity_counts = {}
    for f in findings:
        sev = f["severity"]
        severity_counts[sev] = severity_counts.get(sev, 0) + 1

    return {
        "score": score,
        "grade": "A" if score >= 80 else "B" if score >= 60 else "C" if score >= 40 else "D",
        "total_findings": len(findings),
        "severity_counts": severity_counts,
    }


def generate_report(basic_info: dict, findings: list[dict], risk_score: dict) -> str:
    """Generate Markdown review report."""
    now = datetime.now().strftime("%Y-%m-%d %H:%M")

    lines = [
        f"# 合同审查报告",
        f"",
        f"**生成时间**: {now}",
        f"**审查工具**: Legal Compliance Skill Bundle v1.0.0",
        f"",
        f"---",
        f"",
        f"## 合同基本信息",
        f"",
        f"| 项目 | 内容 |",
        f"|------|------|",
        f"| 合同名称 | {basic_info.get('title', 'N/A')} |",
        f"| 甲方 | {basic_info.get('party_a', 'N/A')} |",
        f"| 乙方 | {basic_info.get('party_b', 'N/A')} |",
        f"| 合同金额 | {basic_info.get('amount', 'N/A')} |",
        f"| 合同期限 | {basic_info.get('duration', 'N/A')} |",
        f"",
        f"## 风险评分",
        f"",
        f"| 指标 | 结果 |",
        f"|------|------|",
        f"| 综合评分 | **{risk_score['score']}/100** ({risk_score['grade']}级) |",
        f"| 发现问题数 | {risk_score['total_findings']} 项 |",
    ]

    sev = risk_score["severity_counts"]
    lines.extend([
        f"| 🔴 高风险 | {sev.get('high', 0)} 项 |",
        f"| 🟡 中风险 | {sev.get('medium', 0)} 项 |",
        f"| 🟢 低风险 | {sev.get('low', 0)} 项 |",
        f"",
        f"## 风险详情",
        f"",
    ])

    if not findings:
        lines.append("✅ 未发现明显风险条款。建议仍请专业律师进行最终审查。")
    else:
        # Group by severity
        for severity, emoji in [("high", "🔴"), ("medium", "🟡"), ("low", "🟢")]:
            sev_findings = [f for f in findings if f["severity"] == severity]
            if sev_findings:
                lines.append(f"### {emoji} {'高' if severity == 'high' else '中' if severity == 'medium' else '低'}风险项")
                lines.append("")
                for i, f in enumerate(sev_findings, 1):
                    lines.append(f"**{f['rule_id']} - {f['category']}**")
                    lines.append(f"")
                    lines.append(f"- **问题**: {f['description']}")
                    if f.get("matched_text"):
                        lines.append(f"- **原文**: `{f['matched_text']}`")
                    lines.append(f"- **建议**: {f['suggestion']}")
                    lines.append("")

    lines.extend([
        "---",
        "",
        "## 免责声明",
        "",
        "本报告由AI自动生成，仅供参考，不构成法律意见。"
        "重大合同请务必咨询专业律师进行最终审查。",
        "",
        "---",
        f"*Generated by Legal Compliance Skill Bundle v1.0.0*",
    ])

    return "\n".join(lines)


def main():
    if len(sys.argv) < 2:
        print("用法: python contract_review.py <contract_file> [--output report.md]")
        sys.exit(1)

    contract_file = sys.argv[1]
    output_file = None

    if "--output" in sys.argv:
        idx = sys.argv.index("--output")
        if idx + 1 < len(sys.argv):
            output_file = sys.argv[idx + 1]

    try:
        text = load_contract(contract_file)
        print(f"已加载合同文件: {contract_file} ({len(text)} 字符)")

        basic_info = extract_basic_info(text)
        print(f"合同概要: {basic_info['title']}")

        findings = scan_risks(text)
        print(f"发现 {len(findings)} 个风险点")

        risk_score = calculate_risk_score(findings)
        print(f"风险评分: {risk_score['score']}/100 ({risk_score['grade']}级)")

        report = generate_report(basic_info, findings, risk_score)

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
