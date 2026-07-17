"""
Output transformation utilities for the MGMT TopN tool.

Mirrors the display-oriented transformations used by `mgmt_metrics_query_tool`:
- Scale percent metrics (ratio -> 0-100).
- Format numeric values for display (percent -> "xx.xx%",
  others -> K/M/G in English or 万/亿 in Chinese).
- Rename metric codes to user-friendly metric names (including derived
  suffixes like *_growth_rate / *_mom / *_yoy / *_complete_rate).
- Collect unit_info messages for the ordered metrics.

These transformations DO NOT touch the raw API payload; they only reshape
the `data_results` that are rendered back to the LLM / user.
"""

from __future__ import annotations

from typing import Any

from utils.util import is_chinese_language
from utils.mgmt_metrics_formatters import (
    format_metric_value,
    get_percent_metrics,
    infer_percent_metrics_from_records,
    resolve_value_digits,
    scale_percent_metrics_in_records,
)


# Keys that should never be treated as metric values (no scaling / formatting /
# rename). IDs/names come straight from the backend as identifiers.
_ID_LIKE_KEYS: frozenset[str] = frozenset(
    {"id", "name", "title", "studio_name", "project_name", "game_name"}
)


def _derived_suffix_label_map(language: str | None) -> dict[str, str]:
    """Map derived-field suffixes to their human readable labels."""
    if is_chinese_language(language or ""):
        return {
            "_growth_rate": "_增长率",
            "_complete_rate": "_完成率",
            "_mom": "_环比",
            "_yoy": "_同比",
        }
    return {
        "_growth_rate": " Growth Rate",
        "_complete_rate": " Complete Rate",
        "_mom": " MoM",
        "_yoy": " YoY",
    }


def _rename_metric_key(
    key: str,
    metric_names_map: dict[str, str],
    suffix_label_map: dict[str, str],
) -> str:
    """Rename a metric key to its display name.

    - Exact code match -> metric_name.
    - Derived suffix match (e.g. `gross_revenue_actual_growth_rate`) ->
      metric_name + localized suffix label (e.g. `实际收入_增长率`).
    - Otherwise returns the original key unchanged.
    """
    if not isinstance(key, str):
        return key
    if key in metric_names_map:
        return metric_names_map[key]
    for suffix, label in suffix_label_map.items():
        if key.endswith(suffix):
            base = key[: -len(suffix)]
            name = metric_names_map.get(base)
            if name:
                return f"{name}{label}"
            break
    return key


def _collect_base_codes(
    data_results: list[Any],
    suffix_label_map: dict[str, str],
) -> tuple[set[str], list[str]]:
    """Collect referenced base metric codes from rankings structure.

    Returns (base_codes, ordered_outer_codes) where ordered_outer_codes is
    the ordered list of outer `rankings` keys (dedup by first occurrence)
    used to generate unit_info in a stable order.
    """
    base_codes: set[str] = set()
    ordered_outer: list[str] = []
    seen_outer: set[str] = set()

    for result in data_results or []:
        if not isinstance(result, dict):
            continue
        rankings = result.get("rankings")
        if not isinstance(rankings, dict):
            continue
        for metric_code, blob in rankings.items():
            code = str(metric_code)
            base_codes.add(code)
            if code not in seen_outer:
                seen_outer.add(code)
                ordered_outer.append(code)
            if not isinstance(blob, dict):
                continue
            items = blob.get("items")
            if not isinstance(items, list):
                continue
            for item in items:
                if not isinstance(item, dict):
                    continue
                for k in item.keys():
                    k_str = str(k)
                    if k_str in _ID_LIKE_KEYS:
                        continue
                    matched_suffix = False
                    for suffix in suffix_label_map.keys():
                        if k_str.endswith(suffix):
                            base_codes.add(k_str[: -len(suffix)])
                            matched_suffix = True
                            break
                    if not matched_suffix:
                        base_codes.add(k_str)
    return base_codes, ordered_outer


