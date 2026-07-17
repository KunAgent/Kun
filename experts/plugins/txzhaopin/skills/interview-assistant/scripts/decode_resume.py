#!/usr/bin/env python3
"""
decode_resume.py - 从 mcporter 返回的原始 JSON 中正确解码中文字段并输出可读文本。

用法：
    python3 decode_resume.py <input_json> [output_txt]

    input_json: mcporter call 返回的原始 JSON 文件路径
    output_txt: 可选，解码后的可读文本输出路径（默认为 input_json 同目录下 resume_decoded.txt）

背景：
    mcporter 返回的 JSON 是合法 UTF-8，但终端（Bash 工具）渲染时中文会显示为 ���（Unicode
    replacement character）。直接从终端输出读取中文内容会导致关键字段（公司名/岗位名/专业名/
    描述文字等）全部丢失，进而可能被错误推断。

    本脚本的作用是：读取原始 JSON → 正确解码 → 提取关键字段 → 写入文本文件。
    之后用 Read 工具查看该文本文件即可正确显示中文。

v1.0 - 2026-04-28
"""

import json
import os
import re
import sys


def extract_resume(input_path: str, output_path: str | None = None) -> str:
    """从 mcporter JSON 中提取简历关键字段并写入可读文件。"""

    with open(input_path, "rb") as f:
        raw = f.read()

    # 尝试 UTF-8 解码
    text = raw.decode("utf-8")

    # 解析 JSON（mcporter 输出可能包含前缀文本，用正则定位 JSON 对象）
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise ValueError(f"在 {input_path} 中未找到有效 JSON 对象")

    data = json.loads(m.group(0))

    # 穿透到业务 payload。
    # 不同 mcporter / MCP 包装版本可能是 data.data 或 data.data.data：
    # - 若 data.data 直接包含 resumeInfo，则它就是 payload
    # - 若 data.data.data 才包含 resumeInfo，则继续下钻一层
    payload = data.get("data", {}).get("data", {})
    if isinstance(payload, dict) and "data" in payload and "resumeInfo" not in payload:
        payload = payload.get("data") or {}
    if not isinstance(payload, dict):
        raise ValueError("未找到有效的业务 payload，请检查接口返回结构")

    info = payload.get("resumeInfo", {})
    qa = payload.get("qualityAssessment") or {}
    records = (payload.get("interviewRecords") or {}).get("list", [])

    lines = []

    # === 基本信息 ===
    lines.append("=== 基本信息 ===")
    lines.append(f"姓名: {info.get('name', 'N/A')}")
    lines.append(f"性别: {info.get('sex', 'N/A')}")
    lines.append(f"专业: {info.get('speciality', 'N/A')}")
    lines.append(f"最高学历: {info.get('highest_education', 'N/A')}")
    lines.append(f"最高学校: {info.get('highest_school', 'N/A')}")
    lines.append(f"投递岗位: {info.get('station_txt', 'N/A')}")
    lines.append(f"BG: {info.get('bg_txt', 'N/A')}")
    lines.append(f"期望城市: {info.get('expect_work_city_txt', 'N/A')}")
    lines.append(f"标签: {info.get('tagTxtList', [])}")
    lines.append(f"毕业时间: {info.get('graduate_time', 'N/A')}")
    lines.append(f"IELTS/语言: {info.get('foreign_language_txt', '')} {info.get('foreign_language_score', '')}")
    lines.append("")

    # === 面试记录 ===
    if records:
        rec = records[0]
        lines.append("=== 面试记录 ===")
        lines.append(f"当前面试官: {rec.get('current_staff_txt', 'N/A')}")
        lines.append(f"投递部门: {rec.get('department_txt', 'N/A')}")
        lines.append(f"投递岗位(面试记录): {rec.get('position_txt', 'N/A')}")
        lines.append(f"BG: {rec.get('bg_txt', 'N/A')}")
        flows = rec.get("flows") or []
        if flows:
            lines.append("流转记录:")
            for flow in flows:
                lines.append(
                    f"  {flow.get('step_txt', '?')} | "
                    f"{flow.get('staff_txt', '?')} | "
                    f"{flow.get('result_txt', '?')}"
                )
        lines.append("")

    # === 教育经历 ===
    lines.append("=== 教育经历 ===")
    for edu in (info.get("education_list") or []):
        lines.append(
            f"学校: {edu.get('school', 'N/A')} | "
            f"学历: {edu.get('edu_txt', 'N/A')} | "
            f"专业: {edu.get('speciality', 'N/A')} | "
            f"排名: {edu.get('school_rank_txt', 'N/A')}"
        )
    lines.append("")

    # === 实习经历 ===
    lines.append("=== 实习经历 ===")
    for exp in (info.get("resume_intern_exp") or []):
        lines.append(f"公司: {exp.get('employer_name', 'N/A')}")
        lines.append(f"岗位: {exp.get('position_title', 'N/A')}")
        lines.append(f"时间: {exp.get('work_start_date_str', '?')} ~ {exp.get('work_end_date_str', '?')}")
        lines.append(f"描述: {exp.get('work_summary', '')}")
        lines.append("")

    # === 项目经历 ===
    lines.append("=== 项目经历 ===")
    for proj in (info.get("resume_project") or []):
        lines.append(f"项目: {proj.get('project_name', 'N/A')} | 角色: {proj.get('proj_role', 'N/A')}")
        lines.append(f"时间: {proj.get('proj_start_date_str', '?')} ~ {proj.get('proj_end_date_str', '至今')}")
        lines.append(f"描述: {proj.get('proj_summary', '')}")
        lines.append("")

    # === 获奖 ===
    prizes = info.get("resumePrizes")
    if prizes:
        lines.append("=== 获奖信息 ===")
        for p in prizes:
            lines.append(f"- {p}")
        lines.append("")

    # === other_info ===
    other = info.get("other_info", "")
    if other:
        lines.append("=== 自我描述 / other_info ===")
        lines.append(other)
        lines.append("")

    # === 技能标签 ===
    lines.append("=== 技能标签 ===")
    lines.append(f"技能: {info.get('skillTag', [])}")
    lines.append(f"开发语言: {info.get('dev_language', [])}")
    lines.append(f"AI技能: {info.get('ai_skill', 'N/A')}")
    lines.append("")

    # === 测评数据 ===
    lines.append("=== 测评数据（档位 1=低/2=中/3=高，仅 1 档需预警） ===")
    lines.append(f"异常答题数: {qa.get('answerExceptionCount', 'N/A')}")
    results = qa.get("qualityAssessmentResults") or []
    tier_map = {1: "低⚠️预警", 2: "中", 3: "高"}
    if results:
        has_warn = False
        for dim in results:
            r = dim.get('result')
            tag = tier_map.get(r, f"档位{r}")
            if r == 1:
                has_warn = True
            lines.append(f"{dim['dimensionName']}: 档位 {r}（{tag}）")
            for child in dim.get("childDimensions") or []:
                cr = child.get('result')
                ctag = tier_map.get(cr, f"档位{cr}")
                if cr == 1:
                    has_warn = True
                lines.append(f"  └ {child['dimensionName']}: 档位 {cr}（{ctag}）")
        lines.append("")
        if has_warn:
            lines.append("⚠️ 存在档位 1（低）维度，面试计划 Part 3 应生成针对性验证题")
        else:
            lines.append("✅ 所有维度 ≥ 档位 2，测评无预警，本轮不作为判断依据")
        lines.append("ℹ️ 原始分（1-10 尺度）仅在招活前端 PDF 报告，MCP 接口不返回")
    else:
        lines.append("⚠️ 无测评数据")
    lines.append("")

    # === 简历漂亮数字扫描 ===
    lines.append("=== 简历漂亮数字扫描 ===")
    text_pool = []
    for exp in (info.get("resume_intern_exp") or []):
        text_pool.append(exp.get("work_summary", ""))
    for proj in (info.get("resume_project") or []):
        text_pool.append(proj.get("proj_summary", ""))
    text_pool.append(info.get("other_info", ""))

    all_text = "\n".join(text_pool)
    numbers = re.findall(r"\d[\d,]*\.?\d*\s*[%x倍万w+]|\d{3,}[\d,]*", all_text)
    if numbers:
        for n in numbers:
            lines.append(f"- {n.strip()}")
    else:
        lines.append("⚠️ 未找到可抽查数字")

    # 写入输出文件
    if output_path is None:
        output_path = os.path.join(os.path.dirname(input_path), "resume_decoded.txt")

    content = "\n".join(lines)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(content)

    return output_path


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(f"用法: {sys.argv[0]} <input_json> [output_txt]")
        sys.exit(1)

    input_file = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else None

    out = extract_resume(input_file, output_file)
    print(f"✅ 解码完成，已写入: {out}")
