#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["yfinance>=0.2.40"]
# ///
"""
Portfolio management for stock-analysis skill.

Usage:
    uv run portfolio.py create "Portfolio Name"
    uv run portfolio.py list
    uv run portfolio.py show [--portfolio NAME]
    uv run portfolio.py delete "Portfolio Name"
    uv run portfolio.py rename "Old Name" "New Name"

    uv run portfolio.py add TICKER --quantity 100 --cost 150.00 [--portfolio NAME]
    uv run portfolio.py update TICKER --quantity 150 [--portfolio NAME]
    uv run portfolio.py remove TICKER [--portfolio NAME]
"""

import argparse
import json
import os
import sys
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Literal

import yfinance as yf


# Top 20 supported cryptocurrencies
SUPPORTED_CRYPTOS = {
    "BTC-USD", "ETH-USD", "BNB-USD", "SOL-USD", "XRP-USD",
    "ADA-USD", "DOGE-USD", "AVAX-USD", "DOT-USD", "MATIC-USD",
    "LINK-USD", "ATOM-USD", "UNI-USD", "LTC-USD", "BCH-USD",
    "XLM-USD", "ALGO-USD", "VET-USD", "FIL-USD", "NEAR-USD",
}


def get_storage_path() -> Path:
    """Get the portfolio storage path."""
    # Use ~/.clawdbot/skills/stock-analysis/portfolios.json
    state_dir = os.environ.get("CLAWDBOT_STATE_DIR", os.path.expanduser("~/.clawdbot"))
    portfolio_dir = Path(state_dir) / "skills" / "stock-analysis"
    portfolio_dir.mkdir(parents=True, exist_ok=True)
    return portfolio_dir / "portfolios.json"


def detect_asset_type(ticker: str) -> Literal["stock", "crypto"]:
    """Detect asset type from ticker format."""
    ticker_upper = ticker.upper()
    if ticker_upper.endswith("-USD"):
        base = ticker_upper[:-4]
        if base.isalpha() and f"{base}-USD" in SUPPORTED_CRYPTOS:
            return "crypto"
        # Allow any *-USD ticker as crypto (flexible)
        if base.isalpha():
            return "crypto"
    return "stock"


@dataclass
class Asset:
    ticker: str
    type: Literal["stock", "crypto"]
    quantity: float
    cost_basis: float
    added_at: str


@dataclass
class Portfolio:
    name: str
    created_at: str
    updated_at: str
    assets: list[Asset]


