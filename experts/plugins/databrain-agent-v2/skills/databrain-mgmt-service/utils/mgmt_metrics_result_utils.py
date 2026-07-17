from __future__ import annotations

import json
import re

from utils.mgmt_metrics_dataframe_utils import merge_csv_data


def normalize_entity_key(entity_type: str, entity_id: str) -> str:
    et = (entity_type or "").strip() or "unknown"
    eid = (entity_id or "").strip() or "all"
    return f"{et}:{eid}"


def sanitize_label_name(name: str) -> str:
    # label uses ":" as separator; avoid breaking parse
    s = str(name or "").strip()
    if not s:
        return ""
    return s.replace(":", " ").strip()


def make_name_id_label(name: str, entity_id: str) -> str:
    n = sanitize_label_name(name) or "unknown"
    eid = (entity_id or "").strip() or "all"
    return f"{n}:{eid}"


def rename_description_keys(description_str: str, metric_names_map: dict[str, str]) -> str:
    """
    Convert describe keys from metric_code_* to metric_name_* (指标名 + 聚合形式).
    Example: gross_revenue_actual_mean -> 收入实际值(美元)_mean
    """
    if not description_str or not isinstance(description_str, str):
        return description_str or ""
    desc = description_str.strip()
    if not desc:
        return ""
    try:
        payload = json.loads(desc)
    except Exception:
        return description_str

    if not isinstance(payload, list):
        return description_str

    metric_codes = sorted(
        [k for k in (metric_names_map or {}).keys() if isinstance(k, str) and k.strip()],
        key=len,
        reverse=True,
    )

    def _rename_key(k: str) -> str:
        if not isinstance(k, str):
            return k
        for code in metric_codes:
            prefix = f"{code}_"
            if k.startswith(prefix):
                name = str(metric_names_map.get(code) or "").strip()
                if name:
                    return f"{name}{k[len(code):]}"
        return k

    new_payload: list[dict] = []
    for item in payload:
        if not isinstance(item, dict):
            new_payload.append(item)
            continue
        new_item = {}
        for k, v in item.items():
            nk = _rename_key(k)
            new_item[nk] = v
        new_payload.append(new_item)

    # Add granularity prefix (and actual time range if present) into metric/stat keys
    # so different monthly/yearly blocks won't collide after downstream merges.
    suffix_re = re.compile(r".+_(mean|min|max|sum|median|std|count|min_at_time|max_at_time)$")
    reserved_keys = {
        "granularity",
        "original_granularity",
        "effective_granularity",
        "granularity_key",
        "actual_start_time",
        "actual_end_time",
        "actual_time_range",
    }

    decorated_payload: list[dict] = []
    for item in new_payload:
        if not isinstance(item, dict):
            decorated_payload.append(item)
            continue

        requested_gran = str(item.get("granularity") or "").strip() or "unknown"
        effective_gran = str(item.get("effective_granularity") or "").strip() or requested_gran or "unknown"
        start = str(item.get("actual_start_time") or "").strip()
        end = str(item.get("actual_end_time") or "").strip()

        base = effective_gran
        # Keep requested granularity in name for debugging / disambiguation
        if requested_gran and requested_gran != effective_gran:
            base = f"{base}_requested_{requested_gran}"
        if start and end:
            base = f"{base}_{start}_to_{end}"
        # sanitize for stable key naming
        base = re.sub(r"\s+", "_", base)
        base = base.replace(":", "_").replace("/", "_").replace("\\", "_")

        out: dict = {}
        for k, v in item.items():
            if k in reserved_keys:
                out[k] = v
                continue
            if isinstance(k, str) and suffix_re.match(k):
                out[f"{base}__{k}"] = v
            else:
                out[k] = v

        # Keep a readable name too (used by UI/debugging)
        try:
            out.setdefault("granularity_name", base)
        except Exception:
            pass

        decorated_payload.append(out)

    try:
        return json.dumps(decorated_payload, ensure_ascii=False)
    except Exception:
        return description_str