def _build_unit_info(
    ordered_outer_codes: list[str],
    metric_by_code: dict,
    metric_names_map: dict[str, str],
) -> list[str]:
    unit_info: list[str] = []
    for code in ordered_outer_codes:
        info = metric_by_code.get(code) if isinstance(metric_by_code, dict) else None
        if not isinstance(info, dict):
            continue
        unit = str(info.get("unit") or "").strip()
        if not unit or unit == "-":
            continue
        display = metric_names_map.get(code) or code
        unit_info.append(f"{display} has unit of {unit}. ")
    return unit_info


def process_topn_rankings(
    data_results: list[Any],
    *,
    language: str | None,
    metric_by_code: dict | None,
    digits: int = 2,
) -> tuple[list[Any], list[str]]:
    """Transform TopN `data_results` for display.

    Returns a tuple of (processed_data_results, unit_info).
    - Numeric values are scaled (percent metrics) and formatted.
    - Rankings outer keys and items' inner keys are renamed to metric_name
      (with localized derived-suffix labels when applicable).
    - unit_info mirrors the one produced by `mgmt_metrics_query_tool`.
    """
    if not data_results:
        return data_results, []

    use_zh = is_chinese_language(language or "")
    suffix_label_map = _derived_suffix_label_map(language)
    metric_by_code = metric_by_code or {}

    base_codes, ordered_outer = _collect_base_codes(data_results, suffix_label_map)

    # Build metric_code -> metric_name map from registry (only codes we saw).
    metric_names_map: dict[str, str] = {}
    for code in base_codes:
        info = metric_by_code.get(code) if isinstance(metric_by_code, dict) else None
        if isinstance(info, dict):
            name = str(info.get("metric_name") or "").strip()
            if name:
                metric_names_map[code] = name

    # Percent metrics: registry-declared + heuristics (_growth_rate / _mom / _yoy / ...).
    percent_metrics: set[str] = get_percent_metrics(list(base_codes), metric_by_code)

    unit_info = _build_unit_info(ordered_outer, metric_by_code, metric_names_map)

    processed: list[Any] = []
    for result in data_results:
        if not isinstance(result, dict):
            processed.append(result)
            continue

        rankings = result.get("rankings")
        if not isinstance(rankings, dict):
            processed.append(result)
            continue

        new_rankings: dict[str, Any] = {}
        for metric_code, blob in rankings.items():
            code_str = str(metric_code)
            new_outer_key = _rename_metric_key(code_str, metric_names_map, suffix_label_map)

            if not isinstance(blob, dict):
                new_rankings[new_outer_key] = blob
                continue

            items = blob.get("items")
            if not isinstance(items, list):
                new_rankings[new_outer_key] = blob
                continue

            # Include derived percent columns (e.g. *_growth_rate, *_mom, *_yoy)
            local_percent = set(percent_metrics)
            local_percent |= infer_percent_metrics_from_records(
                items, metric_by_code=metric_by_code
            )
            local_percent -= _ID_LIKE_KEYS

            # Scale percent metrics in place (ratio -> 0-100).
            if local_percent:
                scale_percent_metrics_in_records(items, local_percent)

            new_items: list[Any] = []
            for item in items:
                if not isinstance(item, dict):
                    new_items.append(item)
                    continue
                new_item: dict[str, Any] = {}
                for k, v in item.items():
                    k_str = str(k)
                    # Preserve id/name fields without formatting or rename.
                    if k_str in _ID_LIKE_KEYS:
                        new_item[k_str] = v
                        continue

                    is_percent_cell = k_str in local_percent
                    cell_digits = resolve_value_digits(
                        k_str,
                        is_percent=is_percent_cell,
                        metric_by_code=metric_by_code,
                        default_digits=digits,
                    )
                    formatted = format_metric_value(
                        v,
                        is_percent=is_percent_cell,
                        use_zh=use_zh,
                        digits=cell_digits,
                    )

                    new_key = _rename_metric_key(
                        k_str, metric_names_map, suffix_label_map
                    )
                    new_item[new_key] = formatted
                new_items.append(new_item)

            new_blob = {**blob, "items": new_items}
            new_rankings[new_outer_key] = new_blob

        new_result = {**result, "rankings": new_rankings}
        processed.append(new_result)

    return processed, unit_info
