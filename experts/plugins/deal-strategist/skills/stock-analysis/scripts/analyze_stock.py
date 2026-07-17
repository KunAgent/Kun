#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "yfinance>=0.2.40",
#     "pandas>=2.0.0",
#     "fear-and-greed>=0.4",
#     "edgartools>=2.0.0",
#     "feedparser>=6.0.0",
# ]
# ///
"""
Stock analysis using Yahoo Finance data.

Usage:
    uv run analyze_stock.py TICKER [TICKER2 ...] [--output text|json] [--verbose]
"""

import argparse
import asyncio
import json
import sys
import time
from dataclasses import dataclass, asdict
from datetime import datetime
from typing import Literal

import pandas as pd
import yfinance as yf


# Top 20 supported cryptocurrencies
SUPPORTED_CRYPTOS = {
    "BTC-USD", "ETH-USD", "BNB-USD", "SOL-USD", "XRP-USD",
    "ADA-USD", "DOGE-USD", "AVAX-USD", "DOT-USD", "MATIC-USD",
    "LINK-USD", "ATOM-USD", "UNI-USD", "LTC-USD", "BCH-USD",
    "XLM-USD", "ALGO-USD", "VET-USD", "FIL-USD", "NEAR-USD",
}

# Crypto category mapping for sector-like analysis
CRYPTO_CATEGORIES = {
    "BTC-USD": "Store of Value",
    "ETH-USD": "Smart Contract L1",
    "BNB-USD": "Exchange Token",
    "SOL-USD": "Smart Contract L1",
    "XRP-USD": "Payment",
    "ADA-USD": "Smart Contract L1",
    "DOGE-USD": "Meme",
    "AVAX-USD": "Smart Contract L1",
    "DOT-USD": "Interoperability",
    "MATIC-USD": "Layer 2",
    "LINK-USD": "Oracle",
    "ATOM-USD": "Interoperability",
    "UNI-USD": "DeFi",
    "LTC-USD": "Payment",
    "BCH-USD": "Payment",
    "XLM-USD": "Payment",
    "ALGO-USD": "Smart Contract L1",
    "VET-USD": "Enterprise",
    "FIL-USD": "Storage",
    "NEAR-USD": "Smart Contract L1",
}


def detect_asset_type(ticker: str) -> Literal["stock", "crypto"]:
    """Detect asset type from ticker format."""
    ticker_upper = ticker.upper()
    if ticker_upper.endswith("-USD"):
        base = ticker_upper[:-4]
        if base.isalpha():
            return "crypto"
    return "stock"


@dataclass
class StockData:
    ticker: str
    info: dict
    earnings_history: pd.DataFrame | None
    analyst_info: dict | None
    price_history: pd.DataFrame | None
    asset_type: Literal["stock", "crypto"] = "stock"


@dataclass
class CryptoFundamentals:
    """Crypto-specific fundamentals (replaces P/E, margins for crypto)."""
    market_cap: float | None
    market_cap_rank: str  # "large", "mid", "small"
    volume_24h: float | None
    circulating_supply: float | None
    category: str | None  # "Smart Contract L1", "DeFi", etc.
    btc_correlation: float | None  # 30-day correlation to BTC
    score: float
    explanation: str


@dataclass
class EarningsSurprise:
    score: float
    explanation: str
    actual_eps: float | None = None
    expected_eps: float | None = None
    surprise_pct: float | None = None


@dataclass
class Fundamentals:
    score: float
    key_metrics: dict
    explanation: str


@dataclass
class AnalystSentiment:
    score: float | None
    summary: str
    consensus_rating: str | None = None
    price_target: float | None = None
    current_price: float | None = None
    upside_pct: float | None = None
    num_analysts: int | None = None


@dataclass
class HistoricalPatterns:
    score: float
    pattern_desc: str
    beats_last_4q: int | None = None
    avg_reaction_pct: float | None = None


@dataclass
class MarketContext:
    vix_level: float
    vix_status: str  # "calm", "elevated", "fear"
    spy_trend_10d: float
    qqq_trend_10d: float
    market_regime: str  # "bull", "bear", "choppy"
    score: float
    explanation: str
    # Safe-haven indicators (v4.0.0)
    gld_change_5d: float | None = None  # Gold ETF % change
    tlt_change_5d: float | None = None  # Treasury ETF % change
    uup_change_5d: float | None = None  # USD Index ETF % change
    risk_off_detected: bool = False  # True if flight to safety detected


@dataclass
class SectorComparison:
    sector_name: str
    industry_name: str
    stock_return_1m: float
    sector_return_1m: float
    relative_strength: float
    sector_trend: str  # "strong uptrend", "downtrend", etc.
    score: float
    explanation: str


@dataclass
class EarningsTiming:
    days_until_earnings: int | None
    days_since_earnings: int | None
    next_earnings_date: str | None
    last_earnings_date: str | None
    timing_flag: str  # "pre_earnings", "post_earnings", "safe"
    price_change_5d: float | None
    confidence_adjustment: float
    caveats: list[str]


@dataclass
class MomentumAnalysis:
    rsi_14d: float | None
    rsi_status: str  # "overbought", "oversold", "neutral"
    price_vs_52w_low: float | None
    price_vs_52w_high: float | None
    near_52w_high: bool
    near_52w_low: bool
    volume_ratio: float | None
    relative_strength_vs_sector: float | None
    score: float
    explanation: str


@dataclass
class SentimentAnalysis:
    score: float  # Overall -1.0 to 1.0
    explanation: str  # Human-readable summary

    # Sub-indicator scores
    fear_greed_score: float | None = None
    short_interest_score: float | None = None
    vix_structure_score: float | None = None
    insider_activity_score: float | None = None
    put_call_score: float | None = None

    # Raw data
    fear_greed_value: int | None = None  # 0-100
    fear_greed_status: str | None = None  # "Extreme Fear", etc.
    short_interest_pct: float | None = None
    days_to_cover: float | None = None
    vix_structure: str | None = None  # "contango", "backwardation", "flat"
    vix_slope: float | None = None
    insider_net_shares: int | None = None
    insider_net_value: float | None = None  # Millions USD
    put_call_ratio: float | None = None
    put_volume: int | None = None
    call_volume: int | None = None

    # Metadata
    indicators_available: int = 0
    data_freshness_warnings: list[str] | None = None


@dataclass
class Signal:
    ticker: str
    company_name: str
    recommendation: Literal["BUY", "HOLD", "SELL"]
    confidence: float
    final_score: float
    supporting_points: list[str]
    caveats: list[str]
    timestamp: str
    components: dict


def fetch_stock_data(ticker: str, verbose: bool = False) -> StockData | None:
    """Fetch stock data from Yahoo Finance with retry logic."""
    max_retries = 3
    for attempt in range(max_retries):
        try:
            if verbose:
                print(f"Fetching data for {ticker}... (attempt {attempt + 1}/{max_retries})", file=sys.stderr)

            stock = yf.Ticker(ticker)
            info = stock.info

            # Validate ticker
            if not info or "regularMarketPrice" not in info:
                return None

            # Fetch earnings history
            try:
                earnings_history = stock.earnings_dates
            except Exception:
                earnings_history = None

            # Fetch analyst info
            try:
                analyst_info = {
                    "recommendations": stock.recommendations,
                    "analyst_price_targets": stock.analyst_price_targets,
                }
            except Exception:
                analyst_info = None

            # Fetch price history (1 year for historical patterns)
            try:
                price_history = stock.history(period="1y")
            except Exception:
                price_history = None

            return StockData(
                ticker=ticker,
                info=info,
                earnings_history=earnings_history,
                analyst_info=analyst_info,
                price_history=price_history,
                asset_type=detect_asset_type(ticker),
            )

        except Exception as e:
            if attempt < max_retries - 1:
                wait_time = 2 ** attempt  # Exponential backoff
                if verbose:
                    print(f"Error fetching {ticker}: {e}. Retrying in {wait_time}s...", file=sys.stderr)
                time.sleep(wait_time)
            else:
                if verbose:
                    print(f"Failed to fetch {ticker} after {max_retries} attempts", file=sys.stderr)
                return None

    return None


def analyze_earnings_surprise(data: StockData) -> EarningsSurprise | None:
    """Analyze earnings surprise from most recent quarter."""
    if data.earnings_history is None or data.earnings_history.empty:
        return None

    try:
        # Get most recent earnings with actual data
        recent = data.earnings_history.sort_index(ascending=False).head(10)

        for idx, row in recent.iterrows():
            if pd.notna(row.get("Reported EPS")) and pd.notna(row.get("EPS Estimate")):
                actual = float(row["Reported EPS"])
                expected = float(row["EPS Estimate"])

                if expected == 0:
                    continue

                surprise_pct = ((actual - expected) / abs(expected)) * 100

                # Score based on surprise percentage
                if surprise_pct > 10:
                    score = 1.0
                elif surprise_pct > 5:
                    score = 0.7
                elif surprise_pct > 0:
                    score = 0.3
                elif surprise_pct > -5:
                    score = -0.3
                elif surprise_pct > -10:
                    score = -0.7
                else:
                    score = -1.0

                explanation = f"{'Beat' if surprise_pct > 0 else 'Missed'} by {abs(surprise_pct):.1f}%"

                return EarningsSurprise(
                    score=score,
                    explanation=explanation,
                    actual_eps=actual,
                    expected_eps=expected,
                    surprise_pct=surprise_pct,
                )

        return None

    except Exception:
        return None


