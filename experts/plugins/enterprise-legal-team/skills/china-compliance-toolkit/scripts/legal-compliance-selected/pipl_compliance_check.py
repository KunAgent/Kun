#!/usr/bin/env python3
"""
pipl_compliance_check.py — PIPL合规检查技能 (Skill #33)
检查App/网站的个人信息处理是否符合《个人信息保护法》。

用法: python pipl_compliance_check.py --config check_config.json [--output report.md]
      python pipl_compliance_check.py --interactive
"""

import sys
import json
from datetime import datetime
from pathlib import Path

# ─── PIPL合规检查项 ───
PIPL_CHECKS = [
    {
        "id": "P001",
        "category": "合法性基础",
        "article": "PIPL第13条",
        "question": "是否取得了个人的明确同意？",
        "required": True,
        "severity": "high",
        "guidance": "处理个人信息需取得个人同意，或符合其他法定情形（合同必要、法定义务、公共利益等）",
    },
    {
        "id": "P002",
        "category": "告知义务",
        "article": "PIPL第17条",
        "question": "是否以显著方式、清晰易懂的语言告知了处理目的、方式、种类和保存期限？",
        "required": True,
        "severity": "high",
        "guidance": "告知内容需包括：处理者名称/联系方式、处理目的/方式/种类、保存期限、个人行使权利的方式",
    },
    {
        "id": "P003",
        "category": "最小必要",
        "article": "PIPL第6条",
        "question": "收集的个人信息是否限于实现处理目的的最小范围？",
        "required": True,
        "severity": "high",
        "guidance": "不得过度收集个人信息，应遵循最小必要原则",
    },
    {
        "id": "P004",
        "category": "敏感信息",
        "article": "PIPL第28-29条",
        "question": "如果处理敏感个人信息，是否取得了个人的单独同意？",
        "required": True,
        "severity": "high",
        "guidance": "敏感信息包括：生物识别、宗教信仰、特定身份、医疗健康、金融账户、行踪轨迹、不满14周岁未成年人信息",
    },
    {
        "id": "P005",
        "category": "敏感信息",
        "article": "PIPL第30条",
        "question": "处理敏感信息时，是否告知了处理的必要性及对个人权益的影响？",
        "required": True,
        "severity": "high",
        "guidance": "处理敏感信息需额外告知必要性和对个人权益的影响",
    },
    {
        "id": "P006",
        "category": "个人信息权利",
        "article": "PIPL第44-47条",
        "question": "是否提供了个人信息查阅、复制、更正、删除的途径？",
        "required": True,
        "severity": "high",
        "guidance": "个人有权查阅、复制、更正、删除其个人信息，需提供便捷的行使途径",
    },
    {
        "id": "P007",
        "category": "个人信息权利",
        "article": "PIPL第47条",
        "question": "是否提供了撤回同意的便捷方式？",
        "required": True,
        "severity": "medium",
        "guidance": "个人有权撤回同意，处理者应提供便捷的撤回方式，且撤回前的处理行为不因撤回而无效",
    },
    {
        "id": "P008",
        "category": "委托处理",
        "article": "PIPL第21条",
        "question": "如委托第三方处理个人信息，是否签订了数据处理协议？",
        "required": False,
        "severity": "medium",
        "guidance": "委托处理需签订协议，约定处理目的、期限、方式、种类、保护措施和双方权利义务",
    },
    {
        "id": "P009",
        "category": "跨境传输",
        "article": "PIPL第38-39条",
        "question": "如需向境外提供个人信息，是否通过了安全评估/标准合同/认证？",
        "required": False,
        "severity": "high",
        "guidance": "跨境传输需满足：安全评估（关键信息基础设施运营者或达到规定数量）、标准合同、认证之一",
    },
    {
        "id": "P010",
        "category": "安全保护",
        "article": "PIPL第51条",
        "question": "是否采取了必要的安全技术措施（加密、去标识化、访问控制等）？",
        "required": True,
        "severity": "medium",
        "guidance": "需采取加密、去标识化、访问控制、安全审计等措施",
    },
    {
        "id": "P011",
        "category": "安全保护",
        "article": "PIPL第54条",
        "question": "是否定期进行了个人信息保护合规审计？",
        "required": False,
        "severity": "medium",
        "guidance": "处理者应定期进行合规审计，确保处理活动符合法律法规",
    },
    {
        "id": "P012",
        "category": "安全事件",
        "article": "PIPL第57条",
        "question": "是否制定了个人信息泄露应急预案，包括通知个人和监管部门的流程？",
        "required": True,
        "severity": "medium",
        "guidance": "发生安全事件需立即采取补救措施，通知监管部门和个人",
    },
    {
        "id": "P013",
        "category": "个人信息保护负责人",
        "article": "PIPL第52条",
        "question": "处理个人信息达到规定数量的，是否指定了个人信息保护负责人？",
        "required": False,
        "severity": "medium",
        "guidance": "处理量达到国家网信部门规定数量的，需指定负责人并公开联系方式",
    },
    {
        "id": "P014",
        "category": "未成年人保护",
        "article": "PIPL第31条",
        "question": "如处理不满14周岁未成年人信息，是否取得了其父母或监护人的同意？",
        "required": False,
        "severity": "high",
        "guidance": "处理不满14周岁未成年人个人信息，应取得其父母或其他监护人的同意",
    },
]


