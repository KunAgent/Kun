#!/usr/bin/env python3
"""
PIPL合规检查工具
用于检查特定场景是否符合中国个人信息保护法（PIPL）要求
"""

import argparse
import json
import sys
from datetime import datetime
from typing import Dict, List, Any

class PIPLChecker:
    """PIPL合规检查器"""
    
    def __init__(self):
        self.check_categories = {
            "consent": "同意机制检查",
            "notification": "告知义务检查",
            "minimization": "数据最小化检查",
            "security": "安全保障检查",
            "rights": "个人权利保障检查",
            "cross_border": "跨境传输检查"
        }
        
        self.scenario_templates = {
            "user_registration": {
                "name": "用户注册",
                "checks": ["consent", "notification", "minimization", "security"]
            },
            "location_collection": {
                "name": "位置信息收集",
                "checks": ["consent", "notification", "minimization", "security"],
                "special": ["单独同意要求"]
            },
            "marketing_push": {
                "name": "营销推送",
                "checks": ["consent", "notification", "minimization"]
            },
            "cross_border_transfer": {
                "name": "跨境数据传输",
                "checks": ["consent", "notification", "cross_border", "security"]
            },
            "sensitive_info": {
                "name": "敏感信息处理",
                "checks": ["consent", "notification", "security", "minimization"],
                "special": ["单独同意要求", "额外安全保障"]
            }
        }
    
    def check_consent(self, scenario_data: Dict) -> List[Dict]:
        """检查同意机制"""
        issues = []
        
        # 检查是否取得同意
        if not scenario_data.get("has_consent", False):
            issues.append({
                "code": "CONSENT_001",
                "description": "未取得用户同意",
                "risk": "high",
                "recommendation": "在处理个人信息前必须取得用户同意"
            })
        
        # 检查单独同意（如涉及敏感信息）
        if scenario_data.get("involves_sensitive_info", False):
            if not scenario_data.get("has_separate_consent", False):
                issues.append({
                    "code": "CONSENT_002",
                    "description": "涉及敏感信息但未取得单独同意",
                    "risk": "high",
                    "recommendation": "对敏感信息处理必须取得单独同意"
                })
        
        # 检查同意撤回机制
        if not scenario_data.get("has_withdrawal", True):
            issues.append({
                "code": "CONSENT_003",
                "description": "未提供便捷的同意撤回方式",
                "risk": "medium",
                "recommendation": "提供清晰、便捷的同意撤回机制"
            })
        
        return issues
    
    def check_notification(self, scenario_data: Dict) -> List[Dict]:
        """检查告知义务"""
        issues = []
        
        required_notifications = [
            "处理目的",
            "处理方式",
            "个人信息种类",
            "保存期限",
            "权利行使方式",
            "处理者联系方式"
        ]
        
        # 检查告知内容完整性
        provided_notifications = scenario_data.get("notifications", [])
        missing = [n for n in required_notifications if n not in provided_notifications]
        
        if missing:
            issues.append({
                "code": "NOTIFY_001",
                "description": f"告知内容不完整，缺失：{', '.join(missing)}",
                "risk": "medium",
                "recommendation": "补充完整告知内容"
            })
        
        # 检查告知方式
        if not scenario_data.get("notification_clear", True):
            issues.append({
                "code": "NOTIFY_002",
                "description": "告知方式不显著或语言不清晰",
                "risk": "medium",
                "recommendation": "以显著方式、清晰易懂的语言进行告知"
            })
        
        return issues
    
    def check_minimization(self, scenario_data: Dict) -> List[Dict]:
        """检查数据最小化"""
        issues = []
        
        # 检查收集必要性
        if scenario_data.get("collects_unnecessary", False):
            issues.append({
                "code": "MINIMIZE_001",
                "description": "收集了非必要个人信息",
                "risk": "medium",
                "recommendation": "仅收集与处理目的直接相关的个人信息"
            })
        
        # 检查处理范围
        if scenario_data.get("exceeds_purpose", False):
            issues.append({
                "code": "MINIMIZE_002",
                "description": "处理范围超出目的范围",
                "risk": "medium",
                "recommendation": "处理限于实现处理目的的最小范围"
            })
        
        # 检查保存期限
        retention_days = scenario_data.get("retention_days", 0)
        if retention_days > 365 * 5:  # 超过5年
            issues.append({
                "code": "MINIMIZE_003",
                "description": f"保存期限过长：{retention_days}天",
                "risk": "low",
                "recommendation": "评估保存期限必要性，缩短至合理范围"
            })
        
        return issues
    
    def check_security(self, scenario_data: Dict) -> List[Dict]:
        """检查安全保障"""
        issues = []
        
        # 检查技术措施
        security_measures = scenario_data.get("security_measures", [])
        required_measures = ["加密", "访问控制", "安全审计"]
        
        missing_tech = [m for m in required_measures if m not in security_measures]
        if missing_tech:
            issues.append({
                "code": "SECURITY_001",
                "description": f"技术安全措施不足，缺失：{', '.join(missing_tech)}",
                "risk": "high",
                "recommendation": "实施必要的技术安全措施"
            })
        
        # 检查管理措施
        if not scenario_data.get("has_security_policy", False):
            issues.append({
                "code": "SECURITY_002",
                "description": "缺乏安全管理措施",
                "risk": "medium",
                "recommendation": "建立安全管理制度和操作规程"
            })
        
        # 检查第三方管理
        if scenario_data.get("involves_third_party", False):
            if not scenario_data.get("has_third_party_agreement", False):
                issues.append({
                    "code": "SECURITY_003",
                    "description": "涉及第三方但未签订数据处理协议",
                    "risk": "high",
                    "recommendation": "与第三方签订数据处理协议并进行监督"
                })
        
        return issues
    
    def check_cross_border(self, scenario_data: Dict) -> List[Dict]:
        """检查跨境传输"""
        issues = []
        
        if not scenario_data.get("involves_cross_border", False):
            return issues
        
        # 检查合法性路径
        legal_paths = scenario_data.get("legal_paths", [])
        valid_paths = ["安全评估", "保护认证", "标准合同"]
        
        if not any(path in legal_paths for path in valid_paths):
            issues.append({
                "code": "CROSS_001",
                "description": "跨境传输不符合PIPL要求",
                "risk": "high",
                "recommendation": "通过安全评估、保护认证或标准合同满足要求"
            })
        
        # 检查告知义务
        if not scenario_data.get("notified_cross_border", False):
            issues.append({
                "code": "CROSS_002",
                "description": "未告知跨境传输事实",
                "risk": "medium",
                "recommendation": "告知境外接收方信息和个人权利行使方式"
            })
        
        return issues
    
    def check_rights(self, scenario_data: Dict) -> List[Dict]:
        """检查个人权利保障"""
        issues = []
        
        required_rights = ["查询", "复制", "更正", "删除", "注销"]
        provided_rights = scenario_data.get("provided_rights", [])
        
        missing_rights = [r for r in required_rights if r not in provided_rights]
        if missing_rights:
            issues.append({
                "code": "RIGHTS_001",
                "description": f"个人权利保障不足，缺失：{', '.join(missing_rights)}",
                "risk": "medium",
                "recommendation": "提供完整的个人权利保障机制"
            })
        
        # 检查响应时间
        response_days = scenario_data.get("response_days", 30)
        if response_days > 15:
            issues.append({
                "code": "RIGHTS_002",
                "description": f"权利响应时间过长：{response_days}天",
                "risk": "low",
                "recommendation": "缩短权利响应时间，建议不超过15天"
            })
        
        return issues
    
    def run_check(self, scenario: str, scenario_data: Dict) -> Dict:
        """运行合规检查"""
        results = {
            "scenario": scenario,
            "check_time": datetime.now().isoformat(),
            "overall_score": 100,
            "risk_level": "low",
            "issues": [],
            "categories": {}
        }
        
        # 获取检查项
        if scenario in self.scenario_templates:
            checks = self.scenario_templates[scenario]["checks"]
        else:
            checks = list(self.check_categories.keys())
        
        # 执行各项检查
        total_issues = 0
        high_risk_count = 0
        
        for check in checks:
            if check == "consent":
                issues = self.check_consent(scenario_data)
            elif check == "notification":
                issues = self.check_notification(scenario_data)
            elif check == "minimization":
                issues = self.check_minimization(scenario_data)
            elif check == "security":
                issues = self.check_security(scenario_data)
            elif check == "cross_border":
                issues = self.check_cross_border(scenario_data)
            elif check == "rights":
                issues = self.check_rights(scenario_data)
            else:
                issues = []
            
            results["categories"][check] = {
                "name": self.check_categories.get(check, check),
                "issue_count": len(issues),
                "issues": issues
            }
            
            total_issues += len(issues)
            high_risk_count += len([i for i in issues if i["risk"] == "high"])
        
        # 计算总体评分
        if total_issues > 0:
            results["overall_score"] = max(0, 100 - (total_issues * 10))
        
        # 确定风险等级
        if high_risk_count > 0:
            results["risk_level"] = "high"
        elif total_issues > 3:
            results["risk_level"] = "medium"
        else:
            results["risk_level"] = "low"
        
        # 汇总所有问题
        for category in results["categories"].values():
            results["issues"].extend(category["issues"])
        
        return results

