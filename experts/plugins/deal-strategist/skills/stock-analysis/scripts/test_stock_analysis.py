#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "pytest>=8.0.0",
#     "yfinance>=0.2.40",
#     "pandas>=2.0.0",
# ]
# ///
"""
Tests for Stock Analysis Skill v6.0

Run with: uv run pytest test_stock_analysis.py -v
"""

import json
import pytest
from unittest.mock import Mock, patch, MagicMock
from datetime import datetime, timezone
import pandas as pd

# Import modules to test
from analyze_stock import (
    detect_asset_type,
    calculate_rsi,
    fetch_stock_data,
    analyze_earnings_surprise,
    analyze_fundamentals,
    analyze_momentum,
    synthesize_signal,
    EarningsSurprise,
    Fundamentals,
    MomentumAnalysis,
    MarketContext,
    StockData,
)
from dividends import analyze_dividends
from watchlist import (
    add_to_watchlist,
    remove_from_watchlist,
    list_watchlist,
    WatchlistItem,
)
from portfolio import PortfolioStore


class TestAssetTypeDetection:
    """Test asset type detection."""
    
    def test_stock_detection(self):
        assert detect_asset_type("AAPL") == "stock"
        assert detect_asset_type("MSFT") == "stock"
        assert detect_asset_type("googl") == "stock"
    
    def test_crypto_detection(self):
        assert detect_asset_type("BTC-USD") == "crypto"
        assert detect_asset_type("ETH-USD") == "crypto"
        assert detect_asset_type("sol-usd") == "crypto"
    
    def test_edge_cases(self):
        # Ticker ending in USD but not crypto format
        assert detect_asset_type("MUSD") == "stock"
        # Numbers in ticker
        assert detect_asset_type("BRK.B") == "stock"


class TestRSICalculation:
    """Test RSI calculation."""
    
    def test_rsi_overbought(self):
        """Test RSI > 70 (overbought)."""
        # Create rising prices
        prices = pd.Series([100 + i * 2 for i in range(20)])
        rsi = calculate_rsi(prices, period=14)
        assert rsi is not None
        assert rsi > 70
    
    def test_rsi_oversold(self):
        """Test RSI < 30 (oversold)."""
        # Create falling prices
        prices = pd.Series([100 - i * 2 for i in range(20)])
        rsi = calculate_rsi(prices, period=14)
        assert rsi is not None
        assert rsi < 30
    
    def test_rsi_insufficient_data(self):
        """Test RSI with insufficient data."""
        prices = pd.Series([100, 101, 102])  # Too few points
        rsi = calculate_rsi(prices, period=14)
        assert rsi is None


class TestEarningsSurprise:
    """Test earnings surprise analysis."""
    
    def test_earnings_beat(self):
        """Test positive earnings surprise."""
        # Mock StockData with earnings beat
        mock_earnings = pd.DataFrame({
            "Reported EPS": [1.50],
            "EPS Estimate": [1.20],
        }, index=[pd.Timestamp("2024-01-15")])
        
        mock_data = Mock(spec=StockData)
        mock_data.earnings_history = mock_earnings
        
        result = analyze_earnings_surprise(mock_data)
        
        assert result is not None
        assert result.score > 0
        assert result.surprise_pct > 0
        assert "Beat" in result.explanation
    
    def test_earnings_miss(self):
        """Test negative earnings surprise."""
        mock_earnings = pd.DataFrame({
            "Reported EPS": [0.80],
            "EPS Estimate": [1.00],
        }, index=[pd.Timestamp("2024-01-15")])
        
        mock_data = Mock(spec=StockData)
        mock_data.earnings_history = mock_earnings
        
        result = analyze_earnings_surprise(mock_data)
        
        assert result is not None
        assert result.score < 0
        assert result.surprise_pct < 0
        assert "Missed" in result.explanation


