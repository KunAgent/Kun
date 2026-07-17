#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
内容提取器 v2：从文书中提取关键要素信息
支持两种输入格式：
1. 要素式文书（已有□勾选框和标签的，如从实例docx中提取）
2. 传统文书（纯文本叙述式）
"""

import os
import re
import json
from typing import Dict, List, Optional, Tuple


class ContentExtractor:
    """内容提取器"""

    def __init__(self, config_dir: str = None):
        if config_dir is None:
            config_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'configs')
        
        self.config_dir = config_dir
        self.field_mapping = self._load_field_mapping()

    def _load_field_mapping(self) -> dict:
        """加载字段映射配置"""
        mapping_path = os.path.join(self.config_dir, 'field_mapping.json')
        if os.path.exists(mapping_path):
            with open(mapping_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        return {}

    def extract(self, text: str, case_type: str = '', doc_type: str = '') -> Dict:
        """
        从文书文本中提取结构化数据
        自动检测输入格式（要素式 or 传统式），选择合适的提取策略
        """
        # 检测是否是要素式文书
        is_element_style = self._detect_element_style(text)
        
        if is_element_style:
            return self._extract_from_element_style(text, case_type, doc_type)
        else:
            return self._extract_from_traditional(text, case_type, doc_type)

    def _detect_element_style(self, text: str) -> bool:
        """检测是否是要素式文书"""
        # 要素式文书的特征：有勾选框、有结构化的标签
        checkbox_count = text.count('□') + text.count('☐') + text.count('☑')
        has_element_labels = any(label in text for label in [
            '当事人信息', '诉讼请求', '事实与理由', 
            '对纠纷解决方式的意愿', '具状人（签字、盖章）'
        ])
        
        return checkbox_count >= 3 and has_element_labels

    def _extract_from_element_style(self, text: str, case_type: str, doc_type: str) -> Dict:
        """
        从要素式文书中提取信息
        要素式文书有明确的标签和填空结构，可以直接按标签提取
        """
        result = {
            'parties': {},
            'case_specific': {},
            'checkboxes': [],
            'signature': {},
            'raw_text': text,
            'case_type': case_type,
            'doc_type': doc_type,
            'input_style': 'element',
        }
        
        # 将文本按段落分割
        lines = text.split('\n')
        lines = [l.strip() for l in lines if l.strip()]
        
        # === 提取当事人信息 ===
        parties = self._extract_parties_element(lines, doc_type)
        result['parties'] = parties
        
        # === 提取勾选框 ===
        checkboxes = self._extract_checkboxes_element(text)
        result['checkboxes'] = checkboxes
        
        # === 提取案由特定字段 ===
        case_fields = self._extract_case_specific_element(text, case_type, lines)
        result['case_specific'] = case_fields
        
        # === 提取签名 ===
        signature = self._extract_signature_element(text)
        result['signature'] = signature
        
        return result

    def _extract_parties_element(self, lines: List[str], doc_type: str) -> Dict:
        """从要素式文书的行中提取当事人信息"""
        parties = {}
        
        # 确定段落标记
        section_markers = {
            'plaintiff_start': ['原告', '（自然人）', '起诉人', '自诉人', '赔偿请求人'],
            'plaintiff_legal': ['原告', '（法人、非法人组织）'],
            'defendant_start': ['被告', '被起诉人', '被告人', '赔偿义务机关'],
            'defendant_legal': ['被告', '（法人、非法人组织）'],
            'agent_start': ['委托诉讼代理人'],
            'third_person_start': ['第三人'],
            'request_start': ['诉讼请求'],
        }
        
        # 将行分组到各个段落
        current_section = None
        sections = {}
        
        for line in lines:
            # 检测段落切换
            new_section = None
            if line in ('原告', '被告', '第三人', '答辩人', '自诉人', '被告人', '赔偿请求人', '申请人', '委托诉讼代理人', '诉讼代理人', '辩护人', '委托代理人', '赔偿义务机关'):
                new_section = line
            elif line == '（自然人）' and current_section in ('原告', '被告', '第三人', '答辩人', '自诉人', '被告人', '赔偿请求人', '申请人'):
                new_section = f'{current_section}_natural'
            elif line == '（法人、非法人组织）' and current_section in ('原告', '被告', '第三人', '答辩人', '申请人', '赔偿请求人'):
                new_section = f'{current_section}_legal'
            elif line.startswith('诉讼请求') or line.startswith('事实与理由'):
                new_section = 'end'
            
            if new_section:
                current_section = new_section
                if current_section not in sections:
                    sections[current_section] = []
                continue
            
            if current_section and current_section != 'end':
                sections.setdefault(current_section, []).append(line)
        
        # 从各段落提取信息
        # 原告自然人
        plaintiff_lines = (sections.get('原告_natural', []) or sections.get('答辩人_natural', []) or sections.get('自诉人_natural', []) or sections.get('自诉人', []) or sections.get('申请人_natural', []) or sections.get('申请人', []) or sections.get('赔偿请求人_natural', []) or sections.get('原告', []))
        if plaintiff_lines:
            parties['plaintiff'] = self._parse_person_lines(plaintiff_lines, 'natural')
            parties['plaintiff']['type'] = 'natural'
        
        # 原告法人
        plaintiff_legal_lines = sections.get('原告_legal', [])
        if plaintiff_legal_lines and 'plaintiff' not in parties:
            parties['plaintiff'] = self._parse_legal_person_lines(plaintiff_legal_lines)
            parties['plaintiff']['type'] = 'legal'
        
        # 被告自然人
        defendant_lines = (sections.get('被告_natural', []) or sections.get('被告人_natural', []) or sections.get('被告人', []) or sections.get('被告', []))
        if defendant_lines:
            parties['defendant'] = self._parse_person_lines(defendant_lines, 'natural')
            parties['defendant']['type'] = 'natural'
        
        # 被告法人
        defendant_legal_lines = sections.get('被告_legal', [])
        if defendant_legal_lines and 'defendant' not in parties:
            parties['defendant'] = self._parse_legal_person_lines(defendant_legal_lines)
            parties['defendant']['type'] = 'legal'
        
        # 委托诉讼代理人
        agent_lines = sections.get('委托诉讼代理人', [])
        if agent_lines:
            parties['agent'] = self._parse_agent_lines(agent_lines)
        
        return parties

    def _parse_person_lines(self, lines: List[str], person_type: str) -> Dict:
        """解析自然人信息行"""
        info = {}
        
        # 将多行合并为一个文本便于匹配
        full_text = '\n'.join(lines)
        
        # 姓名
        m = re.search(r'姓名[：:]\s*(.+)', full_text)
        if m:
            info['name'] = m.group(1).strip()
        
        # 性别 - 从勾选框判断
        if '男☐' in full_text or '男 ☐' in full_text or '男☑' in full_text:
            info['gender'] = '男'
        elif '女☐' in full_text or '女 ☐' in full_text or '女☑' in full_text:
            info['gender'] = '女'
        else:
            # 尝试从文本判断
            m = re.search(r'性别[：:]\s*(男|女)', full_text)
            if m:
                info['gender'] = m.group(1)
        
        # 出生日期
        m = re.search(r'出生日期[：:]\s*(.+?)(?:\s+民族|$)', full_text)
        if m:
            info['birthdate'] = m.group(1).strip()
        
        # 民族
        m = re.search(r'民族[：:]\s*(\S+)', full_text)
        if m:
            info['ethnicity'] = m.group(1)
        
        # 工作单位
        m = re.search(r'工作单位[：:]\s*(.+?)(?:\s+职务|$)', full_text)
        if m:
            info['work_unit'] = m.group(1).strip()
        
        # 职务
        m = re.search(r'职务[：:]\s*(.+?)(?:\s+联系电话|$)', full_text)
        if m:
            info['position'] = m.group(1).strip()
        
        # 联系电话
        m = re.search(r'联系电话[：:]\s*(.+)', full_text)
        if m:
            info['phone'] = m.group(1).strip()
        
        # 住所地
        m = re.search(r'住所地[（(][^）)]*[）)][：:]\s*(.+)', full_text)
        if m:
            info['address'] = m.group(1).strip()
        
        # 经常居住地
        m = re.search(r'经常居住地[：:]\s*(.+)', full_text)
        if m:
            info['residence'] = m.group(1).strip()
        
        # 证件类型
        m = re.search(r'证件类型[：:]\s*(.+)', full_text)
        if m:
            info['id_type'] = m.group(1).strip()
        
        # 证件号码
        m = re.search(r'证件号码[：:]\s*(.+)', full_text)
        if m:
            info['id_number'] = m.group(1).strip()
        
        return info

    def _parse_legal_person_lines(self, lines: List[str]) -> Dict:
        """解析法人信息行"""
        info = {'type': 'legal'}
        full_text = '\n'.join(lines)
        
        m = re.search(r'名称[：:]\s*(.+)', full_text)
        if m:
            info['name'] = m.group(1).strip()
        
        m = re.search(r'法定代表人\s*/\s*负责人[：:]\s*(.+?)(?:\s+职务|$)', full_text)
        if m:
            info['legal_person'] = m.group(1).strip()
        
        m = re.search(r'统一社会信用代码[：:]\s*(.+)', full_text)
        if m:
            info['credit_code'] = m.group(1).strip()
        
        m = re.search(r'联系电话[：:]\s*(.+)', full_text)
        if m:
            info['phone'] = m.group(1).strip()
        
        m = re.search(r'住所地[（(][^）)]*[）)][：:]\s*(.+)', full_text)
        if m:
            info['address'] = m.group(1).strip()
        
        return info

    def _parse_agent_lines(self, lines: List[str]) -> Dict:
        """解析委托诉讼代理人信息行"""
        info = {'has_agent': False}
        full_text = '\n'.join(lines)
        
        # 判断是否有代理人
        if '有☐' in full_text or '有☑' in full_text:
            info['has_agent'] = True
        elif re.search(r'姓名[：:]\s*\S', full_text):
            info['has_agent'] = True
        
        if not info['has_agent']:
            return info
        
        m = re.search(r'姓名[：:]\s*(.+)', full_text)
        if m:
            info['name'] = m.group(1).strip()
        
        m = re.search(r'单位[：:]\s*(.+?)(?:\s+职务|$)', full_text)
        if m:
            info['unit'] = m.group(1).strip()
        
        m = re.search(r'联系电话[：:]\s*(.+)', full_text)
        if m:
            info['phone'] = m.group(1).strip()
        
        # 代理权限
        if '特别授权☐' in full_text or '特别授权☑' in full_text:
            info['authority'] = '特别授权'
        elif '一般授权☐' in full_text or '一般授权☑' in full_text:
            info['authority'] = '一般授权'
        
        return info

    def _extract_checkboxes_element(self, text: str) -> List[Dict]:
        """从要素式文书中提取勾选框状态"""
        checkboxes = []
        
        lines = text.split('\n')
        for line in lines:
            # 查找已勾选的☐（U+2610 BALLOT BOX）
            if '☐' in line:
                # ☐在要素式实例中表示已勾选
                # 找到☐前面的文字作为context
                idx = line.index('☐')
                before = line[:idx].rstrip()
                # 取最后30个字符作为context
                context = before[-30:] if len(before) > 30 else before
                checkboxes.append({
                    'context': context,
                    'check': True
                })
            
            # 查找☑（已勾选）
            if '☑' in line:
                idx = line.index('☑')
                before = line[:idx].rstrip()
                context = before[-30:] if len(before) > 30 else before
                checkboxes.append({
                    'context': context,
                    'check': True
                })
        
        return checkboxes

    def _extract_case_specific_element(self, text: str, case_type: str, lines: List[str]) -> Dict:
        """从要素式文书中提取案由特定字段"""
        # 根据案由选择提取策略
        extractors = {
            '民间借贷纠纷': self._extract_loan_fields_element,
            '离婚纠纷': self._extract_divorce_fields_element,
            '机动车交通事故责任纠纷': self._extract_traffic_fields_element,
            '劳动争议纠纷': self._extract_labor_fields_element,
        }
        
        extractor = extractors.get(case_type, self._extract_generic_fields_element)
        return extractor(text, lines)

    def _extract_loan_fields_element(self, text: str, lines: List[str]) -> Dict:
        """从要素式民间借贷文书中提取字段"""
        fields = {}
        
        # 本金
        m = re.search(r'尚欠本金\s*(\d[\d,.]*\s*万?元)', text)
        if m:
            fields['本金金额'] = m.group(1)
        
        # 利息
        m = re.search(r'尚欠利息\s*(\d[\d,.]*\s*万?元)', text)
        if m:
            fields['利息金额'] = m.group(1)
        
        # 利率
        m = re.search(r'年利率\s*(\d+\.?\d*)\s*%', text)
        if m:
            fields['年利率'] = m.group(1) + '%'
        
        # 借款金额
        m = re.search(r'约定[：:]\s*(\d[\d,.]*\s*万?元整?)', text)
        if m:
            fields['约定借款金额'] = m.group(1)
        
        # 实际提供
        m = re.search(r'实际提供[：:]\s*(\d[\d,.]*\s*万?元)', text)
        if m:
            fields['实际提供金额'] = m.group(1)
        
        # 标的总额
        m = re.search(r'标的总额[^"]*?(\d[\d,.]*\s*万?元)', text)
        if m:
            fields['标的总额'] = m.group(1)
        
        # 已还本金
        m = re.search(r'已还本金[：:]\s*(\d[\d,.]*\s*元)', text)
        if m:
            fields['已还本金'] = m.group(1)
        
        # 已还利息
        m = re.search(r'已还利息[：:]\s*(\d[\d,.]*\s*元)', text)
        if m:
            fields['已还利息'] = m.group(1)
        
        # 逾期时间
        m = re.search(r'逾期时间[：:]\s*(.+?)(?:\s*否□|$)', text)
        if m:
            fields['逾期时间'] = m.group(1).strip()
        
        # 合同签订
        m = re.search(r'合同签订情况[^"]*?\n(.+)', text)
        if m:
            fields['合同签订情况'] = m.group(1).strip()
        
        # 诉讼请求概括
        m = re.search(r'诉讼请求\s*\n(.+)', text)
        if m:
            fields['诉讼请求概括'] = m.group(1).strip()
        
        # 事实与理由概括
        m = re.search(r'事实与理由\s*\n(.+)', text)
        if m:
            fields['事实与理由概括'] = m.group(1).strip()
        
        # 出借人
        m = re.search(r'出借人[：:]\s*(.+)', text)
        if m:
            fields['出借人'] = m.group(1).strip()
        
        # 借款人
        m = re.search(r'借款人[：:]\s*(.+)', text)
        if m:
            fields['借款人'] = m.group(1).strip()
        
        # 约定期限
        m = re.search(r'约定期限[：:]\s*(.+?)(?:\n|$)', text)
        if m:
            fields['约定期限'] = m.group(1).strip()
        
        # 合同约定
        m = re.search(r'合同约定[：:]\s*(.+?)(?:\n|$)', text)
        if m:
            fields['请求依据合同约定'] = m.group(1).strip()
        
        # 法律规定
        m = re.search(r'法律规定[：:]\s*(.+?)(?:\n|$)', text)
        if m:
            fields['请求依据法律规定'] = m.group(1).strip()
        
        # 管辖约定
        m = re.search(r'合同条款及内容[：:]\s*(.+?)(?:\n|无□|$)', text)
        if m:
            fields['管辖约定'] = m.group(1).strip()
        
        return fields

    def _extract_divorce_fields_element(self, text: str, lines: List[str]) -> Dict:
        """从要素式离婚文书中提取字段"""
        fields = {}
        
        m = re.search(r'结婚时间[：:]\s*(.+)', text)
        if m:
            fields['结婚时间'] = m.group(1).strip()
        
        m = re.search(r'生育子女情况[：:]\s*(.+)', text)
        if m:
            fields['生育子女情况'] = m.group(1).strip()
        
        m = re.search(r'离婚事由[：:]\s*(.+)', text)
        if m:
            fields['离婚事由'] = m.group(1).strip()
        
        return fields

    def _extract_traffic_fields_element(self, text: str, lines: List[str]) -> Dict:
        """从要素式交通事故文书中提取字段"""
        fields = {}
        # 交通事故的字段通常由专门的生成器处理
        # 这里只提取基本信息
        m = re.search(r'事故时间[：:]\s*(.+)', text)
        if m:
            fields['事故时间'] = m.group(1).strip()
        
        return fields

    def _extract_labor_fields_element(self, text: str, lines: List[str]) -> Dict:
        """从要素式劳动争议文书中提取字段"""
        fields = {}
        m = re.search(r'(?:月工资|工资)[：:]\s*(\d[\d,.]*)\s*元', text)
        if m:
            fields['工资'] = m.group(1) + '元'
        return fields

    def _extract_generic_fields_element(self, text: str, lines: List[str]) -> Dict:
        """通用要素式字段提取"""
        fields = {}
        
        # 诉讼请求概括
        m = re.search(r'诉讼请求\s*\n(.+)', text)
        if m:
            fields['诉讼请求概括'] = m.group(1).strip()
        
        # 事实与理由概括
        m = re.search(r'事实与理由\s*\n(.+)', text)
        if m:
            fields['事实与理由概括'] = m.group(1).strip()
        
        # 标的额
        m = re.search(r'(?:标的总额|标的额)[^"]*?(\d[\d,.]*\s*万?元)', text)
        if m:
            fields['标的总额'] = m.group(1)
        
        return fields

    def _extract_signature_element(self, text: str) -> Dict:
        """提取签名和日期"""
        signature = {}
        
        m = re.search(r'具状人[（(]签字、盖章[）)][：:]\s*(.+?)(?:\n|$)', text)
        if m:
            signature['signer'] = m.group(1).strip()
        
        m = re.search(r'日期[：:]\s*(.+?)(?:\n|$)', text)
        if m:
            signature['date'] = m.group(1).strip()
        
        return signature

    # ================================================================
    # 传统文书提取（原有逻辑，保留）
    # ================================================================
    def _extract_from_traditional(self, text: str, case_type: str, doc_type: str) -> Dict:
        """从传统叙述式文书中提取信息"""
        result = {
            'parties': {},
            'case_specific': {},
            'checkboxes': [],
            'signature': {},
            'raw_text': text,
            'case_type': case_type,
            'doc_type': doc_type,
            'input_style': 'traditional',
        }
        
        result['parties'] = self._extract_parties_traditional(text, doc_type)
        result['case_specific'] = self._extract_case_specific_traditional(text, case_type)
        result['signature'] = self._extract_signature_traditional(text)
        
        return result

    def _extract_parties_traditional(self, text: str, doc_type: str) -> Dict:
        """从传统文书中提取当事人信息，支持所有文书类型的角色名"""
        parties = {}
        
        # 文书类型→角色名映射：party1对应内部plaintiff，party2对应内部defendant
        ROLE_MAP = {
            '民事起诉状': ('原告', '被告'),
            '民事答辩状': ('答辩人', None),  # 答辩人即原被告之一
            '刑事自诉状': ('自诉人', '被告人'),
            '刑事自诉答辩状': ('答辩人', None),
            '行政起诉状': ('原告', '被告'),
            '行政答辩状': ('答辩人', None),
            '国家赔偿申请书': ('赔偿请求人', '赔偿义务机关'),
            '国家赔偿答辩状': ('答辩人', None),
            '第三人意见陈述书': ('第三人', None),
        }
        
        # 自动从文本推断角色名（如果doc_type没给出或不匹配）
        role1_name, role2_name = ROLE_MAP.get(doc_type, (None, None))
        if not role1_name:
            role1_name, role2_name = self._infer_roles_from_text(text)
        
        # 提取party1（plaintiff）
        if role1_name:
            party1 = self._extract_person_by_role(text, role1_name)
            if party1:
                parties['plaintiff'] = party1
        
        # 提取party2（defendant）
        if role2_name:
            party2 = self._extract_person_by_role(text, role2_name)
            if party2:
                parties['defendant'] = party2
        
        # 兜底：如果plaintiff没提取到，尝试所有已知角色名
        if 'plaintiff' not in parties:
            for role in ['原告', '答辩人', '自诉人', '赔偿请求人', '第三人', '申请人', '陈述人']:
                party = self._extract_person_by_role(text, role)
                if party:
                    parties['plaintiff'] = party
                    break
        
        # 兜底：如果defendant没提取到且有对应角色名
        if 'defendant' not in parties:
            for role in ['被告', '被告人', '赔偿义务机关', '复议机关']:
                party = self._extract_person_by_role(text, role)
                if party:
                    parties['defendant'] = party
                    break
        
        return parties
    
    def _infer_roles_from_text(self, text: str) -> Tuple:
        """从文本内容推断角色名"""
        ROLE_KEYWORDS = {
            '答辩人': ['民事答辩状', '刑事自诉答辩状', '行政答辩状', '国家赔偿答辩状', '答辩意见', '答辩事项'],
            '自诉人': ['刑事自诉状', '自诉状'],
            '赔偿请求人': ['国家赔偿申请', '赔偿请求人', '赔偿义务机关'],
            '第三人': ['第三人意见', '意见陈述书'],
        }
        
        for role, keywords in ROLE_KEYWORDS.items():
            for kw in keywords:
                if kw in text:
                    if role == '答辩人':
                        return ('答辩人', None)
                    elif role == '自诉人':
                        return ('自诉人', '被告人')
                    elif role == '赔偿请求人':
                        return ('赔偿请求人', '赔偿义务机关')
                    elif role == '第三人':
                        return ('第三人', None)
        
        return ('原告', '被告')
    
    def _extract_person_by_role(self, text: str, role_name: str) -> Optional[Dict]:
        """按角色名提取当事人信息（自然人/法人自动判断）"""
        # 法人/组织特征关键词
        LEGAL_KEYWORDS = ['有限公司', '股份有限公司', '集团', '公司', '银行', '保险', '局', '委员会', 
                          '法院', '政府', '机关', '所', '协会', '联合会', '知识产权局']
        
        # 完整格式：角色名：张三，男，1985年3月12日出生，汉族...
        pattern_full = re.compile(
            rf'{re.escape(role_name)}[：:]\s*([^\s,，\n（(]{{2,30}})[，,\s]+(男|女)[，,\s]*(\d{{4}})\s*年\s*(\d{{1,2}})\s*月\s*(\d{{1,2}})\s*日\s*出生[，,\s]*([^\s,，\n]+?)\s*族'
        )
        m = pattern_full.search(text)
        if m:
            person = {'type': 'natural'}
            person['name'] = m.group(1).strip()
            person['gender'] = m.group(2)
            person['birthdate'] = f"{m.group(3)} 年 {m.group(4)} 月 {m.group(5)} 日"
            person['ethnicity'] = m.group(6)
            self._fill_extra_fields(person, text, m.start())
            return person
        
        # 简短自然人格式：角色名：张三，男，...
        pattern_short = re.compile(
            rf'{re.escape(role_name)}[：:]\s*([^\s,，\n（(]{{2,10}})[，,\s]+(男|女)'
        )
        m = pattern_short.search(text)
        if m:
            person = {'type': 'natural'}
            person['name'] = m.group(1).strip()
            person['gender'] = m.group(2)
            self._fill_extra_fields(person, text, m.start())
            return person
        
        # 法人/组织格式：角色名：XX有限公司，住所地：...
        pattern_legal = re.compile(
            rf'{re.escape(role_name)}[：:]\s*([^\n，,]+?)(?:[，,]\s*住所地[：:]|\.?\s*$|\n)'
        )
        m = pattern_legal.search(text)
        if m:
            name = m.group(1).strip()
            # 判断是否是法人/组织
            is_legal = any(kw in name for kw in LEGAL_KEYWORDS)
            if is_legal:
                person = {'type': 'legal'}
                person['name'] = name
                # 提取法人额外信息
                person_text = text[m.start():min(m.start() + 500, len(text))]
                addr_m = re.search(r'住所地[：:]\s*(.+?)(?:\n|，|。|$)', person_text)
                if addr_m:
                    person['address'] = addr_m.group(1).strip()
                lp_m = re.search(r'法定代表人[/\s]*(?:负责人)?[：:]\s*(.+?)(?:\n|，|。|$|联系电话)', person_text)
                if lp_m:
                    person['legal_person'] = lp_m.group(1).strip()
                phone_m = re.search(r'联系电话[：:]\s*([0-9\-]+)', person_text)
                if phone_m:
                    person['phone'] = phone_m.group(1)
                return person
            else:
                # 简单名称格式（只有名字，后面直接跟住址等）
                person = {'type': 'natural'}
                person['name'] = name.rstrip('，,')
                self._fill_extra_fields(person, text, m.start())
                return person
        
        # 最简格式：角色名：名称（可能只有名字）
        pattern_min = re.compile(
            rf'{re.escape(role_name)}[：:]\s*([^\n]+?)(?:\n|$)'
        )
        m = pattern_min.search(text)
        if m:
            raw = m.group(1).strip()
            name = raw.split('，')[0].split(',')[0].strip()
            if len(name) >= 2:
                is_legal = any(kw in name for kw in LEGAL_KEYWORDS)
                person = {'type': 'legal' if is_legal else 'natural'}
                person['name'] = name
                self._fill_extra_fields(person, text, m.start())
                return person
        
        return None
    
    def _fill_extra_fields(self, person: Dict, text: str, start_pos: int):
        """填充当事人的额外字段"""
        person_text = text[start_pos:min(start_pos + 400, len(text))]
        
        phone_m = re.search(r'(?:联系电话|电话|联系方式)[：:]\s*([0-9\-]+)', person_text)
        if phone_m:
            person['phone'] = phone_m.group(1)
        
        id_m = re.search(r'(?:身份证号码?|证件号码?)[：:]\s*(\d{17}[\dXx])', person_text)
        if id_m:
            person['id_number'] = id_m.group(1)
        
        addr_m = re.search(r'(?:住所地|住址|地址|住)[：:]\s*(.+?)(?:\n|，|。|$)', person_text)
        if addr_m:
            person['address'] = addr_m.group(1).strip()
        
        work_m = re.search(r'(?:工作单位|单位)[：:]\s*(.+?)(?:\n|，|职务|$)', person_text)
        if work_m:
            person['work_unit'] = work_m.group(1).strip()
        
        pos_m = re.search(r'职务[：:]\s*(.+?)(?:\n|，|联系电话|$)', person_text)
        if pos_m:
            person['position'] = pos_m.group(1).strip()

    def _extract_case_specific_traditional(self, text: str, case_type: str) -> Dict:
        """从传统文书中提取案由特定字段"""
        extractors = {
            '民间借贷纠纷': self._extract_loan_fields,
            '离婚纠纷': self._extract_divorce_fields,
            '机动车交通事故责任纠纷': self._extract_traffic_fields,
            '劳动争议纠纷': self._extract_labor_fields,
        }
        
        extractor = extractors.get(case_type, self._extract_generic_fields)
        return extractor(text)

    def _extract_signature_traditional(self, text: str) -> Dict:
        """从传统文书中提取签名，支持所有文书类型的签名标签"""
        signature = {}
        
        # 所有可能的签名标签
        sig_labels = [
            '具状人', '起诉人', '申请人', '答辩人', '赔偿请求人',
            '陈述人', '自诉人', '赔偿请求人',
        ]
        sig_pattern = r'(?:' + '|'.join(re.escape(l) for l in sig_labels) + r')[（(]签字、盖章[）)][：:]\s*(.+?)(?:\n|$)'
        m = re.search(sig_pattern, text)
        if m:
            signature['signer'] = m.group(1).strip()
        
        # 也尝试无括号的格式
        if 'signer' not in signature:
            sig_pattern2 = r'(?:' + '|'.join(re.escape(l) for l in sig_labels) + r')[（(]签字[）)][：:]\s*(.+?)(?:\n|$)'
            m = re.search(sig_pattern2, text)
            if m:
                signature['signer'] = m.group(1).strip()
        
        # 日期
        m = re.search(r'(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*$', text.strip())
        if m:
            signature['date'] = f"{m.group(1)} 年 {m.group(2)} 月 {m.group(3)} 日"
        
        return signature

    # ================================================================
    # 传统文书 - 案由特定提取
    # ================================================================
    def _extract_loan_fields(self, text: str) -> Dict:
        """提取民间借贷纠纷特定字段"""
        fields = {}
        m = re.search(r'(?:尚欠)?本金\s*(\d[\d,.]*)\s*元', text)
        if m:
            fields['本金金额'] = m.group(1) + '元'
        m = re.search(r'(?:尚欠)?利息\s*(\d[\d,.]*)\s*元', text)
        if m:
            fields['利息金额'] = m.group(1) + '元'
        m = re.search(r'年利率\s*(\d+\.?\d*)\s*%', text)
        if m:
            fields['年利率'] = m.group(1) + '%'
        m = re.search(r'借款\s*(\d[\d,.]*\s*万?元)', text)
        if m:
            fields['约定借款金额'] = m.group(1)
        m = re.search(r'《([^》]+)》', text)
        if m:
            fields['合同名称'] = m.group(1)
        return fields

    def _extract_divorce_fields(self, text: str) -> Dict:
        """提取离婚纠纷特定字段"""
        fields = {}
        m = re.search(r'(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})?\s*日?\s*(?:结婚|登记)', text)
        if m:
            fields['结婚时间'] = f"{m.group(1)}年{m.group(2)}月{m.group(3) or ''}日"
        return fields

    def _extract_traffic_fields(self, text: str) -> Dict:
        """提取交通事故特定字段"""
        fields = {}
        return fields

    def _extract_labor_fields(self, text: str) -> Dict:
        """提取劳动争议特定字段"""
        fields = {}
        m = re.search(r'(?:月工资|工资标准)[：:]?\s*(\d[\d,.]*)\s*元', text)
        if m:
            fields['工资'] = m.group(1) + '元'
        return fields

    def _extract_generic_fields(self, text: str) -> Dict:
        """通用字段提取"""
        fields = {}
        amounts = re.findall(r'(\d[\d,.]*\s*万?元)', text)
        if amounts:
            fields['标的额'] = amounts[0]
        m = re.search(r'《([^》]+)》', text)
        if m:
            fields['合同名称'] = m.group(1)
        return fields

    def extract_with_llm_prompt(self, text: str, case_type: str = '') -> str:
        """生成LLM辅助提取的prompt"""
        prompt = f"""请从以下诉讼文书中提取关键信息，以JSON格式返回。

