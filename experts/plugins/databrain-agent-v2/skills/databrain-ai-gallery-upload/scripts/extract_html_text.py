#!/usr/bin/env python3
"""HTML 文件 -> 纯文本（供 AI 推断 dashboard 元数据用）。

零依赖纯 stdlib（html.parser），不依赖 BeautifulSoup / lxml。

输出格式（stdout，UTF-8 强制）：
    第 1 行：<title>...</title> 内文（无 title 时为 [no title]）
    第 2 行起：正文纯文本（去 <script> / <style> / 注释 / 标签）
    总长度截断到约 4KB（避免撑爆 AI prompt）

错误时 exit 1 + stderr 打印原因；不抛 UnicodeDecodeError（非 UTF-8 用替换字符容错）。

用法：
    python3 extract_html_text.py /path/to/dash.html
"""

from __future__ import annotations

import re
import sys
from html.parser import HTMLParser
from pathlib import Path

MAX_OUTPUT_BYTES = 4 * 1024
SKIP_TAGS = {"script", "style", "noscript", "svg"}


class TextExtractor(HTMLParser):
    """提取 <title> + 正文，跳过 script / style / noscript / svg。"""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title_parts: list[str] = []
        self.body_parts: list[str] = []
        self._skip_depth = 0
        self._in_title = False

    def handle_starttag(self, tag: str, attrs):
        tag_low = tag.lower()
        if tag_low in SKIP_TAGS:
            self._skip_depth += 1
        elif tag_low == "title":
            self._in_title = True

    def handle_endtag(self, tag: str):
        tag_low = tag.lower()
        if tag_low in SKIP_TAGS and self._skip_depth > 0:
            self._skip_depth -= 1
        elif tag_low == "title":
            self._in_title = False

    def handle_startendtag(self, tag: str, attrs):
        # <br/> <img/> 等自闭合标签：忽略，不进 SKIP 计数
        pass

    def handle_data(self, data: str):
        if self._skip_depth > 0:
            return
        if self._in_title:
            self.title_parts.append(data)
        else:
            self.body_parts.append(data)

    def handle_comment(self, data: str):
        # 注释一律丢弃
        pass


def normalize_whitespace(text: str) -> str:
    """合并连续空白为单空格，去掉前后空白。"""
    return re.sub(r"\s+", " ", text).strip()


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: extract_html_text.py <html_file>", file=sys.stderr)
        return 1

    html_path = Path(sys.argv[1])
    if not html_path.is_file():
        print(f"file not found: {html_path}", file=sys.stderr)
        return 1

    try:
        raw = html_path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        print(f"read error: {exc}", file=sys.stderr)
        return 1

    parser = TextExtractor()
    try:
        parser.feed(raw)
        parser.close()
    except Exception as exc:  # html.parser 自带的解析异常都继承自 Exception
        print(f"parse error: {exc}", file=sys.stderr)
        return 1

    title = normalize_whitespace("".join(parser.title_parts)) or "[no title]"
    body = normalize_whitespace("".join(parser.body_parts))

    output = f"{title}\n{body}"
    output_bytes = output.encode("utf-8")
    if len(output_bytes) > MAX_OUTPUT_BYTES:
        truncated = output_bytes[:MAX_OUTPUT_BYTES].decode("utf-8", errors="ignore")
        output = truncated + "\n[...truncated]"

    print(output)
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except AttributeError:
        pass
    sys.exit(main())
