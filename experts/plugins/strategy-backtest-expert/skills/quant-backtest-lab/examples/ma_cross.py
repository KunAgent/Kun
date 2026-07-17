"""
Example 1: Moving-average strategy sample
(trend filter + dual EMA + trailing stop, pure Python + pandas)

Example query:
"Backtest a trend-filtered moving-average strategy on the CSI 300 ETF.
Only allow long entries when close > SMA120.
Buy when EMA20 crosses above EMA60.
Sell when EMA20 crosses below EMA60, or close < SMA120, or the position draws
down 8% from the highest close seen since entry.
Use A-share T+1 rules, fill at the next day's open, round to 100-share lots,
start with 1,000,000 cash, use 3 bps commission on both sides, and 0 stamp
duty for the ETF example (pass 5 bps if you switch to an A-share stock).
Return equity_curve and closed trade_history,
and force-close any remaining position at the last bar's close."
"""

import pandas as pd


def run(
    df: pd.DataFrame,
    initial_cash: float = 1_000_000,
    buy_commission: float = 0.0003,
    sell_commission: float = 0.0003,
    sell_tax: float = 0.0,
    lot_size: int = 100,
    t_plus_1: bool = True,
    fast_span: int = 20,
    slow_span: int = 60,
    trend_window: int = 120,
    trailing_stop_pct: float = 0.08,
) -> tuple[list, list]:
    """
    ``df`` must contain date, open, high, low, close, volume in ascending order.
    Returns ``(equity_curve, trade_history)``.
    """
    df = df.copy().sort_values("date").reset_index(drop=True)
    df["ema_fast"] = df["close"].ewm(span=fast_span, adjust=False).mean()
    df["ema_slow"] = df["close"].ewm(span=slow_span, adjust=False).mean()
    df["sma_trend"] = df["close"].rolling(trend_window).mean()

    df["cross_up"] = (
        (df["ema_fast"].shift(1) <= df["ema_slow"].shift(1))
        & (df["ema_fast"] > df["ema_slow"])
    )
    df["cross_down"] = (
        (df["ema_fast"].shift(1) >= df["ema_slow"].shift(1))
        & (df["ema_fast"] < df["ema_slow"])
    )

    cash = initial_cash
    position = 0
    entry_price = 0.0
    entry_date = ""
    entry_bar = -1
    highest_close_since_entry: float | None = None
    pending_buy = False
    pending_sell = False

    equity_curve = []
    trade_history = []

    for i in range(len(df)):
        row = df.iloc[i]
        date = str(row["date"])[:10]
        open_price = float(row["open"])
        close_price = float(row["close"])
        low_price = float(row["low"])

        # Execute yesterday's pending signal at today's open.
        if pending_buy and position == 0:
            size = int(cash / (open_price * (1 + buy_commission)))
            size = (size // lot_size) * lot_size
            if size > 0:
                cost = size * open_price * (1 + buy_commission)
                cash -= cost
                position = size
                entry_price = open_price
                entry_date = date
                entry_bar = i
                # The trailing stop is defined off the highest close since entry,
                # so initialize it after the first post-entry close is observed.
                highest_close_since_entry = None
            pending_buy = False

        if pending_sell and position > 0:
            if not t_plus_1 or i > entry_bar:
                proceeds = position * open_price * (1 - sell_commission - sell_tax)
                buy_cost = position * entry_price * (1 + buy_commission)
                pnl = proceeds - buy_cost
                pnl_pct = (open_price / entry_price - 1) * 100
                trade_history.append({
                    "entry_date": entry_date,
                    "exit_date": date,
                    "side": "long",
                    "size": position,
                    "entry_price": round(entry_price, 4),
                    "exit_price": round(open_price, 4),
                    "pnl": round(pnl, 2),
                    "pnl_pct": round(pnl_pct, 4),
                    "holding_bars": i - entry_bar,
                    "symbol": "",
                })
                cash += proceeds
                position = 0
                highest_close_since_entry = None
            pending_sell = False

        indicators_ready = (
            pd.notna(row["ema_fast"])
            and pd.notna(row["ema_slow"])
            and pd.notna(row["sma_trend"])
        )

        # Generate today's signal to be executed tomorrow.
        if indicators_ready:
            if position == 0:
                if close_price > float(row["sma_trend"]) and bool(row["cross_up"]):
                    pending_buy = True
            else:
                stop_price = None
                if i > entry_bar and highest_close_since_entry is not None:
                    stop_price = highest_close_since_entry * (1 - trailing_stop_pct)

                if stop_price is not None and low_price <= stop_price:
                    pending_sell = True
                elif bool(row["cross_down"]):
                    pending_sell = True
                elif close_price < float(row["sma_trend"]):
                    pending_sell = True

        # Check the trailing stop against the previous peak first, then update
        # the running highest close. This avoids same-bar look-ahead.
        if position > 0:
            if highest_close_since_entry is None:
                highest_close_since_entry = close_price
            else:
                highest_close_since_entry = max(highest_close_since_entry, close_price)

        value = cash + position * close_price
        equity_curve.append({"date": date, "value": round(value, 2)})

    # Force liquidation at the end if a position is still open.
    if position > 0:
        last = df.iloc[-1]
        last_date = str(last["date"])[:10]
        price = float(last["close"])
        proceeds = position * price * (1 - sell_commission - sell_tax)
        buy_cost = position * entry_price * (1 + buy_commission)
        pnl = proceeds - buy_cost
        pnl_pct = (price / entry_price - 1) * 100
        trade_history.append({
            "entry_date": entry_date,
            "exit_date": last_date,
            "side": "long",
            "size": position,
            "entry_price": round(entry_price, 4),
            "exit_price": round(price, 4),
            "pnl": round(pnl, 2),
            "pnl_pct": round(pnl_pct, 4),
            "holding_bars": len(df) - 1 - entry_bar,
            "symbol": "",
        })
        cash += proceeds
        position = 0
        if equity_curve:
            equity_curve[-1]["value"] = round(cash, 2)

    return equity_curve, trade_history
