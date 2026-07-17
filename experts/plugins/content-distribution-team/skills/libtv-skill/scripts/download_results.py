#!/usr/bin/env python3
"""下载生成结果：从会话中提取所有图片/视频 URL 并批量下载到本地"""

import argparse
import json
import os
import re
import sys
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.dirname(__file__))
from _common import query_session


def extract_urls_from_messages(messages):
    """从会话消息中提取所有图片和视频结果 URL"""
    urls = []
    url_pattern = re.compile(r'https://libtv-res\.liblib\.art/[^\s"\'<>]+\.(?:png|jpg|jpeg|webp|mp4|mov|webm)')

    for msg in messages:
        content = msg.get("content", "")
        if not content or not isinstance(content, str):
            continue

        # 从 task_result 中提取（toolmsg 返回的结果）
        if msg.get("role") == "tool":
            try:
                data = json.loads(content)
                task_result = data.get("task_result", {})
                for img in task_result.get("images", []):
                    preview = img.get("previewPath", "")
                    if preview:
                        urls.append(preview)
                for vid in task_result.get("videos", []):
                    preview = vid.get("previewPath", vid.get("url", ""))
                    if preview:
                        urls.append(preview)
            except (json.JSONDecodeError, AttributeError):
                pass

        # 从 assistant 文本消息中提取 URL
        if msg.get("role") == "assistant":
            found = url_pattern.findall(content)
            urls.extend(found)

    # 去重保序
    seen = set()
    unique = []
    for u in urls:
        if u not in seen:
            seen.add(u)
            unique.append(u)
    return unique


def download_file(url, filepath):
    """下载单个文件"""
    req = urllib.request.Request(url, headers={"User-Agent": "LibTV-Skill/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            with open(filepath, "wb") as f:
                while True:
                    chunk = resp.read(8192)
                    if not chunk:
                        break
                    f.write(chunk)
        return filepath, None
    except Exception as e:
        return filepath, str(e)


def main():
    parser = argparse.ArgumentParser(
        description="下载会话中生成的图片/视频到本地",
        epilog="""
使用方式:
  # 从会话自动提取并下载所有结果
  python3 download_results.py SESSION_ID

  # 指定输出目录
  python3 download_results.py SESSION_ID --output-dir ~/Desktop/my_project

  # 指定文件名前缀
  python3 download_results.py SESSION_ID --prefix "storyboard"

  # 直接下载指定 URL 列表
  python3 download_results.py --urls URL1 URL2 URL3 --output-dir ./output
        """,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("session_id", nargs="?", default="", help="会话 ID，自动提取该会话所有生成结果的 URL")
    parser.add_argument("--urls", nargs="+", default=[], help="直接指定要下载的 URL 列表（不需要 session_id）")
    parser.add_argument("--output-dir", default="", help="输出目录（默认 ~/Downloads/libtv_results/）")
    parser.add_argument("--prefix", default="", help="文件名前缀（如 'storyboard' → storyboard_01.png）")
    parser.add_argument("--workers", type=int, default=5, help="并行下载线程数（默认 5）")
    args = parser.parse_args()

    # 收集 URL
    urls = list(args.urls)
    if args.session_id:
        data = query_session(args.session_id)
        messages = data.get("messages", [])
        extracted = extract_urls_from_messages(messages)
        urls.extend(extracted)

    if not urls:
        print(json.dumps({"error": "未找到可下载的图片/视频 URL", "downloaded": []}, ensure_ascii=False, indent=2))
        sys.exit(1)

    # 准备输出目录
    output_dir = args.output_dir or os.path.expanduser("~/Downloads/libtv_results")
    os.makedirs(output_dir, exist_ok=True)

    # 构建下载任务
    tasks = []
    for i, url in enumerate(urls, 1):
        ext = os.path.splitext(url.split("?")[0])[-1] or ".png"
        if args.prefix:
            filename = f"{args.prefix}_{i:02d}{ext}"
        else:
            filename = f"{i:02d}{ext}"
        filepath = os.path.join(output_dir, filename)
        tasks.append((url, filepath))

    # 并行下载
    results = []
    errors = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(download_file, url, fp): (url, fp) for url, fp in tasks}
        for future in as_completed(futures):
            fp, err = future.result()
            if err:
                errors.append({"file": fp, "error": err})
            else:
                results.append(fp)

    # 按文件名排序输出
    results.sort()

    output = {
        "output_dir": output_dir,
        "downloaded": results,
        "total": len(results),
    }
    if errors:
        output["errors"] = errors

    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
