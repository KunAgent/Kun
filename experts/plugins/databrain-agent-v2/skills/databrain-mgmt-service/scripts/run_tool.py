#!/usr/bin/env python3
from __future__ import annotations
"""Generic entry script for MGMT skill tools."""
import argparse
import asyncio
import inspect
import json
import os
import sys

_SKILL_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _SKILL_ROOT)

from context_loader import get_context
from run_context_wrapper import RunContextWrapper
from utils.util import is_chinese_language

_TOOL_MAP = None
_SIDECAR_FILENAME = ".context_sidecar.json"


def _jsonable(value):
    if hasattr(value, "model_dump"):
        return value.model_dump()
    if hasattr(value, "dict"):
        return value.dict()
    return value


def _write_context_sidecar(ctx):
    output_dir = os.environ.get("AGENT_OUTPUT_DIR", "").strip()
    if not output_dir:
        return
    payload = {}
    for key in ("data", "has_mgmt_data", "references", "combine_id_to_name", "studio_id_to_name", "mgmt_info", "topn_tool_called"):
        value = getattr(ctx, key, None)
        if value:
            payload[key] = _jsonable(value)
    if not payload:
        return
    try:
        sidecar_path = os.path.join(output_dir, _SIDECAR_FILENAME)
        existing = {}
        if os.path.exists(sidecar_path):
            with open(sidecar_path, "r", encoding="utf-8") as f:
                existing = json.load(f)
        for key, value in payload.items():
            if isinstance(value, list):
                existing.setdefault(key, [])
                existing[key].extend(value)
            elif isinstance(value, dict):
                existing.setdefault(key, {})
                existing[key].update(value)
            else:
                existing[key] = value
        with open(sidecar_path, "w", encoding="utf-8") as f:
            json.dump(existing, f, ensure_ascii=False, default=str)
    except Exception:
        pass


def _merge_existing_context_sidecar(ctx):
    output_dir = os.environ.get("AGENT_OUTPUT_DIR", "").strip()
    if not output_dir:
        return
    sidecar_path = os.path.join(output_dir, _SIDECAR_FILENAME)
    if not os.path.exists(sidecar_path):
        return
    try:
        with open(sidecar_path, "r", encoding="utf-8") as f:
            payload = json.load(f)
        for key in ("combine_id_to_name", "studio_id_to_name", "mgmt_info"):
            value = payload.get(key)
            if isinstance(value, dict):
                current = getattr(ctx, key, None)
                if not isinstance(current, dict):
                    current = {}
                current.update(value)
                setattr(ctx, key, current)
        if payload.get("topn_tool_called"):
            ctx.topn_tool_called = True
    except Exception:
        pass


async def _preload_metric_map(context, user_query: str) -> bool:
    try:
        if context.context.mgmt_info is None:
            context.context.mgmt_info = {}
        if context.context.mgmt_info.get("metric_by_code"):
            return True
        from mgmt_tools.mgmt_metric_map import load_metric_map_to_context
        return bool(await load_metric_map_to_context(
            context,
            user_query or context.context.user_input or "",
            is_chinese_language(context.context.language),
        ))
    except Exception as exc:
        print(json.dumps({"status": "warning", "warning": f"failed to preload MGMT metric map: {exc}"}, ensure_ascii=False))
        return False


