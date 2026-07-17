#!/usr/bin/env python3
"""上传图片/视频到 OSS：POST /openapi/upload（multipart/form-data）"""

import argparse
import json
import mimetypes
import os
import sys
import uuid
import urllib.request
import urllib.error

sys.path.insert(0, os.path.dirname(__file__))
from _common import IM_BASE, ACCESS_KEY

# 允许的 MIME 类型前缀
ALLOWED_PREFIXES = ("image/", "video/")


def upload_file(file_path: str) -> dict:
    """
    上传本地文件到 agent-im OSS。
    返回 data: { url }。
    """
    if not os.path.isfile(file_path):
        print(f"错误：文件不存在: {file_path}", file=sys.stderr)
        sys.exit(1)

    # 检查 MIME 类型
    mime_type, _ = mimetypes.guess_type(file_path)
    if mime_type and not any(mime_type.startswith(p) for p in ALLOWED_PREFIXES):
        print(f"错误：不支持的文件类型: {mime_type}，仅支持图片和视频", file=sys.stderr)
        sys.exit(1)

    # 构建 multipart/form-data 请求体
    boundary = f"----PythonUpload{uuid.uuid4().hex}"
    filename = os.path.basename(file_path)

    body_parts = []

    # accessKey 字段
    body_parts.append(f"--{boundary}\r\n".encode())
    body_parts.append(b'Content-Disposition: form-data; name="accessKey"\r\n\r\n')
    body_parts.append(f"{ACCESS_KEY}\r\n".encode())

    # file 字段
    content_type = mime_type or "application/octet-stream"
    body_parts.append(f"--{boundary}\r\n".encode())
    body_parts.append(
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'.encode()
    )
    body_parts.append(f"Content-Type: {content_type}\r\n\r\n".encode())
    with open(file_path, "rb") as f:
        body_parts.append(f.read())
    body_parts.append(b"\r\n")

    # 结束边界
    body_parts.append(f"--{boundary}--\r\n".encode())

    data = b"".join(body_parts)

    url = f"{IM_BASE.rstrip('/')}/openapi/upload"
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Authorization": f"Bearer {ACCESS_KEY}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            return result.get("data", {})
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8") if e.fp else ""
        print(f"API 错误 {e.code}: {err_body}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"网络错误: {e.reason}", file=sys.stderr)
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(
        description="上传图片或视频文件到 OSS",
        epilog="""
环境变量:
  LIBTV_ACCESS_KEY  必填，Bearer 鉴权
  OPENAPI_IM_BASE 或 IM_BASE_URL  可选，默认 https://im.liblib.tv

示例:
  # 上传图片
  python3 upload_file.py /path/to/image.png

  # 上传视频
  python3 upload_file.py /path/to/video.mp4
        """,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "file",
        help="要上传的图片或视频文件路径",
    )
    args = parser.parse_args()

    data = upload_file(args.file)
    oss_url = data.get("url", "")

    if not oss_url:
        print("错误：未返回 OSS 地址", file=sys.stderr)
        sys.exit(1)

    out = {"url": oss_url}
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
