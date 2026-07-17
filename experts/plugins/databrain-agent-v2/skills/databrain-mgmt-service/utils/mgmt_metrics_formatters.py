from __future__ import annotations

import json
import io
import math
import numbers
from typing import Any

import numpy as np
import pandas as pd

from utils.util import is_chinese_language
from utils.value_formatters import format_chinese_unit, format_kmg


# ---------------------------------------------------------------------------
# Shared value-level primitives
#
# These helpers centralize the per-value transformation logic that used to be
# duplicated across `format_describe_data`, `format_csv_numbers` and the
# TopN formatter (`mgmt_topn_formatters.process_topn_rankings`). Higher-level
# formatters decide *which* rows/columns are percent metrics; these helpers
# only handle the per-value conversion given that decision.
# ---------------------------------------------------------------------------


def is_number(v: Any) -> bool:
    """Unified numeric check used by all mgmt formatters.

    - Rejects `bool` (which is a subclass of `int`).
    - Rejects `NaN` floats.
    - Accepts Python numbers plus numpy integer/floating scalars.
    """
    if isinstance(v, bool):
        return False
    if isinstance(v, (np.integer, np.floating)):
        return not (isinstance(v, np.floating) and np.isnan(v))
    if not isinstance(v, numbers.Number):
        return False
    if isinstance(v, float) and math.isnan(v):
        return False
    return True


def format_number_by_language(v: Any, *, use_zh: bool, digits: int = 2) -> Any:
    """Format a single numeric value as 万/亿 (zh) or K/M/G (en).

    Non-numeric values are returned unchanged so callers can pipe any cell
    through this helper without pre-filtering.
    """
    if not is_number(v):
        return v
    if use_zh:
        return format_chinese_unit(float(v), digits=digits, return_str=True)
    return format_kmg(float(v), digits=digits, return_str=True)


def format_metric_value(
    v: Any,
    *,
    is_percent: bool,
    use_zh: bool,
    digits: int = 2,
) -> Any:
    """Format a single metric cell for display.

    - If the cell is a percent metric column and the value is a number, format
      it as `"xx.xx%"` (values are assumed to already be scaled to 0-100 by
      :func:`scale_percent_metrics_in_records`).
    - Otherwise, if it's a number, apply language-aware K/M/G or 万/亿 formatting.
    - Non-numeric values are returned unchanged.
    """
    if is_percent:
        if is_number(v):
            return format_percent_value(float(v), digits=digits)
        return v
    return format_number_by_language(v, use_zh=use_zh, digits=digits)


def get_percent_metrics(metrics: list[str] | None, metric_by_code: dict | None) -> set[str]:
    """Return metric codes whose value_type is percent/percentage."""
    percent_metrics: set[str] = set()
    if not metrics or not metric_by_code:
        return percent_metrics
    for metric_code in metrics:
        info = metric_by_code.get(metric_code, {}) if isinstance(metric_by_code, dict) else {}
        value_type = (info.get("value_type") or "").lower()
        if value_type in ["percent", "percentage"]:
            percent_metrics.add(metric_code)
    return percent_metrics


def format_percent_value(v: float, digits: int = 2) -> str:
    """Format a percent value (already scaled to 0-100) as a string with '%'."""
    return f"{v:.{digits}f}%"