def analyze_fundamentals(data: StockData) -> Fundamentals | None:
    """Analyze fundamental metrics."""
    info = data.info
    scores = []
    metrics = {}
    explanations = []

    try:
        # P/E Ratio (lower is better, but consider growth)
        pe_ratio = info.get("trailingPE") or info.get("forwardPE")
        if pe_ratio and pe_ratio > 0:
            metrics["pe_ratio"] = round(pe_ratio, 2)
            if pe_ratio < 15:
                scores.append(0.5)
                explanations.append(f"Attractive P/E: {pe_ratio:.1f}x")
            elif pe_ratio > 30:
                scores.append(-0.3)
                explanations.append(f"Elevated P/E: {pe_ratio:.1f}x")
            else:
                scores.append(0.1)

        # Operating Margin
        op_margin = info.get("operatingMargins")
        if op_margin:
            metrics["operating_margin"] = round(op_margin, 3)
            if op_margin > 0.15:
                scores.append(0.5)
                explanations.append(f"Strong margin: {op_margin*100:.1f}%")
            elif op_margin < 0.05:
                scores.append(-0.5)
                explanations.append(f"Weak margin: {op_margin*100:.1f}%")

        # Revenue Growth
        rev_growth = info.get("revenueGrowth")
        if rev_growth:
            metrics["revenue_growth_yoy"] = round(rev_growth, 3)
            if rev_growth > 0.20:
                scores.append(0.5)
                explanations.append(f"Strong growth: {rev_growth*100:.1f}% YoY")
            elif rev_growth < 0.05:
                scores.append(-0.3)
                explanations.append(f"Slow growth: {rev_growth*100:.1f}% YoY")
            else:
                scores.append(0.2)

        # Debt to Equity
        debt_equity = info.get("debtToEquity")
        if debt_equity is not None:
            metrics["debt_to_equity"] = round(debt_equity / 100, 2)
            if debt_equity < 50:
                scores.append(0.3)
            elif debt_equity > 200:
                scores.append(-0.5)
                explanations.append(f"High debt: D/E {debt_equity/100:.1f}x")

        if not scores:
            return None

        # Average and normalize
        avg_score = sum(scores) / len(scores)
        normalized_score = max(-1.0, min(1.0, avg_score))

        explanation = "; ".join(explanations) if explanations else "Mixed fundamentals"

        return Fundamentals(
            score=normalized_score,
            key_metrics=metrics,
            explanation=explanation,
        )

    except Exception:
        return None


def analyze_crypto_fundamentals(data: StockData, verbose: bool = False) -> CryptoFundamentals | None:
    """Analyze crypto-specific fundamentals (market cap, supply, category)."""
    if data.asset_type != "crypto":
        return None

    info = data.info
    ticker = data.ticker.upper()

    try:
        # Market cap analysis
        market_cap = info.get("marketCap")
        if not market_cap:
            return None

        # Categorize by market cap
        if market_cap >= 10_000_000_000:  # $10B+
            market_cap_rank = "large"
            cap_score = 0.3  # Large caps are more stable
        elif market_cap >= 1_000_000_000:  # $1B-$10B
            market_cap_rank = "mid"
            cap_score = 0.1
        else:
            market_cap_rank = "small"
            cap_score = -0.2  # Small caps are riskier

        # Volume analysis
        volume_24h = info.get("volume") or info.get("volume24Hr")
        volume_score = 0.0
        if volume_24h and market_cap:
            volume_to_cap = volume_24h / market_cap
            if volume_to_cap > 0.05:  # >5% daily turnover
                volume_score = 0.2  # High liquidity
            elif volume_to_cap < 0.01:
                volume_score = -0.2  # Low liquidity

        # Circulating supply
        circulating_supply = info.get("circulatingSupply")

        # Get crypto category
        category = CRYPTO_CATEGORIES.get(ticker, "Unknown")

        # Calculate BTC correlation (30 days)
        btc_correlation = None
        try:
            if ticker != "BTC-USD" and data.price_history is not None:
                btc = yf.Ticker("BTC-USD")
                btc_hist = btc.history(period="1mo")
                if not btc_hist.empty and len(data.price_history) > 5:
                    # Align dates and calculate correlation
                    crypto_returns = data.price_history["Close"].pct_change().dropna()
                    btc_returns = btc_hist["Close"].pct_change().dropna()
                    # Simple correlation on overlapping dates
                    common_dates = crypto_returns.index.intersection(btc_returns.index)
                    if len(common_dates) > 10:
                        btc_correlation = crypto_returns.loc[common_dates].corr(btc_returns.loc[common_dates])
        except Exception:
            pass

        # BTC correlation scoring (high correlation = less diversification benefit)
        corr_score = 0.0
        if btc_correlation is not None:
            if btc_correlation > 0.8:
                corr_score = -0.1  # Very correlated to BTC
            elif btc_correlation < 0.3:
                corr_score = 0.1  # Good diversification

        # Total score
        total_score = cap_score + volume_score + corr_score

        # Build explanation
        explanations = []
        explanations.append(f"Market cap: ${market_cap/1e9:.1f}B ({market_cap_rank})")
        if category != "Unknown":
            explanations.append(f"Category: {category}")
        if btc_correlation is not None:
            explanations.append(f"BTC corr: {btc_correlation:.2f}")

        return CryptoFundamentals(
            market_cap=market_cap,
            market_cap_rank=market_cap_rank,
            volume_24h=volume_24h,
            circulating_supply=circulating_supply,
            category=category,
            btc_correlation=round(btc_correlation, 2) if btc_correlation else None,
            score=max(-1.0, min(1.0, total_score)),
            explanation="; ".join(explanations),
        )

    except Exception as e:
        if verbose:
            print(f"Error analyzing crypto fundamentals: {e}", file=sys.stderr)
        return None


def analyze_analyst_sentiment(data: StockData) -> AnalystSentiment | None:
    """Analyze analyst sentiment and price targets."""
    info = data.info

    try:
        # Get current price
        current_price = info.get("regularMarketPrice") or info.get("currentPrice")
        if not current_price:
            return None

        # Get target price
        target_price = info.get("targetMeanPrice")

        # Get number of analysts
        num_analysts = info.get("numberOfAnalystOpinions")

        # Get recommendation
        recommendation = info.get("recommendationKey")

        if not target_price or not recommendation:
            return AnalystSentiment(
                score=None,
                summary="No analyst coverage available",
            )

        # Calculate upside
        upside_pct = ((target_price - current_price) / current_price) * 100

        # Score based on recommendation and upside
        rec_scores = {
            "strong_buy": 1.0,
            "buy": 0.7,
            "hold": 0.0,
            "sell": -0.7,
            "strong_sell": -1.0,
        }

        base_score = rec_scores.get(recommendation, 0.0)

        # Adjust based on upside
        if upside_pct > 20:
            score = min(1.0, base_score + 0.3)
        elif upside_pct > 10:
            score = min(1.0, base_score + 0.15)
        elif upside_pct < -10:
            score = max(-1.0, base_score - 0.3)
        else:
            score = base_score

        # Format recommendation
        rec_display = recommendation.replace("_", " ").title()

        summary = f"{rec_display} with {abs(upside_pct):.1f}% {'upside' if upside_pct > 0 else 'downside'}"
        if num_analysts:
            summary += f" ({num_analysts} analysts)"

        return AnalystSentiment(
            score=score,
            summary=summary,
            consensus_rating=rec_display,
            price_target=target_price,
            current_price=current_price,
            upside_pct=upside_pct,
            num_analysts=num_analysts,
        )

    except Exception:
        return AnalystSentiment(
            score=None,
            summary="Error analyzing analyst sentiment",
        )


def analyze_historical_patterns(data: StockData) -> HistoricalPatterns | None:
    """Analyze historical earnings patterns."""
    if data.earnings_history is None or data.price_history is None:
        return None

    if data.earnings_history.empty or data.price_history.empty:
        return None

    try:
        # Get last 4 quarters earnings dates
        earnings_dates = data.earnings_history.sort_index(ascending=False).head(4)

        beats = 0
        reactions = []

        for earnings_date, row in earnings_dates.iterrows():
            if pd.notna(row.get("Reported EPS")) and pd.notna(row.get("EPS Estimate")):
                actual = float(row["Reported EPS"])
                expected = float(row["EPS Estimate"])

                if actual > expected:
                    beats += 1

                # Try to get price reaction (day of earnings)
                try:
                    earnings_day = pd.Timestamp(earnings_date).date()

                    # Find closest trading day
                    price_data = data.price_history[data.price_history.index.date == earnings_day]

                    if not price_data.empty:
                        day_change = ((price_data["Close"].iloc[0] - price_data["Open"].iloc[0]) / price_data["Open"].iloc[0]) * 100
                        reactions.append(day_change)
                except Exception:
                    continue

        total_quarters = len(earnings_dates)
        if total_quarters == 0:
            return None

        # Score based on beat rate
        beat_rate = beats / total_quarters

        if beat_rate == 1.0:
            score = 0.8
        elif beat_rate >= 0.75:
            score = 0.5
        elif beat_rate >= 0.5:
            score = 0.0
        elif beat_rate >= 0.25:
            score = -0.5
        else:
            score = -0.8

        # Pattern description
        pattern_desc = f"{beats}/{total_quarters} quarters beat expectations"

        if reactions:
            avg_reaction = sum(reactions) / len(reactions)
            pattern_desc += f", avg reaction {avg_reaction:+.1f}%"
        else:
            avg_reaction = None

        return HistoricalPatterns(
            score=score,
            pattern_desc=pattern_desc,
            beats_last_4q=beats,
            avg_reaction_pct=avg_reaction,
        )

    except Exception:
        return None


