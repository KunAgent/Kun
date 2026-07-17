#!/usr/bin/env python3
"""
PIPL合规风险评估工具
用于评估个人信息处理活动的合规风险等级
"""

import argparse
import json
import sys
from datetime import datetime
from typing import Dict, List, Any, Optional

class RiskAssessor:
    """风险评估器"""
    
    def __init__(self):
        # 风险维度定义
        self.dimensions = {
            "data_sensitivity": {
                "name": "数据敏感度",
                "weight": 0.30,
                "levels": {
                    "low": 1,      # 基础身份信息
                    "medium": 3,   # 一般个人信息
                    "high": 5,     # 敏感个人信息
                    "critical": 7  # 未成年人敏感信息
                }
            },
            "processing_scale": {
                "name": "处理规模",
                "weight": 0.20,
                "levels": {
                    "small": 1,    # < 1000人
                    "medium": 3,   # 1000-10000人
                    "large": 5,    # 10000-100000人
                    "massive": 7   # > 100000人
                }
            },
            "processing_purpose": {
                "name": "处理目的",
                "weight": 0.15,
                "levels": {
                    "contract": 1,   # 履行合同
                    "legal": 3,      # 法律义务
                    "business": 5,   # 商业目的
                    "sensitive": 7   # 敏感用途
                }
            },
            "third_party_involvement": {
                "name": "第三方参与",
                "weight": 0.15,
                "levels": {
                    "none": 1,        # 无第三方
                    "delegated": 3,   # 委托处理
                    "shared": 5,      # 数据共享
                    "cross_border": 7 # 跨境传输
                }
            },
            "security_measures": {
                "name": "安全保障",
                "weight": 0.20,
                "levels": {
                    "excellent": 1,   # 完善措施
                    "good": 3,        # 基本措施
                    "basic": 5,       # 不足措施
                    "poor": 7         # 无措施
                }
            }
        }
        
    def assess_dimension(self, dimension_key: str, input_value: str) -> int:
        """评估单个维度"""
        dimension = self.dimensions[dimension_key]
        
        # 将输入值映射到对应的风险等级
        if input_value in dimension["levels"]:
            return dimension["levels"][input_value]
        else:
            # 尝试模糊匹配
            for level, score in dimension["levels"].items():
                if level in input_value.lower():
                    return score
        
        # 默认返回中等风险
        return 3
    
    def calculate_risk_score(self, dimension_scores: Dict[str, int]) -> float:
        """计算风险总分"""
        total_score = 0.0
        
        for dim_key, score in dimension_scores.items():
            weight = self.dimensions[dim_key]["weight"]
            total_score += score * weight
        
        # 转换为百分比 (最高7分)
        return (total_score / 7.0) * 100.0
    
    def determine_risk_level(self, risk_score: float) -> str:
        """确定风险等级"""
        if risk_score >= 70:
            return "high"
        elif risk_score >= 40:
            return "medium"
        else:
            return "low"
    
    def generate_recommendations(self, dimension_scores: Dict[str, int], risk_level: str) -> List[Dict]:
        """生成改进建议"""
        recommendations = []
        
        # 根据风险等级生成基础建议
        if risk_level == "high":
            recommendations.append({
                "priority": "critical",
                "description": "立即停止高风险处理活动",
                "action": "开展全面整改",
                "timeline": "立即"
            })
        
        # 根据各维度分数生成具体建议
        for dim_key, score in dimension_scores.items():
            dim_info = self.dimensions[dim_key]
            
            if score >= 5:  # 高风险维度
                recommendations.append({
                    "priority": "high",
                    "description": f"{dim_info['name']}风险较高",
                    "action": f"加强{dim_info['name']}相关措施",
                    "timeline": "15天内"
                })
            elif score >= 3:  # 中等风险维度
                recommendations.append({
                    "priority": "medium",
                    "description": f"{dim_info['name']}有待优化",
                    "action": f"评估{dim_info['name']}现状",
                    "timeline": "30天内"
                })
        
        return recommendations
    
    def run_assessment(self, 
                      activity: str,
                      data_sensitivity: str,
                      processing_scale: str,
                      processing_purpose: str,
                      third_party_involvement: str,
                      security_measures: str) -> Dict:
        """运行风险评估"""
        
        # 评估各个维度
        dimension_scores = {}
        dimension_scores["data_sensitivity"] = self.assess_dimension("data_sensitivity", data_sensitivity)
        dimension_scores["processing_scale"] = self.assess_dimension("processing_scale", processing_scale)
        dimension_scores["processing_purpose"] = self.assess_dimension("processing_purpose", processing_purpose)
        dimension_scores["third_party_involvement"] = self.assess_dimension("third_party_involvement", third_party_involvement)
        dimension_scores["security_measures"] = self.assess_dimension("security_measures", security_measures)
        
        # 计算风险总分和等级
        risk_score = self.calculate_risk_score(dimension_scores)
        risk_level = self.determine_risk_level(risk_score)
        
        # 生成建议
        recommendations = self.generate_recommendations(dimension_scores, risk_level)
        
        # 构建结果
        results = {
            "assessment_time": datetime.now().isoformat(),
            "activity": activity,
            "dimension_scores": {},
            "overall_score": round(risk_score, 2),
            "risk_level": risk_level,
            "recommendations": recommendations
        }
        
        # 填充维度分数详情
        for dim_key, score in dimension_scores.items():
            dim_info = self.dimensions[dim_key]
            results["dimension_scores"][dim_key] = {
                "name": dim_info["name"],
                "score": score,
                "weight": dim_info["weight"],
                "weighted_score": round(score * dim_info["weight"], 2)
            }
        
        return results