def merge_description(a: str, b: str) -> str:
    """
    Merge two describe JSON strings (list[dict]) by granularity key if present.
    Prefer non-empty entries; keep stable order (a then b).
    """
    a = (a or "").strip()
    b = (b or "").strip()
    if not a:
        return b
    if not b:
        return a
    try:
        pa = json.loads(a)
        pb = json.loads(b)
        if not isinstance(pa, list) or not isinstance(pb, list):
            return a
    except Exception:
        return a

    merged: list[dict] = []
    seen: set[str] = set()

    def _key(x: dict) -> str:
        if not isinstance(x, dict):
            return ""
        # Prefer a more specific key if present (avoid dropping multiple monthly blocks).
        if x.get("granularity_key"):
            return str(x.get("granularity_key") or "")
        gran = str(x.get("granularity") or "")
        start = str(x.get("actual_start_time") or "").strip()
        end = str(x.get("actual_end_time") or "").strip()
        if start and end:
            return f"{gran}|{start}~{end}"
        if "granularity" in x:
            return gran
        return ""

    for x in pa + pb:
        if not isinstance(x, dict):
            continue
        k = _key(x)
        if k:
            if k in seen:
                continue
            seen.add(k)
        merged.append(x)

    try:
        return json.dumps(merged, ensure_ascii=False)
    except Exception:
        return a


def strip_description_meta(description_str: str) -> str:
    """
    Remove internal meta keys used for naming/merging from description payload.
    Keep user-facing keys like granularity/original_granularity and the metric stats.
    """
    if not description_str or not isinstance(description_str, str):
        return description_str or ""
    s = description_str.strip()
    if not s:
        return ""
    try:
        obj = json.loads(s)
    except Exception:
        return description_str
    if not isinstance(obj, list):
        return description_str

    meta_keys = {
        "actual_start_time",
        "actual_end_time",
        "actual_time_range",
        "effective_granularity",
        "granularity_key",
        "granularity_name",
    }

    cleaned: list[dict] = []
    changed = False
    for item in obj:
        if not isinstance(item, dict):
            continue
        new_item = dict(item)
        for k in meta_keys:
            if k in new_item:
                new_item.pop(k, None)
                changed = True
        cleaned.append(new_item)

    if not changed:
        return description_str
    try:
        return json.dumps(cleaned, ensure_ascii=False)
    except Exception:
        return description_str


def merge_results_by_entity_key(results: list[dict]) -> list[dict]:
    merged: dict[str, dict] = {}
    for r in results or []:
        if not isinstance(r, dict):
            continue
        key = str(r.get("entity_key") or "") or normalize_entity_key(
            str(r.get("entity_type", "") or ""), str(r.get("entity_id", "") or "")
        )
        if key not in merged:
            merged[key] = r
            continue

        base = merged[key]
        base["data"] = merge_csv_data(base.get("data", ""), r.get("data", ""))
        base["description"] = merge_description(base.get("description", ""), r.get("description", ""))

        ui = base.get("unit_info") or []
        if not isinstance(ui, list):
            ui = [str(ui)]
        for x in r.get("unit_info") or []:
            if x not in ui:
                ui.append(x)
        base["unit_info"] = ui

        if not (base.get("name") or "").strip() and (r.get("name") or "").strip():
            base["name"] = r.get("name")
        if not (base.get("data_id") or "").strip() and (r.get("data_id") or "").strip():
            base["data_id"] = r.get("data_id")

        try:
            _eid = str(base.get("entity_id", "") or "").strip() or "all"
            _nm = str(base.get("name", "") or "").strip()
            base["label"] = make_name_id_label(_nm or str(base.get("entity_type", "") or ""), _eid)
        except Exception:
            pass

    out = list(merged.values())
    # Strip internal meta fields from final output (keep only user-facing stats)
    for r in out:
        try:
            r["description"] = strip_description_meta(r.get("description", ""))
        except Exception:
            continue
    return out

