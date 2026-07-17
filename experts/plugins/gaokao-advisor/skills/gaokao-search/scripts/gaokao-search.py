# -*- coding: utf-8 -*-
"""
Gaokao knowledge base retrieval client.

This script calls AgentTool ImaSearch as the only retrieval path. WorkBuddy
must provide a fresh token from connect_cloud_service for each invocation,
prefer tempToken when present, and fall back to token only when tempToken is
empty. The script only prints data returned by the upstream service and
intentionally avoids fallback generation or heuristic answer synthesis.
"""

import argparse
import contextlib
import json
import mimetypes
from pathlib import Path
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


DEFAULT_AGENTTOOL_ENDPOINT = "https://copilot.tencent.com/agenttool/v1/imasearch"


def error_out(error, message, **extra):
    payload = {
        "ok": False,
        "error": error,
        "message": message,
    }
    payload.update(extra)
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    sys.exit(1)


def build_parser():
    parser = argparse.ArgumentParser(
        description="Search Gaokao knowledge base through AgentTool ImaSearch."
    )
    parser.add_argument("query", help="Search query. Use precise Gaokao-related terms.")
    parser.add_argument(
        "--limit",
        type=int,
        default=20,
        help="Number of documents to request from upstream, 1-20. Default: 20.",
    )
    parser.add_argument(
        "--endpoint",
        default=DEFAULT_AGENTTOOL_ENDPOINT,
        help="AgentTool ImaSearch endpoint. Default: https://copilot.tencent.com/agenttool/v1/imasearch.",
    )
    parser.add_argument(
        "--token",
        default="",
        help="Bearer token for this AgentTool request. Must be freshly obtained by connect_cloud_service and passed explicitly.",
    )
    parser.add_argument(
        "--resolve",
        default="",
        help="Optional DNS override in curl --resolve format, e.g. host:443:1.2.3.4.",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=30,
        help="HTTP timeout in seconds. Default: 30.",
    )
    parser.add_argument(
        "--download",
        nargs="?",
        choices=["first", "all"],
        const="all",
        default="",
        help="Download matched source files instead of only returning search results. Use 'first' or 'all'.",
    )
    parser.add_argument(
        "--download-index",
        type=int,
        action="append",
        default=[],
        help="Download the 1-based result index. Can be provided multiple times.",
    )
    parser.add_argument(
        "--download-dir",
        default=str(Path.cwd().resolve()),
        help="Directory for downloaded files. Default: current project directory.",
    )
    parser.add_argument(
        "--download-timeout",
        type=int,
        default=60,
        help="File download timeout in seconds. Default: 60.",
    )
    return parser


def normalize_limit(limit):
    if limit < 1:
        return 1
    if limit > 20:
        return 20
    return limit


def build_agenttool_request(args):
    body = {
        "query": args.query,
        "scene": "gaokao",
        "limit": normalize_limit(args.limit),
    }
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {args.token}",
    }
    return body, headers, int(time.time())


@contextlib.contextmanager
def temporary_resolve(resolve_rule):
    if not resolve_rule:
        yield
        return

    parts = resolve_rule.rsplit(":", 2)
    if len(parts) != 3:
        error_out("INVALID_RESOLVE", "--resolve 必须使用 host:port:ip 格式。")

    resolve_host, resolve_port, resolve_ip = parts
    try:
        resolve_port = int(resolve_port)
    except ValueError:
        error_out("INVALID_RESOLVE", "--resolve 的端口必须是数字。")

    original_getaddrinfo = socket.getaddrinfo

    def patched_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
        if host == resolve_host and int(port) == resolve_port:
            return original_getaddrinfo(resolve_ip, port, family, type, proto, flags)
        return original_getaddrinfo(host, port, family, type, proto, flags)

    socket.getaddrinfo = patched_getaddrinfo
    try:
        yield
    finally:
        socket.getaddrinfo = original_getaddrinfo


def post_json(endpoint, body, headers, timeout, resolve_rule=""):
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(endpoint, data=data, headers=headers, method="POST")
    try:
        with temporary_resolve(resolve_rule):
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read().decode("utf-8")
                return resp.status, json.loads(raw), raw
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = {"raw": raw}
        return exc.code, parsed, raw
    except urllib.error.URLError as exc:
        error_out("CONNECTION_ERROR", "检索服务连接失败。", detail=str(exc.reason))
    except TimeoutError:
        error_out("TIMEOUT", "检索服务请求超时。")
    except json.JSONDecodeError:
        error_out("INVALID_RESPONSE", "检索服务返回了非 JSON 响应。")


def displayable_url(url):
    return ""