class PortfolioStore:
    """Manages portfolio storage with atomic writes."""

    def __init__(self, path: Path | None = None):
        self.path = path or get_storage_path()
        self._data: dict | None = None

    def _load(self) -> dict:
        """Load portfolios from disk."""
        if self._data is not None:
            return self._data

        if not self.path.exists():
            self._data = {"version": 1, "portfolios": {}}
            return self._data

        try:
            with open(self.path, "r", encoding="utf-8") as f:
                self._data = json.load(f)
                return self._data
        except (json.JSONDecodeError, IOError):
            self._data = {"version": 1, "portfolios": {}}
            return self._data

    def _save(self) -> None:
        """Save portfolios to disk with atomic write."""
        if self._data is None:
            return

        # Ensure directory exists
        self.path.parent.mkdir(parents=True, exist_ok=True)

        # Atomic write: write to temp file, then rename
        tmp_path = self.path.with_suffix(".tmp")
        try:
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(self._data, f, indent=2)
            tmp_path.replace(self.path)
        except Exception:
            if tmp_path.exists():
                tmp_path.unlink()
            raise

    def _get_portfolio_key(self, name: str) -> str:
        """Convert portfolio name to storage key."""
        return name.lower().replace(" ", "-")

    def list_portfolios(self) -> list[str]:
        """List all portfolio names."""
        data = self._load()
        return [p["name"] for p in data["portfolios"].values()]

    def get_portfolio(self, name: str) -> Portfolio | None:
        """Get a portfolio by name."""
        data = self._load()
        key = self._get_portfolio_key(name)

        if key not in data["portfolios"]:
            # Try case-insensitive match
            for k, v in data["portfolios"].items():
                if v["name"].lower() == name.lower():
                    key = k
                    break
            else:
                return None

        p = data["portfolios"][key]
        assets = [
            Asset(
                ticker=a["ticker"],
                type=a["type"],
                quantity=a["quantity"],
                cost_basis=a["cost_basis"],
                added_at=a["added_at"],
            )
            for a in p.get("assets", [])
        ]
        return Portfolio(
            name=p["name"],
            created_at=p["created_at"],
            updated_at=p["updated_at"],
            assets=assets,
        )

    def create_portfolio(self, name: str) -> Portfolio:
        """Create a new portfolio."""
        data = self._load()
        key = self._get_portfolio_key(name)

        if key in data["portfolios"]:
            raise ValueError(f"Portfolio '{name}' already exists")

        now = datetime.now().isoformat()
        portfolio = {
            "name": name,
            "created_at": now,
            "updated_at": now,
            "assets": [],
        }
        data["portfolios"][key] = portfolio
        self._save()

        return Portfolio(name=name, created_at=now, updated_at=now, assets=[])

    def delete_portfolio(self, name: str) -> bool:
        """Delete a portfolio."""
        data = self._load()
        key = self._get_portfolio_key(name)

        # Try case-insensitive match
        if key not in data["portfolios"]:
            for k, v in data["portfolios"].items():
                if v["name"].lower() == name.lower():
                    key = k
                    break
            else:
                return False

        del data["portfolios"][key]
        self._save()
        return True

    def rename_portfolio(self, old_name: str, new_name: str) -> bool:
        """Rename a portfolio."""
        data = self._load()
        old_key = self._get_portfolio_key(old_name)
        new_key = self._get_portfolio_key(new_name)

        # Find old portfolio
        if old_key not in data["portfolios"]:
            for k, v in data["portfolios"].items():
                if v["name"].lower() == old_name.lower():
                    old_key = k
                    break
            else:
                return False

        if new_key in data["portfolios"] and new_key != old_key:
            raise ValueError(f"Portfolio '{new_name}' already exists")

        portfolio = data["portfolios"].pop(old_key)
        portfolio["name"] = new_name
        portfolio["updated_at"] = datetime.now().isoformat()
        data["portfolios"][new_key] = portfolio
        self._save()
        return True

    def add_asset(
        self,
        portfolio_name: str,
        ticker: str,
        quantity: float,
        cost_basis: float,
    ) -> Asset:
        """Add an asset to a portfolio."""
        data = self._load()
        key = self._get_portfolio_key(portfolio_name)

        # Find portfolio
        if key not in data["portfolios"]:
            for k, v in data["portfolios"].items():
                if v["name"].lower() == portfolio_name.lower():
                    key = k
                    break
            else:
                raise ValueError(f"Portfolio '{portfolio_name}' not found")

        portfolio = data["portfolios"][key]
        ticker = ticker.upper()

        # Check if asset already exists
        for asset in portfolio["assets"]:
            if asset["ticker"] == ticker:
                raise ValueError(f"Asset '{ticker}' already in portfolio. Use 'update' to modify.")

        # Validate ticker
        asset_type = detect_asset_type(ticker)
        try:
            stock = yf.Ticker(ticker)
            info = stock.info
            if "regularMarketPrice" not in info:
                raise ValueError(f"Invalid ticker: {ticker}")
        except Exception as e:
            raise ValueError(f"Could not validate ticker '{ticker}': {e}")

        now = datetime.now().isoformat()
        asset = {
            "ticker": ticker,
            "type": asset_type,
            "quantity": quantity,
            "cost_basis": cost_basis,
            "added_at": now,
        }
        portfolio["assets"].append(asset)
        portfolio["updated_at"] = now
        self._save()

        return Asset(**asset)

    def update_asset(
        self,
        portfolio_name: str,
        ticker: str,
        quantity: float | None = None,
        cost_basis: float | None = None,
    ) -> Asset | None:
        """Update an asset in a portfolio."""
        data = self._load()
        key = self._get_portfolio_key(portfolio_name)

        # Find portfolio
        if key not in data["portfolios"]:
            for k, v in data["portfolios"].items():
                if v["name"].lower() == portfolio_name.lower():
                    key = k
                    break
            else:
                return None

        portfolio = data["portfolios"][key]
        ticker = ticker.upper()

        for asset in portfolio["assets"]:
            if asset["ticker"] == ticker:
                if quantity is not None:
                    asset["quantity"] = quantity
                if cost_basis is not None:
                    asset["cost_basis"] = cost_basis
                portfolio["updated_at"] = datetime.now().isoformat()
                self._save()
                return Asset(**asset)

        return None

    def remove_asset(self, portfolio_name: str, ticker: str) -> bool:
        """Remove an asset from a portfolio."""
        data = self._load()
        key = self._get_portfolio_key(portfolio_name)

        # Find portfolio
        if key not in data["portfolios"]:
            for k, v in data["portfolios"].items():
                if v["name"].lower() == portfolio_name.lower():
                    key = k
                    break
            else:
                return False

        portfolio = data["portfolios"][key]
        ticker = ticker.upper()

        original_len = len(portfolio["assets"])
        portfolio["assets"] = [a for a in portfolio["assets"] if a["ticker"] != ticker]

        if len(portfolio["assets"]) < original_len:
            portfolio["updated_at"] = datetime.now().isoformat()
            self._save()
            return True

        return False

    def get_default_portfolio_name(self) -> str | None:
        """Get the default (first) portfolio name, or None if empty."""
        portfolios = self.list_portfolios()
        return portfolios[0] if portfolios else None


