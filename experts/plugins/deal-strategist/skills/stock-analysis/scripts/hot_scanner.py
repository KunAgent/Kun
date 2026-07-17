#!/usr/bin/env python3
"""
🔥 HOT SCANNER v2 - Find viral stocks & crypto trends
Now with Twitter/X, Reddit, and improved Yahoo Finance
"""

import json
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET
import gzip
import io
import subprocess
import os
from datetime import datetime, timezone
from pathlib import Path
import re
import ssl
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

# Load .env file if exists
ENV_FILE = Path(__file__).parent.parent / ".env"
if ENV_FILE.exists():
    with open(ENV_FILE) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                os.environ[key] = value

# Cache directory
CACHE_DIR = Path(__file__).parent.parent / "cache"
CACHE_DIR.mkdir(exist_ok=True)

# SSL context
SSL_CONTEXT = ssl.create_default_context()

class HotScanner:
    def __init__(self, include_social=True):
        self.include_social = include_social
        self.results = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "crypto": [],
            "stocks": [],
            "news": [],
            "movers": [],
            "social": []
        }
        self.mentions = defaultdict(lambda: {"count": 0, "sources": [], "sentiment_hints": []})
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
            "Accept-Encoding": "gzip, deflate",
        }
    
    def _fetch(self, url, timeout=15):
        """Fetch URL with gzip support."""
        req = urllib.request.Request(url, headers=self.headers)
        with urllib.request.urlopen(req, timeout=timeout, context=SSL_CONTEXT) as resp:
            data = resp.read()
            # Handle gzip
            if resp.info().get('Content-Encoding') == 'gzip' or data[:2] == b'\x1f\x8b':
                data = gzip.decompress(data)
            return data.decode('utf-8', errors='replace')
    
    def _fetch_json(self, url, timeout=15):
        """Fetch and parse JSON."""
        return json.loads(self._fetch(url, timeout))
    
    def scan_all(self):
        """Run all scans in parallel."""
        print("🔍 Scanning for hot trends...\n")
        
        tasks = [
            ("CoinGecko Trending", self.scan_coingecko_trending),
            ("CoinGecko Movers", self.scan_coingecko_gainers_losers),
            ("Google News Finance", self.scan_google_news_finance),
            ("Google News Crypto", self.scan_google_news_crypto),
            ("Yahoo Movers", self.scan_yahoo_movers),
        ]
        
        if self.include_social:
            tasks.extend([
                ("Reddit WSB", self.scan_reddit_wsb),
                ("Reddit Crypto", self.scan_reddit_crypto),
                ("Twitter/X", self.scan_twitter),
            ])
        
        with ThreadPoolExecutor(max_workers=8) as executor:
            futures = {executor.submit(task[1]): task[0] for task in tasks}
            for future in as_completed(futures):
                name = futures[future]
                try:
                    future.result()
                except Exception as e:
                    print(f"    ❌ {name}: {str(e)[:50]}")
        
        return self.results
    
    def scan_coingecko_trending(self):
        """Get trending crypto from CoinGecko."""
        print("  📊 CoinGecko Trending...")
        try:
            url = "https://api.coingecko.com/api/v3/search/trending"
            data = self._fetch_json(url)
            
            for item in data.get("coins", [])[:10]:
                coin = item.get("item", {})
                price_data = coin.get("data", {})
                price_change = price_data.get("price_change_percentage_24h", {}).get("usd", 0)
                
                entry = {
                    "symbol": coin.get("symbol", "").upper(),
                    "name": coin.get("name", ""),
                    "rank": coin.get("market_cap_rank"),
                    "price_change_24h": round(price_change, 2) if price_change else None,
                    "source": "coingecko_trending"
                }
                self.results["crypto"].append(entry)
                
                sym = entry["symbol"]
                self.mentions[sym]["count"] += 2  # Trending gets extra weight
                self.mentions[sym]["sources"].append("CoinGecko Trending")
                if price_change:
                    direction = "🚀 bullish" if price_change > 0 else "📉 bearish"
                    self.mentions[sym]["sentiment_hints"].append(f"{direction} ({price_change:+.1f}%)")
            
            print(f"    ✅ {len(data.get('coins', []))} trending coins")
        except Exception as e:
            print(f"    ❌ CoinGecko trending: {e}")
    
    def scan_coingecko_gainers_losers(self):
        """Get top gainers/losers."""
        print("  📈 CoinGecko Movers...")
        try:
            url = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&price_change_percentage=24h"
            data = self._fetch_json(url)
            
            sorted_data = sorted(data, key=lambda x: abs(x.get("price_change_percentage_24h") or 0), reverse=True)
            
            count = 0
            for coin in sorted_data[:20]:
                change = coin.get("price_change_percentage_24h", 0)
                if abs(change or 0) > 3:
                    entry = {
                        "symbol": coin.get("symbol", "").upper(),
                        "name": coin.get("name", ""),
                        "price": coin.get("current_price"),
                        "change_24h": round(change, 2) if change else None,
                        "volume": coin.get("total_volume"),
                        "source": "coingecko_movers"
                    }
                    self.results["movers"].append(entry)
                    count += 1
                    
                    sym = entry["symbol"]
                    self.mentions[sym]["count"] += 1
                    self.mentions[sym]["sources"].append("CoinGecko Movers")
                    direction = "🚀 pumping" if change > 0 else "📉 dumping"
                    self.mentions[sym]["sentiment_hints"].append(f"{direction} ({change:+.1f}%)")
            
            print(f"    ✅ {count} significant movers")
        except Exception as e:
            print(f"    ❌ CoinGecko movers: {e}")
    
    def scan_google_news_finance(self):
        """Get finance news from Google News RSS."""
        print("  📰 Google News Finance...")
        try:
            # Business news topic
            url = "https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx6TVdZU0FtVnVHZ0pWVXlnQVAB?hl=en-US&gl=US&ceid=US:en"
            text = self._fetch(url)
            root = ET.fromstring(text)
            items = root.findall(".//item")
            
            for item in items[:15]:
                title_elem = item.find("title")
                title = title_elem.text if title_elem is not None else ""
                tickers = self._extract_tickers(title)
                
                news_entry = {
                    "title": title,
                    "tickers_mentioned": tickers,
                    "source": "google_news_finance"
                }
                self.results["news"].append(news_entry)
                
                for ticker in tickers:
                    self.mentions[ticker]["count"] += 1
                    self.mentions[ticker]["sources"].append("Google News")
                    self.mentions[ticker]["sentiment_hints"].append(f"📰 {title[:40]}...")
            
            print(f"    ✅ {len(items)} news items")
        except Exception as e:
            print(f"    ❌ Google News Finance: {e}")
    
    def scan_google_news_crypto(self):
        """Search for crypto news."""
        print("  📰 Google News Crypto...")
        try:
            url = "https://news.google.com/rss/search?q=bitcoin+OR+ethereum+OR+crypto+crash+OR+crypto+pump&hl=en-US&gl=US&ceid=US:en"
            text = self._fetch(url)
            root = ET.fromstring(text)
            items = root.findall(".//item")
            
            crypto_keywords = {
                "bitcoin": "BTC", "btc": "BTC", "ethereum": "ETH", "eth": "ETH",
                "solana": "SOL", "xrp": "XRP", "ripple": "XRP", "dogecoin": "DOGE",
                "cardano": "ADA", "polkadot": "DOT", "avalanche": "AVAX",
            }
            
            for item in items[:12]:
                title_elem = item.find("title")
                title = title_elem.text if title_elem is not None else ""
                tickers = self._extract_tickers(title)
                
                for word, ticker in crypto_keywords.items():
                    if word in title.lower():
                        tickers.append(ticker)
                tickers = list(set(tickers))
                
                if tickers:
                    news_entry = {
                        "title": title,
                        "tickers_mentioned": tickers,
                        "source": "google_news_crypto"
                    }
                    self.results["news"].append(news_entry)
                    
                    for ticker in tickers:
                        self.mentions[ticker]["count"] += 1
                        self.mentions[ticker]["sources"].append("Google News Crypto")
            
            print(f"    ✅ Processed crypto news")
        except Exception as e:
            print(f"    ❌ Google News Crypto: {e}")
    
    def scan_yahoo_movers(self):
        """Scrape Yahoo Finance movers with gzip support."""
        print("  📈 Yahoo Finance Movers...")
        categories = [
            ("gainers", "https://finance.yahoo.com/gainers/"),
            ("losers", "https://finance.yahoo.com/losers/"),
            ("most_active", "https://finance.yahoo.com/most-active/")
        ]
        
        for category, url in categories:
            try:
                text = self._fetch(url, timeout=12)
                
                # Multiple patterns for ticker extraction
                tickers = []
                # Pattern 1: data-symbol attribute
                tickers.extend(re.findall(r'data-symbol="([A-Z]{1,5})"', text))
                # Pattern 2: ticker in URL
                tickers.extend(re.findall(r'/quote/([A-Z]{1,5})[/"\?]', text))
                # Pattern 3: fin-streamer
                tickers.extend(re.findall(r'fin-streamer[^>]*symbol="([A-Z]{1,5})"', text))
                
                unique_tickers = list(dict.fromkeys(tickers))[:15]
                
                for ticker in unique_tickers:
                    # Skip common false positives
                    if ticker in ['USA', 'CEO', 'IPO', 'ETF', 'SEC', 'FDA', 'NYSE', 'API']:
                        continue
                    self.results["stocks"].append({
                        "symbol": ticker,
                        "category": category,
                        "source": f"yahoo_{category}"
                    })
                    self.mentions[ticker]["count"] += 1
                    self.mentions[ticker]["sources"].append(f"Yahoo {category.replace('_', ' ').title()}")
                
                if unique_tickers:
                    print(f"    ✅ Yahoo {category}: {len(unique_tickers)} tickers")
            except Exception as e:
                print(f"    ⚠️ Yahoo {category}: {str(e)[:30]}")
    
    def scan_reddit_wsb(self):
        """Scrape r/wallstreetbets for hot stocks."""
        print("  🦍 Reddit r/wallstreetbets...")
        try:
            # Use old.reddit.com (more scrape-friendly)
            url = "https://old.reddit.com/r/wallstreetbets/hot/.json"
            headers = {**self.headers, "Accept": "application/json"}
            req = urllib.request.Request(url, headers=headers)
            
            with urllib.request.urlopen(req, timeout=15, context=SSL_CONTEXT) as resp:
                data = resp.read()
                if data[:2] == b'\x1f\x8b':
                    data = gzip.decompress(data)
                posts = json.loads(data.decode('utf-8'))
            
            tickers_found = []
            for post in posts.get("data", {}).get("children", [])[:25]:
                title = post.get("data", {}).get("title", "")
                score = post.get("data", {}).get("score", 0)
                
                # Extract tickers
                tickers = self._extract_tickers(title)
                for ticker in tickers:
                    if ticker not in ['USA', 'CEO', 'IPO', 'DD', 'WSB', 'YOLO', 'FD']:
                        weight = 2 if score > 1000 else 1
                        self.mentions[ticker]["count"] += weight
                        self.mentions[ticker]["sources"].append("Reddit WSB")
                        self.mentions[ticker]["sentiment_hints"].append(f"🦍 WSB: {title[:35]}...")
                        tickers_found.append(ticker)
                        
                        self.results["social"].append({
                            "platform": "reddit_wsb",
                            "title": title[:100],
                            "score": score,
                            "tickers": tickers
                        })
            
            print(f"    ✅ WSB: {len(set(tickers_found))} tickers mentioned")
        except Exception as e:
            print(f"    ❌ Reddit WSB: {str(e)[:40]}")
    
    def scan_reddit_crypto(self):
        """Scrape r/cryptocurrency for hot coins."""
        print("  💎 Reddit r/cryptocurrency...")
        try:
            url = "https://old.reddit.com/r/cryptocurrency/hot/.json"
            headers = {**self.headers, "Accept": "application/json"}
            req = urllib.request.Request(url, headers=headers)
            
            with urllib.request.urlopen(req, timeout=15, context=SSL_CONTEXT) as resp:
                data = resp.read()
                if data[:2] == b'\x1f\x8b':
                    data = gzip.decompress(data)
                posts = json.loads(data.decode('utf-8'))
            
            crypto_keywords = {
                "bitcoin": "BTC", "btc": "BTC", "ethereum": "ETH", "eth": "ETH",
                "solana": "SOL", "sol": "SOL", "xrp": "XRP", "cardano": "ADA",
                "dogecoin": "DOGE", "doge": "DOGE", "shiba": "SHIB", "pepe": "PEPE",
                "avalanche": "AVAX", "polkadot": "DOT", "chainlink": "LINK",
            }
            
            tickers_found = []
            for post in posts.get("data", {}).get("children", [])[:20]:
                title = post.get("data", {}).get("title", "").lower()
                score = post.get("data", {}).get("score", 0)
                
                for word, ticker in crypto_keywords.items():
                    if word in title:
                        weight = 2 if score > 500 else 1
                        self.mentions[ticker]["count"] += weight
                        self.mentions[ticker]["sources"].append("Reddit Crypto")
                        tickers_found.append(ticker)
            
            print(f"    ✅ r/crypto: {len(set(tickers_found))} coins mentioned")
        except Exception as e:
            print(f"    ❌ Reddit Crypto: {str(e)[:40]}")
    
    def scan_twitter(self):
        """Use bird CLI to get trending finance/crypto tweets."""
        print("  🐦 Twitter/X...")
        try:
            # Find bird binary
            bird_paths = [
                "/home/clawdbot/.nvm/versions/node/v24.12.0/bin/bird",
                "/usr/local/bin/bird",
                "bird"
            ]
            bird_bin = None
            for p in bird_paths:
                if Path(p).exists() or p == "bird":
                    bird_bin = p
                    break
            
            if not bird_bin:
                print("    ⚠️ Twitter: bird not found")
                return
            
            # Search for finance tweets
            searches = [
                ("stocks", "stock OR $SPY OR $QQQ OR earnings"),
                ("crypto", "bitcoin OR ethereum OR crypto OR $BTC"),
            ]
            
            for category, query in searches:
                try:
                    env = os.environ.copy()
                    result = subprocess.run(
                        [bird_bin, "search", query, "-n", "15", "--json"],
                        capture_output=True, text=True, timeout=30, env=env
                    )
                    
                    if result.returncode == 0 and result.stdout.strip():
                        tweets = json.loads(result.stdout)
                        for tweet in tweets[:10]:
                            text = tweet.get("text", "")
                            tickers = self._extract_tickers(text)
                            
                            # Add crypto keywords
                            crypto_map = {"bitcoin": "BTC", "ethereum": "ETH", "solana": "SOL"}
                            for word, ticker in crypto_map.items():
                                if word in text.lower():
                                    tickers.append(ticker)
                            
                            for ticker in set(tickers):
                                self.mentions[ticker]["count"] += 1
                                self.mentions[ticker]["sources"].append("Twitter/X")
                                self.mentions[ticker]["sentiment_hints"].append(f"🐦 {text[:35]}...")
                                
                                self.results["social"].append({
                                    "platform": "twitter",
                                    "text": text[:100],
                                    "tickers": list(set(tickers))
                                })
                        
                        print(f"    ✅ Twitter {category}: processed")
                except subprocess.TimeoutExpired:
                    print(f"    ⚠️ Twitter {category}: timeout")
                except json.JSONDecodeError:
                    print(f"    ⚠️ Twitter {category}: no auth?")
        except FileNotFoundError:
            print("    ⚠️ Twitter: bird CLI not found")
        except Exception as e:
            print(f"    ❌ Twitter: {str(e)[:40]}")
    
    def _extract_tickers(self, text):
        """Extract stock/crypto tickers from text."""
        patterns = [
            r'\$([A-Z]{1,5})\b',  # $AAPL
            r'\(([A-Z]{2,5})\)',   # (AAPL)
            r'(?:^|\s)([A-Z]{2,4})(?:\s|$|[,.])',  # Standalone caps
        ]
        
        tickers = []
        for pattern in patterns:
            matches = re.findall(pattern, text)
            tickers.extend(matches)
        
        # Company mappings
        companies = {
            "Apple": "AAPL", "Microsoft": "MSFT", "Google": "GOOGL", "Alphabet": "GOOGL",
            "Amazon": "AMZN", "Tesla": "TSLA", "Nvidia": "NVDA", "Meta": "META",
            "Netflix": "NFLX", "GameStop": "GME", "AMD": "AMD", "Intel": "INTC",
            "Palantir": "PLTR", "Coinbase": "COIN", "MicroStrategy": "MSTR",
        }
        
        for company, ticker in companies.items():
            if company.lower() in text.lower():
                tickers.append(ticker)
        
        # Filter out common words
        skip = {'USA', 'CEO', 'IPO', 'ETF', 'SEC', 'FDA', 'NYSE', 'API', 'USD', 'EU', 
                'UK', 'US', 'AI', 'IT', 'AT', 'TO', 'IN', 'ON', 'IS', 'IF', 'OR', 'AN',
                'DD', 'WSB', 'YOLO', 'FD', 'OP', 'PM', 'AM'}
        
        return list(set(t for t in tickers if t not in skip and len(t) >= 2))
    
    def get_hot_summary(self):
        """Generate summary."""
        sorted_mentions = sorted(
            self.mentions.items(),
            key=lambda x: x[1]["count"],
            reverse=True
        )
        
        summary = {
            "scan_time": self.results["timestamp"],
            "top_trending": [],
            "crypto_highlights": [],
            "stock_highlights": [],
            "social_buzz": [],
            "breaking_news": []
        }
        
        for symbol, data in sorted_mentions[:20]:
            summary["top_trending"].append({
                "symbol": symbol,
                "mentions": data["count"],
                "sources": list(set(data["sources"])),
                "signals": data["sentiment_hints"][:3]
            })
        
        # Crypto
        seen = set()
        for coin in self.results["crypto"] + self.results["movers"]:
            if coin["symbol"] not in seen:
                summary["crypto_highlights"].append(coin)
                seen.add(coin["symbol"])
        
        # Stocks
        seen = set()
        for stock in self.results["stocks"]:
            if stock["symbol"] not in seen:
                summary["stock_highlights"].append(stock)
                seen.add(stock["symbol"])
        
        # Social
        for item in self.results["social"][:15]:
            summary["social_buzz"].append(item)
        
        # News
        for news in self.results["news"][:10]:
            if news.get("tickers_mentioned"):
                summary["breaking_news"].append({
                    "title": news["title"],
                    "tickers": news["tickers_mentioned"]
                })
        
        return summary