def main():
    parser = argparse.ArgumentParser(description="PIPL合规检查工具")
    parser.add_argument("--scenario", required=True, help="检查场景")
    parser.add_argument("--detailed", action="store_true", help="输出详细报告")
    parser.add_argument("--format", choices=["json", "text"], default="text", help="输出格式")
    parser.add_argument("--output", help="输出文件路径")
    
    args = parser.parse_args()
    
    # 创建检查器
    checker = PIPLChecker()
    
    # 示例数据（实际使用时应从参数或配置文件获取）
    scenario_data = {
        "has_consent": True,
        "involves_sensitive_info": False,
        "has_separate_consent": True,
        "has_withdrawal": True,
        "notifications": ["处理目的", "处理方式", "个人信息种类", "保存期限"],
        "notification_clear": True,
        "collects_unnecessary": False,
        "exceeds_purpose": False,
        "retention_days": 365,
        "security_measures": ["加密", "访问控制"],
        "has_security_policy": True,
        "involves_third_party": False,
        "involves_cross_border": False,
        "provided_rights": ["查询", "复制", "更正", "删除"]
    }
    
    # 运行检查
    results = checker.run_check(args.scenario, scenario_data)
    
    # 输出结果
    if args.format == "json":
        output = json.dumps(results, ensure_ascii=False, indent=2)
    else:
        output = format_text_output(results, args.detailed)
    
    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            f.write(output)
        print(f"检查结果已保存至：{args.output}")
    else:
        print(output)

