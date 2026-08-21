from __future__ import annotations

import json
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .artifacts import Redactor, atomic_write_json


@dataclass(frozen=True)
class UsageTotals:
    prompt_tokens: int = 0
    completion_tokens: int = 0
    reasoning_tokens: int = 0
    cached_tokens: int = 0
    cost_usd: float = 0.0
    model_calls: int = 0


@dataclass(frozen=True)
class ParsedRun:
    trajectory: dict[str, Any]
    usage: UsageTotals
    terminal_status: str | None
    errors: list[str]


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid JSONL at {path}:{line_number}: {exc}") from exc
        if not isinstance(value, dict):
            raise ValueError(f"JSONL record at {path}:{line_number} is not an object")
        records.append(value)
    return records


def convert_kun_jsonl(
    records: Iterable[dict[str, Any]],
    *,
    instruction: str,
    model_name: str,
    agent_version: str,
) -> ParsedRun:
    ordered = list(records)
    runtime_events = [
        record["event"]
        for record in ordered
        if record.get("type") == "runtime_event" and isinstance(record.get("event"), dict)
    ]
    runtime_events.sort(key=lambda event: int(event.get("seq", 0)))
    terminal = next(
        (
            str(record.get("status"))
            for record in reversed(ordered)
            if record.get("type") == "run_finished"
        ),
        None,
    )
    session_id = next(
        (
            str(record.get("threadId"))
            for record in ordered
            if record.get("type") == "run_started" and record.get("threadId")
        ),
        "unknown",
    )
    items = latest_items(runtime_events)
    assistant_text = []
    reasoning_text = []
    tool_calls = []
    observations = []
    for item in items.values():
        kind = item.get("kind")
        if kind == "assistant_text" and item.get("text"):
            assistant_text.append((str(item.get("createdAt", "")), str(item["text"])))
        elif kind == "assistant_reasoning" and item.get("text"):
            reasoning_text.append((str(item.get("createdAt", "")), str(item["text"])))
        elif kind == "tool_call":
            tool_calls.append(
                {
                    "tool_call_id": str(item.get("callId", item.get("id", ""))),
                    "function_name": str(item.get("toolName", "unknown")),
                    "arguments": item.get("arguments")
                    if isinstance(item.get("arguments"), dict)
                    else {},
                }
            )
        elif kind == "tool_result":
            observations.append(
                {
                    "source_call_id": str(item.get("callId", "")) or None,
                    "content": render_content(item.get("output")),
                    "extra": {"is_error": item.get("isError") is True},
                }
            )
    assistant_text.sort()
    reasoning_text.sort()
    usage = aggregate_usage(runtime_events)
    peak_context = max(
        (
            int(event.get("estimatedInputTokens", 0))
            for event in runtime_events
            if event.get("kind") == "context_snapshot"
        ),
        default=0,
    )
    compactions = sum(1 for event in runtime_events if event.get("kind") == "compaction_completed")
    errors = [
        str(event.get("message", "runtime error"))
        for event in runtime_events
        if event.get("kind") == "error"
    ]
    timestamp = next(
        (str(event["timestamp"]) for event in runtime_events if event.get("timestamp")), None
    )
    metrics = {
        "prompt_tokens": usage.prompt_tokens or None,
        "completion_tokens": usage.completion_tokens or None,
        "cached_tokens": usage.cached_tokens or None,
        "cost_usd": usage.cost_usd or None,
        "extra": {"reasoning_tokens": usage.reasoning_tokens} if usage.reasoning_tokens else None,
    }
    agent_step: dict[str, Any] = {
        "step_id": 2,
        "timestamp": timestamp,
        "source": "agent",
        "message": "\n".join(text for _, text in assistant_text),
        "model_name": model_name,
        "llm_call_count": usage.model_calls,
        "extra": {"kun_terminal_status": terminal, "runtime_errors": errors},
    }
    if usage.model_calls:
        agent_step["metrics"] = compact(metrics)
    if reasoning_text:
        agent_step["reasoning_content"] = "\n\n".join(text for _, text in reasoning_text)
    if tool_calls:
        agent_step["tool_calls"] = tool_calls
    if observations:
        agent_step["observation"] = {"results": observations}
    final_metrics = compact(
        {
            "total_prompt_tokens": usage.prompt_tokens or None,
            "total_completion_tokens": usage.completion_tokens or None,
            "total_cached_tokens": usage.cached_tokens or None,
            "total_cost_usd": usage.cost_usd or None,
            "total_steps": 2,
            "extra": compact(
                {
                    "reasoning_tokens": usage.reasoning_tokens or None,
                    "peak_context_tokens": peak_context or None,
                    "summarization_count": compactions or None,
                    "kun_terminal_status": terminal,
                }
            ),
        }
    )
    trajectory = {
        "schema_version": "ATIF-v1.7",
        "session_id": session_id,
        "agent": {"name": "kun", "version": agent_version, "model_name": model_name},
        "steps": [
            {"step_id": 1, "source": "user", "message": instruction},
            compact(agent_step),
        ],
        "final_metrics": final_metrics,
    }
    return ParsedRun(trajectory=trajectory, usage=usage, terminal_status=terminal, errors=errors)


def latest_items(events: Iterable[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    items: dict[str, dict[str, Any]] = {}
    for event in events:
        item = event.get("item")
        if not isinstance(item, dict):
            continue
        item_id = str(item.get("id", event.get("itemId", "")))
        if not item_id:
            continue
        if event.get("kind") == "assistant_text_delta" and item_id in items:
            continue
        items[item_id] = item
    return items


def aggregate_usage(events: Iterable[dict[str, Any]]) -> UsageTotals:
    prompt = completion = reasoning = cached = calls = 0
    cost = 0.0
    for event in events:
        if event.get("kind") != "usage" or not isinstance(event.get("usage"), dict):
            continue
        usage = event["usage"]
        prompt += int(usage.get("promptTokens", 0) or 0)
        completion += int(usage.get("completionTokens", 0) or 0)
        reasoning += int(usage.get("reasoningTokens", 0) or 0)
        cached += int(usage.get("cacheHitTokens", usage.get("cachedTokens", 0)) or 0)
        cost += float(usage.get("costUsd", 0) or 0)
        calls += 1
    return UsageTotals(prompt, completion, reasoning, cached, cost, calls)


def write_redacted_trajectory(path: Path, parsed: ParsedRun, redactor: Redactor) -> None:
    atomic_write_json(path, redactor.value(parsed.trajectory))


def compact(value: dict[str, Any]) -> dict[str, Any]:
    return {key: item for key, item in value.items() if item is not None}


def render_content(value: Any) -> str:
    if isinstance(value, str):
        return value
    return json.dumps(value, sort_keys=True, ensure_ascii=False)
