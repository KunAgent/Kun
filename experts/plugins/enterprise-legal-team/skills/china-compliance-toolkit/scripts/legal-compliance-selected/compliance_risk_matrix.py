#!/usr/bin/env python3
"""
compliance_risk_matrix.py — 合规风险矩阵生成器 (Skill #48)
根据企业情况生成合规风险评估矩阵，识别高风险领域。

用法: python compliance_risk_matrix.py --industry <行业> [--output matrix.md]
      python compliance_risk_matrix.py --config risk_config.json [--output matrix.md]
"""

import sys
import json
from datetime import datetime
from pathlib import Path

# ─── 行业合规风险预设 ───
INDUSTRY_RISKS = {
    "互联网": [
        {"domain": "数据合规", "likelihood": "高", "impact": "高", "level": "critical",
         "risks": ["个人信息泄露", "数据跨境违规", "未取得有效同意", "过度收集信息"],
         "regulations": ["PIPL", "数据安全法", "网络安全法", "APP合规"]},
        {"domain": "知识产权", "likelihood": "中", "impact": "高", "level": "high",
         "risks": ["软件著作权侵权", "商标侵权", "开源协议违规"],
         "regulations": ["著作权法", "商标法", "开源许可协议"]},
        {"domain": "内容合规", "likelihood": "中", "impact": "高", "level": "high",
         "risks": ["违规内容传播", "算法歧视", "信息茧房"],
         "regulations": ["互联网信息服务管理办法", "网络信息内容生态治理规定"]},
        {"domain": "劳动用工", "likelihood": "中", "impact": "中", "level": "medium",
         "risks": ["996工时争议", "竞业限制纠纷", "远程办公管理"],
         "regulations": ["劳动法", "劳动合同法"]},
    ],
    "金融": [
        {"domain": "反洗钱", "likelihood": "中", "impact": "高", "level": "high",
         "risks": ["KYC不完善", "大额交易未报告", "可疑交易漏报"],
         "regulations": ["反洗钱法", "金融机构反洗钱规定"]},
        {"domain": "消费者保护", "likelihood": "高", "impact": "高", "level": "critical",
         "risks": ["不当销售", "信息披露不充分", "投诉处理不当"],
         "regulations": ["消费者权益保护法", "金融消费者权益保护实施办法"]},
        {"domain": "数据合规", "likelihood": "高", "impact": "高", "level": "critical",
         "risks": ["客户信息泄露", "征信数据违规使用", "数据跨境传输"],
         "regulations": ["PIPL", "征信业管理条例", "金融数据安全"]},
    ],
    "医疗健康": [
        {"domain": "数据合规", "likelihood": "高", "impact": "高", "level": "critical",
         "risks": ["患者隐私泄露", "健康数据违规使用", "数据跨境"],
         "regulations": ["PIPL", "基本医疗卫生与健康促进法", "人类遗传资源管理条例"]},
        {"domain": "广告合规", "likelihood": "中", "impact": "高", "level": "high",
         "risks": ["虚假医疗广告", "未经审批发布药品广告"],
         "regulations": ["广告法", "医疗广告管理办法"]},
        {"domain": "资质合规", "likelihood": "低", "impact": "高", "level": "high",
         "risks": ["执业资质不全", "超范围经营"],
         "regulations": ["执业医师法", "医疗机构管理条例"]},
    ],
    "电商": [
        {"domain": "消费者保护", "likelihood": "高", "impact": "中", "level": "high",
         "risks": ["虚假宣传", "退货退款纠纷", "价格欺诈"],
         "regulations": ["消费者权益保护法", "电子商务法", "价格法"]},
        {"domain": "数据合规", "likelihood": "高", "impact": "高", "level": "critical",
         "risks": ["用户信息泄露", "精准营销合规", "数据共享"],
         "regulations": ["PIPL", "电子商务法"]},
        {"domain": "税务合规", "likelihood": "中", "impact": "高", "level": "high",
         "risks": ["收入申报不实", "跨境税务", "发票管理"],
         "regulations": ["税收征收管理法", "电子商务法"]},
    ],
    "教育": [
        {"domain": "未成年人保护", "likelihood": "高", "impact": "高", "level": "critical",
         "risks": ["未成年人信息保护不足", "不良内容推送", "过度收集学生信息"],
         "regulations": ["未成年人保护法", "未成年人网络保护条例"]},
        {"domain": "资质合规", "likelihood": "中", "impact": "高", "level": "high",
         "risks": ["无证办学", "教师资质不全"],
         "regulations": ["民办教育促进法", "教师法"]},
    ],
    "通用": [
        {"domain": "劳动用工", "likelihood": "中", "impact": "中", "level": "medium",
         "risks": ["劳动合同不规范", "社保缴纳不足", "加班管理不当"],
         "regulations": ["劳动法", "劳动合同法", "社会保险法"]},
        {"domain": "税务合规", "likelihood": "中", "impact": "高", "level": "high",
         "risks": ["税务申报错误", "发票管理不规范", "关联交易定价"],
         "regulations": ["税收征收管理法", "企业所得税法"]},
        {"domain": "安全生产", "likelihood": "低", "impact": "高", "level": "medium",
         "risks": ["安全隐患排查不力", "应急预案缺失"],
         "regulations": ["安全生产法"]},
    ],
}


