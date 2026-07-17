"""
Render a fixed HTML dashboard from backtest results (3 standard files).

Usage:
    from reference.render_dashboard import build_dashboard_data, render_dashboard

    report_data = build_dashboard_data(
        equity_csv="ma_cross_600519_equity.csv",
        trades_csv="ma_cross_600519_trades.csv",
        summary_json="ma_cross_600519_summary.json",
        language="en",  # follow the user-facing output language
        extra_modules=[
            {"type": "text", "tab": "overview", "title": "Key Takeaways", "text": "- Drawdown stayed controlled\n- Most gains came from 3 trades"},
            {"type": "text", "tab": "overview", "title": "Optimization Ideas", "text": "- Test a wider take-profit range"},
        ],
    )
    render_dashboard(report_data, output_path="index.html")

Or from command line:
    python render_dashboard.py report_data.json index.html

This renderer uses a modular dashboard.
The visual system stays fixed, while the report payload decides which modules
appear and how they are distributed across tabs.
"""

from __future__ import annotations

import argparse
import csv
import html
import json
import math
import re
from datetime import date, datetime
from pathlib import Path
from typing import Any

try:
    from .dashboard_locales import DEFAULT_LANGUAGE, LOCALES, SUPPORTED_LANGUAGES
except ImportError:  # pragma: no cover - direct script execution
    from dashboard_locales import DEFAULT_LANGUAGE, LOCALES, SUPPORTED_LANGUAGES


def _resolve_locale(language: str | None) -> dict[str, Any]:
    return LOCALES[_normalize_language(language)]


def _normalize_language(language: str | None) -> str:
    raw = str(language or "").strip().lower()
    if raw in SUPPORTED_LANGUAGES:
        return raw
    if not raw:
        raise ValueError(
            "Dashboard language must be set explicitly to 'zh' or 'en'. "
            "Pass language or set report_data['ui']['language']."
        )
    raise ValueError(
        f"Unsupported dashboard language: {language!r}. Only 'zh' and 'en' are supported."
    )


def _html_lang_attr(language: str) -> str:
    return {"zh": "zh-CN", "en": "en"}.get(language, language)


def _validate_dashboard_language(report_data: dict[str, Any]) -> str:
    ui = report_data.get("ui")
    if not isinstance(ui, dict):
        raise ValueError(
            "Dashboard payload is missing ui.language. "
            "Use build_dashboard_data(..., language=...) or provide it manually."
        )
    return _normalize_language(ui.get("language"))


# ---------------------------------------------------------------------------
# Data loading (from 3 standard files)
# ---------------------------------------------------------------------------

