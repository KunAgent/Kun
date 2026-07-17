#!/usr/bin/env python3
"""
SuperSQL 知识检索工具。

兼容调用方式：
```bash
python scripts/retriever.py --query "xxx"
```

扩展调用方式：
```bash
python scripts/retriever.py --log-text "完整报错日志"
python scripts/retriever.py --log-file /path/to/error.log
```
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import cast

import requests


API_URL = "http://dev.llmapp.woa.com/api/v1/chatflows/b2d581f6-d0ef-495b-a6d5-642cf46e91b0/prediction"
DEFAULT_TYPE = "sop"
# 当前知识库后端仅支持 sop；后续后端扩展后可追加 "spark", "presto", "starrocks" 等
SUPPORTED_TYPES = {"sop"}
REQUEST_TIMEOUT = 15
PRIORITY_KEYWORDS = ("org.apache.calcite", "CalciteContextException", "SuperSQL")
ERROR_HINT_PATTERN = re.compile(
    r"(exception|error|failed|failure|denied|unauthorized|timeout|not found|invalid|mismatch)",
    re.IGNORECASE,
)
STACK_FRAME_PATTERN = re.compile(r"^at\s+[\w.$_]+\(.*\)$")
JsonDict = dict[str, object]


def _ensure_dict(value: object) -> JsonDict:
    if isinstance(value, dict):
        return cast(JsonDict, value)
    raise RuntimeError("知识库服务返回的数据结构不是对象")


def normalize_type(knowledge_type: str) -> str:
    """标准化知识类型参数。"""
    normalized = (knowledge_type or DEFAULT_TYPE).strip().lower()
    if normalized not in SUPPORTED_TYPES:
        raise ValueError(f"输入的 type 不存在，仅支持：{', '.join(sorted(SUPPORTED_TYPES))}")
    return normalized


def _normalize_text(text: str) -> str:
    # 兼容 CLI 传参时 \n 未被 shell 解析为换行符的情况
    result = text.replace("\\n", "\n").replace("\\r\\n", "\n").replace("\\r", "\n")
    return result.replace("\r\n", "\n").replace("\r", "\n").strip()


def _looks_like_stack_frame(line: str) -> bool:
    stripped = line.strip()
    return stripped.startswith("at ") or bool(STACK_FRAME_PATTERN.match(stripped))


def _sanitize_error_line(line: str) -> str:
    cleaned = line.strip()
    cleaned = re.sub(r"^\[[^\]]+\]\s*", "", cleaned)
    cleaned = re.sub(r"^\d+[.)]\s*", "", cleaned)
    cleaned = re.sub(r"^(ERROR|WARN|INFO|DEBUG)\s*[:|-]?\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"^Caused by:\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip(" -:")


def _collect_candidate_lines(lines: list[str]) -> list[str]:
    candidates: list[str] = []
    for line in lines:
        stripped = line.strip()
        if not stripped or _looks_like_stack_frame(stripped):
            continue
        if stripped == "...":
            continue
        if "Caused by:" in stripped or any(keyword in stripped for keyword in PRIORITY_KEYWORDS):
            candidates.append(stripped)
            continue
        if ERROR_HINT_PATTERN.search(stripped):
            candidates.append(stripped)
    return candidates


def extract_key_error(log_text: str) -> str:
    """
    从原始报错日志中提炼最关键的错误信息，用作知识库 query。
    """
    text = _normalize_text(log_text)
    if not text:
        return ""

    lines = [line for line in text.split("\n") if line.strip()]
    priority_indices = [
        index for index, line in enumerate(lines) if any(keyword in line for keyword in PRIORITY_KEYWORDS)
    ]

    if priority_indices:
        start = max(0, priority_indices[0] - 2)
        end = min(len(lines), priority_indices[0] + 20)
        window = lines[start:end]
        caused_by_lines = [
            _sanitize_error_line(line) for line in window if "Caused by:" in line and _sanitize_error_line(line)
        ]
        if caused_by_lines:
            return caused_by_lines[-1]

        priority_candidates = [
            _sanitize_error_line(line) for line in _collect_candidate_lines(window) if _sanitize_error_line(line)
        ]
        if priority_candidates:
            return priority_candidates[-1]

    caused_by_lines = [
        _sanitize_error_line(line) for line in lines if "Caused by:" in line and _sanitize_error_line(line)
    ]
    if caused_by_lines:
        return caused_by_lines[-1]

    numbered_fragments: list[str] = cast(
        list[str], re.findall(r"^\s*(?:\[\d+\]|\d+[.)])\s*(.+)$", text, re.MULTILINE)
    )
    for fragment in numbered_fragments:
        cleaned = _sanitize_error_line(fragment)
        if cleaned:
            return cleaned

    generic_candidates = [
        _sanitize_error_line(line) for line in _collect_candidate_lines(lines) if _sanitize_error_line(line)
    ]
    if generic_candidates:
        return generic_candidates[0]

    fallback = re.sub(r"\s+", " ", text)
    return fallback[:300]


def retriever(query: str, type: str = DEFAULT_TYPE, goal: str = "") -> str:
    """
    根据 query、type、goal 调用知识库服务，返回原始 observation 字符串。
    """
    normalized_query = re.sub(r"\s+", " ", (query or "")).strip()
    if not normalized_query:
        raise ValueError("query is empty")

    query_type = normalize_type(type)
    input_json = {
        "query": normalized_query,
        "type": query_type,
        "goal": goal,
    }
    payload = {
        "question": json.dumps(input_json, ensure_ascii=False),
    }

    try:
        response = requests.post(API_URL, json=payload, timeout=REQUEST_TIMEOUT)
        response.raise_for_status()
    except requests.RequestException as exc:
        raise RuntimeError(f"知识库服务调用失败: {exc}") from exc

    try:
        payload_obj = cast(object, response.json())
    except ValueError as exc:
        raise RuntimeError("知识库服务返回了非 JSON 数据") from exc

    output = _ensure_dict(payload_obj)
    data = output.get("data")
    data_dict: JsonDict = cast(JsonDict, data) if isinstance(data, dict) else {}
    observation = data_dict.get("observation", "")
    if observation is None:
        return ""
    return str(observation).strip()


def _normalize_result_item(item: JsonDict) -> JsonDict:
    title = str(item.get("title") or item.get("location") or item.get("source") or "")
    content = item.get("content")
    normalized_content = "" if content in (None, "nan") else str(content)
    score = item.get("score")

    normalized: JsonDict = {
        "title": title,
        "content": normalized_content,
        "score": score,
    }
    for key in ("source", "url", "location"):
        if key in item:
            normalized[key] = item[key]
    return normalized


def parse_observation(observation: str) -> list[JsonDict]:
    """将知识库 observation 解析为结构化结果。"""
    if not observation:
        return []

    stripped = observation.strip()
    results: list[JsonDict] = []

    if stripped.startswith("[") or stripped.startswith("{"):
        try:
            parsed_obj = cast(object, json.loads(stripped))
            if isinstance(parsed_obj, list):
                normalized_items: list[JsonDict] = []
                for item_obj in cast(list[object], parsed_obj):
                    if isinstance(item_obj, dict):
                        normalized_items.append(_normalize_result_item(cast(JsonDict, item_obj)))
                return normalized_items
            if isinstance(parsed_obj, dict):
                return [_normalize_result_item(cast(JsonDict, parsed_obj))]
        except json.JSONDecodeError:
            pass

    for line in stripped.splitlines():
        current = line.strip()
        if not current:
            continue
        match = re.search(r"(\{.*\})", current)
        if not match:
            continue
        try:
            parsed_line_obj = cast(object, json.loads(match.group(1)))
        except json.JSONDecodeError:
            continue
        if isinstance(parsed_line_obj, dict):
            results.append(_normalize_result_item(cast(JsonDict, parsed_line_obj)))

    if results:
        return results

    return [{"title": "", "content": stripped, "score": None}]


def search_knowledge(query: str, type: str = DEFAULT_TYPE, goal: str = "") -> list[JsonDict]:
    """检索知识库并返回结构化结果。"""
    observation = retriever(query=query, type=type, goal=goal)
    return parse_observation(observation)


def retrieve_from_log(log_text: str, type: str = DEFAULT_TYPE, goal: str = "") -> JsonDict:
    """从原始日志中提炼 query 并完成知识检索。"""
    query = extract_key_error(log_text)
    observation = retriever(query=query, type=type, goal=goal)
    return {
        "query": query,
        "type": normalize_type(type),
        "goal": goal,
        "raw_observation": observation,
        "results": parse_observation(observation),
    }


def build_query(query: str | None = None, log_text: str | None = None) -> str:
    """统一根据 query 或日志生成检索 query。"""
    if query:
        normalized_query = re.sub(r"\s+", " ", query).strip()
        if normalized_query:
            return normalized_query
    if log_text:
        extracted = extract_key_error(log_text)
        if extracted:
            return extracted
    raise ValueError("必须提供 --query、--log-text 或 --log-file 之一")


def main() -> int:
    parser = argparse.ArgumentParser(description="SuperSQL 知识检索工具")
    source_group = parser.add_mutually_exclusive_group(required=True)
    _ = source_group.add_argument("--query", help="已经提炼好的错误信息 query")
    _ = source_group.add_argument("--log-text", help="原始报错日志文本")
    _ = source_group.add_argument("--log-file", help="包含原始报错日志的文件路径")
    _ = parser.add_argument("--type", default=DEFAULT_TYPE, help="知识库类型，默认 sop")
    _ = parser.add_argument("--goal", default="", help="检索目标描述")
    _ = parser.add_argument("--query-only", action="store_true", help="仅输出提炼后的 query")
    _ = parser.add_argument("--raw", action="store_true", help="输出原始 observation，不做结构化解析")
    args = parser.parse_args()

    try:
        query_arg = cast(str | None, getattr(args, "query"))
        log_text_arg = cast(str | None, getattr(args, "log_text"))
        log_file_arg = cast(str | None, getattr(args, "log_file"))
        type_arg = cast(str, getattr(args, "type"))
        goal_arg = cast(str, getattr(args, "goal"))
        query_only = cast(bool, getattr(args, "query_only"))
        raw_output = cast(bool, getattr(args, "raw"))

        log_text = ""
        if log_file_arg:
            log_text = Path(log_file_arg).read_text(encoding="utf-8")
        elif log_text_arg:
            log_text = log_text_arg

        query = build_query(query=query_arg, log_text=log_text)

        if query_only:
            print(query)
            return 0

        observation = retriever(query=query, type=type_arg, goal=goal_arg)
        if raw_output:
            print(observation)
            return 0

        payload: JsonDict = {
            "query": query,
            "type": normalize_type(type_arg),
            "goal": goal_arg,
            "results": parse_observation(observation),
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:
        print(f"sql_diagnosis_retriever调用异常，信息：[{type(exc).__name__}: {exc}]")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