async def mgmt_metric_map_tool(context, user_query: str = "", query_mode: int = 2, max_items: int = 200) -> str:
    """Load and return the current user's MGMT metric map from MGMT metric API."""
    ok = await _preload_metric_map(context, user_query)
    metric_by_code = (context.context.mgmt_info or {}).get("metric_by_code", {}) or {}
    metrics = list(metric_by_code.values()) if isinstance(metric_by_code, dict) else []
    def _pick(item):
        return {
            "metric_code": item.get("metric_code"),
            "metric_name": item.get("metric_name") or item.get("metric_name_cn") or item.get("metric_name_en"),
            "metric_name_cn": item.get("metric_name_cn"),
            "metric_name_en": item.get("metric_name_en"),
            "value_type": item.get("value_type"),
            "module": item.get("module"),
            "granularity": item.get("granularity"),
            "unit": item.get("unit"),
            "description": item.get("metric_desc_cn") or item.get("metric_desc_en"),
        }
    payload = {
        "status": "ok" if ok else "warning",
        "count": len(metrics),
        "metrics": [_pick(item) for item in metrics[: int(max_items or 200)] if isinstance(item, dict)],
        "truncated": len(metrics) > int(max_items or 200),
    }
    return json.dumps(payload, ensure_ascii=False, default=str)


def _load_tool_map():
    global _TOOL_MAP
    if _TOOL_MAP is not None:
        return _TOOL_MAP
    from mgmt_tools.mgmt_metrics_query_tool import mgmt_metrics_query_tool
    from mgmt_tools.mgmt_topn_tool import mgmt_topn_query_tool
    from mgmt_tools.mgmt_milestones_query_tool import mgmt_milestones_query_tool
    _TOOL_MAP = {
        "mgmt_metric_map_tool": mgmt_metric_map_tool,
        "mgmt_metrics_query_tool": mgmt_metrics_query_tool,
        "mgmt_topn_query_tool": mgmt_topn_query_tool,
        "mgmt_milestones_query_tool": mgmt_milestones_query_tool,
    }
    return _TOOL_MAP


def _parse_value(value: str):
    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError):
        pass
    if value and value[0] in "[{" and "'" in value:
        try:
            import ast
            parsed = ast.literal_eval(value)
            if isinstance(parsed, (list, dict)):
                return parsed
        except (ValueError, SyntaxError):
            pass
    return value


def _normalize_tool_kwargs(tool_name: str, kwargs: dict):
    """Coerce JSON CLI values into the shapes expected by migrated tools."""
    if tool_name == "mgmt_topn_query_tool" and isinstance(kwargs.get("order_metric_obj"), dict):
        from mgmt_tools.mgmt_topn_tool import OrderMetric
        kwargs = dict(kwargs)
        kwargs["order_metric_obj"] = OrderMetric(**kwargs["order_metric_obj"])
    return kwargs


async def _amain():
    pre_parser = argparse.ArgumentParser(add_help=False)
    pre_parser.add_argument("--tool", required=True)
    known, remaining = pre_parser.parse_known_args()

    tool_map = _load_tool_map()
    tool_func = tool_map.get(known.tool)
    if tool_func is None:
        print(json.dumps({"error": f"Unknown tool: {known.tool}", "available": sorted(tool_map.keys())}, ensure_ascii=False))
        return 1

    kwargs = {}
    i = 0
    while i < len(remaining):
        arg = remaining[i]
        if arg.startswith("--"):
            key = arg[2:]
            if i + 1 < len(remaining) and not remaining[i + 1].startswith("--"):
                kwargs[key] = _parse_value(remaining[i + 1])
                i += 2
            else:
                kwargs[key] = True
                i += 1
        else:
            i += 1

    context = RunContextWrapper(get_context())
    _merge_existing_context_sidecar(context.context)
    await _preload_metric_map(context, str(kwargs.get("user_query", "") or ""))
    kwargs = _normalize_tool_kwargs(known.tool, kwargs)

    sig = inspect.signature(tool_func)
    valid_params = set(sig.parameters.keys()) - {"context"}
    has_var_keyword = any(p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values())
    filtered_kwargs = kwargs if has_var_keyword else {k: v for k, v in kwargs.items() if k in valid_params}

    result = await tool_func(context, **filtered_kwargs)
    if isinstance(result, str):
        print(result)
    else:
        print(json.dumps(result, ensure_ascii=False, default=str))
    _write_context_sidecar(context.context)
    return 0


def main():
    import logging
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    raise SystemExit(asyncio.run(_amain()))


if __name__ == "__main__":
    main()