def run_check(answers: dict) -> list[dict]:
    """Run compliance check based on answers."""
    findings = []
    
    for check in PIPL_CHECKS:
        cid = check["id"]
        answer = answers.get(cid, None)
        
        if answer is None:
            # Unanswered
            if check["required"]:
                findings.append({
                    "check_id": cid,
                    "category": check["category"],
                    "severity": "high",
                    "status": "未回答",
                    "article": check["article"],
                    "question": check["question"],
                    "guidance": check["guidance"],
                    "recommendation": "请补充回答此检查项",
                })
            continue
        
        if answer is False:
            findings.append({
                "check_id": cid,
                "category": check["category"],
                "severity": check["severity"],
                "status": "不合规",
                "article": check["article"],
                "question": check["question"],
                "guidance": check["guidance"],
                "recommendation": f"需整改：{check['guidance']}",
            })
    
    return findings


def calculate_compliance_score(findings: list[dict], total_checks: int) -> dict:
    weights = {"high": 10, "medium": 5, "low": 2}
    deductions = sum(weights.get(f["severity"], 5) for f in findings)
    score = max(0, 100 - deductions)
    
    return {
        "score": score,
        "grade": "A" if score >= 85 else "B" if score >= 70 else "C" if score >= 50 else "D",
        "total_checks": total_checks,
        "passed": total_checks - len(findings),
        "failed": len(findings),
    }


def generate_report(findings: list[dict], score: dict) -> str:
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    
    lines = [
        "# PIPL合规检查报告",
        "",
        f"**生成时间**: {now}",
        f"**检查依据**: 《个人信息保护法》(PIPL)",
        "",
        "---",
        "",
        "## 合规评分",
        "",
        f"| 指标 | 结果 |",
        f"|------|------|",
        f"| 综合评分 | **{score['score']}/100** ({score['grade']}级) |",
        f"| 检查项总数 | {score['total_checks']} |",
        f"| ✅ 通过 | {score['passed']} |",
        f"| ❌ 不合规 | {score['failed']} |",
        "",
    ]
    
    if findings:
        lines.extend(["## 不合规项详情", ""])
        for f in findings:
            emoji = "🔴" if f["severity"] == "high" else "🟡" if f["severity"] == "medium" else "🟢"
            lines.append(f"### {emoji} {f['check_id']} — {f['category']} [{f['status']}]")
            lines.append(f"- **法律依据**: {f['article']}")
            lines.append(f"- **检查问题**: {f['question']}")
            lines.append(f"- **合规指导**: {f['guidance']}")
            lines.append(f"- **整改建议**: {f['recommendation']}")
            lines.append("")
    else:
        lines.append("✅ 恭喜！所有PIPL合规检查项均已通过。")
        lines.append("")
    
    lines.extend([
        "---",
        "",
        "## 免责声明",
        "",
        "本报告由AI自动生成，仅供参考，不构成法律意见。",
        "个人信息保护合规建议由专业律师进行最终确认。",
        "",
        f"*Generated by Legal Compliance Skill Bundle v1.0.0*",
    ])
    
    return "\n".join(lines)


def interactive_mode() -> dict:
    """Run interactive Q&A mode."""
    print("=" * 60)
    print("PIPL合规检查 — 交互式问答")
    print("=" * 60)
    print("请回答以下问题（y=是, n=否, s=跳过）：\n")
    
    answers = {}
    for check in PIPL_CHECKS:
        print(f"\n[{check['id']}] {check['category']} ({check['article']})")
        print(f"  {check['question']}")
        print(f"  💡 {check['guidance']}")
        
        while True:
            resp = input("  回答 [y/n/s]: ").strip().lower()
            if resp == 'y':
                answers[check['id']] = True
                break
            elif resp == 'n':
                answers[check['id']] = False
                break
            elif resp == 's':
                break
            else:
                print("  请输入 y/n/s")
    
    return answers


def main():
    answers = {}
    output_file = None
    
    if "--interactive" in sys.argv:
        answers = interactive_mode()
    elif "--config" in sys.argv:
        idx = sys.argv.index("--config")
        if idx + 1 < len(sys.argv):
            config_path = Path(sys.argv[idx + 1])
            if config_path.exists():
                answers = json.loads(config_path.read_text(encoding="utf-8"))
            else:
                print(f"配置文件不存在: {config_path}")
                sys.exit(1)
    else:
        print("用法:")
        print("  python pipl_compliance_check.py --interactive")
        print("  python pipl_compliance_check.py --config answers.json [--output report.md]")
        sys.exit(1)
    
    if "--output" in sys.argv:
        idx = sys.argv.index("--output")
        if idx + 1 < len(sys.argv):
            output_file = sys.argv[idx + 1]
    
    findings = run_check(answers)
    score = calculate_compliance_score(findings, len(PIPL_CHECKS))
    
    print(f"\n合规评分: {score['score']}/100 ({score['grade']}级)")
    print(f"通过: {score['passed']}/{score['total_checks']} | 不合规: {score['failed']}")
    
    report = generate_report(findings, score)
    
    if output_file:
        Path(output_file).write_text(report, encoding="utf-8")
        print(f"报告已保存: {output_file}")
    else:
        print("\n" + report)


if __name__ == "__main__":
    main()