def infer_percent_metrics_from_records(records: list[dict] | None, metric_by_code: dict | None = None) -> set[str]:
    """
    Infer percent-like metric columns from returned records.

    This covers derived fields returned by backend (e.g. *_growth_rate, *_complete_rate)
    that are not present in the requested `metrics` list.
    """
    if not records or not isinstance(records, list):
        return set()

    # Find first dict row to inspect keys
    row = None
    for r in records:
        if isinstance(r, dict):
            row = r
            break
    if not row:
        return set()

    percent_metrics: set[str] = set()
    for key in row.keys():
        k = str(key)
        k_l = k.lower()

        # Prefer metric map typing if available
        if isinstance(metric_by_code, dict):
            info = metric_by_code.get(k)
            if isinstance(info, dict):
                vt = (info.get("value_type") or "").lower()
                if vt in ["percent", "percentage"]:
                    percent_metrics.add(k)
                    continue

        # Heuristics for derived rate fields
        if (
            k_l.endswith("_rate")
            or "growth_rate" in k_l
            or "complete_rate" in k_l
            # Common MGMT derived fields returned by backend
            or k_l.endswith("_mom")
            or k_l.endswith("_yoy")
        ):
            percent_metrics.add(k)

    return percent_metrics


def scale_percent_metrics_in_records(
    records: list[dict] | None,
    percent_metrics: set[str] | None,
    scale: float = 100.0,
) -> list[dict] | None:
    """
    Scale percent metrics in-place so the *actual data* is in percent units (0-100).

    Note: We always scale for percent metrics (ratios), including values > 1
    """
    if not records or not percent_metrics:
        return records

    for row in records:
        if not isinstance(row, dict):
            continue
        for metric_code in percent_metrics:
            if metric_code not in row:
                continue
            v = row.get(metric_code)
            if not is_number(v):
                continue
            row[metric_code] = float(v) * scale
    return records


# ---------------------------------------------------------------------------
# value_type -> decimal digits resolution
#
# Used by TopN formatter, `format_describe_data` and `format_csv_numbers`
# to pick per-cell digits based on the declared `value_type` in metric_map.
# ---------------------------------------------------------------------------

# Aggregation suffixes appended by `DataFrameAnalyzer.describe` onto the base
# metric code (default agg_functions = mean/min/max/sum, plus pandas describe
# stats and `_min_at_time` / `_max_at_time`). When a describe-produced key like
# `gross_revenue_actual_mean` isn't found directly in `metric_by_code`, we try
# stripping one of these suffixes to recover the base metric code so the
# aggregated cell inherits its base `value_type` (numerical -> integer display).
#
# Order matters: longer suffixes must be tried first so `_min_at_time` wins
# over `_min`.
_DESCRIBE_AGG_SUFFIXES: tuple[str, ...] = (
    "_min_at_time",
    "_max_at_time",
    "_mean",
    "_std",
    "_min",
    "_max",
    "_sum",
    "_median",
    "_count",
    "_25%",
    "_50%",
    "_75%",
)


def resolve_value_digits(
    key: str,
    *,
    is_percent: bool,
    metric_by_code: dict | None,
    default_digits: int,
) -> int:
    """Decide decimal digits for a metric value cell.

    Rule:
    - percent columns (including derived `_growth_rate/_mom/_yoy/_complete_rate`)
      -> `default_digits` (rendered as `xx.xx%`; percent formatting owns digits).
    - `value_type == "numerical"` -> 0 (integer display, e.g. `"988M"`).
    - `value_type == "float"` or unknown -> `default_digits` (2 decimals).
    - Describe-produced aggregation keys (e.g. `foo_mean`, `foo_sum`) inherit
      the base metric's `value_type`: if `foo` is numerical, `foo_mean/min/max/
      sum/...` are also rendered as integers.

    Callers may pass column names that are NOT metrics (e.g. `studio_name`,
    time columns); these simply fall through to `default_digits` because
    neither the full key nor any stripped base is in `metric_by_code`.
    """
    if is_percent:
        return default_digits
    if not isinstance(metric_by_code, dict) or not metric_by_code:
        return default_digits

    # Direct match first (TopN inner keys, CSV column names, plain metric codes).
    info = metric_by_code.get(key)

    # Fall back to stripping a known aggregation suffix to recover base code.
    if not isinstance(info, dict):
        for suffix in _DESCRIBE_AGG_SUFFIXES:
            if key.endswith(suffix) and len(key) > len(suffix):
                info = metric_by_code.get(key[: -len(suffix)])
                break

    if not isinstance(info, dict):
        return default_digits
    value_type = str(info.get("value_type") or "").strip().lower()
    if value_type == "numerical":
        return 0
    return default_digits


