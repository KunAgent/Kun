#!/usr/bin/env python3
"""Extract table-of-contents and searchable snippets from current ihr-cli docs."""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import urllib.parse
import urllib.request
from dataclasses import dataclass, asdict


DOCS_BASE = "https://hrclaw-docs.ihr360.com/"


@dataclass
class DocChunk:
    title: str
    module_id: str
    text: str


def fetch_text(url: str) -> str:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "ihr-cli-operator-docs-discovery/1.0",
            "Accept": "text/html,application/javascript,*/*",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read()
    return raw.decode("utf-8", errors="replace")


def current_bundle_url(base_url: str = DOCS_BASE) -> str:
    index = fetch_text(base_url)
    match = re.search(r'<script[^>]+src=["\']([^"\']*build/bundle\.[^"\']+\.js)["\']', index)
    if not match:
        match = re.search(r'["\']([^"\']*build/bundle\.[^"\']+\.js)["\']', index)
    if not match:
        raise RuntimeError("Could not find build/bundle.<hash>.js in docs homepage")
    return urllib.parse.urljoin(base_url, match.group(1))


def unescape_js_string(value: str) -> str:
    # Decode enough webpack markdown string escapes for searching and display.
    value = value.replace("\\n", "\n").replace("\\r", "\r").replace("\\t", "\t")
    value = value.replace('\\"', '"').replace("\\'", "'").replace("\\/", "/")

    def repl(match: re.Match[str]) -> str:
        return chr(int(match.group(1), 16))

    value = re.sub(r"\\u([0-9a-fA-F]{4})", repl, value)
    return html.unescape(value)


def extract_toc(bundle: str) -> list[str]:
    start = bundle.find('sections:[{name:"i人事CLI-API"')
    if start < 0:
        start = bundle.find('sections:[{name:')
    if start < 0:
        return []
    end = bundle.find("}]}},function", start)
    if end < 0:
        end = min(len(bundle), start + 300_000)
    chunk = bundle[start:end]
    return [unescape_js_string(name) for name in re.findall(r'name:"([^"]+)"', chunk)]


def extract_markdown_chunks(bundle: str) -> list[DocChunk]:
    chunks: list[DocChunk] = []
    pattern = re.compile(r"content:'((?:\\'|[^'])*)'", re.DOTALL)
    for idx, match in enumerate(pattern.finditer(bundle), start=1):
        text = unescape_js_string(match.group(1))
        if not text.strip():
            continue
        title = ""
        heading = re.search(r"^\s{0,3}#{1,3}\s+(.+?)\s*$", text, re.MULTILINE)
        if heading:
            title = heading.group(1).strip()
        else:
            title = f"chunk-{idx}"
        chunks.append(DocChunk(title=title, module_id=str(idx), text=text))
    return chunks


def snippet(text: str, query: str, radius: int = 420) -> str:
    pos = text.lower().find(query.lower())
    if pos < 0:
        return text[: radius * 2].strip()
    start = max(0, pos - radius)
    end = min(len(text), pos + len(query) + radius)
    prefix = "..." if start else ""
    suffix = "..." if end < len(text) else ""
    return prefix + text[start:end].strip() + suffix


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=DOCS_BASE)
    parser.add_argument("--toc", action="store_true", help="Print current docs table of contents")
    parser.add_argument("--search", help="Search current docs markdown content")
    parser.add_argument("--section", help="Print chunks whose title or text contains this value")
    parser.add_argument("--dump", help="Write extracted docs JSON to this path")
    parser.add_argument("--limit", type=int, default=20)
    args = parser.parse_args()

    bundle_url = current_bundle_url(args.base_url)
    bundle = fetch_text(bundle_url)
    toc = extract_toc(bundle)
    chunks = extract_markdown_chunks(bundle)

    if args.dump:
        data = {
            "source": args.base_url,
            "bundle_url": bundle_url,
            "toc": toc,
            "chunks": [asdict(chunk) for chunk in chunks],
        }
        with open(args.dump, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    if args.toc:
        print(f"bundle: {bundle_url}")
        for item in toc:
            print(item)

    query = args.search or args.section
    if query:
        matches = [
            chunk
            for chunk in chunks
            if query.lower() in chunk.title.lower() or query.lower() in chunk.text.lower()
        ]
        print(f"bundle: {bundle_url}")
        print(f"matches: {len(matches)}")
        for chunk in matches[: args.limit]:
            print("\n---")
            print(f"title: {chunk.title}")
            print(snippet(chunk.text, query))

    if not (args.toc or args.search or args.section or args.dump):
        print(f"bundle: {bundle_url}")
        print(f"toc_items: {len(toc)}")
        print(f"markdown_chunks: {len(chunks)}")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1)
