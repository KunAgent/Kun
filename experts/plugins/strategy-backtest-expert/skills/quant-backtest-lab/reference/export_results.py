"""
Standard export for backtest results.

Call export_results(...) after the backtest finishes. It writes 3 files into the
current working directory (cwd):

    <prefix>_equity.csv     date, value
    <prefix>_trades.csv     entry_date, exit_date, side, size, entry_price, exit_price, pnl, pnl_pct, holding_bars, symbol[, symbol_name, display_symbol]
    <prefix>_summary.json   total_return_pct / annual_return_pct / sharpe / max_drawdown_pct / win_rate_pct / total_trades + meta

The downstream dashboard / analysis scripts only read these 3 files.

Defensive rules enforced here:
  1. When the loaded data window is longer than the evaluation window, recompute
     Sharpe / annual return / total return / max drawdown on the evaluation slice.
  2. Enforce A-share long-only: if trade_history contains side="short", raise
     before writing trades.csv.

Usage:

    from reference.export_results import export_results

    # equity_curve: [{"date": "2024-01-02", "value": 1000000.0}, ...]
    # trade_history: [{"entry_date": ..., "exit_date": ..., "side": "long", ...}, ...]

    export_results(
        equity_curve=equity_curve,
        trade_history=trade_history,
        prefix="ma_cross_600519",
        initial_cash=1_000_000,
        start="2024-01-01",
        end="2024-12-31",
        market="china_a",
    )

Write the files directly into cwd, with names such as
ma_cross_600519_equity.csv. Do not create a subdirectory.
"""

from __future__ import annotations

import csv
import json
import math
from datetime import date, datetime
from pathlib import Path
from typing import Any


# Allow a small set of aliases for display fields so a missing standard key does
# not silently fall back to the raw ticker. Keep core execution fields strict to
# avoid hiding trading-logic bugs.
_TRADE_SYMBOL_NAME_KEYS = (
    "symbol_name",
    "name",
    "stock_name",
    "security_name",
    "display_name",
    "asset_name",
    "instrument_name",
    "ticker_name",
)


