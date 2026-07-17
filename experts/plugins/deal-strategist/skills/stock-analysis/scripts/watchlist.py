#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "yfinance>=0.2.40",
# ]
# ///
"""
Stock Watchlist with Price Alerts.

Usage:
    uv run watchlist.py add AAPL                      # Add to watchlist
    uv run watchlist.py add AAPL --target 200         # With price target
    uv run watchlist.py add AAPL --stop 150           # With stop loss
    uv run watchlist.py add AAPL --alert-on signal    # Alert on signal change
    uv run watchlist.py remove AAPL                   # Remove from watchlist
    uv run watchlist.py list                          # Show watchlist
    uv run watchlist.py check                         # Check for triggered alerts
    uv run watchlist.py check --notify               # Check and format for notification
"""

import argparse
import json
import sys
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import yfinance as yf

# Storage
WATCHLIST_DIR = Path.home() / ".clawdbot" / "skills" / "stock-analysis"
WATCHLIST_FILE = WATCHLIST_DIR / "watchlist.json"


@dataclass
class WatchlistItem:
    ticker: str
    added_at: str
    price_at_add: float | None = None
    target_price: float | None = None  # Alert when price >= target
    stop_price: float | None = None    # Alert when price <= stop
    alert_on_signal: bool = False      # Alert when recommendation changes
    last_signal: str | None = None     # BUY/HOLD/SELL
    last_check: str | None = None
    notes: str | None = None


@dataclass
class Alert:
    ticker: str
    alert_type: Literal["target_hit", "stop_hit", "signal_change"]
    message: str
    current_price: float
    trigger_value: float | str
    timestamp: str


def ensure_dirs():
    """Create storage directories."""
    WATCHLIST_DIR.mkdir(parents=True, exist_ok=True)


def load_watchlist() -> list[WatchlistItem]:
    """Load watchlist from file."""
    if WATCHLIST_FILE.exists():
        data = json.loads(WATCHLIST_FILE.read_text())
        return [WatchlistItem(**item) for item in data]
    return []


def save_watchlist(items: list[WatchlistItem]):
    """Save watchlist to file."""
    ensure_dirs()
    data = [asdict(item) for item in items]
    WATCHLIST_FILE.write_text(json.dumps(data, indent=2))


def get_current_price(ticker: str) -> float | None:
    """Get current price for a ticker."""
    try:
        stock = yf.Ticker(ticker)
        price = stock.info.get("regularMarketPrice") or stock.info.get("currentPrice")
        return float(price) if price else None
    except Exception:
        return None


def add_to_watchlist(
    ticker: str,
    target_price: float | None = None,
    stop_price: float | None = None,
    alert_on_signal: bool = False,
    notes: str | None = None,
) -> dict:
    """Add ticker to watchlist."""
    ticker = ticker.upper()
    
    # Validate ticker
    current_price = get_current_price(ticker)
    if current_price is None:
        return {"success": False, "error": f"Invalid ticker: {ticker}"}
    
    # Load existing watchlist
    watchlist = load_watchlist()
    
    # Check if already exists
    for item in watchlist:
        if item.ticker == ticker:
            # Update existing
            item.target_price = target_price or item.target_price
            item.stop_price = stop_price or item.stop_price
            item.alert_on_signal = alert_on_signal or item.alert_on_signal
            item.notes = notes or item.notes
            save_watchlist(watchlist)
            return {
                "success": True,
                "action": "updated",
                "ticker": ticker,
                "current_price": current_price,
                "target_price": item.target_price,
                "stop_price": item.stop_price,
                "alert_on_signal": item.alert_on_signal,
            }
    
    # Add new
    item = WatchlistItem(
        ticker=ticker,
        added_at=datetime.now(timezone.utc).isoformat(),
        price_at_add=current_price,
        target_price=target_price,
        stop_price=stop_price,
        alert_on_signal=alert_on_signal,
        notes=notes,
    )
    watchlist.append(item)
    save_watchlist(watchlist)
    
    return {
        "success": True,
        "action": "added",
        "ticker": ticker,
        "current_price": current_price,
        "target_price": target_price,
        "stop_price": stop_price,
        "alert_on_signal": alert_on_signal,
    }


def remove_from_watchlist(ticker: str) -> dict:
    """Remove ticker from watchlist."""
    ticker = ticker.upper()
    watchlist = load_watchlist()
    
    original_len = len(watchlist)
    watchlist = [item for item in watchlist if item.ticker != ticker]
    
    if len(watchlist) == original_len:
        return {"success": False, "error": f"{ticker} not in watchlist"}
    
    save_watchlist(watchlist)
    return {"success": True, "removed": ticker}