def format_text_output(results: Dict, detailed: bool = False) -> str:
    """格式化文本输出"""
    output_lines = []
    
    output_lines.append("=" * 60)
    output_lines.append("PIPL合规检查报告")
    output_lines.append("=" * 60)
    output_lines.append(f"检查场景：{results['scenario']}")
    output_lines.append(f"检查时间：{results['check_time']}")
    output_lines.append(f"总体评分：{results['overall_score']}/100")
    
    # 风险等级显示
    risk_display = {
        "high": "🔴 高风险",
        "medium": "🟡 中风险", 
        "low": "🟢 低风险"
    }
    output_lines.append(f"风险等级：{risk_display.get(results['risk_level'], results['risk_level'])}")
    output_lines.append("")
    
    # 分类统计
    output_lines.append("分类检查统计：")
    for cat_key, cat_data in results["categories"].items():
        if cat_data["issue_count"] > 0:
            status = "❌"
        else:
            status = "✅"
        output_lines.append(f"  {status} {cat_data['name']}: {cat_data['issue_count']}个问题")
    
    output_lines.append("")
    
    # 问题详情
    if results["issues"]:
        output_lines.append("发现的问题：")
        for i, issue in enumerate(results["issues"], 1):
            risk_emoji = {"high": "🔴", "medium": "🟡", "low": "🟢"}.get(issue["risk"], "⚪")
            output_lines.append(f"{i}. {risk_emoji} [{issue['code']}] {issue['description']}")
            if detailed:
                output_lines.append(f"   风险等级：{issue['risk']}")
                output_lines.append(f"   建议：{issue['recommendation']}")
                output_lines.append("")
    else:
        output_lines.append("✅ 未发现问题")
    
    output_lines.append("")
    output_lines.append("=" * 60)
    
    return "\n".join(output_lines)

if __name__ == "__main__":
    main()