def format_currency(value: float) -> str:
    """Format a value as currency."""
    if abs(value) >= 1_000_000:
        return f"${value/1_000_000:.2f}M"
    elif abs(value) >= 1_000:
        return f"${value/1_000:.2f}K"
    else:
        return f"${value:.2f}"


def show_portfolio(portfolio: Portfolio, verbose: bool = False) -> None:
    """Display portfolio details with current prices."""
    print(f"\n{'='*60}")
    print(f"PORTFOLIO: {portfolio.name}")
    print(f"Created: {portfolio.created_at[:10]} | Updated: {portfolio.updated_at[:10]}")
    print(f"{'='*60}\n")

    if not portfolio.assets:
        print("  No assets in portfolio. Use 'add' to add assets.\n")
        return

    total_cost = 0.0
    total_value = 0.0

    print(f"{'Ticker':<12} {'Type':<8} {'Qty':>10} {'Cost':>12} {'Current':>12} {'Value':>14} {'P&L':>12}")
    print("-" * 82)

    for asset in portfolio.assets:
        try:
            stock = yf.Ticker(asset.ticker)
            current_price = stock.info.get("regularMarketPrice", 0) or 0
        except Exception:
            current_price = 0

        cost_total = asset.quantity * asset.cost_basis
        current_value = asset.quantity * current_price
        pnl = current_value - cost_total
        pnl_pct = (pnl / cost_total * 100) if cost_total > 0 else 0

        total_cost += cost_total
        total_value += current_value

        pnl_str = f"{'+' if pnl >= 0 else ''}{format_currency(pnl)} ({pnl_pct:+.1f}%)"

        print(f"{asset.ticker:<12} {asset.type:<8} {asset.quantity:>10.4f} "
              f"{format_currency(asset.cost_basis):>12} {format_currency(current_price):>12} "
              f"{format_currency(current_value):>14} {pnl_str:>12}")

    print("-" * 82)
    total_pnl = total_value - total_cost
    total_pnl_pct = (total_pnl / total_cost * 100) if total_cost > 0 else 0
    print(f"{'TOTAL':<12} {'':<8} {'':<10} {format_currency(total_cost):>12} {'':<12} "
          f"{format_currency(total_value):>14} {'+' if total_pnl >= 0 else ''}{format_currency(total_pnl)} ({total_pnl_pct:+.1f}%)")
    print()


