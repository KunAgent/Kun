#!/usr/bin/env python3
"""
校验 agent 产出文档是否符合模板硬指标约束。

用法:
    python3 validate_template_compliance.py [--output-dir .workbuddy/output] [--format json|text]

检查矩阵:
    资料摘要:       9 项硬指标
    调研报告:      11 项硬指标
    高层架构设计: 11 项硬指标
    系统设计:     11 项硬指标
    部署设计:      9 项硬指标
    安全设计:      9 项硬指标
    UserStory:     5 项硬指标
    通用:          1 项（无残留占位符）
"""

import re
import os
import sys
import json
from pathlib import Path

# ── 配置 ──────────────────────────────────────────────
DEFAULT_OUTPUT_DIR = ".workbuddy/output"

SIGNATURE_MARKERS = [
    r'<[^>]+>',               # <...> 占位符
    r'YYYY-MM-DD',            # 日期占位符
    r'\bTBD\b',               # TBD
    r'<n>|<x>',               # <n>, <x>
    r'示例\s*：|例\s*：',      # 示例前缀（中文冒号）
    r'示例\s*:|例\s*:',       # 示例前缀（英文冒号）
]

# ── 硬指标检查规则 ────────────────────────────────────

def check_no_placeholders(text, doc_name):
    """检查无残留占位符"""
    issues = []
    for marker in SIGNATURE_MARKERS:
        matches = list(re.finditer(marker, text))
        for m in matches:
            start = max(0, m.start() - 30)
            end = min(len(text), m.end() + 30)
            snippet = text[start:end].replace('\n', ' ').strip()
            issues.append(f"  残留标记 \"{m.group()}\" → ...{snippet}...")
    if issues:
        return len(issues) == 0, f"找到 {len(issues)} 个残留标记", issues
    return True, "无残留占位符", []


def count_pattern(text, pattern, label):
    """计数模式匹配"""
    count = len(re.findall(pattern, text, re.IGNORECASE | re.MULTILINE))
    return count


def check_count_min(text, pattern, label, min_count):
    """检查数量 ≥ 最小值"""
    count = count_pattern(text, pattern, label)
    ok = count >= min_count
    return ok, f"{label}: {count}（要求 ≥ {min_count}）—— {'✓' if ok else '✗'}"


def check_count_max(text, pattern, label, max_count):
    """检查数量 ≤ 最大值"""
    count = count_pattern(text, pattern, label)
    ok = count <= max_count
    return ok, f"{label}: {count}（要求 ≤ {max_count}）—— {'✓' if ok else '✗'}"


def check_count_range(text, pattern, label, min_v, max_v):
    """检查数量在 [min, max] 内"""
    count = count_pattern(text, pattern, label)
    ok = min_v <= count <= max_v
    return ok, f"{label}: {count}（要求 {min_v}~{max_v}）—— {'✓' if ok else '✗'}"


def check_section_exists(text, pattern, label):
    """检查章节存在"""
    exists = bool(re.search(pattern, text, re.IGNORECASE))
    return exists, f"{label}: {'存在 ✓' if exists else '缺失 ✗'}"


# ── 各模板的检查规则集 ─────────────────────────────────