def analyze_market_context(verbose: bool = False) -> MarketContext | None:
    """Analyze overall market conditions using VIX, SPY, QQQ, and safe-havens with 1h cache."""
    # Check cache first
    cached = _get_cached("market_context")
    if cached is not None:
        if verbose:
            print("Using cached market context (< 1h old)", file=sys.stderr)
        return cached

    try:
        if verbose:
            print("Fetching market indicators (VIX, SPY, QQQ)...", file=sys.stderr)

        # Fetch market indicators
        vix = yf.Ticker("^VIX")
        spy = yf.Ticker("SPY")
        qqq = yf.Ticker("QQQ")

        # Get current VIX level
        vix_info = vix.info
        vix_level = vix_info.get("regularMarketPrice") or vix_info.get("currentPrice")

        if not vix_level:
            return None

        # Determine VIX status
        if vix_level < 20:
            vix_status = "calm"
            vix_score = 0.2
        elif vix_level < 30:
            vix_status = "elevated"
            vix_score = 0.0
        else:
            vix_status = "fear"
            vix_score = -0.5

        # Get SPY and QQQ 10-day trends
        spy_hist = spy.history(period="1mo")
        qqq_hist = qqq.history(period="1mo")

        if spy_hist.empty or qqq_hist.empty:
            return None

        # Calculate 10-day price changes
        spy_10d_ago = spy_hist["Close"].iloc[-min(10, len(spy_hist))]
        spy_current = spy_hist["Close"].iloc[-1]
        spy_trend_10d = ((spy_current - spy_10d_ago) / spy_10d_ago) * 100

        qqq_10d_ago = qqq_hist["Close"].iloc[-min(10, len(qqq_hist))]
        qqq_current = qqq_hist["Close"].iloc[-1]
        qqq_trend_10d = ((qqq_current - qqq_10d_ago) / qqq_10d_ago) * 100

        # Determine market regime
        avg_trend = (spy_trend_10d + qqq_trend_10d) / 2

        if avg_trend > 3:
            market_regime = "bull"
            regime_score = 0.3
        elif avg_trend < -3:
            market_regime = "bear"
            regime_score = -0.4
        else:
            market_regime = "choppy"
            regime_score = -0.1

        # Calculate overall score
        overall_score = (vix_score + regime_score) / 2

        # NEW v4.0.0: Fetch safe-haven indicators (GLD, TLT, UUP)
        gld_change_5d = None
        tlt_change_5d = None
        uup_change_5d = None
        risk_off_detected = False

        try:
            if verbose:
                print("Fetching safe-haven indicators (GLD, TLT, UUP)...", file=sys.stderr)

            # Fetch safe-haven ETFs
            gld = yf.Ticker("GLD")  # Gold
            tlt = yf.Ticker("TLT")  # 20+ Year Treasury
            uup = yf.Ticker("UUP")  # USD Index

            gld_hist = gld.history(period="10d")
            tlt_hist = tlt.history(period="10d")
            uup_hist = uup.history(period="10d")

            # Calculate 5-day changes
            if not gld_hist.empty and len(gld_hist) >= 5:
                gld_5d_ago = gld_hist["Close"].iloc[-min(5, len(gld_hist))]
                gld_current = gld_hist["Close"].iloc[-1]
                gld_change_5d = ((gld_current - gld_5d_ago) / gld_5d_ago) * 100

            if not tlt_hist.empty and len(tlt_hist) >= 5:
                tlt_5d_ago = tlt_hist["Close"].iloc[-min(5, len(tlt_hist))]
                tlt_current = tlt_hist["Close"].iloc[-1]
                tlt_change_5d = ((tlt_current - tlt_5d_ago) / tlt_5d_ago) * 100

            if not uup_hist.empty and len(uup_hist) >= 5:
                uup_5d_ago = uup_hist["Close"].iloc[-min(5, len(uup_hist))]
                uup_current = uup_hist["Close"].iloc[-1]
                uup_change_5d = ((uup_current - uup_5d_ago) / uup_5d_ago) * 100

            # Risk-off detection: All three safe-havens rising together
            if (gld_change_5d is not None and gld_change_5d >= 2.0 and
                tlt_change_5d is not None and tlt_change_5d >= 1.0 and
                uup_change_5d is not None and uup_change_5d >= 1.0):
                risk_off_detected = True
                overall_score -= 0.5  # Reduce score significantly
                if verbose:
                    print(f"    🛡️ RISK-OFF DETECTED: GLD {gld_change_5d:+.1f}%, TLT {tlt_change_5d:+.1f}%, UUP {uup_change_5d:+.1f}%", file=sys.stderr)

        except Exception as e:
            if verbose:
                print(f"    Safe-haven indicators unavailable: {e}", file=sys.stderr)

        # Build explanation
        explanation = f"VIX {vix_level:.1f} ({vix_status}), Market {market_regime} (SPY {spy_trend_10d:+.1f}%, QQQ {qqq_trend_10d:+.1f}% 10d)"
        if risk_off_detected:
            explanation += " ⚠️ RISK-OFF MODE"

        result = MarketContext(
            vix_level=vix_level,
            vix_status=vix_status,
            spy_trend_10d=spy_trend_10d,
            qqq_trend_10d=qqq_trend_10d,
            market_regime=market_regime,
            score=overall_score,
            explanation=explanation,
            gld_change_5d=gld_change_5d,
            tlt_change_5d=tlt_change_5d,
            uup_change_5d=uup_change_5d,
            risk_off_detected=risk_off_detected,
        )

        # Cache the result for 1 hour
        _set_cache("market_context", result)
        return result

    except Exception as e:
        if verbose:
            print(f"Error analyzing market context: {e}", file=sys.stderr)
        return None


def get_sector_etf_ticker(sector: str) -> str | None:
    """Map sector name to corresponding sector ETF ticker."""
    sector_map = {
        "Financial Services": "XLF",
        "Financials": "XLF",
        "Technology": "XLK",
        "Healthcare": "XLV",
        "Consumer Cyclical": "XLY",
        "Consumer Defensive": "XLP",
        "Utilities": "XLU",
        "Basic Materials": "XLB",
        "Real Estate": "XLRE",
        "Communication Services": "XLC",
        "Industrials": "XLI",
        "Energy": "XLE",
    }

    return sector_map.get(sector)


# ============================================================================
# Breaking News Check (v4.0.0)
# ============================================================================

# Crisis keywords by category
CRISIS_KEYWORDS = {
    "war": ["war", "invasion", "military strike", "attack", "conflict", "combat"],
    "economic": ["recession", "crisis", "collapse", "default", "bankruptcy", "crash"],
    "regulatory": ["sanctions", "embargo", "ban", "investigation", "fraud", "probe"],
    "disaster": ["earthquake", "hurricane", "pandemic", "outbreak", "disaster", "catastrophe"],
    "financial": ["emergency rate", "fed emergency", "bailout", "circuit breaker", "trading halt"],
}

# Geopolitical event → sector mapping (v4.0.0)
GEOPOLITICAL_RISK_MAP = {
    "taiwan": {
        "keywords": ["taiwan", "tsmc", "strait"],
        "sectors": ["Technology", "Communication Services"],
        "sector_etfs": ["XLK", "XLC"],
        "impact": "Semiconductor supply chain disruption",
        "affected_tickers": ["NVDA", "AMD", "TSM", "INTC", "QCOM", "AVGO", "MU"],
    },
    "china": {
        "keywords": ["china", "beijing", "tariff", "trade war"],
        "sectors": ["Technology", "Consumer Cyclical", "Consumer Defensive"],
        "sector_etfs": ["XLK", "XLY", "XLP"],
        "impact": "Tech supply chain and consumer market exposure",
        "affected_tickers": ["AAPL", "QCOM", "NKE", "SBUX", "MCD", "YUM", "TGT", "WMT"],
    },
    "russia_ukraine": {
        "keywords": ["russia", "ukraine", "putin", "kyiv", "moscow"],
        "sectors": ["Energy", "Materials"],
        "sector_etfs": ["XLE", "XLB"],
        "impact": "Energy and commodity price volatility",
        "affected_tickers": ["XOM", "CVX", "COP", "SLB", "MOS", "CF", "NTR", "ADM"],
    },
    "middle_east": {
        "keywords": ["iran", "israel", "gaza", "saudi", "middle east", "gulf"],
        "sectors": ["Energy", "Industrials"],
        "sector_etfs": ["XLE", "XLI"],
        "impact": "Oil price volatility and defense spending",
        "affected_tickers": ["XOM", "CVX", "COP", "LMT", "RTX", "NOC", "GD", "BA"],
    },
    "banking_crisis": {
        "keywords": ["bank failure", "credit crisis", "liquidity crisis", "bank run"],
        "sectors": ["Financials"],
        "sector_etfs": ["XLF"],
        "impact": "Financial sector contagion risk",
        "affected_tickers": ["JPM", "BAC", "WFC", "C", "GS", "MS", "USB", "PNC"],
    },
}


def check_breaking_news(verbose: bool = False) -> list[str] | None:
    """
    Check Google News RSS for breaking market/economic crisis events (last 24h).
    Returns list of alert strings or None.
    Uses 1h cache to avoid excessive API calls.
    """
    # Check cache first
    cached = _get_cached("breaking_news")
    if cached is not None:
        return cached

    alerts = []

    try:
        import feedparser
        from datetime import datetime, timezone, timedelta

        if verbose:
            print("Checking breaking news (Google News RSS)...", file=sys.stderr)

        # Google News RSS feeds for finance/business
        rss_urls = [
            "https://news.google.com/rss/search?q=stock+market+when:24h&hl=en-US&gl=US&ceid=US:en",
            "https://news.google.com/rss/search?q=economy+crisis+when:24h&hl=en-US&gl=US&ceid=US:en",
        ]

        now = datetime.now(timezone.utc)
        cutoff_time = now - timedelta(hours=24)

        for url in rss_urls:
            try:
                feed = feedparser.parse(url)

                for entry in feed.entries[:20]:  # Check top 20 headlines
                    # Parse publication date
                    pub_date = None
                    if hasattr(entry, "published_parsed") and entry.published_parsed:
                        pub_date = datetime(*entry.published_parsed[:6], tzinfo=timezone.utc)

                    # Skip if older than 24h
                    if pub_date and pub_date < cutoff_time:
                        continue

                    title = entry.get("title", "").lower()
                    summary = entry.get("summary", "").lower()
                    text = f"{title} {summary}"

                    # Check for crisis keywords
                    for category, keywords in CRISIS_KEYWORDS.items():
                        for keyword in keywords:
                            if keyword in text:
                                alert_text = entry.get("title", "Unknown alert")
                                hours_ago = int((now - pub_date).total_seconds() / 3600) if pub_date else None
                                time_str = f"{hours_ago}h ago" if hours_ago is not None else "recent"

                                alert = f"{alert_text} ({time_str})"
                                if alert not in alerts:  # Deduplicate
                                    alerts.append(alert)
                                    if verbose:
                                        print(f"    ⚠️ Alert: {alert}", file=sys.stderr)
                                break
                        if len(alerts) >= 3:  # Limit to 3 alerts
                            break

                    if len(alerts) >= 3:
                        break

            except Exception as e:
                if verbose:
                    print(f"    Failed to fetch {url}: {e}", file=sys.stderr)
                continue

        # Cache results (even if empty) for 1 hour
        result = alerts if alerts else None
        _set_cache("breaking_news", result)
        return result

    except Exception as e:
        if verbose:
            print(f"    Breaking news check failed: {e}", file=sys.stderr)
        return None


