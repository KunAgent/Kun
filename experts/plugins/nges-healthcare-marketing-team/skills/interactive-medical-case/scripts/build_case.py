#!/usr/bin/env python3
"""
互动病例构建脚本：把 case.json 注入 HTML 模板，生成单文件互动病例。

用法:
    python build_case.py <case.json> [-o output.html] [-t template.html]

校验 case.json 的结构后，将其作为 JSON 字面量替换模板中的 __CASE_DATA__ 占位符，
输出一个自包含、可直接在浏览器/手机打开的单文件 HTML。
"""
import json
import sys
import os
import argparse

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_TEMPLATE = os.path.join(HERE, "..", "assets", "template.html")


def validate(case):
    """对 case 做基础结构校验，返回 (errors, warnings)。"""
    errors, warnings = [], []

    if not isinstance(case, dict):
        return ["顶层必须是 JSON 对象"], []

    meta = case.get("meta") or {}
    if not meta.get("title"):
        errors.append("meta.title 缺失（病例标题，应为问句）")
    elif not any(c in meta["title"] for c in "?？"):
        warnings.append("meta.title 建议使用问句形式（聚焦诊疗决策点）")
    if not meta.get("intro"):
        warnings.append("meta.intro 缺失（导语）")

    patient = case.get("patient") or {}
    if not patient.get("basics"):
        warnings.append("patient.basics 缺失（患者基本信息）")

    questions = case.get("questions") or []
    if not questions:
        errors.append("questions 为空，至少需要 1 道互动题")
    if len(questions) > 5:
        warnings.append(f"questions 共 {len(questions)} 题，建议不超过 5 题")

    for i, q in enumerate(questions, 1):
        tag = f"questions[{i}]"
        if not q.get("stem"):
            errors.append(f"{tag}.stem 缺失（题干）")
        opts = q.get("options") or []
        if len(opts) < 2:
            errors.append(f"{tag}.options 至少需要 2 个选项")
        keys = [o.get("key") for o in opts]
        if len(keys) != len(set(keys)):
            errors.append(f"{tag}.options 存在重复的 key")
        correct_opts = [o.get("key") for o in opts if o.get("concept") == "correct"]
        if not correct_opts:
            errors.append(f"{tag} 没有任何 concept=correct 的选项（每题至少 1 个正确观念）")
        declared = q.get("correct") or []
        if declared and set(declared) != set(correct_opts):
            warnings.append(f"{tag}.correct {declared} 与标注 concept=correct 的选项 {correct_opts} 不一致")
        if q.get("type") == "single" and len(correct_opts) > 1:
            warnings.append(f"{tag} 为单选题但有多个 correct 选项")
        ev = q.get("evidence") or {}
        if not ev.get("points"):
            warnings.append(f"{tag}.evidence.points 缺失（循证要点，建议补充指南/文献依据）")
        for o in opts:
            if o.get("concept") not in ("correct", "partial", "miss", "wrong", "open", None):
                warnings.append(f"{tag} 选项 {o.get('key')} 的 concept='{o.get('concept')}' 不在规范取值内")

    summary = case.get("summary") or {}
    if not summary.get("analysis"):
        warnings.append("summary.analysis 缺失（方案解析综合点评）")

    source = case.get("source") or {}
    if not source.get("disclaimer"):
        warnings.append("source.disclaimer 缺失（免责声明），将使用默认声明")

    return errors, warnings


def build(case_path, out_path=None, template_path=None):
    template_path = template_path or DEFAULT_TEMPLATE
    template_path = os.path.abspath(template_path)

    with open(case_path, "r", encoding="utf-8") as f:
        case = json.load(f)

    errors, warnings = validate(case)
    for w in warnings:
        print(f"  ⚠️  {w}")
    if errors:
        print("\n❌ 校验未通过，请修正以下问题：")
        for e in errors:
            print(f"   - {e}")
        sys.exit(1)

    with open(template_path, "r", encoding="utf-8") as f:
        template = f.read()

    if "__CASE_DATA__" not in template:
        print("❌ 模板中未找到 __CASE_DATA__ 占位符")
        sys.exit(1)

    # 用 json.dumps 生成安全的 JS 字面量；转义 </script 防止提前闭合
    data_js = json.dumps(case, ensure_ascii=False)
    data_js = data_js.replace("</", "<\\/")
    html = template.replace("__CASE_DATA__", data_js)

    if not out_path:
        base = os.path.splitext(os.path.basename(case_path))[0]
        out_path = os.path.join(os.path.dirname(os.path.abspath(case_path)), base + ".html")

    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html)

    print(f"\n✅ 已生成互动病例：{out_path}")
    print(f"   标题：{case.get('meta', {}).get('title', '')}")
    print(f"   互动题数：{len(case.get('questions', []))}")
    return out_path


def main():
    ap = argparse.ArgumentParser(description="把 case.json 构建为单文件互动病例 HTML")
    ap.add_argument("case", help="病例数据 JSON 文件路径")
    ap.add_argument("-o", "--output", help="输出 HTML 路径（默认与 case.json 同目录同名）")
    ap.add_argument("-t", "--template", help="自定义模板路径（默认 assets/template.html）")
    args = ap.parse_args()
    build(args.case, args.output, args.template)


if __name__ == "__main__":
    main()
