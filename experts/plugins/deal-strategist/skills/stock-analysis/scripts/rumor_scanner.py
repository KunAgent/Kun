#!/usr/bin/env python3
"""
🔮 RUMOR & BUZZ SCANNER
Scans for early signals, rumors, and whispers before they become mainstream news.

Sources:
- Twitter/X: "hearing", "rumor", "sources say", unusual buzz
- Google News: M&A, insider, upgrade/downgrade
- Unusual keywords detection

Usage: python3 rumor_scanner.py
"""

import json
import os
import subprocess
import sys
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.parse import quote_plus
import gzip

CACHE_DIR = Path(__file__).parent.parent / "cache"
CACHE_DIR.mkdir(exist_ok=True)

# Bird CLI path
BIRD_CLI = "/home/clawdbot/.nvm/versions/node/v24.12.0/bin/bird"
BIRD_ENV = Path(__file__).parent.parent / ".env"

def load_env():
    """Load environment variables from .env file."""
    if BIRD_ENV.exists():
        for line in BIRD_ENV.read_text().splitlines():
            if '=' in line and not line.startswith('#'):
                key, value = line.split('=', 1)
                os.environ[key.strip()] = value.strip().strip('"').strip("'")

def fetch_url(url, timeout=15):
    """Fetch URL with headers."""
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate',
        'Accept-Language': 'en-US,en;q=0.9',
    }
    req = Request(url, headers=headers)
    try:
        with urlopen(req, timeout=timeout) as resp:
            data = resp.read()
            if resp.info().get('Content-Encoding') == 'gzip':
                data = gzip.decompress(data)
            return data.decode('utf-8', errors='ignore')
    except Exception as e:
        return None

def search_twitter_rumors():
    """Search Twitter for rumors and early signals."""
    results = []
    
    # Rumor-focused search queries
    queries = [
        '"hearing that" stock OR $',
        '"sources say" stock OR company',
        '"rumor" merger OR acquisition',
        'insider buying stock',
        '"upgrade" OR "downgrade" stock tomorrow',
        '$AAPL OR $TSLA OR $NVDA rumor',
        '"breaking" stock market',
        'M&A rumor',
    ]
    
    load_env()
    
    for query in queries[:4]:  # Limit to avoid rate limits
        try:
            cmd = [BIRD_CLI, 'search', query, '-n', '10', '--json']
            env = os.environ.copy()
            
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30, env=env)
            
            if result.returncode == 0 and result.stdout:
                try:
                    tweets = json.loads(result.stdout)
                    for tweet in tweets:
                        text = tweet.get('text', '')
                        # Filter for actual rumors/signals
                        if any(kw in text.lower() for kw in ['hearing', 'rumor', 'source', 'insider', 'upgrade', 'downgrade', 'breaking', 'M&A', 'merger', 'acquisition']):
                            results.append({
                                'source': 'twitter',
                                'type': 'rumor',
                                'text': text[:300],
                                'author': tweet.get('author', {}).get('username', 'unknown'),
                                'likes': tweet.get('likes', 0),
                                'retweets': tweet.get('retweets', 0),
                                'query': query
                            })
                except json.JSONDecodeError:
                    pass
        except Exception as e:
            pass
    
    # Dedupe by text similarity
    seen = set()
    unique = []
    for r in results:
        key = r['text'][:100]
        if key not in seen:
            seen.add(key)
            unique.append(r)
    
    return unique

def search_twitter_buzz():
    """Search Twitter for general stock buzz - what are people talking about?"""
    results = []
    
    queries = [
        '$SPY OR $QQQ',
        'stock to buy',
        'calls OR puts expiring',
        'earnings play',
        'short squeeze',
    ]
    
    load_env()
    
    for query in queries[:3]:
        try:
            cmd = [BIRD_CLI, 'search', query, '-n', '15', '--json']
            env = os.environ.copy()
            
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30, env=env)
            
            if result.returncode == 0 and result.stdout:
                try:
                    tweets = json.loads(result.stdout)
                    for tweet in tweets:
                        text = tweet.get('text', '')
                        # Extract stock symbols
                        symbols = re.findall(r'\$([A-Z]{1,5})\b', text)
                        if symbols:
                            results.append({
                                'source': 'twitter',
                                'type': 'buzz',
                                'text': text[:300],
                                'symbols': symbols,
                                'author': tweet.get('author', {}).get('username', 'unknown'),
                                'engagement': tweet.get('likes', 0) + tweet.get('retweets', 0) * 2
                            })
                except json.JSONDecodeError:
                    pass
        except Exception as e:
            pass
    
    # Sort by engagement
    results.sort(key=lambda x: x.get('engagement', 0), reverse=True)
    return results[:20]

def search_news_rumors():
    """Search Google News for M&A, insider, upgrade news."""
    results = []
    
    queries = [
        'merger acquisition rumor',
        'insider buying stock',
        'analyst upgrade stock',
        'takeover bid company',
        'SEC investigation company',
    ]
    
    for query in queries:
        url = f"https://news.google.com/rss/search?q={quote_plus(query)}&hl=en-US&gl=US&ceid=US:en"
        content = fetch_url(url)
        
        if content:
            import xml.etree.ElementTree as ET
            try:
                root = ET.fromstring(content)
                for item in root.findall('.//item')[:5]:
                    title = item.find('title')
                    link = item.find('link')
                    pub_date = item.find('pubDate')
                    
                    if title is not None:
                        title_text = title.text or ''
                        # Extract company names or symbols
                        results.append({
                            'source': 'google_news',
                            'type': 'news_rumor',
                            'title': title_text,
                            'link': link.text if link is not None else '',
                            'date': pub_date.text if pub_date is not None else '',
                            'query': query
                        })
            except ET.ParseError:
                pass
    
    return results