def _first_non_empty_text(row: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = row.get(key)
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return ""


def _market_prefers_stock_name(market: str | None) -> bool:
    return (market or "").strip().lower() in {
        "china_a",
        "a股",
        "cn",
        "cn-stock",
        "hong_kong",
        "hk",
        "hk-stock",
    }


def _looks_like_cn_or_hk_symbol(symbol: Any) -> bool:
    text = str(symbol or "").strip().upper()
    return text.endswith((".SH", ".SZ", ".BJ", ".HK"))


def _normalize_trade_display_fields(
    trade: dict[str, Any],
    market: str | None = None,
) -> dict[str, Any]:
    row = dict(trade)

    symbol_name = _first_non_empty_text(row, *_TRADE_SYMBOL_NAME_KEYS)
    if symbol_name:
        row["symbol_name"] = symbol_name

    display_symbol = _first_non_empty_text(row, "display_symbol")
    if not display_symbol:
        if _market_prefers_stock_name(market) or _looks_like_cn_or_hk_symbol(row.get("symbol")):
            display_symbol = _first_non_empty_text(
                row,
                "symbol_name",
                "name",
                "stock_name",
                "security_name",
                "display_name",
                "asset_name",
                "instrument_name",
                "ticker_name",
                "symbol",
            )
        else:
            display_symbol = _first_non_empty_text(
                row,
                "symbol",
                "symbol_name",
                "name",
                "stock_name",
                "security_name",
                "display_name",
                "asset_name",
                "instrument_name",
                "ticker_name",
            )
    if display_symbol:
        row["display_symbol"] = display_symbol

    return row


def _normalize_trade_history_for_export(
    trade_history: list[dict[str, Any]],
    market: str | None = None,
) -> list[dict[str, Any]]:
    return [_normalize_trade_display_fields(trade, market=market) for trade in trade_history or []]


# ---------------------------------------------------------------------------
# Top-level export
# ---------------------------------------------------------------------------

def export_results(
    equity_curve: list[dict[str, Any]],
    trade_history: list[dict[str, Any]],
    prefix: str,
    initial_cash: float,
    start: str | None = None,
    end: str | None = None,
    market: str | None = None,
    output_dir: str | Path | None = None,
    strategy_name: str | None = None,
    symbol: str | None = None,
    is_flat_at_end: bool | None = None,
) -> dict[str, Path]:
    """Write backtest results into 3 standard files.

    Args:
        equity_curve: Per-bar equity list, each item like {"date": str, "value": float}.
        trade_history: Closed trades. Each item must contain
            entry_date/exit_date/side/size/entry_price/exit_price/pnl/pnl_pct/
            holding_bars/symbol.
            Optional display fields: symbol_name / display_symbol. For display
            compatibility, export also normalizes common aliases such as
            name / stock_name / security_name / display_name into
            symbol_name / display_symbol.
        prefix: Output filename prefix, for example "ma_cross_600519".
        initial_cash: Initial capital.
        start / end: The formal evaluation window. If the backtest includes a
            warmup segment, these must be passed explicitly. Otherwise summary
            metrics will be computed on the full loaded range, and meta.start/end
            will incorrectly reflect the data start instead of the evaluation
            start.
            If the loaded range already matches the evaluation range, they may be
            omitted. If provided but fully disjoint from the data dates, raise.
        market: "china_a" / "us_stock" / "hong_kong" / None
            Pass "china_a" to enable the long-only short-trade check.
        output_dir: Output directory. Defaults to the current working directory.
        strategy_name / symbol: Written into summary.json meta.
        is_flat_at_end: Whether the backtest script has confirmed there are no
            open positions after the last bar. Passing True is recommended;
            passing False will raise immediately.

    Returns:
        A dict like {"equity": Path, "trades": Path, "summary": Path}.
    """
    out_dir = Path(output_dir) if output_dir else Path.cwd()
    out_dir.mkdir(parents=True, exist_ok=True)

    equity_curve_all = list(equity_curve)
    trade_history_all = list(trade_history)

    report_start = start or (equity_curve_all[0]["date"] if equity_curve_all else None)
    report_end = end or (equity_curve_all[-1]["date"] if equity_curve_all else None)

    eq = _slice_timeseries(equity_curve_all, report_start, report_end)
    # If the raw equity_curve has data but the sliced result is empty, the
    # provided start/end range is completely disjoint from the data dates.
    # Do not silently fall back to the full range; that would recompute summary
    # metrics on warmup data and give the user the wrong evaluation window.
    if equity_curve_all and not eq:
        raise ValueError(
            f"Sliced equity_curve is empty: evaluation window [{report_start}, {report_end}] "
            f"does not overlap with data date range "
            f"[{equity_curve_all[0]['date']}, {equity_curve_all[-1]['date']}]. "
            "Check whether the start/end arguments passed to export_results are correct."
        )

    trades = _slice_trade_history(trade_history_all, report_start, report_end)
    trades = _normalize_trade_history_for_export(trades, market=market)

    # ---- Defensive checks: period-end liquidation should already be done ----
    _enforce_flat_at_end(is_flat_at_end)
    _enforce_closed_trades(trades)

    # ---- Defensive check: A-share long-only must not produce side="short" ----
    _enforce_long_only(trades, market=market)

    # ---- Compute summary on the sliced evaluation window ----
    v = _safe_float(eq[0]["value"]) if eq else None
    window_start_value = v if v is not None else float(initial_cash)
    v = _safe_float(eq[-1]["value"]) if eq else None
    final_value = v if v is not None else float(initial_cash)

    _enforce_equity_trade_consistency(
        equity_curve=eq,
        trade_history=trades,
        base_value=window_start_value,
    )

    summary = _compute_window_summary(
        equity_curve=eq,
        trade_history=trades,
        base_value=window_start_value,
    )

    meta = {
        "strategy_name": strategy_name or "Strategy",
        "symbol": symbol or "",
        "start": report_start,
        "end": report_end,
        "initial_cash": float(initial_cash),
        "window_start_value": float(window_start_value),
        "final_value": final_value,
        "market": market,
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
    }

    # ---- Write the 3 output files ----
    equity_path = out_dir / f"{prefix}_equity.csv"
    trades_path = out_dir / f"{prefix}_trades.csv"
    summary_path = out_dir / f"{prefix}_summary.json"

    _write_equity_csv(equity_path, eq)
    _write_trades_csv(trades_path, trades)
    _write_summary_json(summary_path, meta=meta, summary=summary)

    return {"equity": equity_path, "trades": trades_path, "summary": summary_path}


# ---------------------------------------------------------------------------
# File writers
# ---------------------------------------------------------------------------

def _write_equity_csv(path: Path, equity_curve: list[dict[str, Any]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["date", "value"])
        for point in equity_curve:
            writer.writerow([point["date"], _safe_float(point.get("value"))])


def _write_trades_csv(path: Path, trade_history: list[dict[str, Any]]) -> None:
    fields = [
        "entry_date", "exit_date", "side", "size",
        "entry_price", "exit_price", "pnl", "pnl_pct",
        "holding_bars", "symbol", "symbol_name", "display_symbol",
    ]
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(fields)
        for trade in trade_history:
            writer.writerow([trade.get(k) for k in fields])


def _write_summary_json(path: Path, meta: dict[str, Any], summary: dict[str, Any]) -> None:
    payload = {"meta": meta, "summary": summary}
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def _enforce_flat_at_end(is_flat_at_end: bool | None) -> None:
    """Hard-fail when the caller explicitly knows the backtest is not flat."""
    if is_flat_at_end is False:
        raise ValueError(
            "The backtest still has open positions at the end. Per the skill "
            "contract, the script must force-close remaining positions at the "
            "last bar close, append them to trade_history, and confirm the "
            "portfolio is flat before calling export_results."
        )


def _enforce_closed_trades(trade_history: list[dict[str, Any]]) -> None:
    """trade_history must contain only closed trades with exit_date present."""
    for trade in trade_history or []:
        exit_date = str(trade.get("exit_date") or "").strip()
        if exit_date:
            continue
        raise ValueError(
            "trade_history must contain only closed trades, but one record is "
            "missing exit_date. Record the trade after execution and export "
            "only after period-end liquidation is complete. "
            f"Offending trade: {trade}"
        )


def _enforce_long_only(trade_history: list[dict[str, Any]], market: str | None) -> None:
    """Enforce the A-share long-only rule.

    A-share single-name strategies must not short. If trade_history contains
    side="short", hard-fail before writing files so the bug is visible.
    Other markets (us_stock / hong_kong / None) do not trigger this check.
    """
    if (market or "").lower() not in {"china_a", "a股", "cn", "cn-stock"}:
        return

    for trade in trade_history or []:
        if (trade.get("side") or "long").lower() == "short":
            raise ValueError(
                "A-share single-name strategies (market='china_a') must not short, "
                "but trade_history contains a trade with side='short'. "
                f"Offending trade: {trade}"
            )


def _enforce_equity_trade_consistency(
    equity_curve: list[dict[str, Any]],
    trade_history: list[dict[str, Any]],
    base_value: float,
) -> None:
    """Reject summaries whose equity moved but closed trades are empty."""
    if not equity_curve or trade_history:
        return

    if not _series_varies_from_base(equity_curve, base_value):
        return

    raise ValueError(
        "The evaluation-window equity_curve changed, but the sliced "
        "trade_history is empty. This usually means the script forgot the "
        "period-end forced close, or the start/end window cuts through an "
        "unrealized PnL segment. Force-close remaining positions first and, "
        "when available, pass is_flat_at_end=True before exporting."
    )


# ---------------------------------------------------------------------------
# Metrics (window-sliced recompute)
# ---------------------------------------------------------------------------

def _compute_window_summary(
    equity_curve: list[dict[str, Any]],
    trade_history: list[dict[str, Any]],
    base_value: float,
) -> dict[str, Any]:
    """Recompute total/annual/sharpe/drawdown/win_rate on the evaluation slice."""
    if not equity_curve or not base_value:
        return {
            "total_return_pct": None,
            "annual_return_pct": None,
            "max_drawdown_pct": None,
            "sharpe": None,
            "win_rate_pct": 0.0,
            "total_trades": 0,
        }

    v = _safe_float(equity_curve[-1].get("value"))
    final_value = v if v is not None else base_value
    total_return = final_value / base_value - 1.0

    returns = []
    prev_value = None
    for point in equity_curve:
        value = _safe_float(point.get("value"))
        if value is None:
            continue
        if prev_value is not None and prev_value != 0:
            returns.append(value / prev_value - 1.0)
        prev_value = value

    total_trades = len(trade_history)
    winning_trades = sum(
        1 for trade in trade_history if (_safe_float(trade.get("pnl")) or 0.0) > 0
    )
    win_rate_pct = winning_trades / total_trades * 100.0 if total_trades else 0.0

    drawdown_curve = _build_drawdown_curve(equity_curve)
    max_drawdown_pct = (
        abs(min(point["drawdown_pct"] for point in drawdown_curve))
        if drawdown_curve
        else None
    )

    annual_return_pct = None
    sharpe = None
    annual_factor = _infer_annual_factor(equity_curve)
    if annual_factor and returns:
        periods = len(returns)
        # Bug A guard: if total_return < -1 (for example in extreme leveraged
        # blow-up cases), (1 + total_return) becomes negative and fractional
        # powers would raise ValueError. Annualized return is meaningless there.
        if 1.0 + total_return > 0:
            annual_return_pct = ((1.0 + total_return) ** (annual_factor / periods) - 1.0) * 100.0
        elif final_value <= 0:
            annual_return_pct = -100.0  # Fully wiped out.

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


def _build_drawdown_curve(equity_curve: list[dict[str, Any]]) -> list[dict[str, float | str]]:
    drawdown_curve = []
    peak = None
    for point in equity_curve:
        value = _safe_float(point.get("value"))
        if value is None:
            continue
        peak = value if peak is None else max(peak, value)
        # Bug B guard: when peak <= 0, value/peak - 1 no longer has a meaningful
        # drawdown interpretation. In practice this means the equity is already
        # wiped out or negative, so clamp relative drawdown to -100.
        if peak is None or peak <= 0:
            drawdown_pct = 0.0 if value == peak else -100.0
        else:
            drawdown_pct = (value / peak - 1.0) * 100.0
        drawdown_curve.append(
            {
                "date": point["date"],
                "drawdown_pct": drawdown_pct,
            }
        )
    return drawdown_curve


def _infer_annual_factor(equity_curve: list[dict[str, Any]]) -> float | None:
    """Infer periods_per_year from timestamps. Daily=252, weekly=52, monthly=12."""
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

    median_days = median_delta / 86400.0
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
# Window slicing
# ---------------------------------------------------------------------------

def _slice_timeseries(
    points: list[dict[str, Any]],
    start: str | None,
    end: str | None,
) -> list[dict[str, Any]]:
    start_dt = _parse_timestamp(start)
    end_dt = _parse_timestamp(end)
    if start_dt is None and end_dt is None:
        return list(points)

    out = []
    for point in points:
        point_dt = _parse_timestamp(point.get("date"))
        if point_dt is None:
            continue
        if start_dt is not None and point_dt < start_dt:
            continue
        if end_dt is not None and point_dt > end_dt:
            continue
        out.append(point)
    return out


def _slice_trade_history(
    trade_history: list[dict[str, Any]],
    start: str | None,
    end: str | None,
) -> list[dict[str, Any]]:
    start_dt = _parse_timestamp(start)
    end_dt = _parse_timestamp(end)
    if start_dt is None and end_dt is None:
        return list(trade_history)

    out = []
    for trade in trade_history:
        ref_dt = _parse_timestamp(trade.get("exit_date")) or _parse_timestamp(trade.get("entry_date"))
        if ref_dt is None:
            out.append(trade)
            continue
        if start_dt is not None and ref_dt < start_dt:
            continue
        if end_dt is not None and ref_dt > end_dt:
            continue
        out.append(trade)
    return out


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

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


def _series_varies_from_base(
    equity_curve: list[dict[str, Any]],
    base_value: float,
    *,
    rel_tol: float = 1e-9,
    abs_tol: float = 1e-6,
) -> bool:
    for point in equity_curve:
        value = _safe_float(point.get("value"))
        if value is None:
            continue
        if not math.isclose(value, base_value, rel_tol=rel_tol, abs_tol=abs_tol):
            return True
    return False
