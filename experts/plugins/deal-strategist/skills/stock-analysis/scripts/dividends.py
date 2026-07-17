#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "yfinance>=0.2.40",
#     "pandas>=2.0.0",
# ]
# ///
"""
Dividend Analysis Module.

Analyzes dividend metrics for income investors:
- Dividend Yield
- Payout Ratio
- Dividend Growth Rate (5Y CAGR)
- Dividend Safety Score
- Ex-Dividend Date

Usage:
    uv run dividends.py AAPL
    uv run dividends.py JNJ PG KO --output json
"""

import argparse
import json
import sys
from dataclasses import dataclass, asdict
from datetime import datetime

import pandas as pd
import yfinance as yf


@dataclass
class DividendAnalysis:
    ticker: str
    company_name: str
    
    # Basic metrics
    dividend_yield: float | None  # Annual yield %
    annual_dividend: float | None  # Annual dividend per share
    current_price: float | None
    
    # Payout analysis
    payout_ratio: float | None  # Dividend / EPS
    payout_status: str  # "safe", "moderate", "high", "unsustainable"
    
    # Growth
    dividend_growth_5y: float | None  # 5-year CAGR %
    consecutive_years: int | None  # Years of consecutive increases
    dividend_history: list[dict] | None  # Last 5 years
    
    # Timing
    ex_dividend_date: str | None
    payment_frequency: str | None  # "quarterly", "monthly", "annual"
    
    # Safety score (0-100)
    safety_score: int
    safety_factors: list[str]
    
    # Verdict
    income_rating: str  # "excellent", "good", "moderate", "poor", "no_dividend"
    summary: str