def _load_equity_csv(path: str | Path) -> list[dict[str, Any]]:
    rows = []
    with open(path, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append({"date": row["date"], "value": float(row["value"])})
    return rows


def _load_trades_csv(path: str | Path) -> list[dict[str, Any]]:
    rows = []
    with open(path, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            for k in ("size", "entry_price", "exit_price", "pnl", "pnl_pct"):
                if row.get(k):
                    try:
                        row[k] = float(row[k])
                    except (TypeError, ValueError):
                        pass
            if row.get("holding_bars"):
                try:
                    row["holding_bars"] = int(float(row["holding_bars"]))
                except (TypeError, ValueError):
                    pass
            rows.append(row)
    return rows


def _market_prefers_stock_name(market: str | None) -> bool:
    return (market or "").strip().lower() in {
        "china_a", "a股", "cn", "cn-stock",
        "hong_kong", "hk", "hk-stock",
    }


def _looks_like_cn_or_hk_symbol(symbol: Any) -> bool:
    text = str(symbol or "").strip().upper()
    return text.endswith((".SH", ".SZ", ".BJ", ".HK"))


def _first_non_empty(trade: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = trade.get(key)
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return ""


def _resolve_trade_display_symbol(
    trade: dict[str, Any],
    market: str | None,
    language: str | None = None,
) -> str:
    language = _normalize_language(language) if language else None
    symbol = _first_non_empty(trade, "symbol")
    symbol_name = _first_non_empty(trade, "symbol_name", "name")
    explicit = _first_non_empty(trade, "display_symbol")
    is_cn_or_hk = _market_prefers_stock_name(market) or _looks_like_cn_or_hk_symbol(symbol)

    # Language lock beats market-based display fallbacks for China/HK names.
    if language == "en" and is_cn_or_hk:
        return symbol or explicit or symbol_name
    if language == "zh" and is_cn_or_hk:
        return symbol_name or explicit or symbol

    if explicit:
        return explicit
    if is_cn_or_hk:
        return symbol_name or symbol
    return symbol or symbol_name


def _normalize_trade_history_display(
    trade_history: list[dict[str, Any]],
    market: str | None = None,
    language: str | None = None,
) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for trade in trade_history or []:
        row = dict(trade)
        if not _first_non_empty(row, "symbol_name"):
            fallback_name = _first_non_empty(row, "name")
            if fallback_name:
                row["symbol_name"] = fallback_name
        display_symbol = _resolve_trade_display_symbol(row, market, language=language)
        if display_symbol:
            row["display_symbol"] = display_symbol
        normalized.append(row)
    return normalized


def _load_summary_json(path: str | Path) -> dict[str, Any]:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# Top-level API
# ---------------------------------------------------------------------------

def build_dashboard_data(
    equity_csv: str | Path | None = None,
    trades_csv: str | Path | None = None,
    summary_json: str | Path | None = None,
    equity_curve: list[dict[str, Any]] | None = None,
    trade_history: list[dict[str, Any]] | None = None,
    summary: dict[str, Any] | None = None,
    meta: dict[str, Any] | None = None,
    language: str | None = None,
    market: str | None = None,
    event_overview_mode: str | None = None,
    extra_modules: list[dict[str, Any]] | None = None,
    ui_overrides: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build the report_data dict for the dashboard template.

    Pass EITHER file paths (equity_csv, trades_csv, summary_json)
    OR pre-loaded data (equity_curve, trade_history, summary, meta).
    ``language`` is required and must be ``"zh"`` or ``"en"``.
    It should follow the user-facing output language.
    Event studies must set ``event_overview_mode`` explicitly to ``"stats"``
    or ``"timeline"``. No query-based inference is performed.
    To add narrative cards, comparisons, or custom tabs, pass standard
    dashboard modules via ``extra_modules`` and optional UI changes via
    ``ui_overrides``. ``sections`` is intentionally not supported.
    """
    language = _normalize_language(language)

    # Load from files if paths given
    if equity_csv and equity_curve is None:
        equity_curve = _load_equity_csv(equity_csv)
    if trades_csv and trade_history is None:
        trade_history = _load_trades_csv(trades_csv)
    if summary_json and (summary is None or meta is None):
        payload = _load_summary_json(summary_json)
        if summary is None:
            summary = payload.get("summary", {})
        if meta is None:
            meta = payload.get("meta", {})

    equity_curve = equity_curve or []
    trade_history = trade_history or []
    summary = summary or {}
    meta = dict(meta or {})

    if market is None:
        market = meta.get("market")

    trade_history = _normalize_trade_history_display(
        trade_history,
        market=market,
        language=language,
    )

    report_kind = _detect_report_kind(
        meta=meta,
        summary=summary,
        trade_history=trade_history,
        equity_curve=equity_curve,
    )

    if report_kind == "event_study" and not equity_curve:
        resolved_event_overview_mode = _require_event_overview_mode(
            explicit_mode=event_overview_mode,
            meta=meta,
        )
        meta["event_overview_mode"] = resolved_event_overview_mode
        if resolved_event_overview_mode in {"timeline", "both"}:
            equity_curve = _build_event_pnl_curve(trade_history)
    elif report_kind == "event_study":
        meta["event_overview_mode"] = _require_event_overview_mode(
            explicit_mode=event_overview_mode,
            meta=meta,
        )

    window_start_value = (
        _safe_float(equity_curve[0]["value"]) if equity_curve else
        _safe_float(meta.get("window_start_value")) or _safe_float(meta.get("initial_cash")) or 0.0
    )

    if equity_curve:
        meta.setdefault("window_start_value", window_start_value)
    if report_kind == "event_study":
        if equity_curve:
            meta.setdefault("initial_cash", window_start_value)
        meta.setdefault("report_kind", "event_study")
        summary = _merge_summary_defaults(_compute_event_summary(trade_history), summary)
    else:
        if equity_curve and window_start_value:
            summary = _merge_summary_defaults(
                _compute_window_summary(equity_curve, trade_history, window_start_value),
                summary,
            )
        meta.setdefault("report_kind", "strategy")

    drawdown_curve = _build_drawdown_curve(equity_curve)
    pnl_curve = [
        {"date": point["date"], "pnl": float(point["value"]) - float(window_start_value)}
        for point in equity_curve
    ]

    report_data = {
        "meta": meta,
        "summary": summary,
        "equity_curve": equity_curve,
        "pnl_curve": pnl_curve,
        "drawdown_curve": drawdown_curve,
        "trade_history": trade_history,
    }
    report_data["ui"] = _merge_ui_overrides(
        _build_default_ui(report_data, language=language),
        ui_overrides,
    )
    report_data["modules"] = _build_default_modules(report_data, language=language, market=market)
    if extra_modules:
        report_data["modules"].extend(extra_modules)
    return report_data


def render_dashboard(
    report_data: dict[str, Any],
    output_path: str | Path,
    template_path: str | Path | None = None,
) -> Path:
    if report_data.get("sections") is not None:
        raise ValueError(
            "`sections` is no longer supported; use report_data['modules'] instead."
        )
    template_file = Path(template_path) if template_path else Path(__file__).with_name(
        "dashboard_template.html"
    )
    template = template_file.read_text(encoding="utf-8")
    _validate_template_source(template, template_file)
    _warn_missing_event_labels(report_data)
    _validate_event_marker_alignment(report_data)
    dashboard_language = _validate_dashboard_language(report_data)

    title = report_data.get("meta", {}).get("strategy_name") or "Backtest Dashboard"
    report_json = _json_for_html(report_data)

    rendered = (
        template.replace("__REPORT_TITLE__", html.escape(title))
        .replace("__HTML_LANG__", html.escape(_html_lang_attr(dashboard_language)))
        .replace("__REPORT_DATA__", report_json)
    )

    output_file = Path(output_path)
    output_file.write_text(rendered, encoding="utf-8")
    return output_file


# ---------------------------------------------------------------------------
# Trade markers
# ---------------------------------------------------------------------------

def _is_truthy_flag(value: Any, default: bool = True) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    text = str(value).strip().lower()
    if not text:
        return default
    if text in {"0", "false", "no", "n", "off"}:
        return False
    if text in {"1", "true", "yes", "y", "on"}:
        return True
    return default


def _event_marker_enabled(trade: dict[str, Any]) -> bool:
    """Whether this event row should produce a chart marker.

    Default is True. Set ``show_marker=False`` to keep an event only in the
    table but not on the chart. ``marker_required`` is accepted as a fallback
    alias for compatibility with hand-written payloads.
    """
    if "show_marker" in trade:
        return _is_truthy_flag(trade.get("show_marker"), default=True)
    if "marker_required" in trade:
        return _is_truthy_flag(trade.get("marker_required"), default=True)
    return True


def _resolve_event_marker_date(trade: dict[str, Any]) -> str | None:
    explicit = trade.get("event_date")
    if explicit:
        return str(explicit)

    anchor = str(trade.get("event_anchor") or "").strip().lower()
    entry_date = trade.get("entry_date")
    exit_date = trade.get("exit_date")
    if anchor == "exit":
        return str(exit_date) if exit_date else (str(entry_date) if entry_date else None)
    if anchor == "entry":
        return str(entry_date) if entry_date else (str(exit_date) if exit_date else None)
    return str(entry_date) if entry_date else (str(exit_date) if exit_date else None)


def _build_trade_markers(
    trade_history: list[dict[str, Any]],
    market: str | None = None,
) -> list[dict[str, Any]]:
    """Convert closed trades into entry/exit markers for the overview chart."""
    is_china_a_long_only = (market or "").lower() in {"china_a", "a股", "cn", "cn-stock"}

    markers: list[dict[str, Any]] = []
    for trade in trade_history or []:
        side = (trade.get("side") or "long").lower()
        is_short = side == "short"

        if is_short and is_china_a_long_only:
            raise ValueError(
                "A-share single-name strategies must not emit side='short'. "
                "Check whether a sell path was accidentally turned into a short entry. "
                f"Offending trade: {trade}"
            )

        entry_date = trade.get("entry_date")
        exit_date = trade.get("exit_date")
        entry_price = trade.get("entry_price")
        exit_price = trade.get("exit_price")
        pnl = trade.get("pnl")
        pnl_pct = trade.get("pnl_pct")

        if entry_date:
            markers.append({
                "date": entry_date,
                "action": "short" if is_short else "buy",
                "price": entry_price,
                "size": trade.get("size"),
                "symbol": _resolve_trade_display_symbol(trade, market),
                "label": trade.get("label"),
            })
        if exit_date:
            markers.append({
                "date": exit_date,
                "action": "cover" if is_short else "sell",
                "price": exit_price,
                "size": trade.get("size"),
                "symbol": _resolve_trade_display_symbol(trade, market),
                "pnl": pnl,
                "pnl_pct": pnl_pct,
            })
    return markers


def _build_event_markers(
    trade_history: list[dict[str, Any]],
    market: str | None = None,
) -> list[dict[str, Any]]:
    """Convert event-study rows into one marker per event.

    Event studies care about "what happened on this event" more than
    entry/exit execution glyphs. The default marker therefore anchors each
    row to a single event date (explicit ``event_date`` or entry_date by
    default, optionally exit_date via ``event_anchor='exit'``).
    """
    markers: list[dict[str, Any]] = []
    for trade in trade_history or []:
        if not _event_marker_enabled(trade):
            continue
        event_date = _resolve_event_marker_date(trade)
        if not event_date:
            continue
        markers.append({
            "date": event_date,
            "action": "event",
            "price": trade.get("entry_price"),
            "size": trade.get("size"),
            "symbol": _resolve_trade_display_symbol(trade, market),
            "label": trade.get("label"),
            "pnl": trade.get("pnl"),
            "pnl_pct": trade.get("pnl_pct"),
            "entry_date": trade.get("entry_date"),
            "exit_date": trade.get("exit_date"),
            "entry_price": trade.get("entry_price"),
            "exit_price": trade.get("exit_price"),
            "event_anchor": trade.get("event_anchor"),
        })
    return markers


# ---------------------------------------------------------------------------
# Drawdown / summary / slicing
# ---------------------------------------------------------------------------

def _build_drawdown_curve(equity_curve: list[dict[str, Any]]) -> list[dict[str, float | str]]:
    drawdown_curve = []
    peak = None
    for point in equity_curve:
        value = _safe_float(point.get("value"))
        if value is None:
            continue
        peak = value if peak is None else max(peak, value)
        drawdown_pct = 0.0 if not peak else (value / peak - 1.0) * 100.0
        drawdown_abs = 0.0 if peak is None else peak - value
        drawdown_curve.append({
            "date": point["date"],
            "drawdown_pct": drawdown_pct,
            "drawdown_abs": drawdown_abs,
        })
    return drawdown_curve


def _compute_window_summary(
    equity_curve: list[dict[str, Any]],
    trade_history: list[dict[str, Any]],
    base_value: float,
) -> dict[str, Any]:
    if not equity_curve or not base_value:
        return {
            "total_return_pct": None, "annual_return_pct": None,
            "max_drawdown_pct": None, "sharpe": None,
            "win_rate_pct": 0.0, "total_trades": 0,
        }

    final_value = _safe_float(equity_curve[-1].get("value")) or base_value
    total_return = final_value / base_value - 1.0
    returns = []
    prev_value = None
    for point in equity_curve:
        value = _safe_float(point.get("value"))
        if value is None:
            continue
        if prev_value and prev_value != 0:
            returns.append(value / prev_value - 1.0)
        prev_value = value

    total_trades = len(trade_history)
    winning_trades = sum(1 for t in trade_history if (_safe_float(t.get("pnl")) or 0.0) > 0)
    win_rate_pct = winning_trades / total_trades * 100.0 if total_trades else 0.0
    drawdown_curve = _build_drawdown_curve(equity_curve)
    max_drawdown_pct = (
        abs(min(p["drawdown_pct"] for p in drawdown_curve)) if drawdown_curve else None
    )

    annual_return_pct = None
    sharpe = None
    annual_factor = _infer_annual_factor(equity_curve)
    if annual_factor and returns:
        periods = len(returns)
        annual_return_pct = ((1.0 + total_return) ** (annual_factor / periods) - 1.0) * 100.0
        if len(returns) > 1:
            mean_ret = sum(returns) / len(returns)
            variance = sum((ret - mean_ret) ** 2 for ret in returns) / (len(returns) - 1)
            std = math.sqrt(variance)
            if std > 0:
                sharpe = mean_ret / std * math.sqrt(annual_factor)

    return {
        "total_return_pct": total_return * 100.0,
        "annual_return_pct": annual_return_pct,
        "max_drawdown_pct": max_drawdown_pct,
        "sharpe": sharpe,
        "win_rate_pct": win_rate_pct,
        "total_trades": total_trades,
    }


def _compute_event_summary(trade_history: list[dict[str, Any]]) -> dict[str, Any]:
    total_trades = len(trade_history)
    returns = [
        ret for ret in (_safe_float(trade.get("pnl_pct")) for trade in trade_history)
        if ret is not None
    ]
    if not returns:
        return {
            "total_return_pct": None,
            "avg_return_pct": None,
            "median_return_pct": None,
            "best_trade_pct": None,
            "worst_trade_pct": None,
            "win_rate_pct": 0.0,
            "total_trades": total_trades,
        }

    ordered = sorted(returns)
    mid = len(ordered) // 2
    median_return = (
        ordered[mid]
        if len(ordered) % 2 == 1 else
        (ordered[mid - 1] + ordered[mid]) / 2.0
    )
    winning_trades = sum(1 for ret in returns if ret > 0)
    return {
        "total_return_pct": sum(returns),
        "avg_return_pct": sum(returns) / len(returns),
        "median_return_pct": median_return,
        "best_trade_pct": max(returns),
        "worst_trade_pct": min(returns),
        "win_rate_pct": winning_trades / len(returns) * 100.0,
        "total_trades": total_trades,
    }


def _parse_timestamp(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime.combine(value, datetime.min.time())
    text = str(value).strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        try:
            return datetime.combine(date.fromisoformat(text), datetime.min.time())
        except ValueError:
            return None


def _slice_timeseries(points: list[dict[str, Any]], start: str | None, end: str | None) -> list[dict[str, Any]]:
    start_dt = _parse_timestamp(start)
    end_dt = _parse_timestamp(end)
    if start_dt is None and end_dt is None:
        return list(points)
    filtered = []
    for point in points:
        point_dt = _parse_timestamp(point.get("date"))
        if point_dt is None:
            continue
        if start_dt is not None and point_dt < start_dt:
            continue
        if end_dt is not None and point_dt > end_dt:
            continue
        filtered.append(point)
    return filtered


def _slice_trade_history(trade_history: list[dict[str, Any]], start: str | None, end: str | None) -> list[dict[str, Any]]:
    start_dt = _parse_timestamp(start)
    end_dt = _parse_timestamp(end)
    if start_dt is None and end_dt is None:
        return list(trade_history)
    filtered = []
    for trade in trade_history:
        ref_dt = _parse_timestamp(trade.get("exit_date")) or _parse_timestamp(trade.get("entry_date"))
        if ref_dt is None:
            filtered.append(trade)
            continue
        if start_dt is not None and ref_dt < start_dt:
            continue
        if end_dt is not None and ref_dt > end_dt:
            continue
        filtered.append(trade)
    return filtered


def _infer_annual_factor(equity_curve: list[dict[str, Any]]) -> float | None:
    if len(equity_curve) < 2:
        return None
    timestamps = [_parse_timestamp(p.get("date")) for p in equity_curve]
    timestamps = [ts for ts in timestamps if ts is not None]
    if len(timestamps) < 2:
        return None

    per_day_counts: dict[date, int] = {}
    for ts in timestamps:
        per_day_counts[ts.date()] = per_day_counts.get(ts.date(), 0) + 1
    avg_bars_per_day = sum(per_day_counts.values()) / len(per_day_counts)

    deltas = []
    prev_ts = timestamps[0]
    for ts in timestamps[1:]:
        delta_seconds = (ts - prev_ts).total_seconds()
        if delta_seconds > 0:
            deltas.append(delta_seconds)
        prev_ts = ts
    if not deltas:
        return None

    deltas.sort()
    mid = len(deltas) // 2
    median_delta = deltas[mid] if len(deltas) % 2 == 1 else (deltas[mid - 1] + deltas[mid]) / 2.0
    if median_delta <= 0:
        return None

    median_days = median_delta / (24 * 60 * 60)
    if avg_bars_per_day > 1.0:
        return avg_bars_per_day * 252.0
    if median_days <= 2.0:
        return 252.0
    if median_days <= 10.0:
        return 52.0
    if median_days <= 40.0:
        return 12.0
    if median_days <= 120.0:
        return 4.0
    return 1.0


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _safe_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(result) or math.isinf(result):
        return None
    return result


def _json_for_html(data: dict[str, Any]) -> str:
    return (
        json.dumps(data, ensure_ascii=False)
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace("&", "\\u0026")
    )


def _merge_summary_defaults(defaults: dict[str, Any], overrides: dict[str, Any]) -> dict[str, Any]:
    merged = dict(defaults)
    for key, value in overrides.items():
        if value is not None:
            merged[key] = value
    return merged


def _warn_missing_event_labels(report_data: dict[str, Any]) -> None:
    """Warn on stderr when event-study markers mostly lack labels.

    Heuristic: if an overview_chart has <= 30 event markers and more than 30% of
    them miss `label`, it is probably an event-study payload where the LLM forgot
    to include event descriptions. This stays as a warning instead of a hard
    error to avoid breaking legitimate custom cases.
    """
    import sys
    for module in report_data.get("modules") or []:
        if module.get("type") != "overview_chart":
            continue
        markers = module.get("markers") or []
        event_markers = [
            m for m in markers if (m.get("action") or "").lower() == "event"
        ]
        if not event_markers or len(event_markers) > 30:
            continue
        missing = [m for m in event_markers if not m.get("label")]
        if not missing:
            continue
        ratio = len(missing) / len(event_markers)
        if ratio <= 0.3:
            continue
        print(
            f"[render_dashboard WARN] overview_chart has {len(event_markers)} event "
            f"markers, and {len(missing)} of them ({ratio:.0%}) are missing `label`."
            " If this is an event study, every event marker should carry an event "
            "description; otherwise users cannot tell what each marker represents. "
            "See the event-study dashboard rules in SKILL.md.",
            file=sys.stderr,
        )


def _validate_event_marker_alignment(report_data: dict[str, Any]) -> None:
    """For event studies, ensure overview markers align with event-table rows.

    Each trades_table row represents one event, and overview_chart normally draws
    one event marker per row. A row may opt out with ``show_marker=False``.
    If overview points do not cover some event_date values (defaulting to
    entry_date, optionally overridden by event_date / event_anchor), the template
    would silently drop those markers. Hard-fail before writing HTML so the user
    never gets a dashboard where the table has an event but the chart does not.
    """
    report_kind = (report_data.get("meta", {}).get("report_kind") or "").lower()
    if report_kind != "event_study":
        return

    modules = report_data.get("modules") or []
    overview_modules = [m for m in modules if m.get("type") == "overview_chart"]
    trade_tables = [m for m in modules if m.get("type") == "trades_table"]
    if not overview_modules or not trade_tables:
        return

    def _rows_for_tab(tab_id: Any) -> list[dict[str, Any]]:
        for module in trade_tables:
            if module.get("tab") == tab_id:
                return list(module.get("rows") or [])
        return list(report_data.get("trade_history") or [])

    def _format_examples(values: list[str]) -> str:
        if not values:
            return ""
        preview = ", ".join(values[:5])
        if len(values) > 5:
            preview += ", ..."
        return preview

    for overview in overview_modules:
        tab_id = overview.get("tab")
        rows = _rows_for_tab(tab_id)
        if not rows:
            continue

        points = [
            point for point in (overview.get("points") or [])
            if point and point.get("date") and point.get("equity") is not None
        ]
        point_dates = {str(point["date"]) for point in points}
        markers = overview.get("markers") or []
        visible_markers = [
            marker for marker in markers
            if str(marker.get("action") or "").lower() == "event"
            and marker.get("date") is not None
            and str(marker.get("date")) in point_dates
        ]

        expected_rows = [row for row in rows if _event_marker_enabled(row)]
        if not expected_rows:
            continue
        missing_event_dates = []
        for row in expected_rows:
            event_date = _resolve_event_marker_date(row)
            if not event_date or event_date not in point_dates:
                missing_event_dates.append(str(event_date))

        if len(visible_markers) != len(expected_rows):
            sample = _format_examples(missing_event_dates)
            hint = (
                f" Example missing / misaligned event dates: {sample}."
                if sample else ""
            )
            raise ValueError(
                "Event-study dashboard validation failed: overview_chart has "
                f"{len(visible_markers)} visible event markers, but the trades_table "
                f"on the same tab has {len(expected_rows)} rows. "
                "Check whether event_date / event_anchor (default entry_date) "
                "all land on overview_chart.points.date."
                + hint
            )


def _detect_report_kind(
    meta: dict[str, Any],
    summary: dict[str, Any],
    trade_history: list[dict[str, Any]],
    equity_curve: list[dict[str, Any]],
) -> str:
    explicit = _explicit_report_kind(meta)
    if explicit:
        return explicit

    if any(summary.get(key) is not None for key in (
        "avg_return_pct",
        "median_return_pct",
        "best_trade_pct",
        "worst_trade_pct",
    )):
        return "event_study"

    if not trade_history:
        return "strategy"

    has_event_labels = any(str(trade.get("label") or "").strip() for trade in trade_history)
    has_event_returns = any(_safe_float(trade.get("pnl_pct")) is not None for trade in trade_history)
    has_strategy_metrics = any(summary.get(key) is not None for key in (
        "annual_return_pct",
        "max_drawdown_pct",
        "sharpe",
    ))
    if has_event_returns and not has_strategy_metrics and (has_event_labels or not equity_curve):
        return "event_study"
    return "strategy"


def _explicit_report_kind(meta: dict[str, Any]) -> str | None:
    for key in ("report_kind", "report_type", "analysis_type", "backtest_type", "scenario"):
        raw = meta.get(key)
        if raw is None:
            continue
        text = str(raw).strip().lower()
        if not text:
            continue
        if "event" in text or "事件" in text:
            return "event_study"
        if "strategy" in text or "backtest" in text or "策略" in text:
            return "strategy"
    return None


def _require_event_overview_mode(
    explicit_mode: str | None,
    meta: dict[str, Any],
) -> str:
    explicit = _normalize_event_overview_mode(explicit_mode)
    if explicit is not None:
        return explicit

    meta_mode = _normalize_event_overview_mode(meta.get("event_overview_mode"))
    if meta_mode is not None:
        return meta_mode

    raise ValueError(
        "Event-study dashboards must set event_overview_mode explicitly to "
        "'stats', 'timeline', or 'both'. Pass it into build_dashboard_data(...) "
        "or set meta['event_overview_mode']."
    )


def _normalize_event_overview_mode(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip().lower()
    if not text:
        return None
    if text in {"stats", "timeline", "both"}:
        return text
    return None


def _build_event_pnl_curve(trade_history: list[dict[str, Any]]) -> list[dict[str, Any]]:
    dated_points: dict[str, datetime] = {}
    realized_returns: dict[str, float] = {}

    for trade in trade_history:
        event_date = trade.get("event_date")
        entry_date = trade.get("entry_date")
        exit_date = trade.get("exit_date")
        for raw_date in (event_date, entry_date, exit_date):
            parsed = _parse_timestamp(raw_date)
            if raw_date and parsed is not None:
                dated_points.setdefault(str(raw_date), parsed)

        realized_date = exit_date or entry_date
        realized_ret = _safe_float(trade.get("pnl_pct"))
        parsed_realized = _parse_timestamp(realized_date)
        if realized_date and realized_ret is not None and parsed_realized is not None:
            key = str(realized_date)
            dated_points.setdefault(key, parsed_realized)
            realized_returns[key] = realized_returns.get(key, 0.0) + realized_ret

    if not dated_points:
        return []

    cumulative = 0.0
    curve: list[dict[str, Any]] = []
    for raw_date, _ in sorted(dated_points.items(), key=lambda item: (item[1], item[0])):
        cumulative += realized_returns.get(raw_date, 0.0)
        curve.append({"date": raw_date, "value": 100.0 + cumulative})
    return curve


def _validate_template_source(template: str, template_file: Path) -> None:
    """Guard against HTML-in-JS / HTML-in-CSS literal-closing-tag pitfalls.

    Example failure this catches:

        <script>
          // Close with </script>    ← browser stops HERE, not at the real end
          ...
        </script>

    The browser's HTML parser doesn't understand JS comments — any literal
    ``</script>`` inside a ``<script>`` body terminates the block early. The
    resulting page looks blank with a SyntaxError in devtools.

    Detection: count ``<script>`` opens vs ``</script>`` closes across the
    whole template. A matched template has equal counts. An extra close
    means someone wrote a literal ``</script>`` inside a block — exactly
    the pitfall that bites us. Same logic for ``<style>``. Opening tags
    inside script bodies are harmless (browser treats them as text while
    in script mode), so we don't flag ``opens > closes``.
    """
    for opener, closer in (("<script", "</script"), ("<style", "</style")):
        open_re = re.compile(r"<" + opener[1:] + r"\b[^>]*>", re.IGNORECASE)
        close_re = re.compile(r"</" + opener[1:] + r"\s*>", re.IGNORECASE)
        open_count = len(open_re.findall(template))
        close_count = len(close_re.findall(template))
        if close_count > open_count:
            # Find the first extra closer after its matching opener, so
            # the error message points at the troublesome line.
            opens = [m.end() for m in open_re.finditer(template)]
            closes = [m.start() for m in close_re.finditer(template)]
            extra_pos = None
            oi = 0
            for cpos in closes:
                if oi < len(opens) and opens[oi] < cpos:
                    oi += 1
                else:
                    extra_pos = cpos
                    break
            if extra_pos is None:
                extra_pos = closes[-1]
            line_no = template.count("\n", 0, extra_pos) + 1
            raise ValueError(
                f"{template_file} line {line_no} contains an unescaped {closer}>. "
                f"It will terminate the {opener}> block early and blank the page. "
                f"Rewrite the literal, for example '<\\{closer[1:]}>'."
            )


# ---------------------------------------------------------------------------
# Default UI + modules
# ---------------------------------------------------------------------------

def _build_default_ui(report_data: dict[str, Any], language: str) -> dict[str, Any]:
    language = _normalize_language(language)
    L = _resolve_locale(language)
    tabs = [{"id": "overview", "label": L["tab_overview"]}]
    if (
        (report_data.get("meta", {}).get("report_kind") or "").lower() == "event_study"
        and (_normalize_event_overview_mode(report_data.get("meta", {}).get("event_overview_mode")) == "both")
    ):
        tabs.append({"id": "timeline", "label": "Timeline"})
    return {
        "subtitle": L["subtitle"],
        "active_tab": "overview",
        "tabs": tabs,
        "topbar_menu": [],
        "window_status": "",
        "language": language,
        "i18n": L["i18n"],
    }


def _merge_ui_overrides(base_ui: dict[str, Any], overrides: dict[str, Any] | None) -> dict[str, Any]:
    if not overrides:
        return base_ui
    merged = dict(base_ui)
    for key, value in overrides.items():
        if key == "i18n" and isinstance(value, dict):
            merged["i18n"] = {**base_ui.get("i18n", {}), **value}
        else:
            merged[key] = value
    return merged


def _build_default_modules(
    report_data: dict[str, Any],
    language: str | None = None,
    market: str | None = None,
) -> list[dict[str, Any]]:
    if (report_data.get("meta", {}).get("report_kind") or "").lower() == "event_study":
        return _build_event_modules(report_data, language=language, market=market)

    L = _resolve_locale(language)
    summary = report_data.get("summary", {})
    meta = report_data.get("meta", {})
    equity_curve = report_data.get("equity_curve", [])
    drawdown_curve = report_data.get("drawdown_curve", [])
    trade_history = report_data.get("trade_history", [])
    if market is None:
        market = meta.get("market")

    total_return_pct = summary.get("total_return_pct")
    final_value_pct = (
        (1 + total_return_pct / 100.0) * 100.0 if total_return_pct is not None else None
    )

    overview_stats = [
        _kpi(L["kpi_total_pnl"], numberFormatPy(total_return_pct, suffix="%"), raw=total_return_pct),
        _kpi(L["kpi_max_dd"], numberFormatPy(summary.get("max_drawdown_pct"), suffix="%"), raw=-abs(summary.get("max_drawdown_pct") or 0)),
        _kpi(L["kpi_total_trades"], str(summary.get("total_trades", 0))),
        _kpi(L["kpi_win_rate"], numberFormatPy(summary.get("win_rate_pct"), suffix="%"), raw=summary.get("win_rate_pct")),
        _kpi(L["kpi_sharpe"], numberFormatPy(summary.get("sharpe"), digits=3), raw=summary.get("sharpe")),
    ]

    metric_rows = [
        _metric_row(L["metric_net_profit"], [_metric(numberFormatPy(total_return_pct, suffix="%"), raw=total_return_pct)]),
        _metric_row(L["metric_annual_return"], [_metric(numberFormatPy(summary.get("annual_return_pct"), suffix="%"), raw=summary.get("annual_return_pct"))]),
        _metric_row(L["metric_max_drawdown"], [_metric(numberFormatPy(summary.get("max_drawdown_pct"), suffix="%"), raw=-abs(summary.get("max_drawdown_pct") or 0))]),
        _metric_row(L["metric_total_trades"], [_metric(str(summary.get("total_trades", 0)))]),
        _metric_row(L["metric_win_rate"], [_metric(numberFormatPy(summary.get("win_rate_pct"), suffix="%"), raw=summary.get("win_rate_pct"))]),
        _metric_row(L["metric_final_value"], [_metric(numberFormatPy(final_value_pct, suffix="%"), raw=final_value_pct)]),
    ]

    show_symbol_column = any(_first_non_empty(trade, "display_symbol", "symbol") for trade in trade_history)
    trade_columns = []
    if show_symbol_column:
        trade_columns.append({"key": "display_symbol", "label": L["i18n"]["trades_col_symbol"], "format": "text"})
    trade_columns.extend([
        {"key": "side", "label": L["i18n"]["trades_col_side"], "format": "pill"},
        {"key": "entry_date", "label": L["i18n"]["trades_col_entry_date"], "format": "text"},
        {"key": "exit_date", "label": L["i18n"]["trades_col_exit_date"], "format": "text"},
        {"key": "holding_bars", "label": L["i18n"]["trades_col_holding"], "format": "text"},
        {"key": "size", "label": L["i18n"]["trades_col_size"], "format": "number"},
        {"key": "entry_price", "label": L["i18n"]["trades_col_entry_price"], "format": "number"},
        {"key": "exit_price", "label": L["i18n"]["trades_col_exit_price"], "format": "number"},
        {"key": "pnl", "label": L["i18n"]["trades_col_pnl"], "format": "sign"},
        {"key": "pnl_pct", "label": L["i18n"]["trades_col_pnl_pct"], "format": "pct"},
    ])

    modules = [
        {
            "type": "overview_chart",
            "tab": "overview",
            "width": "full",
            "stats": overview_stats,
            "points": _merge_overview_points(equity_curve, drawdown_curve, meta.get("window_start_value")),
            "markers": _build_trade_markers(trade_history, market=market),
            "series_key": "equity",
            "stroke": "#f23645",
            "area_fill": "rgba(181,126,255,0.18)",
            "bars_key": "drawdown_abs",
            "bars_fill": "rgba(181,126,255,0.32)",
            "toggles": [
                {"id": "equity", "label": L["toggle_equity"], "checked": True},
                {"id": "drawdown", "label": L["toggle_drawdown"], "checked": True},
                {"id": "trades", "label": L["toggle_trades"], "checked": True},
            ],
            "modes": [
                {"id": "percentage", "label": L["mode_percentage"], "active": True},
                {"id": "absolute", "label": L["mode_absolute"], "active": False},
            ],
        },
        {
            "type": "metric_table",
            "tab": "overview",
            "title": L["metric_table_title"],
            "subtitle": f"{meta.get('strategy_name') or 'Strategy'} · {L['metric_table_subtitle_suffix']}",
            "columns": [L["col_metric"], L["col_all"]],
            "rows": metric_rows,
        },
        {
            "type": "trades_table",
            "tab": "overview",
            "title": L["trades_title"],
            "subtitle": L["trades_subtitle"],
            "rows": trade_history,
            "columns": trade_columns,
        },
    ]

    return modules


def _build_event_modules(
    report_data: dict[str, Any],
    language: str | None = None,
    market: str | None = None,
) -> list[dict[str, Any]]:
    L = _resolve_locale(language)
    summary = report_data.get("summary", {})
    meta = report_data.get("meta", {})
    equity_curve = report_data.get("equity_curve", [])
    drawdown_curve = report_data.get("drawdown_curve", [])
    trade_history = report_data.get("trade_history", [])
    event_overview_mode = _normalize_event_overview_mode(meta.get("event_overview_mode")) or "stats"
    if market is None:
        market = meta.get("market")

    overview_stats = [
        _kpi(L["kpi_event_pnl"], numberFormatPy(summary.get("total_return_pct"), suffix="%"), raw=summary.get("total_return_pct")),
        _kpi(L["kpi_total_events"], str(summary.get("total_trades", 0))),
        _kpi(L["kpi_win_rate"], numberFormatPy(summary.get("win_rate_pct"), suffix="%"), raw=summary.get("win_rate_pct")),
        _kpi(L["kpi_avg_return"], numberFormatPy(summary.get("avg_return_pct"), suffix="%"), raw=summary.get("avg_return_pct")),
        _kpi(L["kpi_median_return"], numberFormatPy(summary.get("median_return_pct"), suffix="%"), raw=summary.get("median_return_pct")),
    ]
    metric_rows = [
        _metric_row(L["metric_cumulative_return"], [_metric(numberFormatPy(summary.get("total_return_pct"), suffix="%"), raw=summary.get("total_return_pct"))]),
        _metric_row(L["metric_avg_return"], [_metric(numberFormatPy(summary.get("avg_return_pct"), suffix="%"), raw=summary.get("avg_return_pct"))]),
        _metric_row(L["metric_median_return"], [_metric(numberFormatPy(summary.get("median_return_pct"), suffix="%"), raw=summary.get("median_return_pct"))]),
        _metric_row(L["metric_total_events"], [_metric(str(summary.get("total_trades", 0)))]),
        _metric_row(L["metric_win_rate"], [_metric(numberFormatPy(summary.get("win_rate_pct"), suffix="%"), raw=summary.get("win_rate_pct"))]),
        _metric_row(L["metric_best_trade"], [_metric(numberFormatPy(summary.get("best_trade_pct"), suffix="%"), raw=summary.get("best_trade_pct"))]),
        _metric_row(L["metric_worst_trade"], [_metric(numberFormatPy(summary.get("worst_trade_pct"), suffix="%"), raw=summary.get("worst_trade_pct"))]),
    ]

    modules: list[dict[str, Any]] = []
    chart_tab = "timeline" if event_overview_mode == "both" else "overview"
    if event_overview_mode in {"timeline", "both"} and equity_curve:
        modules.append({
            "type": "overview_chart",
            "tab": chart_tab,
            "width": "full",
            "stats": overview_stats,
            "points": _merge_overview_points(equity_curve, drawdown_curve, meta.get("window_start_value")),
            "markers": _build_event_markers(trade_history, market=market),
            "series_key": "equity",
            "stroke": "#f23645",
            "area_fill": "rgba(181,126,255,0.18)",
            "bars_key": "drawdown_abs",
            "bars_fill": "rgba(181,126,255,0.32)",
            "toggles": [
                {"id": "equity", "label": L["toggle_event_pnl"], "checked": True},
                {"id": "drawdown", "label": L["toggle_drawdown"], "checked": False},
                {"id": "trades", "label": L["toggle_trades"], "checked": True},
            ],
            "modes": [
                {"id": "percentage", "label": L["mode_percentage"], "active": True},
                {"id": "absolute", "label": L["mode_absolute"], "active": False},
            ],
            "hide_value_row": True,
            "hide_drawdown_tooltip": True,
            "return_label": L["event_return_label"],
        })

    modules.append({
        "type": "metric_table",
        "tab": "overview",
        "title": L["metric_event_table_title"],
        "subtitle": f"{meta.get('strategy_name') or 'Strategy'} · {L['metric_table_subtitle_suffix']}",
        "columns": [L["col_metric"], L["col_all"]],
        "rows": metric_rows,
    })
    modules.append({
        "type": "trades_table",
        "tab": "overview",
        "title": L["trades_title_event"],
        "subtitle": L["trades_subtitle_event"],
        "rows": trade_history,
        "columns": _build_event_trade_columns(trade_history, language=language),
    })
    return modules


def _merge_overview_points(
    equity_curve: list[dict[str, Any]],
    drawdown_curve: list[dict[str, Any]],
    initial_cash: float | None,
) -> list[dict[str, Any]]:
    dd_map = {
        item["date"]: {
            "drawdown_pct": item.get("drawdown_pct", 0),
            "drawdown_abs": item.get("drawdown_abs", 0),
        }
        for item in drawdown_curve
    }
    points = []
    for item in equity_curve:
        value = _safe_float(item.get("value"))
        if value is None:
            continue
        drawdown_info = dd_map.get(item["date"], {})
        points.append({
            "date": item["date"],
            "equity": value,
            "drawdown_abs": abs(_safe_float(drawdown_info.get("drawdown_abs")) or 0.0),
            "pnl": value - float(initial_cash or 0),
        })
    return points


def _kpi(label: str, value: str, pct: float | None = None, raw: float | None = None) -> dict[str, Any]:
    item = {"label": label, "value": value, "raw": raw}
    if pct is not None:
        item["subvalue"] = numberFormatPy(pct, suffix="%")
        item["subraw"] = pct
    return item


def _metric(main: str, secondary: str | None = None, raw: float | None = None) -> dict[str, Any]:
    return {"main": main, "secondary": secondary, "raw": raw}


def _metric_row(metric: str, values: list[dict[str, Any]]) -> dict[str, Any]:
    return {"metric": metric, "values": values}


def _build_event_trade_columns(
    trade_history: list[dict[str, Any]],
    language: str | None = None,
) -> list[dict[str, Any]]:
    L = _resolve_locale(language)
    columns = [
        {"key": "label", "label": L["i18n"]["trades_col_event"], "format": "text"},
    ]
    if any(_first_non_empty(trade, "display_symbol", "symbol") for trade in trade_history):
        columns.append({"key": "display_symbol", "label": L["i18n"]["trades_col_symbol"], "format": "text"})
    columns.extend([
        {"key": "entry_date", "label": L["i18n"]["trades_col_entry_date"], "format": "text"},
        {"key": "exit_date", "label": L["i18n"]["trades_col_exit_date"], "format": "text"},
        {"key": "pnl_pct", "label": L["i18n"]["trades_col_pnl_pct"], "format": "pct"},
    ])
    return columns


def _money_delta_value(meta: dict[str, Any]) -> float:
    initial_cash = _safe_float(meta.get("window_start_value"))
    if initial_cash is None:
        initial_cash = _safe_float(meta.get("initial_cash")) or 0.0
    final_value = _safe_float(meta.get("final_value")) or 0.0
    return final_value - initial_cash


def numberFormatPy(value: Any, digits: int = 2, suffix: str = "") -> str:
    if value is None:
        return "--"
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return str(value)
    return f"{numeric:,.{digits}f}{suffix}"


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Render a fixed HTML dashboard from a JSON report payload.")
    parser.add_argument("input_json", help="Path to the JSON file containing dashboard data")
    parser.add_argument("output_html", help="Path to the generated HTML file")
    parser.add_argument("--template", dest="template_path", help="Optional custom HTML template path")
    args = parser.parse_args()

    payload = json.loads(Path(args.input_json).read_text(encoding="utf-8"))
    render_dashboard(payload, output_path=args.output_html, template_path=args.template_path)


if __name__ == "__main__":
    main()
