#!/usr/bin/env python3
"""
decode_todo.py - 从 mcporter 返回的面试待办 JSON 中正确解码中文字段并输出可读文本。

用法：
    python3 decode_todo.py <input_json> [output_txt]

    input_json: mcporter call 返回的原始 JSON 文件路径
    output_txt: 可选，解码后的可读文本输出路径（默认为 input_json 同目录下 todo_decoded.txt）

背景：
    mcporter 返回的 JSON 是合法 UTF-8，但终端（Bash 工具）渲染时中文会显示为
    replacement character。本脚本正确解码后提取关键字段写入文本文件，
    之后用 Read 工具查看即可正确显示中文。

v1.0 - 2026-04-29
"""

import json
import os
import re
import sys


# 待办状态码映射
ORDER_STATE_MAP = {
    1: "待安排面试时间",
    2: "待确认面试时间",
    3: "待面试官接受",
    4: "待候选人接受",
    5: "面试已取消",
    6: "候选人已拒绝",
    7: "已过期未处理",
    8: "待开始面试",
    9: "面试进行中",
    10: "待填写面评",
    11: "已完成",
}

# 面试方式映射
INTERVIEW_FORM_MAP = {
    1: "现场面试",
    2: "电话面试",
    3: "面呗",
    4: "腾讯会议",
    5: "web版面呗",
    6: "牛客网",
    7: "其他",
}


def extract_todo(input_path: str, output_path: str | None = None) -> str:
    """从 mcporter JSON 中提取面试待办关键字段并写入可读文件。"""

    with open(input_path, "rb") as f:
        raw = f.read()

    text = raw.decode("utf-8")

    # 解析 JSON
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise ValueError(f"在 {input_path} 中未找到有效 JSON 对象")

    data = json.loads(m.group(0))

    # 穿透到业务数据
    todo_data = data.get("data", {}).get("data", {})
    items = todo_data.get("list", [])
    total = todo_data.get("total", 0)

    lines = [f"面试待办总数: {total}", ""]

    for i, item in enumerate(items, 1):
        state_id = item.get("orderStateId", 0)
        state_txt = ORDER_STATE_MAP.get(state_id, f"未知({state_id})")

        lines.append(f"=== 待办 {i} ===")
        lines.append(f"面试时间: {item.get('interviewTime', 'N/A')} ~ {item.get('interviewEndTime', 'N/A')}")
        interview_type = item.get("interviewType", 0)
        type_txt = "单面" if interview_type == 1 else "群面" if interview_type == 2 else "其他"
        lines.append(f"面试类型: {type_txt}")
        lines.append(f"面试人数: {item.get('interviewNum', 0)}")
        lines.append(f"待办状态: {state_txt}")
        lines.append(f"待办状态ID: {state_id}")

        for p in item.get("personList", []):
            lines.append(f"  候选人: {p.get('name', 'N/A')}")
            lines.append(f"  性别: {p.get('sex', 'N/A')}")
            lines.append(f"  学校: {p.get('school', 'N/A')}")
            lines.append(f"  专业: {p.get('speciality', 'N/A')}")
            lines.append(f"  岗位: {p.get('positionTxt', 'N/A')}")
            lines.append(f"  岗位全称: {p.get('positionFullTitle', 'N/A')}")
            lines.append(f"  部门: {p.get('departmentTxt', 'N/A')}")
            lines.append(f"  部门全称: {p.get('departmentFullName', 'N/A')}")
            lines.append(f"  BG: {p.get('bgName', 'N/A')}")
            lines.append(f"  招聘类型: {p.get('recruitTypeTxt', 'N/A')}")
            lines.append(f"  招聘年份: {p.get('recruitYear', 'N/A')}")
            lines.append(f"  环节: {p.get('stepName', 'N/A')}")
            lines.append(f"  面试时间: {p.get('interviewTimeStr', 'N/A')} ~ {p.get('interviewEndTimeStr', 'N/A')}")

            form_id = p.get("interviewForm", 0)
            form_txt = INTERVIEW_FORM_MAP.get(form_id, f"其他({form_id})")
            lines.append(f"  面试方式: {form_txt}")

            lines.append(f"  候选人回复: {p.get('msgReplyTxt', 'N/A')}")
            lines.append(f"  评价结果: {p.get('resultTxt', 'N/A')}")
            lines.append(f"  面评截止: {p.get('planEndTimeTxt', 'N/A')}")
            lines.append(f"  RID: {p.get('resumeRid', 'N/A')}")
            lines.append(f"  简历链接: https://zhaopin.woa.com/resume/campus/ResumeDetail?rid={p.get('resumeRid', '')}")

            video_url = p.get("videoUrl", "")
            if video_url:
                lines.append(f"  腾讯会议: {video_url}")
            meeting_code = p.get("meetingCode", "")
            if meeting_code:
                lines.append(f"  会议号: {meeting_code}")

            # 面试官信息
            interviewer_name = p.get("interviewerName", "")
            if interviewer_name:
                lines.append(f"  面试官: {interviewer_name}")

            # 候选人所在地
            cur_country = p.get("curCountry", "")
            cur_city = p.get("curCity", "")
            if cur_country or cur_city:
                lines.append(f"  候选人所在: {cur_country} {cur_city}")

        lines.append("")

    # 写入输出文件
    if output_path is None:
        output_path = os.path.join(os.path.dirname(input_path), "todo_decoded.txt")

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

    out = extract_todo(input_file, output_file)
    print(f"Done: {out}")