def analyze_dividends(ticker: str, verbose: bool = False) -> DividendAnalysis | None:
    """Analyze dividend metrics for a stock."""
    try:
        stock = yf.Ticker(ticker)
        info = stock.info
        
        company_name = info.get("longName") or info.get("shortName") or ticker
        current_price = info.get("regularMarketPrice") or info.get("currentPrice")
        
        # Basic dividend info
        dividend_yield = info.get("dividendYield")
        if dividend_yield:
            dividend_yield = dividend_yield * 100  # Convert to percentage
        
        annual_dividend = info.get("dividendRate")
        
        # No dividend
        if not annual_dividend or annual_dividend == 0:
            return DividendAnalysis(
                ticker=ticker,
                company_name=company_name,
                dividend_yield=None,
                annual_dividend=None,
                current_price=current_price,
                payout_ratio=None,
                payout_status="no_dividend",
                dividend_growth_5y=None,
                consecutive_years=None,
                dividend_history=None,
                ex_dividend_date=None,
                payment_frequency=None,
                safety_score=0,
                safety_factors=["No dividend paid"],
                income_rating="no_dividend",
                summary=f"{ticker} does not pay a dividend.",
            )
        
        # Payout ratio
        trailing_eps = info.get("trailingEps")
        payout_ratio = None
        payout_status = "unknown"
        
        if trailing_eps and trailing_eps > 0 and annual_dividend:
            payout_ratio = (annual_dividend / trailing_eps) * 100
            
            if payout_ratio < 40:
                payout_status = "safe"
            elif payout_ratio < 60:
                payout_status = "moderate"
            elif payout_ratio < 80:
                payout_status = "high"
            else:
                payout_status = "unsustainable"
        
        # Dividend history (for growth calculation)
        dividends = stock.dividends
        dividend_history = None
        dividend_growth_5y = None
        consecutive_years = None
        
        if dividends is not None and len(dividends) > 0:
            # Group by year
            dividends_df = dividends.reset_index()
            dividends_df["Year"] = pd.to_datetime(dividends_df["Date"]).dt.year
            yearly = dividends_df.groupby("Year")["Dividends"].sum().sort_index(ascending=False)
            
            # Last 5 years history
            dividend_history = []
            for year in yearly.head(5).index:
                dividend_history.append({
                    "year": int(year),
                    "total": round(float(yearly[year]), 4),
                })
            
            # Calculate 5-year CAGR
            if len(yearly) >= 5:
                current_div = yearly.iloc[0]
                div_5y_ago = yearly.iloc[4]
                
                if div_5y_ago > 0 and current_div > 0:
                    dividend_growth_5y = ((current_div / div_5y_ago) ** (1/5) - 1) * 100
            
            # Count consecutive years of increases
            consecutive_years = 0
            prev_div = None
            for div in yearly.values:
                if prev_div is not None:
                    if div >= prev_div:
                        consecutive_years += 1
                    else:
                        break
                prev_div = div
        
        # Ex-dividend date
        ex_dividend_date = info.get("exDividendDate")
        if ex_dividend_date:
            ex_dividend_date = datetime.fromtimestamp(ex_dividend_date).strftime("%Y-%m-%d")
        
        # Payment frequency
        payment_frequency = None
        if dividends is not None and len(dividends) >= 4:
            # Count dividends in last year
            one_year_ago = pd.Timestamp.now() - pd.DateOffset(years=1)
            recent_divs = dividends[dividends.index > one_year_ago]
            count = len(recent_divs)
            
            if count >= 10:
                payment_frequency = "monthly"
            elif count >= 3:
                payment_frequency = "quarterly"
            elif count >= 1:
                payment_frequency = "annual"
        
        # Safety score calculation (0-100)
        safety_score = 50  # Base score
        safety_factors = []
        
        # Payout ratio factor (+/- 20)
        if payout_ratio:
            if payout_ratio < 40:
                safety_score += 20
                safety_factors.append(f"Low payout ratio ({payout_ratio:.0f}%)")
            elif payout_ratio < 60:
                safety_score += 10
                safety_factors.append(f"Moderate payout ratio ({payout_ratio:.0f}%)")
            elif payout_ratio < 80:
                safety_score -= 10
                safety_factors.append(f"High payout ratio ({payout_ratio:.0f}%)")
            else:
                safety_score -= 20
                safety_factors.append(f"Unsustainable payout ratio ({payout_ratio:.0f}%)")
        
        # Growth factor (+/- 15)
        if dividend_growth_5y:
            if dividend_growth_5y > 10:
                safety_score += 15
                safety_factors.append(f"Strong dividend growth ({dividend_growth_5y:.1f}% CAGR)")
            elif dividend_growth_5y > 5:
                safety_score += 10
                safety_factors.append(f"Good dividend growth ({dividend_growth_5y:.1f}% CAGR)")
            elif dividend_growth_5y > 0:
                safety_score += 5
                safety_factors.append(f"Positive dividend growth ({dividend_growth_5y:.1f}% CAGR)")
            else:
                safety_score -= 15
                safety_factors.append(f"Dividend declining ({dividend_growth_5y:.1f}% CAGR)")
        
        # Consecutive years factor (+/- 15)
        if consecutive_years:
            if consecutive_years >= 25:
                safety_score += 15
                safety_factors.append(f"Dividend Aristocrat ({consecutive_years}+ years)")
            elif consecutive_years >= 10:
                safety_score += 10
                safety_factors.append(f"Long dividend history ({consecutive_years} years)")
            elif consecutive_years >= 5:
                safety_score += 5
                safety_factors.append(f"Consistent dividend ({consecutive_years} years)")
        
        # Yield factor (high yield can be risky)
        if dividend_yield:
            if dividend_yield > 8:
                safety_score -= 10
                safety_factors.append(f"Very high yield ({dividend_yield:.1f}%) - verify sustainability")
            elif dividend_yield < 1:
                safety_factors.append(f"Low yield ({dividend_yield:.2f}%)")
        
        # Clamp score
        safety_score = max(0, min(100, safety_score))
        
        # Income rating
        if safety_score >= 80:
            income_rating = "excellent"
        elif safety_score >= 60:
            income_rating = "good"
        elif safety_score >= 40:
            income_rating = "moderate"
        else:
            income_rating = "poor"
        
        # Summary
        summary_parts = []
        if dividend_yield:
            summary_parts.append(f"{dividend_yield:.2f}% yield")
        if payout_ratio:
            summary_parts.append(f"{payout_ratio:.0f}% payout")
        if dividend_growth_5y:
            summary_parts.append(f"{dividend_growth_5y:+.1f}% 5Y growth")
        if consecutive_years and consecutive_years >= 5:
            summary_parts.append(f"{consecutive_years}Y streak")
        
        summary = f"{ticker}: {', '.join(summary_parts)}. Rating: {income_rating.upper()}"
        
        return DividendAnalysis(
            ticker=ticker,
            company_name=company_name,
            dividend_yield=round(dividend_yield, 2) if dividend_yield else None,
            annual_dividend=round(annual_dividend, 4) if annual_dividend else None,
            current_price=current_price,
            payout_ratio=round(payout_ratio, 1) if payout_ratio else None,
            payout_status=payout_status,
            dividend_growth_5y=round(dividend_growth_5y, 2) if dividend_growth_5y else None,
            consecutive_years=consecutive_years,
            dividend_history=dividend_history,
            ex_dividend_date=ex_dividend_date,
            payment_frequency=payment_frequency,
            safety_score=safety_score,
            safety_factors=safety_factors,
            income_rating=income_rating,
            summary=summary,
        )
        
    except Exception as e:
        if verbose:
            print(f"Error analyzing {ticker}: {e}", file=sys.stderr)
        return None