class TestFundamentals:
    """Test fundamentals analysis."""
    
    def test_strong_fundamentals(self):
        """Test stock with strong fundamentals."""
        mock_data = Mock(spec=StockData)
        mock_data.info = {
            "trailingPE": 15,
            "operatingMargins": 0.25,
            "revenueGrowth": 0.30,
            "debtToEquity": 30,
        }
        
        result = analyze_fundamentals(mock_data)
        
        assert result is not None
        assert result.score > 0
        assert "pe_ratio" in result.key_metrics
    
    def test_weak_fundamentals(self):
        """Test stock with weak fundamentals."""
        mock_data = Mock(spec=StockData)
        mock_data.info = {
            "trailingPE": 50,
            "operatingMargins": 0.02,
            "revenueGrowth": -0.10,
            "debtToEquity": 300,
        }
        
        result = analyze_fundamentals(mock_data)
        
        assert result is not None
        assert result.score < 0


class TestMomentum:
    """Test momentum analysis."""
    
    def test_overbought_momentum(self):
        """Test overbought conditions."""
        # Create mock price history with rising prices near 52w high
        dates = pd.date_range(end=datetime.now(), periods=100)
        prices = pd.DataFrame({
            "Close": [100 + i * 0.5 for i in range(100)],
            "Volume": [1000000] * 100,
        }, index=dates)
        
        mock_data = Mock(spec=StockData)
        mock_data.price_history = prices
        mock_data.info = {
            "fiftyTwoWeekHigh": 150,
            "fiftyTwoWeekLow": 80,
            "regularMarketPrice": 148,
        }
        
        result = analyze_momentum(mock_data)
        
        assert result is not None
        assert result.rsi_status == "overbought"
        assert result.near_52w_high == True
        assert result.score < 0  # Overbought = negative score


class TestSignalSynthesis:
    """Test signal synthesis."""
    
    def test_buy_signal(self):
        """Test BUY recommendation synthesis."""
        earnings = EarningsSurprise(score=0.8, explanation="Beat by 20%", actual_eps=1.2, expected_eps=1.0, surprise_pct=20)
        fundamentals = Fundamentals(score=0.6, key_metrics={"pe_ratio": 15}, explanation="Strong margins")
        
        signal = synthesize_signal(
            ticker="TEST",
            company_name="Test Corp",
            earnings=earnings,
            fundamentals=fundamentals,
            analysts=None,
            historical=None,
            market_context=None,
            sector=None,
            earnings_timing=None,
            momentum=None,
            sentiment=None,
        )
        
        assert signal.recommendation == "BUY"
        assert signal.confidence > 0.5
    
    def test_sell_signal(self):
        """Test SELL recommendation synthesis."""
        earnings = EarningsSurprise(score=-0.8, explanation="Missed by 20%", actual_eps=0.8, expected_eps=1.0, surprise_pct=-20)
        fundamentals = Fundamentals(score=-0.6, key_metrics={"pe_ratio": 50}, explanation="Weak margins")
        
        signal = synthesize_signal(
            ticker="TEST",
            company_name="Test Corp",
            earnings=earnings,
            fundamentals=fundamentals,
            analysts=None,
            historical=None,
            market_context=None,
            sector=None,
            earnings_timing=None,
            momentum=None,
            sentiment=None,
        )
        
        assert signal.recommendation == "SELL"
    
    def test_risk_off_penalty(self):
        """Test risk-off mode reduces BUY confidence."""
        earnings = EarningsSurprise(score=0.8, explanation="Beat", actual_eps=1.2, expected_eps=1.0, surprise_pct=20)
        fundamentals = Fundamentals(score=0.6, key_metrics={}, explanation="Strong")
        market = MarketContext(
            vix_level=25,
            vix_status="elevated",
            spy_trend_10d=2.0,
            qqq_trend_10d=1.5,
            market_regime="choppy",
            score=-0.2,
            explanation="Risk-off",
            gld_change_5d=3.0,
            tlt_change_5d=2.0,
            uup_change_5d=1.5,
            risk_off_detected=True,
        )
        
        signal = synthesize_signal(
            ticker="TEST",
            company_name="Test Corp",
            earnings=earnings,
            fundamentals=fundamentals,
            analysts=None,
            historical=None,
            market_context=market,
            sector=None,
            earnings_timing=None,
            momentum=None,
            sentiment=None,
        )
        
        # Should still be BUY but with reduced confidence
        assert signal.recommendation in ["BUY", "HOLD"]
        assert any("RISK-OFF" in c for c in signal.caveats)


