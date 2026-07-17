#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
案由分类器：基于关键词规则匹配，识别文书内容的案由和文书类型
"""

import json
import os
import re
from typing import Tuple, Optional, List, Dict


class CaseClassifier:
    """案由分类器"""

    def __init__(self, config_dir=None):
        if config_dir is None:
            config_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'configs')
        
        keywords_path = os.path.join(config_dir, 'case_keywords.json')
        with open(keywords_path, 'r', encoding='utf-8') as f:
            self.config = json.load(f)
        
        self.case_keywords = self.config.get('case_keywords', {})
        self.doc_type_keywords = self.config.get('doc_type_keywords', {})

    def classify(self, text: str) -> Tuple[str, str, float]:
        """
        分类文书内容的案由和文书类型
        
        Args:
            text: 文书文本内容
            
        Returns:
            (案由, 文书类型, 置信度) 例如 ("民间借贷纠纷", "民事起诉状", 0.85)
        """
        if not text or not text.strip():
            return ("未知", "未知", 0.0)

        case_type, case_confidence = self._classify_case(text)
        doc_type, doc_confidence = self._classify_doc_type(text)
        
        overall_confidence = (case_confidence + doc_confidence) / 2
        
        return (case_type, doc_type, round(overall_confidence, 2))

    def _classify_case(self, text: str) -> Tuple[str, float]:
        """识别案由"""
        scores = {}
        
        for case_name, case_info in self.case_keywords.items():
            keywords = case_info.get('keywords', [])
            priority = case_info.get('priority', 10)
            
            score = 0
            matched_keywords = []
            
            for keyword in keywords:
                # 计算关键词出现次数（加权）
                count = text.count(keyword)
                if count > 0:
                    # 关键词越长越精确，权重越高
                    length_weight = len(keyword) / 2.0
                    # 出现次数有递减收益
                    count_score = min(count, 5) * length_weight
                    score += count_score
                    matched_keywords.append((keyword, count))
            
            if score > 0:
                # 加上基础优先级
                score += priority * 0.1
                scores[case_name] = {
                    'score': score,
                    'priority': priority,
                    'matched': matched_keywords
                }
        
        if not scores:
            return ("未知", 0.0)
        
        # 按得分排序
        sorted_cases = sorted(scores.items(), key=lambda x: x[1]['score'], reverse=True)
        best_case = sorted_cases[0]
        
        # 计算置信度：基于得分与次高分的差距
        best_score = best_case[1]['score']
        if len(sorted_cases) > 1:
            second_score = sorted_cases[1][1]['score']
            confidence = min(best_score / (best_score + second_score + 0.001), 1.0)
        else:
            confidence = 1.0
        
        # 匹配关键词数量越多置信度越高
        match_count = len(best_case[1]['matched'])
        confidence = min(confidence * (1 + match_count * 0.1), 1.0)
        
        return (best_case[0], round(confidence, 2))

    def _classify_doc_type(self, text: str) -> Tuple[str, float]:
        """识别文书类型，优先匹配文书标题中的类型名"""
        # 第一步：直接从文书标题匹配（最可靠）
        # 常见标题格式："民事答辩状"、"刑事自诉状（侮辱案）"等
        title_patterns = [
            (r'刑事自诉答辩状', '刑事自诉答辩状'),
            (r'国家赔偿答辩状', '国家赔偿答辩状'),
            (r'行政答辩状', '行政答辩状'),
            (r'民事答辩状', '民事答辩状'),
            (r'第三人意见陈述书', '第三人意见陈述书'),
            (r'国家赔偿申请书', '国家赔偿申请书'),
            (r'刑事自诉状', '刑事自诉状'),
            (r'行政起诉状', '行政起诉状'),
            (r'民事起诉状', '民事起诉状'),
        ]
        for pattern, doc_type in title_patterns:
            if re.search(pattern, text):
                return (doc_type, 0.95)
        
        # 第二步：关键词评分（无明确标题时）
        scores = {}
        
        for doc_type, keywords in self.doc_type_keywords.items():
            score = 0
            for keyword in keywords:
                count = text.count(keyword)
                if count > 0:
                    score += count * len(keyword) / 2.0
            
            if score > 0:
                scores[doc_type] = score
        
        if not scores:
            return ("未知", 0.0)
        
        sorted_types = sorted(scores.items(), key=lambda x: x[1], reverse=True)
        best_type = sorted_types[0]
        
        # 计算置信度
        best_score = best_type[1]
        if len(sorted_types) > 1:
            second_score = sorted_types[1][1]
            confidence = min(best_score / (best_score + second_score + 0.001), 1.0)
        else:
            confidence = 1.0
        
        # 第三步：根据案由的category修正文书类型
        # 如果关键词评分不确定，用案由category推断
        if confidence < 0.6:
            case_type, _ = self._classify_case(text)
            category = self.get_category(case_type)
            inferred = self._infer_doc_type_from_case(category)
            if inferred != '未知':
                return (inferred, 0.7)
        
        return (best_type[0], round(confidence, 2))
    
    def _infer_doc_type_from_case(self, category: str) -> str:
        """根据案由分类推断文书类型（默认推断起诉/申请类）"""
        category_map = {
            '01-刑事自诉': '刑事自诉状',
            '08-行政纠纷': '行政起诉状',
            '09-国家赔偿': '国家赔偿申请书',
        }
        return category_map.get(category, '未知')

    def get_template_filename(self, case_type: str, doc_type: str) -> Optional[str]:
        """
        根据案由和文书类型获取模板文件名
        
        Args:
            case_type: 案由（如"民间借贷纠纷"）
            doc_type: 文书类型（如"民事起诉状"）
            
        Returns:
            模板文件名（如"民事起诉状-民间借贷纠纷.docx"）
        """
        # 直接拼接
        filename = f"{doc_type}-{case_type}.docx"
        return filename

    def get_category(self, case_type: str) -> str:
        """获取案由所属分类"""
        if case_type in self.case_keywords:
            return self.case_keywords[case_type].get('category', '未知')
        return '未知'

    def get_all_case_types(self) -> List[str]:
        """获取所有案由列表"""
        return list(self.case_keywords.keys())

    def get_case_types_by_category(self, category: str) -> List[str]:
        """获取某分类下的所有案由"""
        return [
            name for name, info in self.case_keywords.items()
            if info.get('category') == category
        ]

    def suggest_alternatives(self, text: str, top_n: int = 3) -> List[Dict]:
        """
        给出多个可能的案由建议（用于低置信度时）
        
        Returns:
            [{"case_type": "民间借贷纠纷", "doc_type": "民事起诉状", "confidence": 0.85}, ...]
        """
        results = []
        
        # 计算所有案由得分
        case_scores = {}
        for case_name, case_info in self.case_keywords.items():
            keywords = case_info.get('keywords', [])
            priority = case_info.get('priority', 10)
            score = 0
            for keyword in keywords:
                count = text.count(keyword)
                if count > 0:
                    score += count * len(keyword) / 2.0
            if score > 0:
                score += priority * 0.1
                case_scores[case_name] = score
        
        # 排序取top N
        sorted_cases = sorted(case_scores.items(), key=lambda x: x[1], reverse=True)[:top_n]
        
        # 文书类型
        doc_type, _ = self._classify_doc_type(text)
        
        total_score = sum(s for _, s in sorted_cases) or 1
        for case_name, score in sorted_cases:
            confidence = score / total_score
            results.append({
                'case_type': case_name,
                'doc_type': doc_type,
                'confidence': round(confidence, 2),
                'category': self.case_keywords[case_name].get('category', '未知'),
                'template': self.get_template_filename(case_name, doc_type)
            })
        
        return results


# 单独测试
if __name__ == '__main__':
    classifier = CaseClassifier()
    
    # 测试1: 民间借贷
    text1 = """
    民事起诉状
    原告张三，男，1985年3月12日出生，汉族
    被告李四，女，1990年5月20日出生
    
    诉讼请求：
    1. 判令被告偿还原告借款本金10万元；
    2. 判令被告支付逾期利息；
    
    事实与理由：
    2023年1月1日，被告向原告借款10万元，约定借期一年，年利率10%。
    借款到期后被告未归还本金和利息。
    """
    
    result1 = classifier.classify(text1)
    print(f"测试1: {result1}")
    print(f"  模板: {classifier.get_template_filename(result1[0], result1[1])}")
    print(f"  分类: {classifier.get_category(result1[0])}")
    
    # 测试2: 离婚
    text2 = """
    民事起诉状
    原告王五，女，1988年出生
    被告赵六，男，1985年出生
    
    诉讼请求：
    1. 判决解除原被告婚姻关系；
    2. 婚生子归原告抚养；
    
    事实与理由：
    原被告于2010年登记结婚，婚后生育一子。因感情不和，请求离婚。
    """
    
    result2 = classifier.classify(text2)
    print(f"测试2: {result2}")
    print(f"  模板: {classifier.get_template_filename(result2[0], result2[1])}")
    
    # 测试3: 建议
    print("\n建议:")
    for s in classifier.suggest_alternatives(text1):
        print(f"  {s}")