def check_sector_geopolitical_risk(
    ticker: str,
    sector: str | None,
    breaking_news: list[str] | None,
    verbose: bool = False
) -> tuple[str | None, float]:
    """
    Check if ticker is exposed to geopolitical risks based on breaking news.
    Returns (warning_message, confidence_penalty).

    Args:
        ticker: Stock ticker symbol
        sector: Stock sector (from yfinance)
        breaking_news: List of breaking news alerts
        verbose: Print debug info

    Returns:
        (warning_message, confidence_penalty) where:
        - warning_message: None or string like "⚠️ SECTOR RISK: Taiwan tensions affect semiconductors"
        - confidence_penalty: 0.0 (no risk) to 0.5 (high risk)
    """
    if not breaking_news:
        return None, 0.0

    # Combine all breaking news into single text for keyword matching
    news_text = " ".join(breaking_news).lower()

    # Check each geopolitical event
    for event_name, event_data in GEOPOLITICAL_RISK_MAP.items():
        # Check if any keywords from this event appear in breaking news
        keywords_found = []
        for keyword in event_data["keywords"]:
            if keyword in news_text:
                keywords_found.append(keyword)

        if not keywords_found:
            continue

        # Check if ticker is in affected list
        if ticker in event_data["affected_tickers"]:
            # Direct ticker exposure
            warning = f"⚠️ SECTOR RISK: {event_data['impact']} (detected: {', '.join(keywords_found)})"
            penalty = 0.3  # Reduce BUY confidence by 30%

            if verbose:
                print(f"    Geopolitical risk detected: {event_name} affects {ticker}", file=sys.stderr)

            return warning, penalty

        # Check if sector is affected (even if ticker not in list)
        if sector and sector in event_data["sectors"]:
            # Sector exposure (weaker signal)
            warning = f"⚠️ SECTOR RISK: {sector} sector exposed to {event_data['impact']}"
            penalty = 0.15  # Reduce BUY confidence by 15%

            if verbose:
                print(f"    Sector risk detected: {event_name} affects {sector} sector", file=sys.stderr)

            return warning, penalty

    return None, 0.0


def analyze_sector_performance(data: StockData, verbose: bool = False) -> SectorComparison | None:
    """Compare stock performance to its sector."""
    try:
        sector = data.info.get("sector")
        industry = data.info.get("industry")

        if not sector:
            return None

        sector_etf_ticker = get_sector_etf_ticker(sector)

        if not sector_etf_ticker:
            if verbose:
                print(f"No sector ETF mapping for {sector}", file=sys.stderr)
            return None

        if verbose:
            print(f"Comparing to sector ETF: {sector_etf_ticker}", file=sys.stderr)

        # Fetch sector ETF data
        sector_etf = yf.Ticker(sector_etf_ticker)
        sector_hist = sector_etf.history(period="3mo")

        if sector_hist.empty or data.price_history is None or data.price_history.empty:
            return None

        # Calculate 1-month returns
        stock_1m_ago = data.price_history["Close"].iloc[-min(22, len(data.price_history))]
        stock_current = data.price_history["Close"].iloc[-1]
        stock_return_1m = ((stock_current - stock_1m_ago) / stock_1m_ago) * 100

        sector_1m_ago = sector_hist["Close"].iloc[-min(22, len(sector_hist))]
        sector_current = sector_hist["Close"].iloc[-1]
        sector_return_1m = ((sector_current - sector_1m_ago) / sector_1m_ago) * 100

        # Calculate relative strength
        relative_strength = stock_return_1m / sector_return_1m if sector_return_1m != 0 else 1.0

        # Sector 10-day trend
        sector_10d_ago = sector_hist["Close"].iloc[-min(10, len(sector_hist))]
        sector_trend_10d = ((sector_current - sector_10d_ago) / sector_10d_ago) * 100

        if sector_trend_10d > 5:
            sector_trend = "strong uptrend"
        elif sector_trend_10d > 2:
            sector_trend = "uptrend"
        elif sector_trend_10d < -5:
            sector_trend = "downtrend"
        elif sector_trend_10d < -2:
            sector_trend = "weak"
        else:
            sector_trend = "neutral"

        # Calculate score
        score = 0.0

        # Relative performance score
        if relative_strength > 1.05:  # Outperforming by >5%
            score += 0.3
        elif relative_strength < 0.95:  # Underperforming by >5%
            score -= 0.3

        # Sector trend score
        if sector_trend_10d > 5:
            score += 0.2
        elif sector_trend_10d < -5:
            score -= 0.2

        explanation = f"{sector} sector {sector_trend} ({sector_return_1m:+.1f}% 1m), stock {stock_return_1m:+.1f}% vs sector"

        return SectorComparison(
            sector_name=sector,
            industry_name=industry or "Unknown",
            stock_return_1m=stock_return_1m,
            sector_return_1m=sector_return_1m,
            relative_strength=relative_strength,
            sector_trend=sector_trend,
            score=score,
            explanation=explanation,
        )

    except Exception as e:
        if verbose:
            print(f"Error analyzing sector performance: {e}", file=sys.stderr)
        return None


def analyze_earnings_timing(data: StockData) -> EarningsTiming | None:
    """Check earnings timing and flag pre/post-earnings periods."""
    try:
        from datetime import datetime, timedelta

        if data.earnings_history is None or data.earnings_history.empty:
            return None

        current_date = datetime.now()
        earnings_dates = data.earnings_history.sort_index(ascending=False)

        # Find next and last earnings dates
        next_earnings_date = None
        last_earnings_date = None

        for earnings_date in earnings_dates.index:
            earnings_dt = pd.Timestamp(earnings_date).to_pydatetime()

            if earnings_dt > current_date and next_earnings_date is None:
                next_earnings_date = earnings_dt
            elif earnings_dt <= current_date and last_earnings_date is None:
                last_earnings_date = earnings_dt
                break

        # Calculate days until/since earnings
        days_until_earnings = None
        days_since_earnings = None

        if next_earnings_date:
            days_until_earnings = (next_earnings_date - current_date).days

        if last_earnings_date:
            days_since_earnings = (current_date - last_earnings_date).days

        # Determine timing flag
        timing_flag = "safe"
        confidence_adjustment = 0.0
        caveats = []

        # Pre-earnings check (< 14 days)
        if days_until_earnings is not None and days_until_earnings <= 14:
            timing_flag = "pre_earnings"
            confidence_adjustment = -0.3
            caveats.append(f"Earnings in {days_until_earnings} days - high volatility expected")

        # Post-earnings check (< 5 days)
        price_change_5d = None
        if days_since_earnings is not None and days_since_earnings <= 5:
            # Calculate 5-day price change
            if data.price_history is not None and len(data.price_history) >= 5:
                price_5d_ago = data.price_history["Close"].iloc[-5]
                price_current = data.price_history["Close"].iloc[-1]
                price_change_5d = ((price_current - price_5d_ago) / price_5d_ago) * 100

                if price_change_5d > 15:
                    timing_flag = "post_earnings"
                    confidence_adjustment = -0.2
                    caveats.append(f"Up {price_change_5d:.1f}% in 5 days - gains may be priced in")

        return EarningsTiming(
            days_until_earnings=days_until_earnings,
            days_since_earnings=days_since_earnings,
            next_earnings_date=next_earnings_date.strftime("%Y-%m-%d") if next_earnings_date else None,
            last_earnings_date=last_earnings_date.strftime("%Y-%m-%d") if last_earnings_date else None,
            timing_flag=timing_flag,
            price_change_5d=price_change_5d,
            confidence_adjustment=confidence_adjustment,
            caveats=caveats,
        )

    except Exception:
        return None


def calculate_rsi(prices: pd.Series, period: int = 14) -> float | None:
    """Calculate RSI (Relative Strength Index)."""
    try:
        if len(prices) < period + 1:
            return None

        # Calculate price changes
        delta = prices.diff()

        # Separate gains and losses
        gains = delta.where(delta > 0, 0)
        losses = -delta.where(delta < 0, 0)

        # Calculate average gains and losses
        avg_gain = gains.rolling(window=period).mean()
        avg_loss = losses.rolling(window=period).mean()

        # Calculate RS
        rs = avg_gain / avg_loss

        # Calculate RSI
        rsi = 100 - (100 / (1 + rs))

        return float(rsi.iloc[-1])

    except Exception:
        return None


def analyze_momentum(data: StockData) -> MomentumAnalysis | None:
    """Analyze momentum indicators (RSI, 52w range, volume, relative strength)."""
    try:
        if data.price_history is None or data.price_history.empty:
            return None

        # Calculate RSI
        rsi_14d = calculate_rsi(data.price_history["Close"], period=14)

        if rsi_14d:
            if rsi_14d > 70:
                rsi_status = "overbought"
            elif rsi_14d < 30:
                rsi_status = "oversold"
            else:
                rsi_status = "neutral"
        else:
            rsi_status = "unknown"

        # Get 52-week high/low
        high_52w = data.info.get("fiftyTwoWeekHigh")
        low_52w = data.info.get("fiftyTwoWeekLow")
        current_price = data.info.get("regularMarketPrice") or data.info.get("currentPrice")

        price_vs_52w_low = None
        price_vs_52w_high = None
        near_52w_high = False
        near_52w_low = False

        if high_52w and low_52w and current_price:
            price_range = high_52w - low_52w
            if price_range > 0:
                price_vs_52w_low = ((current_price - low_52w) / price_range) * 100
                price_vs_52w_high = ((high_52w - current_price) / price_range) * 100

                near_52w_high = price_vs_52w_low > 90
                near_52w_low = price_vs_52w_low < 10

        # Volume analysis
        volume_ratio = None
        if "Volume" in data.price_history.columns and len(data.price_history) >= 60:
            recent_vol = data.price_history["Volume"].iloc[-5:].mean()
            avg_vol = data.price_history["Volume"].iloc[-60:].mean()
            volume_ratio = recent_vol / avg_vol if avg_vol > 0 else None

        # Calculate score
        score = 0.0
        explanations = []

        if rsi_14d:
            if rsi_14d > 70:
                score -= 0.5
                explanations.append(f"RSI {rsi_14d:.0f} (overbought)")
            elif rsi_14d < 30:
                score += 0.5
                explanations.append(f"RSI {rsi_14d:.0f} (oversold)")

        if near_52w_high:
            score -= 0.3
            explanations.append("Near 52w high")
        elif near_52w_low:
            score += 0.3
            explanations.append("Near 52w low")

        if volume_ratio and volume_ratio > 1.5:
            explanations.append(f"Volume {volume_ratio:.1f}x average")

        explanation = "; ".join(explanations) if explanations else "Momentum indicators neutral"

        return MomentumAnalysis(
            rsi_14d=rsi_14d,
            rsi_status=rsi_status,
            price_vs_52w_low=price_vs_52w_low,
            price_vs_52w_high=price_vs_52w_high,
            near_52w_high=near_52w_high,
            near_52w_low=near_52w_low,
            volume_ratio=volume_ratio,
            relative_strength_vs_sector=None,  # Could be enhanced with sector comparison
            score=score,
            explanation=explanation,
        )

    except Exception:
        return None