def make_chunk_payload(*, title, abstract, url, content, score, resource_id, chunk_id,
                       chunk_index, source, publish_time):
    return {
        "title": title or "",
        "abstract": abstract or "",
        "url": displayable_url(url),
        "content": content or "",
        "score": score,
        "resource_id": resource_id or "",
        "chunk_id": chunk_id or "",
        "chunk_index": chunk_index,
        "source": source,
        "publish_time": publish_time or "",
        "download_available": bool(url),
        "_download_url": url or "",
    }


def format_agenttool_chunks(chunks):
    formatted = []
    for item in chunks:
        if not isinstance(item, dict):
            continue
        score = item.get("score", 0)
        try:
            score = float(score)
        except (TypeError, ValueError):
            score = 0.0
        formatted.append(make_chunk_payload(
            title=item.get("chunk_title") or item.get("title") or "",
            abstract=item.get("chunk_abstract") or item.get("abstract") or "",
            url=item.get("chunk_url") or item.get("url") or "",
            content=item.get("content") or "",
            score=score,
            resource_id=item.get("resource_id") or "",
            chunk_id=item.get("chunk_id") or "",
            chunk_index=item.get("chunk_index"),
            source=item.get("source"),
            publish_time=item.get("publish_time", ""),
        ))
    return sorted(formatted, key=lambda x: x["score"], reverse=True)


def sanitize_filename(name):
    cleaned = "".join("_" if ch in '<>:"/\\|?*\r\n\t' else ch for ch in name).strip(" .")
    if not cleaned:
        return "gaokao-document"
    reserved = {
        "CON", "PRN", "AUX", "NUL",
        "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
        "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    }
    if cleaned.upper() in reserved:
        cleaned = f"{cleaned}_file"
    return cleaned[:180]


def filename_from_url(url):
    parsed = urllib.parse.urlparse(url)
    name = Path(urllib.parse.unquote(parsed.path)).name
    return name or ""


def filename_from_headers(headers):
    disposition = headers.get("Content-Disposition", "")
    if not disposition:
        return ""
    params = {}
    for part in disposition.split(";")[1:]:
        if "=" not in part:
            continue
        key, value = part.split("=", 1)
        params[key.strip().lower()] = value.strip().strip('"')
    filename = params.get("filename*") or params.get("filename") or ""
    if filename and "''" in filename:
        filename = filename.split("''", 1)[1]
    return urllib.parse.unquote(filename or "")


def unique_path(path):
    if not path.exists():
        return path
    stem = path.stem
    suffix = path.suffix
    for i in range(2, 1000):
        candidate = path.with_name(f"{stem} ({i}){suffix}")
        if not candidate.exists():
            return candidate
    return path.with_name(f"{stem} ({int(time.time())}){suffix}")


def ensure_extension(path, content_type):
    if path.suffix:
        return path
    extension = ".pdf" if "application/pdf" in content_type else mimetypes.guess_extension(content_type.split(";", 1)[0].strip())
    if not extension:
        extension = ".bin"
    return path.with_suffix(extension)


def download_file(url, title, output_dir, timeout):
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "WorkBuddy-GaokaoAdvisor/1.0"},
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        content_type = resp.headers.get("Content-Type", "")
        header_name = filename_from_headers(resp.headers)
        preferred_name = title or header_name or filename_from_url(url) or "gaokao-document"
        output_path = Path(output_dir) / sanitize_filename(preferred_name)
        output_path = ensure_extension(output_path, content_type)
        output_path = unique_path(output_path)
        with open(output_path, "wb") as file:
            file.write(resp.read())
    return output_path


def selected_download_indexes(args, total):
    explicit = sorted({idx for idx in args.download_index if idx > 0})
    if explicit:
        return [idx for idx in explicit if idx <= total]
    if args.download == "first":
        return [1] if total else []
    if args.download == "all":
        return list(range(1, total + 1))
    return []


