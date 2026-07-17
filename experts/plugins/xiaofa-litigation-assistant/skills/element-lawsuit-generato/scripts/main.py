#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
要素式文书一键生成器 v4 - 合并版主入口

吸收 element-lawsuit-generato（规则分类+多格式输入）和
数据驱动 DOCX 生成引擎的各自最优件。

架构：
  输入(txt/md/docx/pdf/图片) → 解析(FileParser) → 分类(CaseClassifier)
  → 提取(ContentExtractor + 可选AI) → 格式转换 → 生成(generate_docx.py v8) → DOCX

v4 变更：
  - 废弃远程模板下载+XML填充方案，改用 JSON 数据驱动 DOCX 生成
  - 保留 58 案由 × 9 类文书的分类能力
  - 保留 5 种输入格式解析
  - 引入双轨提取：规则快速通道 + AI 精准通道
  - DOCX 生成引擎采用 generate_docx.py（像素级精准）
"""

import os
import sys
import json
import argparse
from datetime import datetime
from typing import Optional, Dict, List, Any

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(SCRIPT_DIR)

from file_parser import FileParser
from case_classifier import CaseClassifier
from content_extractor import ContentExtractor
from generate_docx import generate_docx


class ElementLawsuitGenerator:
    """要素式文书一键生成器 v4"""

    def __init__(self, output_dir=None, config_dir=None):
        if config_dir is None:
            config_dir = os.path.join(BASE_DIR, 'configs')
        if output_dir is None:
            output_dir = os.path.join(BASE_DIR, 'outputs')

        self.config_dir = config_dir
        self.output_dir = output_dir

        os.makedirs(self.output_dir, exist_ok=True)

        self.parser = FileParser()
        self.classifier = CaseClassifier(config_dir)
        self.extractor = ContentExtractor(config_dir)

    def generate(self, file_path: str, case_type_override: str = None,
                 doc_type_override: str = None, mode: str = "auto") -> Dict:
        """
        一键生成要素式文书

        Args:
            file_path: 输入文件路径 (txt/md/docx/pdf/图片)
            case_type_override: 手动指定案由
            doc_type_override: 手动指定文书类型
            mode: "auto" | "rule" | "ai"
                  "auto" - 自动选择提取策略（默认）
                  "rule" - 强制规则提取
                  "ai" - 标记为需要AI辅助提取（在 WorkBuddy 对话中使用）

        Returns:
            {
                "success": bool,
                "output_path": str,
                "case_type": str,
                "doc_type": str,
                "confidence": float,
                "element_data": dict,   # generate_docx 格式的结构化数据
                "errors": [str],
                "warnings": [str],
            }
        """
        result = {
            "success": False, "output_path": "", "case_type": "", "doc_type": "",
            "confidence": 0.0, "element_data": {},
            "errors": [], "warnings": [],
        }

        try:
            # ── Step 1: 解析文件 ──
            print(f"[1/5] 解析文件: {file_path}")
            text = self.parser.parse(file_path)
            if not text or not text.strip():
                result["errors"].append("文件内容为空")
                return result

            # ── Step 2: 识别案由和文书类型 ──
            print(f"[2/5] 识别案由和文书类型")
            if case_type_override:
                case_type = case_type_override
                doc_type = doc_type_override or self._infer_doc_type(text)
                confidence = 1.0
            else:
                case_type, doc_type, confidence = self.classifier.classify(text)
                if confidence < 0.3:
                    result["warnings"].append(
                        f"案由识别置信度较低({confidence})，建议人工确认"
                    )

            result["case_type"] = case_type
            result["doc_type"] = doc_type
            result["confidence"] = confidence

            if case_type == "未知":
                result["errors"].append("无法识别案由，请手动指定 --case-type")
                return result

            # ── Step 3: 提取关键要素 ──
            print(f"[3/5] 提取关键要素")
            extracted = self.extractor.extract(text, case_type, doc_type)

            # ── Step 4: 转换为 DOCX 生成格式 ──
            print(f"[4/5] 转换为 DOCX 格式")
            element_data = self._convert_to_tkk_format(extracted, case_type, doc_type)
            result["element_data"] = element_data

            # ── Step 5: 生成 DOCX ──
            print(f"[5/5] 生成要素式 DOCX")
            output_filename = self._generate_output_filename(case_type, doc_type)
            output_path = os.path.join(self.output_dir, output_filename)

            generate_docx(element_data, output_path)

            result["success"] = True
            result["output_path"] = output_path
            print(f"  → 生成成功: {output_path}")

        except Exception as e:
            result["errors"].append(f"生成失败: {str(e)}")
            import traceback
            traceback.print_exc()

        return result

    def generate_from_element_data(self, case_data: Dict, output_filename: str = None) -> Dict:
        """
        直接从 element 格式的 case_data 生成 DOCX。
        用于 WorkBuddy AI 对话中——AI 分析起诉状后构建 element_data JSON，
        然后调用此方法生成。

        Args:
            case_data: generate_docx.py 期望的 JSON 格式
                {
                    "caseTypeName": "民间借贷纠纷",
                    "plaintiffs": [...],
                    "defendants": [...],
                    "thirds": [...],
                    "agent": {...},
                    "claims": {...},
                    "facts": {...},
                    "jurisdiction": {...}
                }
            output_filename: 输出文件名（可选）

        Returns:
            {"success": bool, "output_path": str, "errors": [...], ...}
        """
        result = {
            "success": False, "output_path": "",
            "case_type": "", "errors": [],
        }

        try:
            case_type = case_data.get("caseTypeName", "未知")
            result["case_type"] = case_type

            if not output_filename:
                output_filename = self._generate_output_filename(case_type)
            output_path = os.path.join(self.output_dir, output_filename)

            generate_docx(case_data, output_path)

            result["success"] = True
            result["output_path"] = output_path

        except Exception as e:
            result["errors"].append(str(e))

        return result

    # ═══════════════════════════════════════════════════
    # 内部辅助方法
    # ═══════════════════════════════════════════════════

    def _infer_doc_type(self, text: str) -> str:
        _, doc_type, _ = self.classifier.classify(text)
        return doc_type

    def _generate_output_filename(self, case_type: str, doc_type: str = "要素式文书") -> str:
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        return f"{doc_type}-{case_type}_{timestamp}.docx"

    def _convert_to_tkk_format(self, extracted: Dict, case_type: str, doc_type: str) -> Dict:
        """
        将 ContentExtractor 的输出转换为 generate_docx.py 期望的格式

        TKK 期望的 JSON 结构:
        {
            "caseTypeName": "民间借贷纠纷",
            "caseTypeId": "mjjd",  (optional)
            "plaintiffs": [{"type": "natural", "name": "张三", ...}],
            "defendants": [{"type": "natural", "name": "李四", ...}],
            "thirds": [],  (optional)
            "agent": {"has": true, "name": "...", "firm": "...", "auth": "general"},
            "claims": {"claim_01": "1. 判令...", ...},
            "facts": {"facts_00": "...", ...},
            "jurisdiction": {"basis": "...", "mediation": "no", "preservation": "no", ...}
        }
        """
        parties = extracted.get("parties", {})
        case_specific = extracted.get("case_specific", {})
        checkboxes = extracted.get("checkboxes", [])

        # ── 当事人 ──
        plaintiffs = []
        plaintiff = parties.get("plaintiff", {})
        if plaintiff:
            if plaintiff.get("type") == "legal":
                plaintiffs.append({
                    "type": "org",
                    "name": plaintiff.get("name", ""),
                    "addr": plaintiff.get("address", ""),
                    "regAddr": plaintiff.get("register_addr", ""),
                    "legalRep": plaintiff.get("legal_person", ""),
                    "job": plaintiff.get("position", ""),
                    "phone": plaintiff.get("phone", ""),
                    "creditCode": plaintiff.get("credit_code", ""),
                    "orgType": plaintiff.get("org_type", ""),
                    "ownership": plaintiff.get("ownership", ""),
                })
            else:
                plaintiffs.append({
                    "type": "natural",
                    "name": plaintiff.get("name", ""),
                    "gender": plaintiff.get("gender", ""),
                    "birth": plaintiff.get("birthdate", ""),
                    "nation": plaintiff.get("ethnicity", ""),
                    "work": plaintiff.get("work_unit", ""),
                    "job": plaintiff.get("position", ""),
                    "phone": plaintiff.get("phone", ""),
                    "addr": plaintiff.get("address", ""),
                    "idNum": plaintiff.get("id_number", ""),
                    "habitual": plaintiff.get("residence", ""),
                })

        defendants = []
        defendant = parties.get("defendant", {})
        if defendant:
            if defendant.get("type") == "legal":
                defendants.append({
                    "type": "org",
                    "name": defendant.get("name", ""),
                    "addr": defendant.get("address", ""),
                    "regAddr": defendant.get("register_addr", ""),
                    "legalRep": defendant.get("legal_person", ""),
                    "job": defendant.get("position", ""),
                    "phone": defendant.get("phone", ""),
                    "creditCode": defendant.get("credit_code", ""),
                    "orgType": defendant.get("org_type", ""),
                    "ownership": defendant.get("ownership", ""),
                })
            else:
                defendants.append({
                    "type": "natural",
                    "name": defendant.get("name", ""),
                    "gender": defendant.get("gender", ""),
                    "birth": defendant.get("birthdate", ""),
                    "nation": defendant.get("ethnicity", ""),
                    "work": defendant.get("work_unit", ""),
                    "job": defendant.get("position", ""),
                    "phone": defendant.get("phone", ""),
                    "addr": defendant.get("address", ""),
                    "idNum": defendant.get("id_number", ""),
                    "habitual": defendant.get("residence", ""),
                })

        # 多个被告时（合伙企业、多名被告等）
        if "co_defendants" in parties:
            for cd in parties["co_defendants"]:
                if cd.get("type") == "legal":
                    defendants.append({
                        "type": "org",
                        "name": cd.get("name", ""),
                        "addr": cd.get("address", ""),
                        "legalRep": cd.get("legal_person", ""),
                        "phone": cd.get("phone", ""),
                        "creditCode": cd.get("credit_code", ""),
                    })
                else:
                    defendants.append({
                        "type": "natural",
                        "name": cd.get("name", ""),
                        "gender": cd.get("gender", ""),
                        "addr": cd.get("address", ""),
                        "idNum": cd.get("id_number", ""),
                    })

        # ── 第三人 ──
        thirds = parties.get("third_persons", [])

        # ── 代理人 ──
        agent_raw = parties.get("agent", {})
        agent = {
            "has": agent_raw.get("has_agent", False),
            "name": agent_raw.get("name", ""),
            "firm": agent_raw.get("unit", ""),
            "job": agent_raw.get("position", ""),
            "phone": agent_raw.get("phone", ""),
            "auth": agent_raw.get("authority", "general"),
        }

        # ── 诉讼请求 (转换为 claims 格式) ──
        claims = {}
        if case_specific.get("诉讼请求概括"):
            # 按序号分割
            request_text = case_specific["诉讼请求概括"]
            lines = request_text.split("\n")
            for i, line in enumerate(lines):
                line = line.strip()
                if line:
                    # 尝试添加序号
                    if not line[0].isdigit():
                        line = f"{i+1}. {line}"
                    claims[f"claim_{i+1:02d}"] = line
        elif case_specific.get("claims"):
            claims = case_specific["claims"]

        # ── 事实与理由 (转换为 facts 格式) ──
        facts = {}
        if case_specific.get("事实与理由概括"):
            facts_text = case_specific["事实与理由概括"]
            # 简单分段
            paragraphs = [p.strip() for p in facts_text.split("\n") if p.strip()]
            for i, para in enumerate(paragraphs):
                facts[f"facts_{i:02d}"] = para
        elif case_specific.get("facts"):
            facts = case_specific["facts"]

        # ── 管辖/调解 ──
        jurisdiction = {}
        if case_specific.get("管辖约定"):
            jurisdiction["basis"] = case_specific["管辖约定"]
        if case_specific.get("仲裁约定"):
            jurisdiction["arbitration"] = case_specific["仲裁约定"]
        jurisdiction["mediation"] = case_specific.get("是否考虑调解", "no")
        jurisdiction["preservation"] = case_specific.get("是否诉前保全", "no")

        # 签名日期
        sig = extracted.get("signature", {})
        if sig.get("date"):
            jurisdiction["date"] = sig["date"]

        return {
            "caseTypeName": case_type,
            "plaintiffs": plaintiffs,
            "defendants": defendants,
            "thirds": thirds,
            "agent": agent,
            "claims": claims,
            "facts": facts,
            "jurisdiction": jurisdiction,
        }


# ══════════════════════════════════════════════
# CLI 入口
# ══════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description='要素式文书一键生成器 v4')
    parser.add_argument('file', nargs='?', help='输入文书文件路径 (.txt/.md/.docx/.pdf/图片)')
    parser.add_argument('--output-dir', '-o', default=None, help='输出目录')
    parser.add_argument('--case-type', '-c', default=None, help='手动指定案由')
    parser.add_argument('--doc-type', '-d', default=None, help='手动指定文书类型')
    parser.add_argument('--config-dir', default=None, help='配置文件目录')
    parser.add_argument('--mode', '-m', default='auto', choices=['auto', 'rule', 'ai'],
                        help='提取模式: auto/rule/ai')
    parser.add_argument('--list-case-types', action='store_true', help='列出所有支持的案由')
    parser.add_argument('--json', default=None, help='直接用 element 格式 JSON 生成 DOCX')

    args = parser.parse_args()

    generator = ElementLawsuitGenerator(
        output_dir=args.output_dir,
        config_dir=args.config_dir,
    )

    # ── 列出支持的案由 ──
    if args.list_case_types:
        cases = generator.classifier.get_all_case_types()
        print(f"支持 {len(cases)} 个案由：")
        for cat in sorted(set(generator.classifier.get_category(c) for c in cases)):
            print(f"\n  [{cat}]")
            for ct in generator.classifier.get_case_types_by_category(cat):
                print(f"    - {ct}")
        return 0

    # ── 从 TKK JSON 直接生成 ──
    if args.tkk_json:
        with open(args.tkk_json, 'r', encoding='utf-8') as f:
            element_data = json.load(f)
        result = generator.generate_from_element_data(element_data)
        print(f"生成结果: {'成功' if result['success'] else '失败'}")
        if result['success']:
            print(f"  → {result['output_path']}")
        else:
            for e in result['errors']:
                print(f"  错误: {e}")
        return 0 if result['success'] else 1

    # ── 标准生成 ──
    if not args.file:
        parser.print_help()
        return 1

    result = generator.generate(
        args.file,
        case_type_override=args.case_type,
        doc_type_override=args.doc_type,
        mode=args.mode,
    )

    print("\n" + "=" * 60)
    print("生成结果")
    print("=" * 60)
    for k in ("success", "case_type", "doc_type", "confidence", "errors", "warnings"):
        print(f"  {k}: {result.get(k)}")
    if result["success"]:
        print(f"  output: {result['output_path']}")

    return 0 if result['success'] else 1


if __name__ == '__main__':
    sys.exit(main())