案由：{case_type}

需要提取的信息：
1. 原告信息（姓名、性别、出生日期、民族、工作单位、职务、联系电话、住所地、证件号码）
2. 被告信息（同上）
3. 委托诉讼代理人信息（有无、姓名、单位、职务、联系电话、代理权限）
4. 诉讼请求具体内容
5. 事实与理由要点
6. 案由特定字段（如民间借贷的本金/利息/利率/期限，离婚的结婚时间/子女情况等）
7. 勾选框状态（哪些选项被勾选）
8. 具状人签名和日期

文书内容：
{text[:3000]}

请以以下JSON格式返回提取结果：
{{
  "parties": {{
    "plaintiff": {{"type": "natural/legal", "name": "", "gender": "", ...}},
    "defendant": {{"type": "natural/legal", "name": "", "gender": "", ...}},
    "agent": {{"has_agent": false, "name": "", ...}}
  }},
  "case_specific": {{
    "字段名": "值"
  }},
  "checkboxes": [
    {{"context": "选项文字", "check": true/false}}
  ],
  "signature": {{
    "signer": "",
    "date": ""
  }}
}}"""
        return prompt


# 单独测试
if __name__ == '__main__':
    extractor = ContentExtractor()
    
    # Test with element-style text
    test_text = """
    民事起诉状
    （民间借贷纠纷）
    当事人信息
    原告
    （自然人）
    姓名：沈 ×
    性别：男□    女 ☐
    出生日期：19×× 年  × 月 ×× 日               民族：汉族
    工作单位：无                       职务：无
    联系电话： ×××××××××××
    住所地（户籍所在地）： 福建省惠安县螺阳镇 ×× 村  × 组  ×× 号
    经常居住地： 同上
    证件类型： 身份证
    证件号码： ××××××××××××××××××
    委托诉讼代理人
    有 ☐
    姓名：李 ××
    被告
    （自然人）
    姓名：董 ××
    性别：男 ☐ 女□
    诉讼请求
    依法判决董 ×× 偿还借款本金 10 万元及利息 12500 元
    """
    
    result = extractor.extract(test_text, '民间借贷纠纷', '民事起诉状')
    import json
    print(json.dumps(result, ensure_ascii=False, indent=2))