# ============================================================================
# Sentiment Analysis Helper Functions
# ============================================================================

# Simple cache for shared indicators (Fear & Greed, VIX)
# Format: {key: (value, timestamp)}
_SENTIMENT_CACHE = {}
_CACHE_TTL_SECONDS = 3600  # 1 hour


def _get_cached(key: str):
    """Get cached value if still valid (within TTL)."""
    if key in _SENTIMENT_CACHE:
        value, timestamp = _SENTIMENT_CACHE[key]
        if time.time() - timestamp < _CACHE_TTL_SECONDS:
            return value
    return None


def _set_cache(key: str, value):
    """Set cached value with current timestamp."""
    _SENTIMENT_CACHE[key] = (value, time.time())


async def get_fear_greed_index() -> tuple[float, int | None, str | None] | None:
    """
    Fetch CNN Fear & Greed Index (contrarian indicator) with 1h cache.
    Returns: (score, value, status) or None on failure.
    """
    # Check cache first
    cached = _get_cached("fear_greed")
    if cached is not None:
        return cached

    def _fetch():
        try:
            from fear_and_greed import get as get_fear_greed
            result = get_fear_greed()
            return result
        except Exception:
            return None

    try:
        result = await asyncio.to_thread(_fetch)
        if result is None:
            return None

        value = result.value  # 0-100
        status = result.description  # "Extreme Fear", "Fear", etc.

        # Contrarian scoring
        if value <= 25:
            score = 0.5  # Extreme fear = buy opportunity
        elif value <= 45:
            score = 0.2  # Fear = mild buy signal
        elif value <= 55:
            score = 0.0  # Neutral
        elif value <= 75:
            score = -0.2  # Greed = caution
        else:
            score = -0.5  # Extreme greed = warning

        result_tuple = (score, value, status)
        _set_cache("fear_greed", result_tuple)
        return result_tuple
    except Exception:
        return None


async def get_short_interest(data: StockData) -> tuple[float, float | None, float | None] | None:
    """
    Analyze short interest (from yfinance).
    Returns: (score, short_interest_pct, days_to_cover) or None.
    """
    # This is already synchronous data access (no API call), but make it async for consistency
    try:
        short_pct = data.info.get("shortPercentOfFloat")
        if short_pct is None:
            return None

        short_pct_float = float(short_pct) * 100  # Convert to percentage

        # Estimate days to cover (simplified - actual calculation needs volume data)
        short_ratio = data.info.get("shortRatio")  # Days to cover
        days_to_cover = float(short_ratio) if short_ratio else None

        # Scoring logic
        if short_pct_float > 20:
            if days_to_cover and days_to_cover > 10:
                score = 0.4  # High short interest + high days to cover = squeeze potential
            else:
                score = -0.3  # High short interest but justified
        elif short_pct_float < 5:
            score = 0.2  # Low short interest = bullish sentiment
        else:
            score = 0.0  # Normal range

        return (score, short_pct_float, days_to_cover)
    except Exception:
        return None


async def get_vix_term_structure() -> tuple[float, str | None, float | None] | None:
    """
    Analyze VIX futures term structure (contango vs backwardation) with 1h cache.
    Returns: (score, structure, slope) or None.
    """
    # Check cache first
    cached = _get_cached("vix_structure")
    if cached is not None:
        return cached

    def _fetch():
        try:
            import yfinance as yf
            vix = yf.Ticker("^VIX")
            vix_data = vix.history(period="5d")
            if vix_data.empty:
                return None
            return vix_data["Close"].iloc[-1]
        except Exception:
            return None

    try:
        vix_spot = await asyncio.to_thread(_fetch)
        if vix_spot is None:
            return None

        # Simplified: assume normal contango when VIX < 20, backwardation when VIX > 30
        if vix_spot < 15:
            structure = "contango"
            slope = 10.0  # Steep contango
            score = 0.3  # Complacency/bullish
        elif vix_spot < 20:
            structure = "contango"
            slope = 5.0
            score = 0.1
        elif vix_spot > 30:
            structure = "backwardation"
            slope = -5.0
            score = -0.3  # Stress/bearish
        else:
            structure = "flat"
            slope = 0.0
            score = 0.0

        result_tuple = (score, structure, slope)
        _set_cache("vix_structure", result_tuple)
        return result_tuple
    except Exception:
        return None


async def get_insider_activity(ticker: str, period_days: int = 90) -> tuple[float, int | None, float | None] | None:
    """
    Analyze insider trading from SEC Form 4 filings using edgartools.
    Returns: (score, net_shares, net_value_millions) or None.

    Scoring logic:
    - Strong buying (>100K shares or >$1M): +0.8
    - Moderate buying (>10K shares or >$0.1M): +0.4
    - Neutral: 0
    - Moderate selling: -0.4
    - Strong selling: -0.8

    Note: SEC EDGAR API requires User-Agent with email.
    """
    def _fetch():
        try:
            from edgar import Company, set_identity
            from datetime import datetime, timedelta

            # Set SEC-required identity
            set_identity("stock-analysis@clawd.bot")

            # Get company and Form 4 filings
            company = Company(ticker)
            filings = company.get_filings(form="4")

            if filings is None or len(filings) == 0:
                return None

            # Calculate cutoff date
            cutoff_date = datetime.now() - timedelta(days=period_days)

            # Aggregate transactions
            total_bought_shares = 0
            total_sold_shares = 0
            total_bought_value = 0.0
            total_sold_value = 0.0

            # Process recent filings (iterate, don't slice due to pyarrow compatibility)
            count = 0
            for filing in filings:
                if count >= 50:
                    break
                count += 1

                try:
                    # Check filing date
                    filing_date = filing.filing_date
                    if hasattr(filing_date, 'to_pydatetime'):
                        filing_date = filing_date.to_pydatetime()
                    elif isinstance(filing_date, str):
                        filing_date = datetime.strptime(filing_date, "%Y-%m-%d")

                    # Convert date object to datetime for comparison
                    if hasattr(filing_date, 'year') and not hasattr(filing_date, 'hour'):
                        filing_date = datetime.combine(filing_date, datetime.min.time())

                    if filing_date < cutoff_date:
                        continue

                    # Get Form 4 object
                    form4 = filing.obj()
                    if form4 is None:
                        continue

                    # Process purchases (edgartools returns DataFrames)
                    if hasattr(form4, 'common_stock_purchases'):
                        purchases = form4.common_stock_purchases
                        if isinstance(purchases, pd.DataFrame) and not purchases.empty:
                            if 'Shares' in purchases.columns:
                                total_bought_shares += int(purchases['Shares'].sum())
                            if 'Price' in purchases.columns and 'Shares' in purchases.columns:
                                total_bought_value += float((purchases['Shares'] * purchases['Price']).sum())

                    # Process sales
                    if hasattr(form4, 'common_stock_sales'):
                        sales = form4.common_stock_sales
                        if isinstance(sales, pd.DataFrame) and not sales.empty:
                            if 'Shares' in sales.columns:
                                total_sold_shares += int(sales['Shares'].sum())
                            if 'Price' in sales.columns and 'Shares' in sales.columns:
                                total_sold_value += float((sales['Shares'] * sales['Price']).sum())

                except Exception:
                    continue

            # Calculate net values
            net_shares = total_bought_shares - total_sold_shares
            net_value = (total_bought_value - total_sold_value) / 1_000_000  # Millions

            # Apply scoring logic
            if net_shares > 100_000 or net_value > 1.0:
                score = 0.8  # Strong buying
            elif net_shares > 10_000 or net_value > 0.1:
                score = 0.4  # Moderate buying
            elif net_shares < -100_000 or net_value < -1.0:
                score = -0.8  # Strong selling
            elif net_shares < -10_000 or net_value < -0.1:
                score = -0.4  # Moderate selling
            else:
                score = 0.0  # Neutral

            return (score, net_shares, net_value)

        except ImportError:
            # edgartools not installed
            return None
        except Exception:
            return None

    try:
        result = await asyncio.to_thread(_fetch)
        return result
    except Exception:
        return None


async def get_put_call_ratio(data: StockData) -> tuple[float, float | None, int | None, int | None] | None:
    """
    Calculate put/call ratio from options chain (contrarian indicator).
    Returns: (score, ratio, put_volume, call_volume) or None.
    """
    def _fetch():
        try:
            if data.ticker_obj is None:
                return None

            # Get options chain for nearest expiration
            expirations = data.ticker_obj.options
            if not expirations or len(expirations) == 0:
                return None

            nearest_exp = expirations[0]
            opt_chain = data.ticker_obj.option_chain(nearest_exp)

            # Calculate total put and call volume
            put_volume = opt_chain.puts["volume"].sum() if "volume" in opt_chain.puts.columns else 0
            call_volume = opt_chain.calls["volume"].sum() if "volume" in opt_chain.calls.columns else 0

            if call_volume == 0 or put_volume == 0:
                return None

            ratio = put_volume / call_volume
            return (ratio, int(put_volume), int(call_volume))
        except Exception:
            return None

    try:
        result = await asyncio.to_thread(_fetch)
        if result is None:
            return None

        ratio, put_volume, call_volume = result

        # Contrarian scoring
        if ratio > 1.5:
            score = 0.3  # Excessive fear = bullish
        elif ratio > 1.0:
            score = 0.1  # Mild fear
        elif ratio > 0.7:
            score = -0.1  # Normal
        else:
            score = -0.3  # Complacency = bearish

        return (score, ratio, put_volume, call_volume)
    except Exception:
        return None


