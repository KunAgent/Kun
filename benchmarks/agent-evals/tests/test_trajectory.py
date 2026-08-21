from kun_bench.framework_support import validate_framework_trajectory
from kun_bench.trajectory import convert_kun_jsonl


def test_jsonl_conversion_uses_authoritative_items_and_usage() -> None:
    records = [
        {"type": "run_started", "threadId": "thr_1"},
        {
            "type": "runtime_event",
            "event": {
                "seq": 1,
                "kind": "assistant_text_delta",
                "itemId": "text_1",
                "item": {"id": "text_1", "kind": "assistant_text", "text": "partial"},
            },
        },
        {
            "type": "runtime_event",
            "event": {
                "seq": 2,
                "kind": "item_created",
                "itemId": "text_1",
                "item": {
                    "id": "text_1",
                    "kind": "assistant_text",
                    "text": "final",
                    "createdAt": "2",
                },
            },
        },
        {
            "type": "runtime_event",
            "event": {
                "seq": 3,
                "kind": "item_created",
                "item": {
                    "id": "call",
                    "kind": "tool_call",
                    "callId": "c1",
                    "toolName": "write",
                    "arguments": {"path": "x"},
                },
            },
        },
        {
            "type": "runtime_event",
            "event": {
                "seq": 4,
                "kind": "item_created",
                "item": {
                    "id": "result",
                    "kind": "tool_result",
                    "callId": "c1",
                    "toolName": "write",
                    "output": {"ok": True},
                    "isError": False,
                },
            },
        },
        {
            "type": "runtime_event",
            "event": {
                "seq": 5,
                "kind": "usage",
                "usage": {
                    "promptTokens": 10,
                    "completionTokens": 2,
                    "cacheHitTokens": 4,
                    "reasoningTokens": 1,
                    "costUsd": 0.01,
                },
            },
        },
        {
            "type": "runtime_event",
            "event": {
                "seq": 6,
                "kind": "context_snapshot",
                "estimatedInputTokens": 12,
            },
        },
        {"type": "run_finished", "status": "completed"},
    ]
    parsed = convert_kun_jsonl(
        records, instruction="task", model_name="model", agent_version="1.0.0"
    )
    assert parsed.terminal_status == "completed"
    assert parsed.usage.prompt_tokens == 10
    agent = parsed.trajectory["steps"][1]
    assert agent["message"] == "final"
    assert agent["tool_calls"][0]["function_name"] == "write"
    assert agent["observation"]["results"][0]["source_call_id"] == "c1"
    assert parsed.trajectory["final_metrics"]["extra"]["peak_context_tokens"] == 12
    validate_framework_trajectory(parsed.trajectory, "harbor")
    validate_framework_trajectory(parsed.trajectory, "pier")