def main():
    import argparse
    parser = argparse.ArgumentParser(description="🔥 Hot Scanner - Find trending stocks & crypto")
    parser.add_argument("--no-social", action="store_true", help="Skip social media scans")
    parser.add_argument("--json", action="store_true", help="Output only JSON")
    args = parser.parse_args()
    
    scanner = HotScanner(include_social=not args.no_social)
    
    if not args.json:
        print("=" * 60)
        print("🔥 HOT SCANNER v2 - What's Trending Right Now?")
        print(f"📅 {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} UTC")
        print("=" * 60)
        print()
    
    scanner.scan_all()
    summary = scanner.get_hot_summary()
    
    # Save
    output_file = CACHE_DIR / "hot_scan_latest.json"
    with open(output_file, "w") as f:
        json.dump(summary, f, indent=2, default=str)
    
    if args.json:
        print(json.dumps(summary, indent=2, default=str))
        return
    
    print()
    print("=" * 60)
    print("🔥 RESULTS")
    print("=" * 60)
    
    print("\n📊 TOP TRENDING (by buzz):\n")
    for i, item in enumerate(summary["top_trending"][:12], 1):
        sources = ", ".join(item["sources"][:2])
        signal = item["signals"][0][:30] if item["signals"] else ""
        print(f"  {i:2}. {item['symbol']:8} ({item['mentions']:2} pts) [{sources}] {signal}")
    
    print("\n🪙 CRYPTO:\n")
    for coin in summary["crypto_highlights"][:8]:
        change = coin.get("change_24h") or coin.get("price_change_24h")
        change_str = f"{change:+.1f}%" if change else "🔥"
        emoji = "🚀" if (change or 0) > 0 else "📉" if (change or 0) < 0 else "🔥"
        print(f"  {emoji} {coin.get('symbol', '?'):8} {coin.get('name', '')[:16]:16} {change_str:>8}")
    
    print("\n📈 STOCKS:\n")
    cat_emoji = {"gainers": "🟢", "losers": "🔴", "most_active": "📊"}
    for stock in summary["stock_highlights"][:10]:
        emoji = cat_emoji.get(stock.get("category"), "•")
        print(f"  {emoji} {stock['symbol']:6} ({stock.get('category', 'N/A').replace('_', ' ')})")
    
    if summary["social_buzz"]:
        print("\n🐦 SOCIAL BUZZ:\n")
        for item in summary["social_buzz"][:5]:
            platform = item.get("platform", "?")
            text = item.get("title") or item.get("text", "")
            text = text[:55] + "..." if len(text) > 55 else text
            print(f"  [{platform}] {text}")
    
    print("\n📰 NEWS:\n")
    for news in summary["breaking_news"][:5]:
        tickers = ", ".join(news["tickers"][:3])
        title = news["title"][:55] + "..." if len(news["title"]) > 55 else news["title"]
        print(f"  [{tickers}] {title}")
    
    print(f"\n💾 Saved: {output_file}\n")


if __name__ == "__main__":
    main()