async def analyze_sentiment(data: StockData, verbose: bool = False, skip_insider: bool = False) -> SentimentAnalysis | None:
    """
    Analyze market sentiment using 5 sub-indicators in parallel.
    Requires at least 2 of 5 indicators for valid sentiment.
    Returns overall sentiment score (-1.0 to +1.0) with sub-metrics.
    """
    scores = []
    explanations = []
    warnings = []

    # Initialize all raw data fields
    fear_greed_score = None
    fear_greed_value = None
    fear_greed_status = None

    short_interest_score = None
    short_interest_pct = None
    days_to_cover = None

    vix_structure_score = None
    vix_structure = None
    vix_slope = None

    insider_activity_score = None
    insider_net_shares = None
    insider_net_value = None

    put_call_score = None
    put_call_ratio = None
    put_volume = None
    call_volume = None

    # Fetch all 5 indicators in parallel with 10s timeout per indicator
    # (or 4 if skip_insider=True for faster analysis)
    try:
        tasks = [
            asyncio.wait_for(get_fear_greed_index(), timeout=10),
            asyncio.wait_for(get_short_interest(data), timeout=10),
            asyncio.wait_for(get_vix_term_structure(), timeout=10),
        ]
        
        if skip_insider:
            tasks.append(asyncio.sleep(0))  # Placeholder - returns None
            if verbose:
                print("    Skipping insider trading analysis (--no-insider)", file=sys.stderr)
        else:
            tasks.append(asyncio.wait_for(get_insider_activity(data.ticker, period_days=90), timeout=10))
        
        tasks.append(asyncio.wait_for(get_put_call_ratio(data), timeout=10))
        
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Process Fear & Greed Index
        fear_greed_result = results[0]
        if isinstance(fear_greed_result, tuple) and fear_greed_result is not None:
            fear_greed_score, fear_greed_value, fear_greed_status = fear_greed_result
            scores.append(fear_greed_score)
            explanations.append(f"{fear_greed_status} ({fear_greed_value})")
            if verbose:
                print(f"    Fear & Greed: {fear_greed_status} ({fear_greed_value}) → score {fear_greed_score:+.2f}", file=sys.stderr)
        elif verbose and isinstance(fear_greed_result, Exception):
            print(f"    Fear & Greed: Failed ({fear_greed_result})", file=sys.stderr)

        # Process Short Interest
        short_interest_result = results[1]
        if isinstance(short_interest_result, tuple) and short_interest_result is not None:
            short_interest_score, short_interest_pct, days_to_cover = short_interest_result
            scores.append(short_interest_score)
            if days_to_cover:
                explanations.append(f"Short interest {short_interest_pct:.1f}% (days to cover: {days_to_cover:.1f})")
            else:
                explanations.append(f"Short interest {short_interest_pct:.1f}%")
            warnings.append("Short interest data typically ~2 weeks old (FINRA lag)")
            if verbose:
                print(f"    Short Interest: {short_interest_pct:.1f}% → score {short_interest_score:+.2f}", file=sys.stderr)
        elif verbose and isinstance(short_interest_result, Exception):
            print(f"    Short Interest: Failed ({short_interest_result})", file=sys.stderr)

        # Process VIX Term Structure
        vix_result = results[2]
        if isinstance(vix_result, tuple) and vix_result is not None:
            vix_structure_score, vix_structure, vix_slope = vix_result
            scores.append(vix_structure_score)
            explanations.append(f"VIX {vix_structure}")
            if verbose:
                print(f"    VIX Structure: {vix_structure} (slope {vix_slope:.1f}%) → score {vix_structure_score:+.2f}", file=sys.stderr)
        elif verbose and isinstance(vix_result, Exception):
            print(f"    VIX Structure: Failed ({vix_result})", file=sys.stderr)

        # Process Insider Activity
        insider_result = results[3]
        if isinstance(insider_result, tuple) and insider_result is not None:
            insider_activity_score, insider_net_shares, insider_net_value = insider_result
            scores.append(insider_activity_score)
            if insider_net_value:
                explanations.append(f"Insider net: ${insider_net_value:.1f}M")
            warnings.append("Insider trades may lag filing by 2-3 days")
            if verbose:
                print(f"    Insider Activity: Net ${insider_net_value:.1f}M → score {insider_activity_score:+.2f}", file=sys.stderr)
        elif verbose and isinstance(insider_result, Exception):
            print(f"    Insider Activity: Failed ({insider_result})", file=sys.stderr)

        # Process Put/Call Ratio
        put_call_result = results[4]
        if isinstance(put_call_result, tuple) and put_call_result is not None:
            put_call_score, put_call_ratio, put_volume, call_volume = put_call_result
            scores.append(put_call_score)
            explanations.append(f"Put/call ratio {put_call_ratio:.2f}")
            if verbose:
                print(f"    Put/Call Ratio: {put_call_ratio:.2f} → score {put_call_score:+.2f}", file=sys.stderr)
        elif verbose and isinstance(put_call_result, Exception):
            print(f"    Put/Call Ratio: Failed ({put_call_result})", file=sys.stderr)

    except Exception as e:
        if verbose:
            print(f"    Sentiment analysis error: {e}", file=sys.stderr)
        return None

    # Require at least 2 of 5 indicators for valid sentiment
    indicators_available = len(scores)
    if indicators_available < 2:
        if verbose:
            print(f"    Sentiment: Insufficient data ({indicators_available}/5 indicators)", file=sys.stderr)
        return None

    # Calculate overall score as simple average
    overall_score = sum(scores) / len(scores)
    explanation = "; ".join(explanations)

    return SentimentAnalysis(
        score=overall_score,
        explanation=explanation,
        fear_greed_score=fear_greed_score,
        short_interest_score=short_interest_score,
        vix_structure_score=vix_structure_score,
        insider_activity_score=insider_activity_score,
        put_call_score=put_call_score,
        fear_greed_value=fear_greed_value,
        fear_greed_status=fear_greed_status,
        short_interest_pct=short_interest_pct,
        days_to_cover=days_to_cover,
        vix_structure=vix_structure,
        vix_slope=vix_slope,
        insider_net_shares=insider_net_shares,
        insider_net_value=insider_net_value,
        put_call_ratio=put_call_ratio,
        put_volume=put_volume,
        call_volume=call_volume,
        indicators_available=indicators_available,
        data_freshness_warnings=warnings if warnings else None,
    )