CHECK_RULES = {
    "material_digest.md": {
        "doc": "资料摘要",
        "rules": [
            # §0 元信息
            ("§0 元信息存在", lambda t: check_section_exists(
                t, r'#+\s*0\.\s*(元信息)', "§0 元信息")),
            # §1 资料清单
            ("§1 资料清单存在", lambda t: check_section_exists(
                t, r'#+\s*1\.\s*(资料清单)', "§1 资料清单")),
            # §2 资料内容摘要（逐份文档按章节摘要 + D编号,§章节 标注）
            ("§2 资料内容摘要存在", lambda t: check_section_exists(
                t, r'#+\s*2\.\s*(资料内容摘要|资料摘要)', "§2 资料内容摘要")),
            ("§2 含 D编号,§章节 出处标注", lambda t: check_section_exists(
                t, r'(D\d+[,，].*?§\d+|D\d+[,，].*?第\s*\d+)', "§2 D编号出处标注")),
            # §3 冲突记录
            ("§3 冲突记录存在", lambda t: check_section_exists(
                t, r'#+\s*3\.\s*(冲突记录|冲突信息)', "§3 冲突记录")),
            # §4 硬指标清单
            ("§4 硬指标清单存在", lambda t: check_section_exists(
                t, r'#+\s*4\.\s*(硬指标)', "§4 硬指标清单")),
        ]
    },

    "research_report.md": {
        "doc": "调研报告",
        "rules": [
            ("§1 调研问题收敛存在", lambda t: check_section_exists(
                t, r'#+\s*1\.\s*(调研问题|问题收敛)', "§1 调研问题收敛")),
            ("§2 事实章节存在", lambda t: check_section_exists(
                t, r'#+\s*2\.\s*(事实|标杆)', "§2 事实章节")),
            ("§3 对比章节存在", lambda t: check_section_exists(
                t, r'#+\s*3\.\s*(对比|矩阵)', "§3 对比章节")),
            ("§4 建议章节存在", lambda t: check_section_exists(
                t, r'#+\s*4\.\s*(建议|取舍)', "§4 建议章节")),
            ("§5 风险章节存在", lambda t: check_section_exists(
                t, r'#+\s*5\.\s*(风险|待确认)', "§5 风险与待确认项")),
            ("§6 关键来源存在且可追溯", lambda t: check_section_exists(
                t, r'(https?://|来源[:：]|出处[:：]|参考资料)', "关键来源")),
            ("标杆系统 ≥ 3 家", lambda t: check_count_min(
                t, r'^\| B\d+ \|', "标杆条目", 3)),
            ("对比矩阵含权重+评分", lambda t: check_section_exists(
                t, r'(对比矩阵|评分矩阵|加权评分|权重)', "对比矩阵/评分")),
            ("三层评分结论", lambda t: check_section_exists(
                t, r'(优先借鉴|部分借鉴|不借鉴)', "三层评分结论")),
            ("风险 ≥ 3 条含缓解建议", lambda t: check_count_min(
                t, r'^\| R-\d+ \|', "风险条目", 3)),
            ("来源 ≥ 3 条含 URL", lambda t: check_count_min(
                t, r'https?://', "来源URL", 3)),
        ]
    },

    "高层架构设计.md": {
        "doc": "高层架构设计",
        "rules": [
            # 结构完整性
            ("§1 需求概要存在", lambda t: check_section_exists(
                t, r'#+\s*(1\.|需求)', "§1 需求概要")),
            ("§2 行业调研存在", lambda t: check_section_exists(
                t, r'#+\s*(2\.|行业)', "§2 行业调研")),
            ("§3 方案决策存在", lambda t: check_section_exists(
                t, r'#+\s*(3\.|方案)', "§3 方案决策")),
            ("§4 业务架构存在", lambda t: check_section_exists(
                t, r'#+\s*(4\.|业务架构)', "§4 业务架构")),
            ("§5 产品需求存在", lambda t: check_section_exists(
                t, r'#+\s*(5\.|产品)', "§5 产品需求")),
            # 硬指标
            ("三层业务架构图", lambda t: check_section_exists(
                t, r'(接入层|接入网关).*(业务能力层|业务层).*(基础能力层|基础层|底座)', "三层架构描述")),
            ("业务闭环含主链路", lambda t: check_section_exists(
                t, r'闭环|主链路|反馈回路', "业务闭环")),
            ("In-Scope ≤ 15 条", lambda t: check_count_max(
                t, r'(?i)in.scope.*\n.*\|', "In-Scope 行数", 15)),
            ("Out-of-Scope ≥ 3 条", lambda t: check_count_min(
                t, r'(?i)out.of.scope.*\n.*\|', "Out-of-Scope 行数", 3)),
            ("P0 = MVP", lambda t: check_section_exists(
                t, r'P0.*MVP|MVP.*P0', "P0 关联 MVP")),
            ("核心角色 ≥ 3 类", lambda t: check_count_min(
                t, r'(?i)(甲方|用户|受影响方|运营|管理员|开发者).*(角色|角色关注)', "角色描述段落", 2)),
        ]
    },

    "系统设计.md": {
        "doc": "系统设计",
        "rules": [
            ("§1~§8 全部章节存在", lambda t: check_section_exists(
                t, r'#+\s*(8\.|可观测)', "§8 可观测设计")),
            ("DDD 限界上下文 ≥ 3", lambda t: check_count_min(
                t, r'(核心域|支撑域|通用域)', "DDD 域分类", 3)),
            ("上下文映射关系", lambda t: check_section_exists(
                t, r'(Customer.Supplier|ACL|Shared Kernel|Conformist|Open.Host)', "上下文映射")),
            ("模块设计五段式", lambda t: check_count_min(
                t, r'(模块概述|接口清单|结构定义|时序图|关键流程)', "模块设计五段", 4)),
            ("技术选型含版本号", lambda t: check_section_exists(
                t, r'(v?\d+\.\d+).*(为什么|选型|理由|选择)', "技术选型")),
            ("全局错误码 6 位格式", lambda t: check_section_exists(
                t, r'\d{6}|错误码.*\d{2}\d{2}\d{2}', "错误码格式")),
            ("RPO/RTO 有数字", lambda t: check_section_exists(
                t, r'RPO.*\d+|RTO.*\d+', "RPO/RTO 数值")),
            ("Dashboard ≥ 5", lambda t: check_section_exists(
                t, r'Dashboard|仪表盘|看板', "Dashboard")),
            ("Logs 含 traceId+tenantId", lambda t: check_section_exists(
                t, r'traceId.*tenantId|trace_id.*tenant_id', "日志规范")),
            ("告警 P0~P3 分级", lambda t: check_section_exists(
                t, r'P0.*P1.*P2.*P3|P0.*P1.*P2|告警.*分级', "告警分级")),
        ]
    },

    "部署设计.md": {
        "doc": "部署设计",
        "rules": [
            ("环境矩阵 4 环境", lambda t: check_section_exists(
                t, r'(dev|int|uat|prod).*(dev|int|uat|prod).*(dev|int|uat|prod)', "多环境")),
            ("资源清单六类", lambda t: check_count_min(
                t, r'(计算|存储|网络|中间件|安全|可观测)', "资源类别", 5)),
            ("故障域划分", lambda t: check_section_exists(
                t, r'(故障域|AZ|Region|容灾|高可用)', "故障域")),
            ("CI/CD 流水线", lambda t: check_section_exists(
                t, r'(CI/CD|流水线|Pipeline|构建.*部署|部署.*发布)', "CI/CD")),
            ("配置管理 L1~L4", lambda t: check_section_exists(
                t, r'L[1-4]', "配置层级")),
            ("容量水位线", lambda t: check_section_exists(
                t, r'(水位|60%|80%|95%|预警|危险)', "容量水位")),
            ("成本计算含月度/年度", lambda t: check_section_exists(
                t, r'(成本|费用|月度|年度|按年)', "成本")),
        ]
    },

    "安全设计.md": {
        "doc": "安全设计",
        "rules": [
            ("STRIDE 6 类威胁", lambda t: check_count_min(
                t, r'(仿冒|篡改|否认|信息泄露|DoS|权限提升|Spoofing|Tampering|Repudiation|Elevation)', "STRIDE 威胁覆盖", 5)),
            ("威胁映射缓解措施", lambda t: check_section_exists(
                t, r'(缓解|对策|防护)', "缓解措施")),
            ("IAM 认证 ≥ 2 种", lambda t: check_count_min(
                t, r'(密码|MFA|2FA|SSO|OAuth|OIDC|SAML|生物识别)', "认证方式", 2)),
            ("数据分级 L1~L4", lambda t: check_count_min(
                t, r'L[1-4]|(公开|内部|敏感|高敏|机密)', "数据分级", 3)),
            ("OWASP Top 10 防护", lambda t: check_count_min(
                t, r'(SQL.?注入|XSS|CSRF|注入|反序列化|SSRF|文件上传|XXE|重定向|越权)', "OWASP 覆盖", 7)),
            ("密钥分级 5 类", lambda t: check_count_min(
                t, r'(密钥|AKSK|密码.*加密|API.?Key|KMS)', "密钥管理", 3)),
            ("审计日志 5 维度", lambda t: check_count_min(
                t, r'(审计|日志|云资源|数据库|堡垒机|WAF)', "审计维度", 3)),
            ("应急响应预案", lambda t: check_section_exists(
                t, r'(应急|响应|预案|Runbook|漏洞.*泄露|攻击)', "应急响应")),
        ]
    },

    "UserStory.md": {
        "doc": "UserStory",
        "rules": [
            ("角色清单 ≥ 3 条", lambda t: check_count_min(
                t, r'\|.*\|.*\|.*\|.*\n\|.*\|.*\|.*\|', "角色表格行", 2)),
            ("用户旅程七段式展开", lambda t: check_count_min(
                t, r'(业务场景|业务流程|UE.*原型|业务逻辑|数据描述|验收标准|外部集成)', "US 七段", 6)),
            ("验收标准 Given/When/Then", lambda t: check_section_exists(
                t, r'Given.*When.*Then|GIVEN.*WHEN.*THEN', "AC 格式")),
            ("非功能需求 6.1~6.4", lambda t: check_section_exists(
                t, r'(6\.1.*易用|6\.2.*性能|6\.3.*环境|6\.4.*安全)', "非功能需求")),
        ]
    },
}