def list_watchlist() -> dict:
    """List all watchlist items with current prices."""
    watchlist = load_watchlist()
    
    if not watchlist:
        return {"success": True, "items": [], "count": 0}
    
    items = []
    for item in watchlist:
        current_price = get_current_price(item.ticker)
        
        # Calculate change since added
        change_pct = None
        if current_price and item.price_at_add:
            change_pct = ((current_price - item.price_at_add) / item.price_at_add) * 100
        
        # Distance to target/stop
        to_target = None
        to_stop = None
        if current_price:
            if item.target_price:
                to_target = ((item.target_price - current_price) / current_price) * 100
            if item.stop_price:
                to_stop = ((item.stop_price - current_price) / current_price) * 100
        
        items.append({
            "ticker": item.ticker,
            "current_price": current_price,
            "price_at_add": item.price_at_add,
            "change_pct": round(change_pct, 2) if change_pct else None,
            "target_price": item.target_price,
            "to_target_pct": round(to_target, 2) if to_target else None,
            "stop_price": item.stop_price,
            "to_stop_pct": round(to_stop, 2) if to_stop else None,
            "alert_on_signal": item.alert_on_signal,
            "last_signal": item.last_signal,
            "added_at": item.added_at[:10],
            "notes": item.notes,
        })
    
    return {"success": True, "items": items, "count": len(items)}


def check_alerts(notify_format: bool = False) -> dict:
    """Check watchlist for triggered alerts."""
    watchlist = load_watchlist()
    alerts: list[Alert] = []
    now = datetime.now(timezone.utc).isoformat()
    
    for item in watchlist:
        current_price = get_current_price(item.ticker)
        if current_price is None:
            continue
        
        # Check target price
        if item.target_price and current_price >= item.target_price:
            alerts.append(Alert(
                ticker=item.ticker,
                alert_type="target_hit",
                message=f"🎯 {item.ticker} hit target! ${current_price:.2f} >= ${item.target_price:.2f}",
                current_price=current_price,
                trigger_value=item.target_price,
                timestamp=now,
            ))
        
        # Check stop price
        if item.stop_price and current_price <= item.stop_price:
            alerts.append(Alert(
                ticker=item.ticker,
                alert_type="stop_hit",
                message=f"🛑 {item.ticker} hit stop! ${current_price:.2f} <= ${item.stop_price:.2f}",
                current_price=current_price,
                trigger_value=item.stop_price,
                timestamp=now,
            ))
        
        # Check signal change (requires running analyze_stock)
        if item.alert_on_signal:
            try:
                import subprocess
                result = subprocess.run(
                    ["uv", "run", str(Path(__file__).parent / "analyze_stock.py"), item.ticker, "--output", "json"],
                    capture_output=True,
                    text=True,
                    timeout=60,
                )
                if result.returncode == 0:
                    analysis = json.loads(result.stdout)
                    new_signal = analysis.get("recommendation")
                    
                    if item.last_signal and new_signal and new_signal != item.last_signal:
                        alerts.append(Alert(
                            ticker=item.ticker,
                            alert_type="signal_change",
                            message=f"📊 {item.ticker} signal changed: {item.last_signal} → {new_signal}",
                            current_price=current_price,
                            trigger_value=f"{item.last_signal} → {new_signal}",
                            timestamp=now,
                        ))
                    
                    # Update last signal
                    item.last_signal = new_signal
            except Exception:
                pass
        
        item.last_check = now
    
    # Save updated watchlist (with last_signal updates)
    save_watchlist(watchlist)
    
    # Format output
    if notify_format and alerts:
        # Format for Telegram notification
        lines = ["📢 **Stock Alerts**\n"]
        for alert in alerts:
            lines.append(alert.message)
        return {"success": True, "alerts": [asdict(a) for a in alerts], "notification": "\n".join(lines)}
    
    return {"success": True, "alerts": [asdict(a) for a in alerts], "count": len(alerts)}


def main():
    parser = argparse.ArgumentParser(description="Stock Watchlist with Alerts")
    subparsers = parser.add_subparsers(dest="command", required=True)
    
    # Add
    add_parser = subparsers.add_parser("add", help="Add ticker to watchlist")
    add_parser.add_argument("ticker", help="Stock ticker")
    add_parser.add_argument("--target", type=float, help="Target price for alert")
    add_parser.add_argument("--stop", type=float, help="Stop loss price for alert")
    add_parser.add_argument("--alert-on", choices=["signal"], help="Alert on signal change")
    add_parser.add_argument("--notes", help="Notes")
    
    # Remove
    remove_parser = subparsers.add_parser("remove", help="Remove ticker from watchlist")
    remove_parser.add_argument("ticker", help="Stock ticker")
    
    # List
    subparsers.add_parser("list", help="List watchlist")
    
    # Check
    check_parser = subparsers.add_parser("check", help="Check for triggered alerts")
    check_parser.add_argument("--notify", action="store_true", help="Format for notification")
    
    args = parser.parse_args()
    
    if args.command == "add":
        result = add_to_watchlist(
            args.ticker,
            target_price=args.target,
            stop_price=args.stop,
            alert_on_signal=(args.alert_on == "signal"),
            notes=args.notes,
        )
        print(json.dumps(result, indent=2))
    
    elif args.command == "remove":
        result = remove_from_watchlist(args.ticker)
        print(json.dumps(result, indent=2))
    
    elif args.command == "list":
        result = list_watchlist()
        print(json.dumps(result, indent=2))
    
    elif args.command == "check":
        result = check_alerts(notify_format=args.notify)
        print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