def download_chunks(chunks, args):
    indexes = selected_download_indexes(args, len(chunks))
    if not indexes:
        return []
    output_dir = Path(args.download_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    downloads = []
    seen_urls = set()
    for index in indexes:
        chunk = chunks[index - 1]
        url = chunk.get("_download_url", "")
        result = {
            "index": index,
            "title": chunk.get("title", ""),
            "ok": False,
        }
        if not url:
            result.update({"error": "NO_DOWNLOAD_URL", "message": "该结果没有可下载文件地址。"})
            downloads.append(result)
            continue
        if url in seen_urls:
            result.update({"error": "DUPLICATE_URL", "message": "该文件已在本次调用中下载过。"})
            downloads.append(result)
            continue
        seen_urls.add(url)
        try:
            path = download_file(url, chunk.get("title", ""), output_dir, args.download_timeout)
            result.update({
                "ok": True,
                "file": str(path),
                "local_path": str(path),
                "message": f"资料已下载，请在右侧栏的“产物”中查看。本地路径：{path}",
                "artifact_hint": "请在右侧栏的“产物”中查看。",
            })
        except urllib.error.HTTPError as exc:
            result.update({"error": "DOWNLOAD_HTTP_ERROR", "message": f"下载失败：HTTP {exc.code}。"})
        except urllib.error.URLError as exc:
            result.update({"error": "DOWNLOAD_CONNECTION_ERROR", "message": f"下载连接失败：{exc.reason}。"})
        except TimeoutError:
            result.update({"error": "DOWNLOAD_TIMEOUT", "message": "下载请求超时。"})
        except OSError as exc:
            result.update({"error": "DOWNLOAD_FILE_ERROR", "message": f"写入文件失败：{exc}。"})
        downloads.append(result)
    return downloads


def public_chunk(chunk, index):
    payload = {key: value for key, value in chunk.items() if not key.startswith("_")}
    payload["download_index"] = index
    return payload


def main():
    parser = build_parser()
    args = parser.parse_args()

    query = args.query.strip()
    if not query:
        error_out("INVALID_QUERY", "检索 query 不能为空。")

    args.query = query
    endpoint = args.endpoint
    if not args.token:
        error_out(
            "TOKEN_NOT_CONFIGURED",
            "gaokao-search 只支持 AgentTool 模式，需要本次调用新获取的 Bearer token。请先调用 connect_cloud_service，优先使用 tempToken；如果没有 tempToken，再使用 token，并通过 --token 传入。",
            endpoint=endpoint,
        )
    body, headers, timestamp = build_agenttool_request(args)

    status, data, _raw = post_json(endpoint, body, headers, args.timeout, args.resolve)

    if status != 200:
        message = str(data.get("msg") or data.get("message") or data.get("raw") or "")
        if status == 429 or "daily search limit exceeded" in message:
            error_out(
                "DAILY_LIMIT_EXCEEDED",
                "高考知识库检索今日配额已用尽。请先复用本轮已返回结果；如仍需补充证据，请明天再试或改查官方渠道。",
                upstream_status=status,
                upstream_response=data,
                endpoint=endpoint,
            )
        error_out(
            "SEARCH_FAILED",
            f"检索服务 HTTP {status}。",
            upstream_status=status,
            upstream_response=data,
            endpoint=endpoint,
        )

    code = data.get("code")
    message = str(data.get("msg") or data.get("message") or data.get("raw") or "")
    if code == 14003 or "daily search limit exceeded" in message:
        error_out(
            "DAILY_LIMIT_EXCEEDED",
            "高考知识库检索今日配额已用尽。请先复用本轮已返回结果；如仍需补充证据，请明天再试或改查官方渠道。",
            upstream_response=data,
            endpoint=endpoint,
        )

    if code not in (None, 0):
        error_out(
            "SEARCH_FAILED",
            f"检索服务返回 code={code}。",
            upstream_response=data,
            endpoint=endpoint,
        )

    chunks = format_agenttool_chunks(data.get("chunks") or [])
    upstream_format = "agenttool_chunks"

    downloads = download_chunks(chunks, args)
    download_root = str(Path(args.download_dir).expanduser().resolve())
    public_chunks = [public_chunk(chunk, index) for index, chunk in enumerate(chunks, start=1)]

    output = {
        "ok": True,
        "query": query,
        "total": len(chunks),
        "retrieval_status": "hit" if chunks else "empty",
        "chunks": public_chunks,
        "downloads": downloads,
        "download_root": download_root,
        "source_note": (
            "All chunks are extracted from the search API response. Empty result means no supported evidence was returned. "
            "Document URLs are intentionally hidden from display; use download_index with --download-index to download after user confirmation."
        ),
        "download_policy": {
            "user_display": "Show result titles, summaries and download indexes only. Do not show document URLs to users.",
            "clear_target": "If one returned result clearly matches the user's requested document, run this script with --download-index N.",
            "unclear_target": "If multiple plausible documents are returned, ask the user to confirm the result by download_index, then download it.",
            "after_download": "Tell the user the file is available in the artifacts panel and include downloads[].local_path.",
        },
        "request": {
            "mode": "agenttool",
            "effective_mode": "agenttool",
            "endpoint": endpoint,
            "limit": body.get("limit"),
            "scene": body.get("scene"),
            "upstream_format": upstream_format,
            "timestamp": timestamp,
        },
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