def validate_document(filepath):
    """校验单个文档"""
    if not os.path.exists(filepath):
        return {"file": filepath, "status": "MISSING", "checks": [], "passed": 0, "total": 0}

    with open(filepath, 'r', encoding='utf-8') as f:
        text = f.read()

    doc_name = os.path.basename(filepath)
    rules = CHECK_RULES.get(doc_name)

    if not rules:
        return {"file": filepath, "status": "NO_RULES", "checks": [], "passed": 0, "total": 0}

    checks = []
    passed = 0
    total = len(rules["rules"]) + 1  # +1 for placeholder check

    # 通用检查：无残留占位符
    placeholder_ok, placeholder_msg, placeholder_details = check_no_placeholders(text, doc_name)
    checks.append({
        "name": "无残留占位符/示例",
        "passed": placeholder_ok,
        "detail": placeholder_msg,
        "issues": placeholder_details,
    })
    if placeholder_ok:
        passed += 1

    # 文档特定检查
    for rule_name, rule_fn in rules["rules"]:
        try:
            ok, msg = rule_fn(text)
            checks.append({
                "name": rule_name,
                "passed": ok,
                "detail": msg,
                "issues": [],
            })
            if ok:
                passed += 1
        except Exception as e:
            checks.append({
                "name": rule_name,
                "passed": False,
                "detail": f"检查异常: {e}",
                "issues": [],
            })

    return {
        "file": filepath,
        "doc": rules["doc"],
        "status": "PASS" if passed == total else "FAIL",
        "checks": checks,
        "passed": passed,
        "total": total,
    }