def synthesize_signal(
    ticker: str,
    company_name: str,
    earnings: EarningsSurprise | None,
    fundamentals: Fundamentals | None,
    analysts: AnalystSentiment | None,
    historical: HistoricalPatterns | None,
    market_context: MarketContext | None,
    sector: SectorComparison | None,
    earnings_timing: EarningsTiming | None,
    momentum: MomentumAnalysis | None,
    sentiment: SentimentAnalysis | None,
    breaking_news: list[str] | None = None,  # NEW v4.0.0
    geopolitical_risk_warning: str | None = None,  # NEW v4.0.0
    geopolitical_risk_penalty: float = 0.0,  # NEW v4.0.0
) -> Signal:
    """Synthesize all components into a final signal."""

    # Collect available components with weights
    components = []
    weights = []

    if earnings:
        components.append(("earnings", earnings.score))
        weights.append(0.30)  # reduced from 0.35

    if fundamentals:
        components.append(("fundamentals", fundamentals.score))
        weights.append(0.20)  # reduced from 0.25

    if analysts and analysts.score is not None:
        components.append(("analysts", analysts.score))
        weights.append(0.20)  # reduced from 0.25

    if historical:
        components.append(("historical", historical.score))
        weights.append(0.10)  # reduced from 0.15

    # NEW COMPONENTS
    if market_context:
        components.append(("market", market_context.score))
        weights.append(0.10)

    if sector:
        components.append(("sector", sector.score))
        weights.append(0.15)

    if momentum:
        components.append(("momentum", momentum.score))
        weights.append(0.15)

    if sentiment:
        components.append(("sentiment", sentiment.score))
        weights.append(0.10)

    # Require at least 2 components
    if len(components) < 2:
        return Signal(
            ticker=ticker,
            company_name=company_name,
            recommendation="HOLD",
            confidence=0.0,
            final_score=0.0,
            supporting_points=["Insufficient data for analysis"],
            caveats=["Limited data available"],
            timestamp=datetime.now().isoformat(),
            components={},
        )

    # Normalize weights
    total_weight = sum(weights)
    normalized_weights = [w / total_weight for w in weights]

    # Calculate weighted score
    final_score = sum(score * weight for (_, score), weight in zip(components, normalized_weights))

    # Determine recommendation
    if final_score > 0.33:
        recommendation = "BUY"
    elif final_score < -0.33:
        recommendation = "SELL"
    else:
        recommendation = "HOLD"

    confidence = abs(final_score)

    # Apply earnings timing adjustments and overrides
    if earnings_timing:
        confidence *= (1.0 + earnings_timing.confidence_adjustment)

        # Override recommendation if needed
        if earnings_timing.timing_flag == "pre_earnings":
            if recommendation == "BUY":
                recommendation = "HOLD"

        elif earnings_timing.timing_flag == "post_earnings":
            if earnings_timing.price_change_5d and earnings_timing.price_change_5d > 15:
                if recommendation == "BUY":
                    recommendation = "HOLD"

    # Check overbought + near 52w high
    if momentum and momentum.rsi_14d and momentum.rsi_14d > 70 and momentum.near_52w_high:
        if recommendation == "BUY":
            recommendation = "HOLD"
            confidence *= 0.7

    # NEW v4.0.0: Risk-off confidence penalty
    if market_context and market_context.risk_off_detected:
        if recommendation == "BUY":
            confidence *= 0.7  # Reduce BUY confidence by 30%

    # NEW v4.0.0: Geopolitical sector risk penalty
    if geopolitical_risk_penalty > 0:
        if recommendation == "BUY":
            confidence *= (1.0 - geopolitical_risk_penalty)  # Apply penalty

    # Generate supporting points
    supporting_points = []

    if earnings and earnings.actual_eps is not None:
        supporting_points.append(
            f"{earnings.explanation} - EPS ${earnings.actual_eps:.2f} vs ${earnings.expected_eps:.2f} expected"
        )

    if fundamentals and fundamentals.explanation:
        supporting_points.append(fundamentals.explanation)

    if analysts and analysts.summary:
        supporting_points.append(f"Analyst consensus: {analysts.summary}")

    if historical and historical.pattern_desc:
        supporting_points.append(f"Historical pattern: {historical.pattern_desc}")

    if market_context and market_context.explanation:
        supporting_points.append(f"Market: {market_context.explanation}")

    if sector and sector.explanation:
        supporting_points.append(f"Sector: {sector.explanation}")

    if momentum and momentum.explanation:
        supporting_points.append(f"Momentum: {momentum.explanation}")

    if sentiment and sentiment.explanation:
        supporting_points.append(f"Sentiment: {sentiment.explanation}")

    # Generate caveats
    caveats = []

    # Add earnings timing caveats first (most important)
    if earnings_timing and earnings_timing.caveats:
        caveats.extend(earnings_timing.caveats)

    # Add sentiment warnings
    if sentiment and sentiment.data_freshness_warnings:
        caveats.extend(sentiment.data_freshness_warnings)

    # Add momentum warnings
    if momentum and momentum.rsi_14d:
        if momentum.rsi_14d > 70 and momentum.near_52w_high:
            caveats.append("Overbought conditions - high risk entry")

    # Add sector warnings
    if sector and sector.score < -0.2:
        caveats.append(f"Sector {sector.sector_name} is weak despite stock fundamentals")

    # Add market warnings
    if market_context and market_context.vix_status == "fear":
        caveats.append(f"High market volatility (VIX {market_context.vix_level:.0f})")

    # NEW v4.0.0: Risk-off warnings
    if market_context and market_context.risk_off_detected:
        caveats.append(f"🛡️ RISK-OFF MODE: Flight to safety detected (GLD {market_context.gld_change_5d:+.1f}%, TLT {market_context.tlt_change_5d:+.1f}%, UUP {market_context.uup_change_5d:+.1f}%)")

    # NEW v4.0.0: Breaking news alerts
    if breaking_news:
        for alert in breaking_news[:2]:  # Limit to 2 alerts to avoid overwhelming
            caveats.append(f"⚠️ BREAKING NEWS: {alert}")

    # NEW v4.0.0: Geopolitical sector risk warnings
    if geopolitical_risk_warning:
        caveats.append(geopolitical_risk_warning)

    # Original caveats
    if not analysts or analysts.score is None:
        caveats.append("Limited or no analyst coverage")

    if not earnings:
        caveats.append("No recent earnings data available")

    if len(components) < 4:
        caveats.append("Analysis based on limited data components")

    if not caveats:
        caveats.append("Market conditions can change rapidly")

    # Limit to 5 caveats
    caveats = caveats[:5]

    # Build components dict for output
    components_dict = {}
    if earnings:
        components_dict["earnings_surprise"] = {
            "score": earnings.score,
            "actual_eps": earnings.actual_eps,
            "expected_eps": earnings.expected_eps,
            "surprise_pct": earnings.surprise_pct,
            "explanation": earnings.explanation,
        }

    if fundamentals:
        components_dict["fundamentals"] = {
            "score": fundamentals.score,
            **fundamentals.key_metrics,
        }

    if analysts:
        components_dict["analyst_sentiment"] = {
            "score": analysts.score,
            "consensus_rating": analysts.consensus_rating,
            "price_target": analysts.price_target,
            "current_price": analysts.current_price,
            "upside_pct": analysts.upside_pct,
            "num_analysts": analysts.num_analysts,
        }

    if historical:
        components_dict["historical_patterns"] = {
            "score": historical.score,
            "beats_last_4q": historical.beats_last_4q,
            "avg_reaction_pct": historical.avg_reaction_pct,
        }

    if market_context:
        components_dict["market_context"] = {
            "score": market_context.score,
            "vix_level": market_context.vix_level,
            "vix_status": market_context.vix_status,
            "spy_trend_10d": market_context.spy_trend_10d,
            "qqq_trend_10d": market_context.qqq_trend_10d,
            "market_regime": market_context.market_regime,
            "gld_change_5d": market_context.gld_change_5d,
            "tlt_change_5d": market_context.tlt_change_5d,
            "uup_change_5d": market_context.uup_change_5d,
            "risk_off_detected": market_context.risk_off_detected,
        }

    if sector:
        components_dict["sector_performance"] = {
            "score": sector.score,
            "sector_name": sector.sector_name,
            "stock_return_1m": sector.stock_return_1m,
            "sector_return_1m": sector.sector_return_1m,
            "relative_strength": sector.relative_strength,
            "sector_trend": sector.sector_trend,
        }

    if earnings_timing:
        components_dict["earnings_timing"] = {
            "days_until_earnings": earnings_timing.days_until_earnings,
            "days_since_earnings": earnings_timing.days_since_earnings,
            "timing_flag": earnings_timing.timing_flag,
            "price_change_5d": earnings_timing.price_change_5d,
            "confidence_adjustment": earnings_timing.confidence_adjustment,
        }

    if momentum:
        components_dict["momentum"] = {
            "score": momentum.score,
            "rsi_14d": momentum.rsi_14d,
            "rsi_status": momentum.rsi_status,
            "near_52w_high": momentum.near_52w_high,
            "near_52w_low": momentum.near_52w_low,
            "volume_ratio": momentum.volume_ratio,
        }

    if sentiment:
        components_dict["sentiment_analysis"] = {
            "score": sentiment.score,
            "indicators_available": sentiment.indicators_available,
            "fear_greed_value": sentiment.fear_greed_value,
            "fear_greed_status": sentiment.fear_greed_status,
            "short_interest_pct": sentiment.short_interest_pct,
            "days_to_cover": sentiment.days_to_cover,
            "vix_structure": sentiment.vix_structure,
            "vix_slope": sentiment.vix_slope,
            "insider_net_value": sentiment.insider_net_value,
            "put_call_ratio": sentiment.put_call_ratio,
            "data_freshness_warnings": sentiment.data_freshness_warnings,
        }

    return Signal(
        ticker=ticker,
        company_name=company_name,
        recommendation=recommendation,
        confidence=confidence,
        final_score=final_score,
        supporting_points=supporting_points[:5],  # Limit to 5
        caveats=caveats,  # Already limited to 5 earlier
        timestamp=datetime.now().isoformat(),
        components=components_dict,
    )


def format_output_text(signal: Signal) -> str:
    """Format signal as text output."""
    lines = [
        "=" * 77,
        f"STOCK ANALYSIS: {signal.ticker} ({signal.company_name})",
        f"Generated: {signal.timestamp}",
        "=" * 77,
        "",
        f"RECOMMENDATION: {signal.recommendation} (Confidence: {signal.confidence*100:.0f}%)",
        "",
        "SUPPORTING POINTS:",
    ]

    for point in signal.supporting_points:
        lines.append(f"• {point}")

    lines.extend([
        "",
        "CAVEATS:",
    ])

    for caveat in signal.caveats:
        lines.append(f"• {caveat}")

    lines.extend([
        "",
        "=" * 77,
        "DISCLAIMER: This analysis is for informational purposes only and does NOT",
        "constitute financial advice. Consult a licensed financial advisor before",
        "making investment decisions. Data provided by Yahoo Finance.",
        "=" * 77,
    ])

    return "\n".join(lines)


def format_output_json(signal: Signal) -> str:
    """Format signal as JSON output."""
    output = {
        **asdict(signal),
        "disclaimer": "NOT FINANCIAL ADVICE. For informational purposes only.",
    }
    return json.dumps(output, indent=2)