def generate_risk_matrix(industry: str) -> dict:
    """Generate risk matrix for specified industry."""
    risks = INDUSTRY_RISKS.get(industry, INDUSTRY_RISKS["通用"])
    
    # Add 通用 risks if not already included
    if industry != "通用":
        universal = INDUSTRY_RISKS["通用"]
        existing_domains = {r["domain"] for r in risks}
        for ur in universal:
            if ur["domain"] not in existing_domains:
                risks.append(ur)
    
    return {
        "industry": industry,
        "risks": risks,
        "total_domains": len(risks),
        "critical_count": sum(1 for r in risks if r["level"] == "critical"),
        "high_count": sum(1 for r in risks if r["level"] == "high"),
    }


def generate_report(matrix: dict) -> str:
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    
    level_emoji = {"critical": "🔴", "high": "🟠", "medium": "🟡", "low": "🟢"}
    likelihood_map = {"高": 3, "中": 2, "低": 1}
    impact_map = {"高": 3, "中": 2, "低": 1}
    
    lines = [
        "# 合规风险评估矩阵",
        "",
        f"**生成时间**: {now}",
        f"**行业**: {matrix['industry']}",
        f"**风险领域**: {matrix['total_domains']}个",
        f"**🔴极高风险**: {matrix['critical_count']}个 | **🟠高风险**: {matrix['high_count']}个",
        "",
        "---",
        "",
        "## 风险矩阵总览",
        "",
        "| 风险领域 | 发生可能性 | 影响程度 | 风险等级 | 优先级评分 |",
        "|----------|-----------|----------|----------|-----------|",
    ]
    
    for risk in sorted(matrix["risks"], key=lambda x: likelihood_map.get(x["likelihood"], 0) * impact_map.get(x["impact"], 0), reverse=True):
        score = likelihood_map.get(risk["likelihood"], 0) * impact_map.get(risk["impact"], 0)
        emoji = level_emoji.get(risk["level"], "⚪")
        lines.append(f"| {risk['domain']} | {risk['likelihood']} | {risk['impact']} | {emoji} {risk['level'].upper()} | {score}/9 |")
    
    lines.extend(["", "---", ""])
    
    # Detailed risk analysis
    for risk in sorted(matrix["risks"], key=lambda x: {"critical": 0, "high": 1, "medium": 2, "low": 3}.get(x["level"], 4)):
        emoji = level_emoji.get(risk["level"], "⚪")
        lines.extend([
            f"## {emoji} {risk['domain']}",
            "",
            f"**风险等级**: {risk['level'].upper()} | **可能性**: {risk['likelihood']} | **影响**: {risk['impact']}",
            "",
            "**主要风险点**:",
            "",
        ])
        for r in risk.get("risks", []):
            lines.append(f"- {r}")
        
        lines.extend(["", "**相关法规**:", ""])
        for reg in risk.get("regulations", []):
            lines.append(f"- {reg}")
        lines.append("")
    
    # Action priority
    lines.extend([
        "---",
        "",
        "## 优先整改建议",
        "",
        "| 优先级 | 风险领域 | 建议措施 |",
        "|--------|----------|----------|",
    ])
    
    priority = 1
    for risk in sorted(matrix["risks"], key=lambda x: likelihood_map.get(x["likelihood"], 0) * impact_map.get(x["impact"], 0), reverse=True):
        if priority > 5:
            break
        first_risk = risk.get("risks", ["加强管理"])[0]
        lines.append(f"| P{priority} | {risk['domain']} | 针对'{first_risk}'等风险，完善制度和流程 |")
        priority += 1
    
    lines.extend([
        "",
        "---",
        "",
        "## 免责声明",
        "",
        "本风险矩阵由AI自动生成，仅供参考。建议由专业合规团队或律师进行深度评估。",
        "",
        f"*Generated by Legal Compliance Skill Bundle v1.0.0*",
    ])
    
    return "\n".join(lines)


def main():
    industry = None
    output_file = None
    config_file = None
    
    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == "--industry" and i + 1 < len(args):
            industry = args[i + 1]
            i += 2
        elif args[i] == "--output" and i + 1 < len(args):
            output_file = args[i + 1]
            i += 2
        elif args[i] == "--config" and i + 1 < len(args):
            config_file = args[i + 1]
            i += 2
        elif args[i] == "--list":
            print("支持的行业:")
            for ind in INDUSTRY_RISKS:
                print(f"  • {ind}")
            sys.exit(0)
        else:
            i += 1
    
    if not industry and not config_file:
        print("用法:")
        print("  python compliance_risk_matrix.py --industry '互联网' [--output matrix.md]")
        print("  python compliance_risk_matrix.py --list  # 查看支持的行业")
        sys.exit(1)
    
    if config_file:
        with open(config_file, 'r', encoding='utf-8') as f:
            config = json.load(f)
        industry = config.get("industry", "通用")
    
    matrix = generate_risk_matrix(industry)
    print(f"已生成{industry}行业合规风险矩阵: {matrix['total_domains']}个风险领域")
    print(f"极高风险: {matrix['critical_count']}个 | 高风险: {matrix['high_count']}个")
    
    report = generate_report(matrix)
    
    if output_file:
        Path(output_file).write_text(report, encoding="utf-8")
        print(f"报告已保存: {output_file}")
    else:
        print("\n" + report)


if __name__ == "__main__":
    main()