def main():
    parser = argparse.ArgumentParser(description="PIPL合规风险评估工具")
    parser.add_argument("--activity", required=True, help="评估的业务活动名称")
    parser.add_argument("--data", default="medium", choices=["low", "medium", "high", "critical"], 
                       help="数据敏感度：low=基础信息，medium=一般信息，high=敏感信息，critical=未成年人信息")
    parser.add_argument("--volume", default="medium", choices=["small", "medium", "large", "massive"],
                       help="处理规模：small=<1000人，medium=1000-10000人，large=10000-100000人，massive=>100000人")
    parser.add_argument("--purpose", default="business", choices=["contract", "legal", "business", "sensitive"],
                       help="处理目的：contract=履行合同，legal=法律义务，business=商业目的，sensitive=敏感用途")
    parser.add_argument("--third-party", default="none", choices=["none", "delegated", "shared", "cross_border"],
                       help="第三方参与：none=无，delegated=委托处理，shared=数据共享，cross_border=跨境传输")
    parser.add_argument("--security", default="basic", choices=["excellent", "good", "basic", "poor"],
                       help="安全保障：excellent=完善，good=基本，basic=不足，poor=无措施")
    parser.add_argument("--format", choices=["json", "text"], default="text", help="输出格式")
    parser.add_argument("--output", help="输出文件路径")
    
    args = parser.parse_args()
    
    # 创建评估器
    assessor = RiskAssessor()
    
    # 运行评估
    results = assessor.run_assessment(
        activity=args.activity,
        data_sensitivity=args.data,
        processing_scale=args.volume,
        processing_purpose=args.purpose,
        third_party_involvement=args.third_party,
        security_measures=args.security
    )
    
    # 输出结果
    if args.format == "json":
        output = json.dumps(results, ensure_ascii=False, indent=2)
    else:
        output = format_text_output(results)
    
    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            f.write(output)
        print(f"评估结果已保存至：{args.output}")
    else:
        print(output)

def format_text_output(results: Dict) -> str:
    """格式化文本输出"""
    output_lines = []
    
    output_lines.append("=" * 60)
    output_lines.append("PIPL合规风险评估报告")
    output_lines.append("=" * 60)
    output_lines.append(f"评估时间：{results['assessment_time']}")
    output_lines.append(f"业务活动：{results['activity']}")
    output_lines.append("")
    
    # 风险等级显示
    risk_display = {
        "high": "🔴 高风险",
        "medium": "🟡 中风险", 
        "low": "🟢 低风险"
    }
    output_lines.append(f"风险总分：{results['overall_score']}/100")
    output_lines.append(f"风险等级：{risk_display.get(results['risk_level'], results['risk_level'])}")
    output_lines.append("")
    
    # 维度分数
    output_lines.append("各维度风险分数：")
    for dim_key, dim_data in results["dimension_scores"].items():
        score = dim_data["score"]
        level_emoji = {
            1: "🟢",  # 低风险
            3: "🟡",  # 中风险
            5: "🟠",  # 中高风险
            7: "🔴"   # 高风险
        }.get(score, "⚪")
        
        output_lines.append(f"  {level_emoji} {dim_data['name']}: {score}/7 (权重：{dim_data['weight']})")
    
    output_lines.append("")
    
    # 建议
    if results["recommendations"]:
        output_lines.append("改进建议：")
        for i, rec in enumerate(results["recommendations"], 1):
            priority_emoji = {
                "critical": "🔴",
                "high": "🟠",
                "medium": "🟡",
                "low": "🟢"
            }.get(rec["priority"], "⚪")
            
            output_lines.append(f"{i}. {priority_emoji} [{rec['priority'].upper()}] {rec['description']}")
            output_lines.append(f"   行动：{rec['action']}")
            output_lines.append(f"   时限：{rec['timeline']}")
            output_lines.append("")
    else:
        output_lines.append("✅ 风险较低，继续保持")
    
    output_lines.append("")
    
    # 后续步骤
    output_lines.append("后续步骤建议：")
    if results["risk_level"] == "high":
        output_lines.append("1. 立即停止高风险处理活动")
        output_lines.append("2. 制定详细整改计划")
        output_lines.append("3. 考虑报告监管机构（如需要）")
    elif results["risk_level"] == "medium":
        output_lines.append("1. 制定30天整改计划")
        output_lines.append("2. 重点解决高风险维度问题")
        output_lines.append("3. 定期监控整改进展")
    else:
        output_lines.append("1. 保持现有合规水平")
        output_lines.append("2. 定期进行风险评估")
        output_lines.append("3. 持续优化合规体系")
    
    output_lines.append("")
    output_lines.append("=" * 60)
    
    return "\n".join(output_lines)

if __name__ == "__main__":
    main()