def extract_symbols_from_text(text):
    """Extract stock symbols from text."""
    # $SYMBOL pattern
    dollar_symbols = re.findall(r'\$([A-Z]{1,5})\b', text)
    
    # Common company name to symbol mapping
    company_map = {
        'apple': 'AAPL', 'tesla': 'TSLA', 'nvidia': 'NVDA', 'microsoft': 'MSFT',
        'google': 'GOOGL', 'amazon': 'AMZN', 'meta': 'META', 'netflix': 'NFLX',
        'coinbase': 'COIN', 'robinhood': 'HOOD', 'disney': 'DIS', 'intel': 'INTC',
        'amd': 'AMD', 'palantir': 'PLTR', 'gamestop': 'GME', 'amc': 'AMC',
    }
    
    text_lower = text.lower()
    company_symbols = [sym for name, sym in company_map.items() if name in text_lower]
    
    return list(set(dollar_symbols + company_symbols))

def calculate_rumor_score(item):
    """Score a rumor by potential impact."""
    score = 0
    text = (item.get('text', '') + item.get('title', '')).lower()
    
    # High impact keywords
    if any(kw in text for kw in ['merger', 'acquisition', 'takeover', 'buyout']):
        score += 5
    if any(kw in text for kw in ['insider', 'ceo buying', 'director buying']):
        score += 4
    if any(kw in text for kw in ['upgrade', 'price target raised']):
        score += 3
    if any(kw in text for kw in ['downgrade', 'sec investigation', 'fraud']):
        score += 3
    if any(kw in text for kw in ['hearing', 'sources say', 'rumor']):
        score += 2
    if any(kw in text for kw in ['breaking', 'just in', 'alert']):
        score += 2
    
    # Engagement boost
    if item.get('engagement', 0) > 100:
        score += 2
    if item.get('likes', 0) > 50:
        score += 1
    
    return score

def main():
    print("=" * 60)
    print("🔮 RUMOR & BUZZ SCANNER")
    print(f"📅 {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')} UTC")
    print("=" * 60)
    print()
    print("🔍 Scanning for early signals...")
    print()
    
    all_rumors = []
    all_buzz = []
    
    # Twitter Rumors
    print("  🐦 Twitter rumors...")
    rumors = search_twitter_rumors()
    print(f"    ✅ {len(rumors)} potential rumors")
    all_rumors.extend(rumors)
    
    # Twitter Buzz
    print("  🐦 Twitter buzz...")
    buzz = search_twitter_buzz()
    print(f"    ✅ {len(buzz)} buzz items")
    all_buzz.extend(buzz)
    
    # News Rumors
    print("  📰 News rumors...")
    news = search_news_rumors()
    print(f"    ✅ {len(news)} news items")
    all_rumors.extend(news)
    
    # Score and sort rumors
    for item in all_rumors:
        item['score'] = calculate_rumor_score(item)
        item['symbols'] = extract_symbols_from_text(item.get('text', '') + item.get('title', ''))
    
    all_rumors.sort(key=lambda x: x['score'], reverse=True)
    
    # Count symbol mentions in buzz
    symbol_counts = {}
    for item in all_buzz:
        for sym in item.get('symbols', []):
            symbol_counts[sym] = symbol_counts.get(sym, 0) + 1
    
    # Output
    print()
    print("=" * 60)
    print("🔮 RESULTS")
    print("=" * 60)
    print()
    
    # Top Rumors
    print("🚨 TOP RUMORS (by potential impact):")
    print()
    for item in all_rumors[:10]:
        if item['score'] > 0:
            source = item['source']
            symbols = ', '.join(item.get('symbols', [])) or 'N/A'
            text = item.get('text', item.get('title', ''))[:80]
            print(f"   [{item['score']}] [{source}] {symbols}")
            print(f"       {text}...")
            print()
    
    # Buzz Leaderboard
    print("📊 BUZZ LEADERBOARD (most discussed):")
    print()
    sorted_symbols = sorted(symbol_counts.items(), key=lambda x: x[1], reverse=True)
    for symbol, count in sorted_symbols[:15]:
        bar = "█" * min(count, 20)
        print(f"   ${symbol:5} {bar} ({count})")
    
    print()
    
    # Recent Buzz Snippets
    print("💬 WHAT PEOPLE ARE SAYING:")
    print()
    for item in all_buzz[:8]:
        author = item.get('author', 'anon')
        text = item.get('text', '')[:120]
        engagement = item.get('engagement', 0)
        print(f"   @{author} ({engagement}♥): {text}...")
        print()
    
    # Save results
    output = {
        'timestamp': datetime.now(timezone.utc).isoformat(),
        'rumors': all_rumors[:20],
        'buzz': all_buzz[:30],
        'symbol_counts': symbol_counts,
    }
    
    output_file = CACHE_DIR / 'rumor_scan_latest.json'
    output_file.write_text(json.dumps(output, indent=2, default=str))
    print(f"💾 Saved: {output_file}")

if __name__ == "__main__":
    main()