def main():
    parser = argparse.ArgumentParser(description="Portfolio management for stock-analysis")
    subparsers = parser.add_subparsers(dest="command", help="Commands")

    # create
    create_parser = subparsers.add_parser("create", help="Create a new portfolio")
    create_parser.add_argument("name", help="Portfolio name")

    # list
    subparsers.add_parser("list", help="List all portfolios")

    # show
    show_parser = subparsers.add_parser("show", help="Show portfolio details")
    show_parser.add_argument("--portfolio", "-p", help="Portfolio name (default: first portfolio)")

    # delete
    delete_parser = subparsers.add_parser("delete", help="Delete a portfolio")
    delete_parser.add_argument("name", help="Portfolio name")

    # rename
    rename_parser = subparsers.add_parser("rename", help="Rename a portfolio")
    rename_parser.add_argument("old_name", help="Current portfolio name")
    rename_parser.add_argument("new_name", help="New portfolio name")

    # add
    add_parser = subparsers.add_parser("add", help="Add an asset to portfolio")
    add_parser.add_argument("ticker", help="Stock/crypto ticker (e.g., AAPL, BTC-USD)")
    add_parser.add_argument("--quantity", "-q", type=float, required=True, help="Quantity")
    add_parser.add_argument("--cost", "-c", type=float, required=True, help="Cost basis per unit")
    add_parser.add_argument("--portfolio", "-p", help="Portfolio name (default: first portfolio)")

    # update
    update_parser = subparsers.add_parser("update", help="Update an asset in portfolio")
    update_parser.add_argument("ticker", help="Stock/crypto ticker")
    update_parser.add_argument("--quantity", "-q", type=float, help="New quantity")
    update_parser.add_argument("--cost", "-c", type=float, help="New cost basis per unit")
    update_parser.add_argument("--portfolio", "-p", help="Portfolio name (default: first portfolio)")

    # remove
    remove_parser = subparsers.add_parser("remove", help="Remove an asset from portfolio")
    remove_parser.add_argument("ticker", help="Stock/crypto ticker")
    remove_parser.add_argument("--portfolio", "-p", help="Portfolio name (default: first portfolio)")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    store = PortfolioStore()

    try:
        if args.command == "create":
            portfolio = store.create_portfolio(args.name)
            print(f"Created portfolio: {portfolio.name}")

        elif args.command == "list":
            portfolios = store.list_portfolios()
            if not portfolios:
                print("No portfolios found. Use 'create' to create one.")
            else:
                print("\nPortfolios:")
                for name in portfolios:
                    p = store.get_portfolio(name)
                    asset_count = len(p.assets) if p else 0
                    print(f"  - {name} ({asset_count} assets)")
                print()

        elif args.command == "show":
            portfolio_name = args.portfolio or store.get_default_portfolio_name()
            if not portfolio_name:
                print("No portfolios found. Use 'create' to create one.")
                sys.exit(1)

            portfolio = store.get_portfolio(portfolio_name)
            if not portfolio:
                print(f"Portfolio '{portfolio_name}' not found.")
                sys.exit(1)

            show_portfolio(portfolio)

        elif args.command == "delete":
            if store.delete_portfolio(args.name):
                print(f"Deleted portfolio: {args.name}")
            else:
                print(f"Portfolio '{args.name}' not found.")
                sys.exit(1)

        elif args.command == "rename":
            if store.rename_portfolio(args.old_name, args.new_name):
                print(f"Renamed portfolio: {args.old_name} -> {args.new_name}")
            else:
                print(f"Portfolio '{args.old_name}' not found.")
                sys.exit(1)

        elif args.command == "add":
            portfolio_name = args.portfolio or store.get_default_portfolio_name()
            if not portfolio_name:
                print("No portfolios found. Use 'create' to create one first.")
                sys.exit(1)

            asset = store.add_asset(portfolio_name, args.ticker, args.quantity, args.cost)
            print(f"Added {asset.ticker} ({asset.type}) to {portfolio_name}: "
                  f"{asset.quantity} units @ {format_currency(asset.cost_basis)}")

        elif args.command == "update":
            portfolio_name = args.portfolio or store.get_default_portfolio_name()
            if not portfolio_name:
                print("No portfolios found.")
                sys.exit(1)

            if args.quantity is None and args.cost is None:
                print("Must specify --quantity and/or --cost to update.")
                sys.exit(1)

            asset = store.update_asset(portfolio_name, args.ticker, args.quantity, args.cost)
            if asset:
                print(f"Updated {asset.ticker} in {portfolio_name}: "
                      f"{asset.quantity} units @ {format_currency(asset.cost_basis)}")
            else:
                print(f"Asset '{args.ticker}' not found in portfolio '{portfolio_name}'.")
                sys.exit(1)

        elif args.command == "remove":
            portfolio_name = args.portfolio or store.get_default_portfolio_name()
            if not portfolio_name:
                print("No portfolios found.")
                sys.exit(1)

            if store.remove_asset(portfolio_name, args.ticker):
                print(f"Removed {args.ticker.upper()} from {portfolio_name}")
            else:
                print(f"Asset '{args.ticker}' not found in portfolio '{portfolio_name}'.")
                sys.exit(1)

    except ValueError as e:
        print(f"Error: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"Unexpected error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