def format_describe_data(
    description_str: str,
    language: str | None,
    percent_metrics: set[str] | None = None,
    digits: int = 2,
    metric_by_code: dict | None = None,
) -> str:
    """
    Format the JSON string returned by DataFrameAnalyzer.describe():
    - For percent metrics: output as 'xx.xx%' (2 decimals). Values are expected to be scaled to 0-100.
    - For `value_type == "numerical"` metrics: output as integer (0 decimals).
    - For other numeric values (float / unknown): output as 万/亿 (zh) or K/M/G (en) with `digits` decimals.
    """
    if not description_str or not isinstance(description_str, str):
        return description_str

    try:
        obj = json.loads(description_str)
    except Exception:
        return description_str

    use_zh = is_chinese_language(language or "")
    percent_metrics = percent_metrics or set()

    def _is_percent_key(key: str | None) -> bool:
        if not key:
            return False
        return any(key == m or key.startswith(f"{m}_") for m in percent_metrics)

    def _format_value(v: Any, key: str | None = None):
        if v is None:
            return v
        is_percent = _is_percent_key(key)
        cell_digits = resolve_value_digits(
            key or "",
            is_percent=is_percent,
            metric_by_code=metric_by_code,
            default_digits=digits,
        )
        return format_metric_value(
            v,
            is_percent=is_percent,
            use_zh=use_zh,
            digits=cell_digits,
        )

    try:
        if isinstance(obj, list):
            formatted = []
            for row in obj:
                if isinstance(row, dict):
                    formatted.append({k: _format_value(v, key=str(k)) for k, v in row.items()})
                else:
                    formatted.append(_format_value(row))
        elif isinstance(obj, dict):
            formatted = {k: _format_value(v, key=str(k)) for k, v in obj.items()}
        else:
            formatted = _format_value(obj)
        return json.dumps(formatted, ensure_ascii=False)
    except Exception:
        return description_str


def format_csv_numbers(
    csv_string: str,
    language: str,
    percent_metrics: set[str] | None = None,
    digits: int = 2,
    metric_by_code: dict | None = None,
) -> str:
    """
    Format numeric columns in a CSV string into 万/亿 (zh) or K/M/G (en) with
    per-column digits decided by `metric_by_code[col].value_type`:
    - percent column -> 'xx.xx%' (values expected to be scaled to 0-100)
    - numerical      -> integer (0 decimals)
    - float / unknown -> `digits` decimals (default 2)

    Skips ID/date/time-like columns to avoid corrupting identifiers.
    """
    if not csv_string or not isinstance(csv_string, str):
        return csv_string

    try:
        df = pd.read_csv(io.StringIO(csv_string))
    except Exception:
        return csv_string

    if df.empty:
        return csv_string

    use_zh = is_chinese_language(language)
    percent_metrics = percent_metrics or set()

    for col in df.columns:
        col_l = str(col).lower()
        if "id" in col_l or "date" in col_l or "time" in col_l:
            continue

        numeric_series = pd.to_numeric(df[col], errors="coerce")
        if numeric_series.notna().sum() == 0:
            continue

        is_percent_col = str(col) in percent_metrics
        col_digits = resolve_value_digits(
            str(col),
            is_percent=is_percent_col,
            metric_by_code=metric_by_code,
            default_digits=digits,
        )

        def _fmt_cell(x, _is_percent=is_percent_col, _digits=col_digits):
            if pd.isna(x):
                return x
            try:
                v = float(x)
            except Exception:
                return x
            return format_metric_value(
                v, is_percent=_is_percent, use_zh=use_zh, digits=_digits
            )

        df[col] = df[col].apply(_fmt_cell)

    return df.to_csv(index=False)

