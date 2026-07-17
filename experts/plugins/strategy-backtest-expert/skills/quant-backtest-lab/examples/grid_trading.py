"""
Example 3: Grid-strategy sample
(fixed-percentage layered grid, pure Python + pandas)

Example query:
"Backtest a fixed-percentage long-only grid strategy on the CSI 300 ETF.
Use A-share T+1 rules, fill at the next day's open, round to 100-share lots,
start with 150,000 cash, use 3 bps commission on both sides, and 0 stamp duty
for ETF sells.
Open the initial base position with 10,000 cash.
Then run a 4% arithmetic grid with at most 5 add-on layers, each layer also
using 10,000 cash. If the close falls through the next grid level relative to
anchor_price, buy the missing layer at the next day's open. If the close
recovers the take-profit grid for a specific layer, sell only that layer at the
next day's open. Record each grid lot as its own closed trade, never merge
multiple layers into one trade. Force-close any remaining layers at the last
bar's close."
"""

import pandas as pd


def _target_open_levels(
    close_price: float,
    anchor_price: float,
    grid_pct: float,
    max_layers: int,
) -> list[int]:
    levels = [0]
    for step in range(1, max_layers + 1):
        threshold = anchor_price * (1 - grid_pct * step)
        if close_price <= threshold:
            levels.append(-step)
        else:
            break
    return levels


def _grid_take_profit_price(anchor_price: float, level: int, grid_pct: float) -> float:
    return anchor_price * (1 + (level + 1) * grid_pct)


def run(
    df: pd.DataFrame,
    initial_cash: float = 150_000,
    lot_cash: float = 10_000,
    grid_pct: float = 0.04,
    max_layers: int = 5,
    buy_commission: float = 0.0003,
    sell_commission: float = 0.0003,
    sell_tax: float = 0.0,
    lot_size: int = 100,
    t_plus_1: bool = True,
) -> tuple[list, list]:
    df = df.copy().sort_values("date").reset_index(drop=True)

    cash = initial_cash
    anchor_price: float | None = None
    next_lot_id = 1
    open_lots: list[dict] = []
    pending_buy_levels: list[int] = []
    pending_sell_ids: set[int] = set()

    equity_curve = []
    trade_history = []

    for i in range(len(df)):
        row = df.iloc[i]
        date = str(row["date"])[:10]
        open_price = float(row["open"])
        close_price = float(row["close"])

        lots_by_id = {lot["lot_id"]: lot for lot in open_lots}

        # Execute yesterday's pending sells at today's open.
        if pending_sell_ids:
            still_pending: set[int] = set()
            for lot_id in sorted(pending_sell_ids):
                lot = lots_by_id.get(lot_id)
                if lot is None:
                    continue
                if t_plus_1 and i <= lot["entry_bar"]:
                    still_pending.add(lot_id)
                    continue

                proceeds = lot["size"] * open_price * (1 - sell_commission - sell_tax)
                buy_cost = lot["size"] * lot["entry_price"] * (1 + buy_commission)
                pnl = proceeds - buy_cost
                pnl_pct = (open_price / lot["entry_price"] - 1) * 100
                trade_history.append({
                    "entry_date": lot["entry_date"],
                    "exit_date": date,
                    "side": "long",
                    "size": lot["size"],
                    "entry_price": round(lot["entry_price"], 4),
                    "exit_price": round(open_price, 4),
                    "pnl": round(pnl, 2),
                    "pnl_pct": round(pnl_pct, 4),
                    "holding_bars": i - lot["entry_bar"],
                    "symbol": "",
                })
                cash += proceeds
                open_lots = [item for item in open_lots if item["lot_id"] != lot_id]
            pending_sell_ids = still_pending

        # Execute yesterday's pending buys at today's open.
        if pending_buy_levels:
            executed_levels = set()
            for level in sorted(set(pending_buy_levels), reverse=True):
                if any(lot["level"] == level for lot in open_lots):
                    executed_levels.add(level)
                    continue

                size = int(lot_cash / (open_price * (1 + buy_commission)))
                size = (size // lot_size) * lot_size
                if size <= 0:
                    executed_levels.add(level)
                    continue

                cost = size * open_price * (1 + buy_commission)
                if cost > cash:
                    executed_levels.add(level)
                    continue

                if not open_lots and level == 0:
                    anchor_price = open_price

                if anchor_price is None:
                    executed_levels.add(level)
                    continue

                cash -= cost
                open_lots.append({
                    "lot_id": next_lot_id,
                    "level": level,
                    "entry_date": date,
                    "entry_price": open_price,
                    "size": size,
                    "entry_bar": i,
                })
                next_lot_id += 1
                executed_levels.add(level)

            pending_buy_levels = [
                level for level in pending_buy_levels if level not in executed_levels
            ]

        if not open_lots and not pending_buy_levels:
            anchor_price = None

        # Generate today's signals to be executed tomorrow.
        if not open_lots and not pending_buy_levels:
            pending_buy_levels.append(0)
        elif anchor_price is not None:
            desired_levels = _target_open_levels(
                close_price=close_price,
                anchor_price=anchor_price,
                grid_pct=grid_pct,
                max_layers=max_layers,
            )
            current_levels = {lot["level"] for lot in open_lots}
            pending_levels = set(pending_buy_levels)
            for level in desired_levels:
                if level not in current_levels and level not in pending_levels:
                    pending_buy_levels.append(level)

            for lot in open_lots:
                target_price = _grid_take_profit_price(
                    anchor_price=anchor_price,
                    level=lot["level"],
                    grid_pct=grid_pct,
                )
                if close_price >= target_price:
                    pending_sell_ids.add(lot["lot_id"])

        market_value = sum(lot["size"] * close_price for lot in open_lots)
        equity_curve.append({"date": date, "value": round(cash + market_value, 2)})

    # Force liquidation at the end, one closed trade per remaining lot.
    if open_lots:
        last = df.iloc[-1]
        last_date = str(last["date"])[:10]
        last_close = float(last["close"])
        for lot in open_lots:
            proceeds = lot["size"] * last_close * (1 - sell_commission - sell_tax)
            buy_cost = lot["size"] * lot["entry_price"] * (1 + buy_commission)
            pnl = proceeds - buy_cost
            pnl_pct = (last_close / lot["entry_price"] - 1) * 100
            trade_history.append({
                "entry_date": lot["entry_date"],
                "exit_date": last_date,
                "side": "long",
                "size": lot["size"],
                "entry_price": round(lot["entry_price"], 4),
                "exit_price": round(last_close, 4),
                "pnl": round(pnl, 2),
                "pnl_pct": round(pnl_pct, 4),
                "holding_bars": len(df) - 1 - lot["entry_bar"],
                "symbol": "",
            })
            cash += proceeds
        open_lots = []
        if equity_curve:
            equity_curve[-1]["value"] = round(cash, 2)

    return equity_curve, trade_history
