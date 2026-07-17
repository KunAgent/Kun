#!/usr/bin/env python3
"""Map natural-language descriptions to Tencent Cloud products via HTTP MCP.

The script intentionally depends only on Python standard library so the skill can
run without installing an MCP client package.
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any

DEFAULT_MCP_URL = "http://portal-mcp-server.woa.com/mcp"
DEFAULT_PROTOCOL_VERSION = "2025-03-26"
DEFAULT_THRESHOLD = 130.0
DEFAULT_RETRIES = 2
DEFAULT_RETRY_DELAY = 5.0
EDITION_WORDS = (
    "标准版",
    "高级版",
    "企业版",
    "基础版",
    "专业版",
    "旗舰版",
    "增强版",
    "入门版",
    "免费版",
    "试用版",
    "国内版",
    "国际版",
    "传统型",
    "saas型",
    "saas 型",
    "SaaS型",
    "SaaS 型",
)

# Curated aliases learned from real quote sheets and Tencent Cloud product catalog
# mismatches. Keep this list conservative: alias to a catalog product only when the
# wording is a known product synonym, abbreviation, renamed product, or SKU family.
#
# Each rule is (pattern, target_slug, exclude_pattern).
# exclude_pattern is optional (None when not needed). When the query matches both
# pattern AND exclude_pattern, the alias is skipped so a more specific alias or
# the regular scoring path can take over. This prevents adjective-style phrases
# (e.g. "BGP 按流量") from hijacking aliases when the query already names a more
# specific product (e.g. "弹性公网 IP").
ALIAS_RULES: tuple[tuple[str, str, str | None], ...] = (
    # EIP must come before BWP so EIP wins when both could match.
    (r"弹性公网\s*IP|\bEIP\b", "eip", None),
    # "公网带宽" alone, or "BGP 按带宽 / BGP 按流量" without an explicit EIP context,
    # refers to the standalone Bandwidth Package (BWP) SPU. If the query already
    # names 弹性公网 IP / EIP, the BGP/公网带宽 fragment is a per-EIP attribute and
    # this alias must not steal the match.
    (r"公网带宽|BGP\s*按带宽|BGP\s*按流量", "bwp", r"弹性公网\s*IP|\bEIP\b"),
    (r"DDoS\s*高防", "ddos", None),
    (r"主机安全|CWPP", "hs", None),
    (r"数据安全审计|DBAudit", "CDS", None),
    (r"漏洞扫描|\bVSS\b", "vgs", None),
    (r"T-Sec\s*态势感知|态势感知", "ssa", None),
    (r"MySQL\s*云数据库|云数据库\s*MySQL", "cdb", None),
    (r"PostgreSQL", "postgres", None),
    (r"SQL\s*Server", "sqlserver", None),
    (r"MariaDB", "tdsql", None),
    (r"\bRedis\b", "tcdc", None),
    (r"MongoDB", "mongodb", None),
    (r"TDSQL-C(?!\s*PostgreSQL)|Cloud\s*Native", "cynosdb", None),
    (r"TDSQL\s*分布式|\bDCDB\b", "dcdb", None),
    (r"TDSQL-A", "tchoused", None),
    (r"CDW-PG|Greenplum", "tchousep", None),
    (r"CDW-DORIS|DORIS", "tchoused", None),
    (r"CDW-CK|ClickHouse", "tchousec", None),
    (r"DNSPod|DNS\s*解析", "dns", None),
    (r"FaceID|人脸识别.*活体", "faceid", None),
    (r"北极星|注册中心", "tse", None),
    (r"持续部署|CICD|制品管理|XRepo", "coding", None),
    (r"Hunyuan-|腾讯混元|混元", "hunyuan", None),
    (r"DeepSeek|Kimi|GLM|MiniMax", "tokenhub", None),
    (r"大模型知识引擎|\bLKE\b", "lkeap", None),
)

# Known noisy terms that are not currently present as first-class products in
# the MCP product catalog. Without this guard, document search often returns
# unrelated products merely because their docs contain these words or API fields.
UNSUPPORTED_PATTERNS: tuple[str, ...] = (
    r"服务网格|\bTCM\b",
    r"工作流\s*ASW|\bASW\b",
    r"蓝盾流水线|蓝盾",
    r"图数据库|KonisGraph",
    r"语音通话|VoIP",
    r"车联网|TCIP",
    r"NLP\s*工具包|自然语言处理",
)


@dataclass(frozen=True)
class Product:
    product_id: int | None
    name: str
    slug: str


@dataclass
class Candidate:
    product: Product
    score: float = 0.0
    reasons: list[str] = field(default_factory=list)


class McpError(RuntimeError):
    pass


class McpNetworkError(McpError):
    """Network-level failure (timeout / connection reset) that is safe to retry."""


class PortalMcpClient:
    def __init__(
        self,
        url: str,
        timeout: float,
        retries: int = DEFAULT_RETRIES,
        retry_delay: float = DEFAULT_RETRY_DELAY,
    ) -> None:
        self.url = url
        self.timeout = timeout
        self.retries = max(0, retries)
        self.retry_delay = max(0.0, retry_delay)
        self.session_id: str | None = None
        self.next_id = 1

    def initialize(self) -> None:
        payload = {
            "jsonrpc": "2.0",
            "id": self._id(),
            "method": "initialize",
            "params": {
                "protocolVersion": DEFAULT_PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {
                    "name": "tencent-cloud-product-mapping",
                    "version": "0.1.0",
                },
            },
        }
        headers, _ = self._post(payload)
        self.session_id = headers.get("Mcp-Session-Id")
        if not self.session_id:
            raise McpError("missing Mcp-Session-Id in initialize response")
        self._post({"jsonrpc": "2.0", "method": "notifications/initialized"})

    def call_tool(self, name: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = {
            "jsonrpc": "2.0",
            "id": self._id(),
            "method": "tools/call",
            "params": {"name": name, "arguments": arguments or {}},
        }
        _, body = self._post(payload)
        result = body.get("result")
        if not isinstance(result, dict):
            raise McpError(f"invalid tool result for {name}")
        if result.get("isError"):
            text = _extract_text_payload(result)
            raise McpError(text or f"tool failed: {name}")
        text = _extract_text_payload(result)
        if not text:
            return {}
        try:
            return json.loads(text)
        except json.JSONDecodeError as exc:
            raise McpError(f"tool returned non-json text: {name}") from exc

    def _id(self) -> int:
        value = self.next_id
        self.next_id += 1
        return value

    def _post(self, payload: dict[str, Any]) -> tuple[Any, dict[str, Any]]:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }
        if self.session_id:
            headers["Mcp-Session-Id"] = self.session_id
        request = urllib.request.Request(self.url, data=data, headers=headers, method="POST")
        for attempt in range(self.retries + 1):
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    raw = response.read().decode("utf-8")
                    parsed = json.loads(raw) if raw.strip() else {}
                    if isinstance(parsed, dict) and "error" in parsed:
                        raise McpError(json.dumps(parsed["error"], ensure_ascii=False))
                    return response.headers, parsed
            except (urllib.error.URLError, TimeoutError) as exc:
                reason = "request timed out" if isinstance(exc, TimeoutError) else str(exc)
                if attempt >= self.retries:
                    raise McpNetworkError(reason) from exc
                print(
                    f"[tencent-cloud-product-mapping] network error: {reason}; "
                    f"retrying in {self.retry_delay:.0f}s "
                    f"(attempt {attempt + 1}/{self.retries})",
                    file=sys.stderr,
                )
                time.sleep(self.retry_delay)
        raise McpNetworkError("exhausted retries without a response")


def _extract_text_payload(result: dict[str, Any]) -> str:
    content = result.get("content")
    if not isinstance(content, list):
        return ""
    for item in content:
        if isinstance(item, dict) and item.get("type") == "text":
            text = item.get("text")
            return text if isinstance(text, str) else ""
    return ""


def normalize(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).lower()
    value = html.unescape(value)
    value = re.sub(r"<[^>]+>", "", value)
    value = re.sub(r"[\s\-_·/\\|,，.。:：;；()（）\[\]【】{}<>《》'\"“”‘’]+", "", value)
    return value


def slug_matches_query(slug: str, query: str) -> bool:
    normalized_slug = normalize(slug)
    if len(normalized_slug) < 2:
        return False
    ascii_tokens = [normalize(token) for token in re.findall(r"[A-Za-z][A-Za-z0-9+_.-]*", query)]
    if normalized_slug in ascii_tokens:
        return True
    return len(normalized_slug) >= 4 and normalized_slug in normalize(query)


def product_lookup(products: list[Product]) -> dict[str, Product]:
    lookup: dict[str, Product] = {}
    for product in products:
        lookup[normalize(product.name)] = product
        if product.slug:
            lookup[normalize(product.slug)] = product
    return lookup


def resolve_product(target: str, lookup: dict[str, Product]) -> Product | None:
    return lookup.get(normalize(target))


def alias_product(query: str, lookup: dict[str, Product]) -> tuple[Product, str] | None:
    for pattern, target, exclude in ALIAS_RULES:
        if not re.search(pattern, query, re.IGNORECASE):
            continue
        if exclude and re.search(exclude, query, re.IGNORECASE):
            continue
        product = resolve_product(target, lookup)
        if product:
            return product, pattern
    return None


def has_unsupported_pattern(query: str) -> str | None:
    for pattern in UNSUPPORTED_PATTERNS:
        if re.search(pattern, query, re.IGNORECASE):
            return pattern
    return None


def direct_product(query: str, products: list[Product]) -> tuple[Product, list[str], float] | None:
    normalized_query = normalize(query)
    best: tuple[Product, list[str], float] | None = None
    for product in products:
        normalized_name = normalize(product.name)
        score = 0.0
        reasons: list[str] = []
        if normalized_name and normalized_name in normalized_query:
            score += 120.0 + min(len(normalized_name), 20)
            reasons.append("product-name-contained-in-query")
        elif normalized_query and normalized_query in normalized_name:
            score += 80.0
            reasons.append("query-contained-in-product-name")
        if slug_matches_query(product.slug, query):
            score += 90.0
            reasons.append("product-slug-contained-in-query")
        if score and (best is None or score > best[2]):
            best = (product, reasons, score)
    return best


def result_for_product(query: str, product: Product, confidence: float, reasons: list[str], explain: bool) -> dict[str, Any]:
    return {
        "query": query,
        "found": True,
        "name": product.name,
        "slug": product.slug,
        "product_id": product.product_id,
        "confidence": round(confidence, 1),
        "searched": [],
        "candidates": [
            {
                "name": product.name,
                "slug": product.slug,
                "product_id": product.product_id,
                "score": round(confidence, 1),
                "reasons": reasons,
            }
        ]
        if explain
        else [],
    }


def not_found_result(
    query: str,
    explain: bool,
    reason: str = "",
    searched: list[str] | None = None,
    candidates: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    debug_candidates = candidates or []
    if explain and reason:
        debug_candidates = [{"reason": reason}] + debug_candidates
    return {
        "query": query,
        "found": False,
        "name": query,
        "slug": "",
        "product_id": None,
        "confidence": 0.0,
        "searched": (searched or []) if explain else [],
        "candidates": debug_candidates if explain else [],
    }


def query_variants(query: str) -> list[str]:
    variants: list[str] = []

    def add(value: str) -> None:
        value = " ".join(value.split()).strip()
        if value and value not in variants:
            variants.append(value)

    add(query)
    stripped = query
    for word in EDITION_WORDS:
        stripped = stripped.replace(word, " ")
    add(stripped)

    chinese_parts = re.findall(r"[\u4e00-\u9fff]{2,}", stripped)
    if chinese_parts:
        add(" ".join(chinese_parts))
        add(max(chinese_parts, key=len))

    ascii_parts = re.findall(r"[A-Za-z][A-Za-z0-9+_.-]{1,}", stripped)
    for part in ascii_parts[:2]:
        add(part)

    return variants[:5]


def load_products(client: PortalMcpClient) -> list[Product]:
    data = client.call_tool("list-document-product", {})
    products: list[Product] = []
    for item in data.get("Products", []):
        if not isinstance(item, dict):
            continue
        name = str(item.get("ProductName") or "").strip()
        if not name:
            continue
        product_id = item.get("ProductId")
        products.append(
            Product(
                product_id=product_id if isinstance(product_id, int) else None,
                name=name,
                slug=str(item.get("ProductSlug") or "").strip(),
            )
        )
    if not products:
        raise McpError("product catalog is empty")
    return products


def search(client: PortalMcpClient, keyword: str) -> list[dict[str, Any]]:
    data = client.call_tool("search-documents", {"Keyword": keyword})
    results = data.get("SearchResults", [])
    return results if isinstance(results, list) else []


def map_one(
    client: PortalMcpClient,
    products: list[Product],
    query: str,
    threshold: float,
    explain: bool,
) -> dict[str, Any]:
    product_by_name = {p.name: p for p in products}
    product_by_id = {p.product_id: p for p in products if p.product_id is not None}
    lookup = product_lookup(products)

    alias = alias_product(query, lookup)
    if alias:
        product, pattern = alias
        return result_for_product(query, product, 5000.0, [f"alias:{pattern}"], explain)

    direct = direct_product(query, products)
    if direct and direct[2] >= 120.0:
        product, reasons, score = direct
        return result_for_product(query, product, score, reasons, explain)

    unsupported = has_unsupported_pattern(query)
    if unsupported:
        return not_found_result(query, explain, f"unsupported-no-catalog-product:{unsupported}")

    candidates: dict[str, Candidate] = {}

    def candidate(product: Product) -> Candidate:
        key = product.name
        if key not in candidates:
            candidates[key] = Candidate(product=product)
        return candidates[key]

    normalized_query = normalize(query)
    if direct:
        product, reasons, score = direct
        item = candidate(product)
        item.score += score
        item.reasons.extend(reasons)

    searched: list[str] = []
    for variant in query_variants(query):
        try:
            results = search(client, variant)
        except McpError:
            continue
        searched.append(variant)
        variant_norm = normalize(variant)
        for index, result in enumerate(results[:20]):
            if not isinstance(result, dict):
                continue
            product_name = str(result.get("ProductName") or "").strip()
            product = product_by_name.get(product_name)
            if not product:
                product_id = _extract_product_id(str(result.get("DocumentURL") or ""))
                product = product_by_id.get(product_id)
            if not product and product_name:
                product = Product(product_id=None, name=product_name, slug="")
            if not product:
                continue

            rank_score = max(6.0, 55.0 - index * 3.0)
            score = rank_score
            if normalize(product.name) in normalized_query:
                score += 45.0
            if slug_matches_query(product.slug, query):
                score += 35.0
            title = normalize(str(result.get("DocumentTitle") or ""))
            snippet = normalize(str(result.get("Snippet") or ""))
            if variant_norm and (variant_norm in title or variant_norm in snippet):
                score += 8.0
            item = candidate(product)
            item.score += score
            if explain:
                item.reasons.append(f"search:{variant}:rank:{index + 1}:score:{score:.1f}")

    best = max(candidates.values(), key=lambda item: item.score, default=None)
    if not best:
        return not_found_result(query, explain, "no-candidate", searched, _candidate_debug(candidates))
    if best.score < threshold:
        return not_found_result(
            query,
            explain,
            f"low-confidence:{best.score:.1f}<threshold:{threshold:.1f}",
            searched,
            _candidate_debug(candidates),
        )
    return {
        "query": query,
        "found": True,
        "name": best.product.name,
        "slug": best.product.slug,
        "product_id": best.product.product_id,
        "confidence": round(best.score, 1),
        "searched": searched if explain else [],
        "candidates": _candidate_debug(candidates) if explain else [],
    }


def _extract_product_id(url: str) -> int | None:
    match = re.search(r"/product/(\d+)(?:/|$)", url)
    if not match:
        return None
    try:
        return int(match.group(1))
    except ValueError:
        return None


def _candidate_debug(candidates: dict[str, Candidate]) -> list[dict[str, Any]]:
    ranked = sorted(candidates.values(), key=lambda item: item.score, reverse=True)[:8]
    return [
        {
            "name": item.product.name,
            "slug": item.product.slug,
            "product_id": item.product.product_id,
            "score": round(item.score, 1),
            "reasons": item.reasons[:8],
        }
        for item in ranked
    ]


def format_result(result: dict[str, Any], field: str) -> str:
    if field == "json":
        return json.dumps(result, ensure_ascii=False, separators=(",", ":"))
    if not result.get("found"):
        return str(result.get("query") or result.get("name") or "")
    if field == "name":
        return str(result.get("name") or result.get("query") or "")
    if field == "slug":
        return str(result.get("slug") or result.get("query") or "")
    if field == "both":
        slug = str(result.get("slug") or "")
        return f"{result.get('name')}\t{slug}".rstrip()
    raise ValueError(f"unsupported field: {field}")


def collect_queries(args: argparse.Namespace) -> list[str]:
    queries = [q.strip() for q in args.queries if q.strip()]
    if queries:
        return queries
    if not sys.stdin.isatty():
        return [line.strip() for line in sys.stdin if line.strip()]
    return []


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Map natural-language text to the best matching Tencent Cloud product."
    )
    parser.add_argument("queries", nargs="*", help="Product descriptions or keywords.")
    parser.add_argument(
        "--field",
        choices=("name", "slug", "both", "json"),
        default="name",
        help="Output field. Default: name.",
    )
    parser.add_argument("--jsonl", action="store_true", help="Emit one JSON object per input query.")
    parser.add_argument("--explain", action="store_true", help="Include searched variants and candidates in JSON output.")
    parser.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD, help="Minimum score required to accept a match.")
    parser.add_argument("--timeout", type=float, default=20.0, help="HTTP request timeout in seconds.")
    parser.add_argument(
        "--retries",
        type=int,
        default=DEFAULT_RETRIES,
        help=f"Retries on network/timeout errors before giving up. Default: {DEFAULT_RETRIES}.",
    )
    parser.add_argument(
        "--retry-delay",
        type=float,
        default=DEFAULT_RETRY_DELAY,
        help=f"Seconds to wait between retries. Default: {DEFAULT_RETRY_DELAY:.0f}.",
    )
    parser.add_argument("--url", default=os.environ.get("TCLOUD_PRODUCT_MCP_URL", DEFAULT_MCP_URL), help="MCP HTTP endpoint.")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    queries = collect_queries(args)
    if not queries:
        return 1

    try:
        client = PortalMcpClient(args.url, args.timeout, retries=args.retries, retry_delay=args.retry_delay)
        client.initialize()
        products = load_products(client)
        for query in queries:
            result = map_one(client, products, query, args.threshold, args.explain or args.field == "json" or args.jsonl)
            if args.jsonl:
                print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
            else:
                print(format_result(result, args.field))
        return 0
    except McpError as exc:
        if args.jsonl or args.field == "json":
            for query in queries:
                result = not_found_result(query, args.explain or args.field == "json" or args.jsonl, f"mcp-error:{exc}")
                print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
        else:
            for query in queries:
                print(query)
        return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