def validate_all(output_dir, doc_filter=None):
    """校验文档，doc_filter 可指定只校验某个文档名"""
    results = []
    for doc_name in CHECK_RULES:
        if doc_filter and doc_name != doc_filter:
            continue
        filepath = os.path.join(output_dir, doc_name)
        results.append(validate_document(filepath))

    return results


def print_results(results, fmt="text"):
    """输出结果"""
    if fmt == "json":
        print(json.dumps(results, ensure_ascii=False, indent=2))
        return

    total_passed = sum(r["passed"] for r in results)
    total_checks = sum(r["total"] for r in results)
    all_pass = all(r["status"] in ("PASS",) for r in results if r["total"] > 0)

    print("=" * 72)
    print("  AICoding 架构文档 · 模板合规性校验")
    print("=" * 72)

    for result in results:
        if result["total"] == 0:
            if result["status"] == "MISSING":
                print(f"\n  📄 {result['file']} — ⚠ 文件不存在，跳过")
            continue

        status_icon = "✓" if result["status"] == "PASS" else "✗"
        print(f"\n  {status_icon} {result['doc']} ({result['file']})")
        print(f"    通过 {result['passed']}/{result['total']} 项")
        print("    " + "-" * 60)

        for check in result["checks"]:
            icon = "✓" if check["passed"] else "✗"
            print(f"    {icon} {check['name']}")
            if not check["passed"] and check["detail"]:
                print(f"      → {check['detail']}")
            for issue in check.get("issues", []):
                print(f"      {issue}")

    print("\n" + "=" * 72)
    print(f"  总览: {total_passed}/{total_checks} 项通过")

    if all_pass:
        print("  结果: ✅ 全部通过 — 当前校验范围可进入下一阶段")
    else:
        failed = total_checks - total_passed
        print(f"  结果: ❌ {failed} 项未通过 — 请修复后重新校验")
    print("=" * 72)

    return 0 if all_pass else 1


def main():
    import argparse
    parser = argparse.ArgumentParser(description="校验架构文档模板合规性")
    parser.add_argument("--output-dir", default=DEFAULT_OUTPUT_DIR,
                        help=f"文档输出目录（默认: {DEFAULT_OUTPUT_DIR}）")
    parser.add_argument("--format", choices=["text", "json"], default="text",
                        help="输出格式（text/json）")
    parser.add_argument("--filter", default=None,
                        help="只校验指定文档（如 高层架构设计.md）")
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    if not output_dir.is_absolute():
        # 尝试从 myteam/ 根目录解析
        script_dir = Path(__file__).parent.parent
        output_dir = script_dir / output_dir

    if not output_dir.exists():
        print(f"⚠ 输出目录不存在: {output_dir}")
        print(f"  请先运行 Team 生成文档，或使用 --output-dir 指定路径")
        sys.exit(1)

    results = validate_all(str(output_dir), doc_filter=args.filter)
    if args.filter and not results:
        print(f"⚠ 未找到文档: {args.filter}（可用: {list(CHECK_RULES.keys())}）")
        sys.exit(1)
    exit_code = print_results(results, args.format)
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