class TestWatchlist:
    """Test watchlist functionality."""
    
    @patch('watchlist.get_current_price')
    @patch('watchlist.save_watchlist')
    @patch('watchlist.load_watchlist')
    def test_add_to_watchlist(self, mock_load, mock_save, mock_price):
        """Test adding ticker to watchlist."""
        mock_load.return_value = []
        mock_price.return_value = 150.0
        mock_save.return_value = None
        
        result = add_to_watchlist("AAPL", target_price=200.0)
        
        assert result["success"] == True
        assert result["action"] == "added"
        assert result["ticker"] == "AAPL"
        assert result["target_price"] == 200.0
    
    @patch('watchlist.save_watchlist')
    @patch('watchlist.load_watchlist')
    def test_remove_from_watchlist(self, mock_load, mock_save):
        """Test removing ticker from watchlist."""
        mock_load.return_value = [
            WatchlistItem(ticker="AAPL", added_at="2024-01-01T00:00:00+00:00")
        ]
        mock_save.return_value = None
        
        result = remove_from_watchlist("AAPL")
        
        assert result["success"] == True
        assert result["removed"] == "AAPL"


class TestDividendAnalysis:
    """Test dividend analysis."""
    
    @patch('yfinance.Ticker')
    def test_dividend_stock(self, mock_ticker):
        """Test analysis of dividend-paying stock."""
        mock_stock = Mock()
        mock_stock.info = {
            "longName": "Johnson & Johnson",
            "regularMarketPrice": 160.0,
            "dividendYield": 0.03,
            "dividendRate": 4.80,
            "trailingEps": 6.00,
        }
        mock_stock.dividends = pd.Series(
            [1.2, 1.2, 1.2, 1.2] * 5,  # 5 years of quarterly dividends
            index=pd.date_range(start="2019-01-01", periods=20, freq="Q")
        )
        mock_ticker.return_value = mock_stock
        
        result = analyze_dividends("JNJ")
        
        assert result is not None
        assert result.dividend_yield == 3.0
        assert result.payout_ratio == 80.0
        assert result.income_rating != "no_dividend"
    
    @patch('yfinance.Ticker')
    def test_no_dividend_stock(self, mock_ticker):
        """Test analysis of non-dividend stock."""
        mock_stock = Mock()
        mock_stock.info = {
            "longName": "Amazon",
            "regularMarketPrice": 180.0,
            "dividendYield": None,
            "dividendRate": None,
        }
        mock_ticker.return_value = mock_stock
        
        result = analyze_dividends("AMZN")
        
        assert result is not None
        assert result.income_rating == "no_dividend"


class TestIntegration:
    """Integration tests (require network)."""
    
    @pytest.mark.integration
    def test_real_stock_analysis(self):
        """Test real stock analysis (AAPL)."""
        data = fetch_stock_data("AAPL", verbose=False)
        
        assert data is not None
        assert data.ticker == "AAPL"
        assert data.info is not None
        assert "regularMarketPrice" in data.info
    
    @pytest.mark.integration
    def test_real_crypto_analysis(self):
        """Test real crypto analysis (BTC-USD)."""
        data = fetch_stock_data("BTC-USD", verbose=False)
        
        assert data is not None
        assert data.asset_type == "crypto"


# Run tests
if __name__ == "__main__":
    pytest.main([__file__, "-v", "--ignore-glob=*integration*"])
