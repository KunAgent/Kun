#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
搜狗微信搜索工具
支持搜索公众号和文章，并获取文章原文

用法:
    python sogou_search.py "关键词"
    python sogou_search.py --type gzh "公众号名称"
    python sogou_search.py "关键词" --fetch-content
    python sogou_search.py "关键词" --days 7        # 搜索7天内的文章
    python sogou_search.py "关键词" --hours 24     # 搜索24小时内的文章
"""

import sys
import json
import time
import re
import random
import argparse
import urllib.parse
import urllib.request
import uuid
from datetime import datetime


# ============ 限频配置（宽松模式）============
class RateLimiter:
    """
    搜狗微信搜索限频器（宽松配置）
    
    测试结果显示短时间高频请求不会触发反爬，
    但长期高频仍可能被封，保留基本限频作为保护。
    """
    
    # 请求间隔（秒）- 宽松配置
    MIN_INTERVAL = 0.5   # 最小间隔 0.5 秒
    MAX_INTERVAL = 1.5   # 最大间隔 1.5 秒
    
    # 获取文章原文的间隔
    CONTENT_INTERVAL = 1
    
    # Cookie 刷新阈值（请求次数）
    COOKIE_REFRESH_THRESHOLD = 50
    
    # User-Agent 列表
    USER_AGENTS = [
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    ]
    
    def __init__(self, enabled=True):
        self.enabled = enabled
        self.request_count = 0
        self.last_request_time = 0
        self.suv_cookie = self._generate_suv()
        
    def _generate_suv(self) -> str:
        """生成 SUV Cookie"""
        return uuid.uuid4().hex.upper()
    
    def get_user_agent(self) -> str:
        """随机获取 User-Agent"""
        return random.choice(self.USER_AGENTS)
    
    def get_cookies(self) -> str:
        """获取 Cookie"""
        if self.request_count >= self.COOKIE_REFRESH_THRESHOLD:
            self.suv_cookie = self._generate_suv()
            self.request_count = 0
        return f"SUV={self.suv_cookie}"
    
    def wait(self, is_content_fetch: bool = False):
        """等待适当间隔"""
        if not self.enabled:
            self.request_count += 1
            return
        
        elapsed = time.time() - self.last_request_time
        
        if is_content_fetch:
            wait_time = self.CONTENT_INTERVAL
        else:
            wait_time = random.uniform(self.MIN_INTERVAL, self.MAX_INTERVAL)
        
        if elapsed < wait_time:
            time.sleep(wait_time - elapsed)
        
        self.last_request_time = time.time()
        self.request_count += 1


# 全局限频器
rate_limiter = RateLimiter()


def fetch_url(url: str, referer: str = None, is_content: bool = False) -> str:
    """获取URL内容"""
    rate_limiter.wait(is_content_fetch=is_content)
    
    headers = {
        "User-Agent": rate_limiter.get_user_agent(),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Cookie": rate_limiter.get_cookies(),
    }
    if referer:
        headers["Referer"] = referer
    
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return response.read().decode("utf-8", errors="ignore")
    except Exception as e:
        return f"Error: {str(e)}"


def clean_html(text: str) -> str:
    """清理HTML标签"""
    text = re.sub(r'<!--[^>]*-->', '', text)
    text = re.sub(r'<[^>]+>', '', text)
    text = re.sub(r'\s+', ' ', text)
    return text.strip()


def search_sogou(query: str, search_type: str = "article", page: int = 1, 
                 time_from: int = None, time_to: int = None) -> list:
    """
    搜狗微信搜索
    
    参数:
        query: 搜索关键词
        search_type: 搜索类型，"article" 或 "gzh"
        page: 页码
        time_from: 起始时间戳（Unix时间戳，秒）
        time_to: 结束时间戳（Unix时间戳，秒）
    """
    type_code = "2" if search_type == "article" else "1"
    encoded_query = urllib.parse.quote(query)
    url = f"https://weixin.sogou.com/weixin?type={type_code}&query={encoded_query}&page={page}&ie=utf8"
    
    # 添加时间筛选参数
    if time_from is not None:
        url += f"&ft={time_from}"
    if time_to is not None:
        url += f"&et={time_to}"
    
    html = fetch_url(url)
    if html.startswith("Error:"):
        return [{"error": html}]
    
    if "请输入验证码" in html or "antispider" in html:
        return [{"error": "触发验证码，请稍后重试"}]
    
    results = []
    
    if search_type == "article":
        li_pattern = r'<li[^>]*id="sogou_vr_\d+_box_\d+"[^>]*>(.*?)</li>'
        items = re.findall(li_pattern, html, re.DOTALL)
        
        for item in items:
            result = {}
            
            link_match = re.search(r'href="(/link\?url=[^"]+)"', item)
            if link_match:
                link = link_match.group(1).replace("&amp;", "&").replace(" ", "%20")
                result["sogou_link"] = "https://weixin.sogou.com" + link
            
            title_match = re.search(r'<h3>\s*<a[^>]*>(.*?)</a>\s*</h3>', item, re.DOTALL)
            if title_match:
                result["title"] = clean_html(title_match.group(1))
            
            digest_match = re.search(r'<p[^>]*class="txt-info"[^>]*>(.*?)</p>', item, re.DOTALL)
            if digest_match:
                result["digest"] = clean_html(digest_match.group(1))[:200]
            
            account_match = re.search(r'<span[^>]*class="all-time-y2"[^>]*>([^<]+)</span>', item)
            if account_match:
                result["account"] = account_match.group(1).strip()
            
            time_match = re.search(r"timeConvert\('(\d+)'\)", item)
            if time_match:
                timestamp = int(time_match.group(1))
                result["time"] = datetime.fromtimestamp(timestamp).strftime("%Y-%m-%d %H:%M")
            
            if result.get("title"):
                results.append(result)
    else:
        gzh_pattern = r'<div[^>]*class="gzh-box[^"]*"[^>]*>(.*?)<div class="s-p"'
        items = re.findall(gzh_pattern, html, re.DOTALL)
        
        for item in items:
            result = {}
            name_match = re.search(r'<p[^>]*class="tit"[^>]*>.*?<a[^>]*>([^<]+)</a>', item, re.DOTALL)
            if name_match:
                result["nickname"] = name_match.group(1).strip()
            wxid_match = re.search(r'<label[^>]*>微信号:\s*([^<]+)</label>', item)
            if wxid_match:
                result["wechat_id"] = wxid_match.group(1).strip()
            if result.get("nickname"):
                results.append(result)
    
    return results


def get_article_content(sogou_link: str) -> dict:
    """获取文章原文"""
    html = fetch_url(sogou_link, referer="https://weixin.sogou.com/", is_content=True)
    
    if html.startswith("Error:"):
        return {"error": html}
    
    url_parts = re.findall(r"url \+= '([^']+)'", html)
    if url_parts:
        wx_url = "".join(url_parts).replace("@", "")
    else:
        wx_match = re.search(r'var\s+url\s*=\s*["\']([^"\']+)["\']', html)
        if wx_match:
            wx_url = wx_match.group(1)
        else:
            return {"error": "无法解析微信文章链接"}
    
    article_html = fetch_url(wx_url, referer="https://weixin.sogou.com/", is_content=True)
    
    if article_html.startswith("Error:"):
        return {"error": article_html}
    
    result = {"wx_url": wx_url}
    
    title_match = re.search(r'<h1[^>]*class="rich_media_title"[^>]*>(.*?)</h1>', article_html, re.DOTALL)
    if not title_match:
        title_match = re.search(r'<title>([^<]+)</title>', article_html)
    if title_match:
        result["title"] = clean_html(title_match.group(1))
    
    account_match = re.search(r'<a[^>]*id="js_name"[^>]*>([^<]+)</a>', article_html)
    if account_match:
        result["account"] = account_match.group(1).strip()
    
    time_match = re.search(r'<em[^>]*id="publish_time"[^>]*>([^<]+)</em>', article_html)
    if time_match:
        result["publish_time"] = time_match.group(1).strip()
    
    content_match = re.search(r'<div[^>]*id="js_content"[^>]*>(.*?)</div>\s*<script', article_html, re.DOTALL)
    if content_match:
        content = content_match.group(1)
        content = re.sub(r'<script[^>]*>.*?</script>', '', content, flags=re.DOTALL)
        content = re.sub(r'<style[^>]*>.*?</style>', '', content, flags=re.DOTALL)
        content = re.sub(r'<[^>]+>', '\n', content)
        content = re.sub(r'\n\s*\n', '\n\n', content)
        content = re.sub(r'&nbsp;', ' ', content)
        content = re.sub(r'&[a-z]+;', '', content)
        result["content"] = content.strip()
    
    return result


def main():
    parser = argparse.ArgumentParser(description="搜狗微信搜索工具")
    parser.add_argument("query", help="搜索关键词")
    parser.add_argument("--type", "-t", choices=["article", "gzh"], default="article")
    parser.add_argument("--page", "-p", type=int, default=1)
    parser.add_argument("--count", "-c", type=int, help="返回文章数量（默认10，最多100）")
    parser.add_argument("--fetch-content", "-f", action="store_true")
    parser.add_argument("--output", "-o", help="输出到JSON文件")
    parser.add_argument("--limit", "-l", type=int, default=10, help="获取原文数量限制")
    parser.add_argument("--no-limit", action="store_true", help="完全禁用限频")
    
    # 时间筛选参数
    time_group = parser.add_mutually_exclusive_group()
    time_group.add_argument("--days", "-d", type=int, help="搜索最近N天内的文章")
    time_group.add_argument("--hours", type=int, help="搜索最近N小时内的文章")
    time_group.add_argument("--time-range", nargs=2, metavar=("FROM", "TO"),
                           help="指定时间范围，格式: YYYY-MM-DD YYYY-MM-DD")
    
    args = parser.parse_args()
    
    if args.no_limit:
        rate_limiter.enabled = False
    
    # 计算时间范围
    time_from = None
    time_to = None
    time_desc = ""
    
    if args.days:
        time_to = int(time.time())
        time_from = time_to - args.days * 86400
        time_desc = f" (最近{args.days}天)"
    elif args.hours:
        time_to = int(time.time())
        time_from = time_to - args.hours * 3600
        time_desc = f" (最近{args.hours}小时)"
    elif args.time_range:
        try:
            from_date = datetime.strptime(args.time_range[0], "%Y-%m-%d")
            to_date = datetime.strptime(args.time_range[1], "%Y-%m-%d")
            # 结束日期设为当天23:59:59
            to_date = to_date.replace(hour=23, minute=59, second=59)
            time_from = int(from_date.timestamp())
            time_to = int(to_date.timestamp())
            time_desc = f" ({args.time_range[0]} 至 {args.time_range[1]})"
        except ValueError:
            print("时间格式错误，请使用 YYYY-MM-DD 格式")
            return
    
    print(f"搜索: {args.query}{time_desc}")
    print(f"类型: {'文章' if args.type == 'article' else '公众号'}")
    print()
    
    # 获取结果
    results = search_sogou(args.query, args.type, args.page, time_from, time_to)
    
    # 限制返回数量
    if args.count:
        results = results[:min(args.count, 10)]
    
    if not results:
        print("未找到结果")
        return
    
    if results and "error" in results[0]:
        print(f"错误: {results[0]['error']}")
        return
    
    print(f"找到 {len(results)} 条结果:\n")
    
    for i, item in enumerate(results, 1):
        if args.type == "article":
            print(f"{i}. {item.get('title', '无标题')}")
            print(f"   公众号: {item.get('account', '未知')} | {item.get('time', '')}")
        else:
            print(f"{i}. {item.get('nickname', '未知')} ({item.get('wechat_id', '')})")
        print()
    
    if args.fetch_content and args.type == "article":
        print("--- 获取文章原文 ---\n")
        for i, item in enumerate(results[:args.limit], 1):
            if "sogou_link" not in item:
                continue
            print(f"获取 {i}/{min(args.limit, len(results))}...")
            content = get_article_content(item["sogou_link"])
            if "error" not in content:
                item["wx_url"] = content.get("wx_url")
                item["full_content"] = content.get("content", "")
                print(f"  {content.get('title', '')} ({len(content.get('content', ''))}字)")
            else:
                print(f"  失败: {content['error']}")
            print()
    
    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=2)
        print(f"已保存到: {args.output}")
    
    print("\n--- JSON ---")
    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