def format_text(analysis: DividendAnalysis) -> str:
    """Format dividend analysis as text."""
    lines = [
        "=" * 60,
        f"DIVIDEND ANALYSIS: {analysis.ticker} ({analysis.company_name})",
        "=" * 60,
        "",
    ]
    
    if analysis.income_rating == "no_dividend":
        lines.append("This stock does not pay a dividend.")
        lines.append("=" * 60)
        return "\n".join(lines)
    
    # Yield & Price
    lines.append(f"Current Price:    ${analysis.current_price:.2f}")
    lines.append(f"Annual Dividend:  ${analysis.annual_dividend:.2f}")
    lines.append(f"Dividend Yield:   {analysis.dividend_yield:.2f}%")
    lines.append(f"Payment Freq:     {analysis.payment_frequency or 'Unknown'}")
    if analysis.ex_dividend_date:
        lines.append(f"Ex-Dividend:      {analysis.ex_dividend_date}")
    
    lines.append("")
    
    # Payout & Safety
    lines.append(f"Payout Ratio:     {analysis.payout_ratio:.1f}% ({analysis.payout_status})")
    lines.append(f"5Y Div Growth:    {analysis.dividend_growth_5y:+.1f}%" if analysis.dividend_growth_5y else "5Y Div Growth:    N/A")
    if analysis.consecutive_years:
        lines.append(f"Consecutive Yrs:  {analysis.consecutive_years}")
    
    lines.append("")
    lines.append(f"SAFETY SCORE:     {analysis.safety_score}/100")
    lines.append(f"INCOME RATING:    {analysis.income_rating.upper()}")
    
    lines.append("")
    lines.append("Safety Factors:")
    for factor in analysis.safety_factors:
        lines.append(f"  • {factor}")
    
    # History
    if analysis.dividend_history:
        lines.append("")
        lines.append("Dividend History:")
        for h in analysis.dividend_history[:5]:
            lines.append(f"  {h['year']}: ${h['total']:.2f}")
    
    lines.append("")
    lines.append("=" * 60)
    
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Dividend Analysis")
    parser.add_argument("tickers", nargs="+", help="Stock ticker(s)")
    parser.add_argument("--output", choices=["text", "json"], default="text")
    parser.add_argument("--verbose", "-v", action="store_true")
    
    args = parser.parse_args()
    
    results = []
    for ticker in args.tickers:
        analysis = analyze_dividends(ticker.upper(), verbose=args.verbose)
        if analysis:
            results.append(analysis)
        else:
            print(f"Error: Could not analyze {ticker}", file=sys.stderr)
    
    if args.output == "json":
        if len(results) == 1:
            print(json.dumps(asdict(results[0]), indent=2))
        else:
            print(json.dumps([asdict(r) for r in results], indent=2))
    else:
        for i, analysis in enumerate(results):
            if i > 0:
                print("\n")
            print(format_text(analysis))


if __name__ == "__main__":
    main()
