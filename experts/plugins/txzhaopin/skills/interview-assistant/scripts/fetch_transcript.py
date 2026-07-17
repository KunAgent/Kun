#!/usr/bin/env python3
"""
fetch_transcript.py — 一键从招活拉面试转写

接口（校招）：recruit.interview-arrange-campus.get_interview_trace_record (GET, recruit-mcp)
接口（社招）：recruit.interview-arrange.get_interview_trace_record          (GET, recruit-mcp)
输入：traceId（即 T 待办 personList[].flowTraceId，必须 string）
输出：
  - transcript_raw.json  招活原始返回
  - transcript.txt       人类可读纯文本（[HH:MM:SS] user: content 一行一句）

用法：
  # 校招：直接给 traceId（最常见，--recruit-type 默认 campus）
  python3 fetch_transcript.py --trace-id <TRACE_ID> \
      --out-dir /tmp \
      --prefix candidate

  # 社招：显式指定 --recruit-type social
  python3 fetch_transcript.py --trace-id 123456 \
      --recruit-type social \
      --out-dir /tmp \
      --prefix zhang_san

  # 从 T 待办文件中按候选人姓名找 traceId 后再拉
  python3 fetch_transcript.py --todo-file /tmp/todo_raw.json \
      --candidate <候选人姓名> \
      --out-dir /tmp

  # 同时给定 mcporter 路径（CI / 非默认 PATH 环境）
  python3 fetch_transcript.py --trace-id <TRACE_ID> \
      --mcporter /opt/homebrew/bin/mcporter \
      --out-dir /tmp

依赖：
  - mcporter（在 PATH 中或 --mcporter 指定）
  - recruit-mcp 已配置且 token 有效

退出码：
  0 = 成功
  1 = 参数错误
  2 = mcporter 调用失败
  3 = 转写为空（接口返回 OK 但无数据，常见于"开会未开转写"）
  4 = 鉴权失败 / 接口不可用

作者：interview-assistant skill / 2026-05-14 v1.0 / 2026-06-12 v1.1 新增社招支持
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path


def find_mcporter(explicit: str | None) -> str:
    if explicit:
        if not Path(explicit).exists():
            print(f"❌ --mcporter 指定的路径不存在：{explicit}", file=sys.stderr)
            sys.exit(1)
        return explicit
    found = shutil.which("mcporter")
    if not found:
        print("❌ 找不到 mcporter，请用 --mcporter 显式指定", file=sys.stderr)
        sys.exit(1)
    return found


def load_todo_and_find_trace(todo_file: Path, candidate_name: str) -> tuple[str, str]:
    """从 T 待办文件中按候选人姓名找出 (flowTraceId, 候选人全名)"""
    raw = todo_file.read_bytes().decode("utf-8", errors="replace")
    # 直接尝试 json.loads；失败再用括号扫描
    data = None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        start = raw.find("{")
        if start >= 0:
            depth = in_str = esc = 0
            for i, ch in enumerate(raw[start:], start):
                if in_str:
                    if esc: esc = 0
                    elif ch == "\\": esc = 1
                    elif ch == '"': in_str = 0
                else:
                    if ch == '"': in_str = 1
                    elif ch == "{": depth += 1
                    elif ch == "}":
                        depth -= 1
                        if depth == 0:
                            try: data = json.loads(raw[start:i+1]); break
                            except: pass
    if data is None:
        print(f"❌ 无法从 {todo_file} 解析 JSON", file=sys.stderr)
        sys.exit(1)
    todos = data.get("data", {}).get("data", {}).get("list", [])
    # 兼容两种结构：①待办 list[].personList[]（候选人在 personList 里）；②已办 list[]（候选人字段直接在顶层，无 personList）
    for t in todos:
        persons = t.get("personList")
        candidates = persons if persons else [t]  # 已办无 personList，t 本身即候选人记录
        for p in candidates:
            name = p.get("name", "") or ""
            if name and (candidate_name in name or name in candidate_name):
                trace = p.get("flowTraceId")
                if trace is None:
                    print(f"❌ 找到候选人 {name} 但记录内无 flowTraceId", file=sys.stderr)
                    sys.exit(1)
                return str(trace), name
    print(f"❌ 在 {todo_file} 中找不到候选人「{candidate_name}」", file=sys.stderr)
    print("   提示：若候选人有多轮面试且面试已结束，请改用已办列表 get_campus_interview_done_list；", file=sys.stderr)
    print("   候选人若有多场(≥3)或面试过很多次，先让用户确认要写哪一场面评，再针对性拉，勿盲目遍历全部历史场次（见 D-evaluation.md D-1.1）。", file=sys.stderr)
    sys.exit(1)


def fetch_trace(mcporter: str, trace_id: str, out_raw: Path, recruit_type: str = "campus") -> dict:
    """调 mcporter 拉转写，写入 out_raw 并返回解析后的 dict

    recruit_type:
      - "campus" → recruit.interview-arrange-campus.get_interview_trace_record（校招）
      - "social" → recruit.interview-arrange.get_interview_trace_record（社招）
    """
    api_map = {
        "campus": "recruit.interview-arrange-campus.get_interview_trace_record",
        "social": "recruit.interview-arrange.get_interview_trace_record",
    }
    api_id = api_map.get(recruit_type)
    if api_id is None:
        print(f"❌ 不支持的 recruit_type: {recruit_type}，可选 campus / social", file=sys.stderr)
        sys.exit(1)

    params = json.dumps({"traceId": str(trace_id)}, ensure_ascii=False)
    cmd = [
        mcporter, "call", "recruit-mcp", "CallAPI",
        f"apiId={api_id}",
        f"params={params}",
    ]
    # 直接把 stdout 重定向到文件，避免 pipe buffer 截断（mcporter 输出可能 >64KB）
    try:
        with out_raw.open("wb") as f:
            result = subprocess.run(
                cmd, stdout=f, stderr=subprocess.PIPE, timeout=120, check=False
            )
    except subprocess.TimeoutExpired:
        print("❌ mcporter 调用超时（120s）", file=sys.stderr)
        sys.exit(2)

    if result.returncode != 0:
        stderr = (result.stderr or b"").decode("utf-8", errors="replace")
        print(f"❌ mcporter 调用失败 (rc={result.returncode}): {stderr[:500]}", file=sys.stderr)
        sys.exit(2)

    text = out_raw.read_bytes().decode("utf-8", errors="replace")
    # 优先直接 json.loads（mcporter 输出整体就是一个 JSON 对象）
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # 兜底：用平衡括号扫描提取最外层 JSON 对象（避免 re 贪婪在大文档上失败）
    start = text.find("{")
    if start < 0:
        print(f"❌ 接口返回不是 JSON：{text[:500]}", file=sys.stderr)
        sys.exit(2)
    depth = 0
    in_str = False
    esc = False
    end = -1
    for i, ch in enumerate(text[start:], start):
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
        else:
            if ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    end = i + 1
                    break
    if end < 0:
        print(f"❌ JSON 解析失败：未找到匹配的 }}（mcporter 输出可能被截断，长度={len(text)}）", file=sys.stderr)
        sys.exit(2)
    try:
        return json.loads(text[start:end])
    except json.JSONDecodeError as e:
        print(f"❌ JSON 解析失败：{e}", file=sys.stderr)
        sys.exit(2)


def normalize_to_text(payload: dict, out_txt: Path) -> int:
    """提取转写并写入 transcript.txt，返回行数"""
    if payload.get("success") is False:
        code = payload.get("errorCode", "")
        msg = payload.get("errorMessage", "")
        if "AUTH" in code or "PERMISSION" in code:
            print(f"❌ 鉴权失败：{code} — {msg}", file=sys.stderr)
            sys.exit(4)
        if "VALIDATION" in code:
            print(f"❌ 参数错误：{code} — {msg}", file=sys.stderr)
            print("   提示：traceId 必须是 string，且来源于 T 待办 personList[].flowTraceId", file=sys.stderr)
            sys.exit(1)
        print(f"❌ 接口失败：{code} — {msg}", file=sys.stderr)
        sys.exit(2)

    # 内层业务 code（招活接口的真实状态在 payload.data.code，而非外层）
    inner = payload.get("data") or {}
    inner_code = str(inner.get("code", ""))
    inner_msg = inner.get("message", "")
    # code 1018 = 面试待办不存在或已失效（该 traceId 轮次/流程作废，换轮次重拉）
    if inner_code == "1018":
        print(f"⚠️  该 traceId 轮次已失效（code 1018：{inner_msg or '面试待办不存在或已失效'}）。", file=sys.stderr)
        print("   这不是'没有转写'——很可能该候选人有多轮/多流程，此 traceId 指向的轮次作废了。", file=sys.stderr)
        print("   ✅ 解决：从 get_campus_interview_done_list 查该候选人的记录定位目标场次的 flowTraceId 重拉。", file=sys.stderr)
        print("      转写只挂在某一具体轮次（实测一候选人 4 个 traceId 仅 1 个有数百条转写）。", file=sys.stderr)
        print("      ⚠️ 候选人有多场(≥3)或面过很多次时，先让用户确认要写哪一场面评，勿盲目遍历全部历史场次。", file=sys.stderr)
        out_txt.write_text("(traceId invalid - code 1018, locate target round)\n", encoding="utf-8")
        sys.exit(3)

    items = (payload.get("data") or {}).get("data") or []
    if isinstance(items, dict):
        items = items.get("data") or []

    if not items:
        print("⚠️  接口返回成功但转写为空（data:[]）。注意：这不一定是'没有转写'！", file=sys.stderr)
        print("   排查顺序（详见 D-evaluation.md D-1.1）：", file=sys.stderr)
        print("   1) traceId 可能对准了错误轮次——候选人多轮面试时，待办的 flowTraceId 指向当前待办轮次，", file=sys.stderr)
        print("      而转写挂在已完成的那一轮。已结束的候选人改从 get_campus_interview_done_list 取 flowTraceId 重拉。", file=sys.stderr)
        print("   2) 转写可能仍在生成——面试刚结束不久(<30~60min)时 ASR 还没生成完，可稍后重试。", file=sys.stderr)
        print("   3) 确认面试是否真的已结束（用 date 取当前时间正确比较，勿心算）。", file=sys.stderr)
        print("   排查后仍为空，才走腾讯会议/手工粘贴兜底。", file=sys.stderr)
        out_txt.write_text("(empty transcript)\n", encoding="utf-8")
        sys.exit(3)

    lines: list[str] = []
    for it in items:
        speak_ts = it.get("speakTime")
        if speak_ts is None:
            continue
        try:
            t = datetime.fromtimestamp(int(speak_ts) / 1000).strftime("%H:%M:%S")
        except Exception:
            t = "?"
        user = it.get("userId") or "?"
        content = (it.get("content") or "").strip()
        if content:
            lines.append(f"[{t}] {user}: {content}")

    out_txt.write_text("\n".join(lines), encoding="utf-8")
    return len(lines)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--trace-id", help="flowTraceId（招活转写 traceId，string 类型）")
    g.add_argument("--todo-file", type=Path, help="T 待办原始 JSON 文件（用于按候选人姓名查 traceId）")
    p.add_argument("--candidate", help="候选人姓名（与 --todo-file 配合使用）")
    p.add_argument("--mcporter", help="mcporter 可执行文件路径（默认从 PATH 找）")
    p.add_argument("--recruit-type", choices=["campus", "social"], default="campus",
                   help="招聘类型：campus=校招（默认），social=社招。决定调用哪个转写接口")
    p.add_argument("--out-dir", type=Path, default=Path(os.environ.get("TMP_DIR", "/tmp")),
                   help="输出目录（默认 $TMP_DIR 或 /tmp）")
    p.add_argument("--prefix", default="transcript", help="输出文件名前缀（默认 transcript）")
    args = p.parse_args()

    if args.todo_file and not args.candidate:
        p.error("--todo-file 必须配合 --candidate 使用")

    args.out_dir.mkdir(parents=True, exist_ok=True)
    mcporter = find_mcporter(args.mcporter)

    if args.todo_file:
        trace_id, full_name = load_todo_and_find_trace(args.todo_file, args.candidate)
        print(f"📋 命中候选人：{full_name}（traceId={trace_id}）")
    else:
        trace_id = str(args.trace_id)
        full_name = ""

    out_raw = args.out_dir / f"{args.prefix}_raw.json"
    out_txt = args.out_dir / f"{args.prefix}.txt"

    print(f"⏳ 调招活转写接口（traceId={trace_id}, recruit_type={args.recruit_type}）...")
    payload = fetch_trace(mcporter, trace_id, out_raw, recruit_type=args.recruit_type)

    n = normalize_to_text(payload, out_txt)
    print(f"✅ 完成：{n} 行转写")
    print(f"   原始：{out_raw}")
    print(f"   文本：{out_txt}")


if __name__ == "__main__":
    main()