def main():
    parser = argparse.ArgumentParser(
        description="Analyze stocks using Yahoo Finance data"
    )
    parser.add_argument(
        "tickers",
        nargs="*",
        help="Stock/crypto ticker(s) to analyze"
    )
    parser.add_argument(
        "--output",
        choices=["text", "json"],
        default="text",
        help="Output format (default: text)"
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Verbose output to stderr"
    )
    parser.add_argument(
        "--portfolio", "-p",
        type=str,
        help="Analyze all assets in a portfolio"
    )
    parser.add_argument(
        "--period",
        choices=["daily", "weekly", "monthly", "quarterly", "yearly"],
        help="Period for portfolio performance analysis"
    )
    parser.add_argument(
        "--no-insider",
        action="store_true",
        help="Skip insider trading analysis (faster, SEC EDGAR is slow)"
    )
    parser.add_argument(
        "--fast",
        action="store_true",
        help="Fast mode: skip slow analyses (insider, breaking news)"
    )

    args = parser.parse_args()
    
    # Fast mode shortcuts
    if args.fast:
        args.no_insider = True

    # Handle portfolio mode
    portfolio_assets = []
    portfolio_name = None
    if args.portfolio:
        try:
            from portfolio import PortfolioStore
            store = PortfolioStore()
            portfolio = store.get_portfolio(args.portfolio)
            if not portfolio:
                # Try to find default portfolio if name not found
                default_name = store.get_default_portfolio_name()
                if default_name and args.portfolio.lower() == "default":
                    portfolio = store.get_portfolio(default_name)
                    portfolio_name = default_name
                else:
                    print(f"Error: Portfolio '{args.portfolio}' not found", file=sys.stderr)
                    sys.exit(1)
            else:
                portfolio_name = portfolio.name

            if not portfolio.assets:
                print(f"Portfolio '{portfolio_name}' has no assets", file=sys.stderr)
                sys.exit(1)

            portfolio_assets = [(a.ticker, a.quantity, a.cost_basis, a.type) for a in portfolio.assets]
            args.tickers = [a.ticker for a in portfolio.assets]

            if args.verbose:
                print(f"Analyzing portfolio: {portfolio_name} ({len(portfolio_assets)} assets)", file=sys.stderr)

        except ImportError:
            print("Error: portfolio.py not found", file=sys.stderr)
            sys.exit(1)
        except Exception as e:
            print(f"Error loading portfolio: {e}", file=sys.stderr)
            sys.exit(1)

    if not args.tickers:
        parser.print_help()
        sys.exit(1)

    # NEW v4.0.0: Check for breaking news (market-wide, check once before analyzing tickers)
    # Check breaking news (skip in fast mode)
    breaking_news = None
    if not args.fast:
        if args.verbose:
            print(f"Checking breaking news (last 24h)...", file=sys.stderr)
        breaking_news = check_breaking_news(verbose=args.verbose)
    elif args.verbose:
        print(f"Skipping breaking news check (--fast mode)", file=sys.stderr)
    if breaking_news and args.verbose:
        print(f"  Found {len(breaking_news)} breaking news alert(s)\n", file=sys.stderr)

    results = []

    for ticker in args.tickers:
        ticker = ticker.upper()

        if args.verbose:
            print(f"\n=== Analyzing {ticker} ===\n", file=sys.stderr)

        # Fetch data
        data = fetch_stock_data(ticker, verbose=args.verbose)

        if data is None:
            print(f"Error: Invalid ticker '{ticker}' or data unavailable", file=sys.stderr)
            sys.exit(2)

        # Get company name
        company_name = data.info.get("longName") or data.info.get("shortName") or ticker

        # Detect asset type (crypto vs stock)
        is_crypto = data.asset_type == "crypto"

        if args.verbose and is_crypto:
            print(f"  Asset type: CRYPTO (using crypto-specific analysis)", file=sys.stderr)

        # Analyze components (different for crypto vs stock)
        if is_crypto:
            # Crypto: Skip stock-specific analyses
            earnings = None
            fundamentals = None
            analysts = None
            historical = None
            earnings_timing = None
            sector = None

            # Crypto fundamentals (market cap, category, BTC correlation)
            if args.verbose:
                print(f"Analyzing crypto fundamentals...", file=sys.stderr)
            crypto_fundamentals = analyze_crypto_fundamentals(data, verbose=args.verbose)

            # Convert crypto fundamentals to regular Fundamentals for synthesize_signal
            if crypto_fundamentals:
                fundamentals = Fundamentals(
                    score=crypto_fundamentals.score,
                    key_metrics={
                        "market_cap": crypto_fundamentals.market_cap,
                        "market_cap_rank": crypto_fundamentals.market_cap_rank,
                        "category": crypto_fundamentals.category,
                        "btc_correlation": crypto_fundamentals.btc_correlation,
                    },
                    explanation=crypto_fundamentals.explanation,
                )
        else:
            # Stock: Full analysis
            earnings = analyze_earnings_surprise(data)
            fundamentals = analyze_fundamentals(data)
            analysts = analyze_analyst_sentiment(data)
            historical = analyze_historical_patterns(data)

            # Analyze earnings timing (stocks only)
            if args.verbose:
                print(f"Checking earnings timing...", file=sys.stderr)
            earnings_timing = analyze_earnings_timing(data)

            # Analyze sector performance (stocks only)
            if args.verbose:
                print(f"Analyzing sector performance...", file=sys.stderr)
            sector = analyze_sector_performance(data, verbose=args.verbose)

        # Market context (both crypto and stock)
        if args.verbose:
            print(f"Analyzing market context...", file=sys.stderr)
        market_context = analyze_market_context(verbose=args.verbose)

        # Momentum (both crypto and stock)
        if args.verbose:
            print(f"Analyzing momentum...", file=sys.stderr)
        momentum = analyze_momentum(data)

        # Sentiment (stocks get full sentiment, crypto gets limited)
        if args.verbose:
            print(f"Analyzing market sentiment...", file=sys.stderr)
        if is_crypto:
            # Skip insider trading and put/call for crypto
            sentiment = None
        else:
            sentiment = asyncio.run(analyze_sentiment(data, verbose=args.verbose, skip_insider=args.no_insider))

        # Geopolitical risks (stocks only)
        if is_crypto:
            geopolitical_risk_warning = None
            geopolitical_risk_penalty = 0.0
        else:
            sector_name = data.info.get("sector")
            geopolitical_risk_warning, geopolitical_risk_penalty = check_sector_geopolitical_risk(
                ticker=ticker,
                sector=sector_name,
                breaking_news=breaking_news,
                verbose=args.verbose
            )

        if args.verbose:
            print(f"Components analyzed:", file=sys.stderr)
            if is_crypto:
                print(f"  Crypto Fundamentals: {'✓' if fundamentals else '✗'}", file=sys.stderr)
                print(f"  Market Context: {'✓' if market_context else '✗'}", file=sys.stderr)
                print(f"  Momentum: {'✓' if momentum else '✗'}", file=sys.stderr)
                print(f"  (Earnings, Sector, Sentiment: N/A for crypto)\n", file=sys.stderr)
            else:
                print(f"  Earnings: {'✓' if earnings else '✗'}", file=sys.stderr)
                print(f"  Fundamentals: {'✓' if fundamentals else '✗'}", file=sys.stderr)
                print(f"  Analysts: {'✓' if analysts and analysts.score else '✗'}", file=sys.stderr)
                print(f"  Historical: {'✓' if historical else '✗'}", file=sys.stderr)
                print(f"  Market Context: {'✓' if market_context else '✗'}", file=sys.stderr)
                print(f"  Sector: {'✓' if sector else '✗'}", file=sys.stderr)
                print(f"  Earnings Timing: {'✓' if earnings_timing else '✗'}", file=sys.stderr)
                print(f"  Momentum: {'✓' if momentum else '✗'}", file=sys.stderr)
                print(f"  Sentiment: {'✓' if sentiment else '✗'}\n", file=sys.stderr)

        # Synthesize signal
        signal = synthesize_signal(
            ticker=ticker,
            company_name=company_name,
            earnings=earnings,
            fundamentals=fundamentals,
            analysts=analysts,
            historical=historical,
            market_context=market_context,  # NEW
            sector=sector,  # NEW
            earnings_timing=earnings_timing,  # NEW
            momentum=momentum,  # NEW
            sentiment=sentiment,  # NEW
            breaking_news=breaking_news,  # NEW v4.0.0
            geopolitical_risk_warning=geopolitical_risk_warning,  # NEW v4.0.0
            geopolitical_risk_penalty=geopolitical_risk_penalty,  # NEW v4.0.0
        )

        results.append(signal)

    # Output results
    if args.output == "json":
        if len(results) == 1:
            print(format_output_json(results[0]))
        else:
            output_data = [asdict(r) for r in results]
            # Add portfolio summary if in portfolio mode
            if portfolio_assets:
                portfolio_summary = generate_portfolio_summary(
                    results, portfolio_assets, portfolio_name, args.period
                )
                output_data = {
                    "portfolio": portfolio_name,
                    "assets": output_data,
                    "summary": portfolio_summary,
                }
            print(json.dumps(output_data, indent=2))
    else:
        for i, signal in enumerate(results):
            if i > 0:
                print("\n")
            print(format_output_text(signal))

        # Print portfolio summary if in portfolio mode
        if portfolio_assets:
            print_portfolio_summary(results, portfolio_assets, portfolio_name, args.period)


def generate_portfolio_summary(
    results: list,
    portfolio_assets: list[tuple[str, float, float, str]],
    portfolio_name: str,
    period: str | None = None,
) -> dict:
    """Generate portfolio summary data."""
    # Map results by ticker
    result_map = {r.ticker: r for r in results}

    # Calculate portfolio metrics
    total_cost = 0.0
    total_value = 0.0
    asset_values = []

    for ticker, quantity, cost_basis, asset_type in portfolio_assets:
        cost_total = quantity * cost_basis
        total_cost += cost_total

        # Get current price from yfinance
        try:
            stock = yf.Ticker(ticker)
            current_price = stock.info.get("regularMarketPrice", 0) or 0
            current_value = quantity * current_price
            total_value += current_value
            asset_values.append((ticker, current_value, cost_total, asset_type))
        except Exception:
            asset_values.append((ticker, 0, cost_total, asset_type))

    # Calculate period returns if requested
    period_return = None
    if period and total_value > 0:
        period_days = {
            "daily": 1,
            "weekly": 7,
            "monthly": 30,
            "quarterly": 90,
            "yearly": 365,
        }.get(period, 30)

        period_return = calculate_portfolio_period_return(portfolio_assets, period_days)

    # Concentration analysis
    concentrations = []
    if total_value > 0:
        for ticker, value, _, asset_type in asset_values:
            if value > 0:
                pct = value / total_value * 100
                if pct > 30:
                    concentrations.append(f"{ticker}: {pct:.1f}%")

    # Build summary
    total_pnl = total_value - total_cost
    total_pnl_pct = (total_pnl / total_cost * 100) if total_cost > 0 else 0

    summary = {
        "portfolio_name": portfolio_name,
        "total_cost": total_cost,
        "total_value": total_value,
        "total_pnl": total_pnl,
        "total_pnl_pct": total_pnl_pct,
        "asset_count": len(portfolio_assets),
        "concentration_warnings": concentrations if concentrations else None,
    }

    if period_return is not None:
        summary["period"] = period
        summary["period_return_pct"] = period_return

    return summary


def calculate_portfolio_period_return(
    portfolio_assets: list[tuple[str, float, float, str]],
    period_days: int,
) -> float | None:
    """Calculate portfolio return over a period using historical prices."""
    try:
        total_start_value = 0.0
        total_current_value = 0.0

        for ticker, quantity, _, _ in portfolio_assets:
            stock = yf.Ticker(ticker)
            hist = stock.history(period=f"{period_days + 5}d")

            if hist.empty or len(hist) < 2:
                continue

            # Get price at period start and now
            current_price = hist["Close"].iloc[-1]
            start_price = hist["Close"].iloc[0]

            total_current_value += quantity * current_price
            total_start_value += quantity * start_price

        if total_start_value > 0:
            return (total_current_value - total_start_value) / total_start_value * 100

    except Exception:
        pass

    return None


def print_portfolio_summary(
    results: list,
    portfolio_assets: list[tuple[str, float, float, str]],
    portfolio_name: str,
    period: str | None = None,
) -> None:
    """Print portfolio summary in text format."""
    summary = generate_portfolio_summary(results, portfolio_assets, portfolio_name, period)

    print("\n" + "=" * 77)
    print(f"PORTFOLIO SUMMARY: {portfolio_name}")
    print("=" * 77)

    # Value overview
    total_cost = summary["total_cost"]
    total_value = summary["total_value"]
    total_pnl = summary["total_pnl"]
    total_pnl_pct = summary["total_pnl_pct"]

    print(f"\nTotal Cost:    ${total_cost:,.2f}")
    print(f"Current Value: ${total_value:,.2f}")
    pnl_sign = "+" if total_pnl >= 0 else ""
    print(f"Total P&L:     {pnl_sign}${total_pnl:,.2f} ({pnl_sign}{total_pnl_pct:.1f}%)")

    # Period return
    if "period_return_pct" in summary:
        period_return = summary["period_return_pct"]
        period_sign = "+" if period_return >= 0 else ""
        print(f"{summary['period'].capitalize()} Return: {period_sign}{period_return:.1f}%")

    # Concentration warnings
    if summary.get("concentration_warnings"):
        print("\n⚠️ CONCENTRATION WARNINGS:")
        for warning in summary["concentration_warnings"]:
            print(f"   • {warning} (>30% of portfolio)")

    # Recommendation summary
    recommendations = {"BUY": 0, "HOLD": 0, "SELL": 0}
    for r in results:
        recommendations[r.recommendation] = recommendations.get(r.recommendation, 0) + 1

    print(f"\nRECOMMENDATIONS: {recommendations['BUY']} BUY | {recommendations['HOLD']} HOLD | {recommendations['SELL']} SELL")
    print("=" * 77)


if __name__ == "__main__":
    main()
