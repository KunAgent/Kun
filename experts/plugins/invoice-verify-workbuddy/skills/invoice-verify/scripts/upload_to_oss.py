#!/usr/bin/env python3
"""
百望 OCR 文件上传 + 调用封装

流程：本地图片/PDF → 上传到阿里云 OSS → 拿到公共读 URL → 调用 baiwang.ocr.stand.tickets OCR 接口

用法：
    # 上传文件并调用 OCR
    python upload_to_oss.py /path/to/invoice.jpg

    # 指定 serviceMode 和 serviceMold
    python upload_to_oss.py /path/to/invoice.jpg --service-mode 0 --service-mold 1

    # 仅上传文件，不调用 OCR（打印 URL 后退出）
    python upload_to_oss.py /path/to/invoice.jpg --upload-only
"""
import uuid
import argparse
import base64
import hashlib
import hmac
import json
import mimetypes
import os
import ssl
import sys
import time
import urllib.parse
from email.utils import formatdate
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError


def load_env_file():
    """从技能目录及父目录查找并加载 .env 文件。优先加载技能根目录的 .env（随专家包交付）。"""
    search_dirs = [
        _find_skill_root(),   # 技能根目录（优先，随专家包交付）
        Path(__file__).parent,  # scripts 目录
        Path.cwd(),             # 当前工作目录
    ]
    for directory in search_dirs:
        env_file = directory / ".env"
        if env_file.exists():
            with open(env_file, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, _, value = line.partition("=")
                    key = key.strip()
                    value = value.strip().strip('"').strip("'")
                    if key and key not in os.environ:
                        os.environ[key] = value
            print(f"  已从 {env_file} 加载环境变量", file=sys.stderr)
            break


def _find_skill_root():
    """定位专家包根目录。

    优先使用 SKILL_ROOT_DIR 环境变量（适用于子 agent 沙箱/工作区场景，
    __file__ 被复制到临时目录时仍可正确定位）。
    兜底：从 __file__ 往上走四级推导。
    """
    env_root = os.environ.get("SKILL_ROOT_DIR", "").strip()
    if env_root and Path(env_root).is_dir():
        return Path(env_root)
    return Path(__file__).parent.parent.parent.parent


def _load_oss_config():
    """从 mcp-config.json 的 oss 节读取阿里云 OSS 配置。

    mcp-config.json 中 oss 节格式：
    {
      "oss": {
        "accessKey": "...",
        "secretKey": "...",
        "bucketName": "...",
        "endpoint": "https://oss-cn-beijing.aliyuncs.com",
        "bucketDomain": "bw-invoice-workbuddy.oss-cn-beijing.aliyuncs.com",
        "prefix": "invoice-uploads"
      }
    }

    环境变量优先级更高：OSS_ACCESS_KEY 等环境变量可覆盖 mcp-config.json 中的值。
    """
    config_path = _find_skill_root() / "mcp-config.json"
    oss_cfg = {}

    if config_path.exists():
        try:
            with open(config_path, encoding="utf-8") as f:
                config = json.load(f)
            oss_cfg = config.get("oss", {})
            if oss_cfg:
                print("  已从 mcp-config.json 加载 OSS 配置", file=sys.stderr)
        except (json.JSONDecodeError, OSError) as exc:
            print(f"  mcp-config.json 读取失败：{exc}", file=sys.stderr)

    return {
        "access_key": os.environ.get("OSS_ACCESS_KEY", oss_cfg.get("accessKey", "")),
        "secret_key": os.environ.get("OSS_SECRET_KEY", oss_cfg.get("secretKey", "")),
        "bucket_name": os.environ.get("OSS_BUCKET_NAME", oss_cfg.get("bucketName", "")),
        "bucket_domain": os.environ.get("OSS_BUCKET_DOMAIN", oss_cfg.get("bucketDomain", "")),
        "endpoint": os.environ.get("OSS_ENDPOINT", oss_cfg.get("endpoint", "https://oss-cn-beijing.aliyuncs.com")),
        "prefix": os.environ.get("OSS_PREFIX", oss_cfg.get("prefix", "invoice-uploads")),
    }


def _load_mcp_urls():
    """从 mcp-config.json 加载 MCP URL 到环境变量。"""
    config_path = _find_skill_root() / "mcp-config.json"
    if config_path.exists():
        try:
            with open(config_path, encoding="utf-8") as f:
                config = json.load(f)
            for key, value in config.items():
                if isinstance(value, dict) and "url" in value:
                    url = value["url"]
                    if url and key not in os.environ:
                        os.environ[key] = url
        except (json.JSONDecodeError, OSError):
            pass


# ─── 启动时加载配置 ──────────────────────────────────────────
load_env_file()
_oss_config = _load_oss_config()
_load_mcp_urls()

OSS_ACCESS_KEY = _oss_config["access_key"]
OSS_SECRET_KEY = _oss_config["secret_key"]
OSS_BUCKET_NAME = _oss_config["bucket_name"]
OSS_BUCKET_DOMAIN = _oss_config["bucket_domain"]
OSS_ENDPOINT = _oss_config["endpoint"]
OSS_PREFIX = _oss_config["prefix"]

# ─── MCP 配置 ─────────────────────────────────────────────
OCR_URL = os.environ.get("BAIWANG_OCR_STANDARD_URL", "")


def _check_oss_config():
    """检查 OSS 必填配置项是否完整，返回缺失项列表。"""
    missing = []
    if not OSS_ACCESS_KEY:
        missing.append("OSS_ACCESS_KEY")
    if not OSS_SECRET_KEY:
        missing.append("OSS_SECRET_KEY")
    if not OSS_BUCKET_NAME:
        missing.append("OSS_BUCKET_NAME")
    if not OSS_BUCKET_DOMAIN:
        missing.append("OSS_BUCKET_DOMAIN")
    return missing


def _upload_to_oss_raw(file_path: Path, object_key: str) -> int:
    """上传文件到 OSS，返回 HTTP 状态码。纯 stdlib 实现，不依赖 oss2 SDK。

    使用三级域名格式: {bucket}.{region}.aliyuncs.com/{key}
    """
    data = file_path.read_bytes()
    content_md5 = base64.b64encode(hashlib.md5(data).digest()).decode()

    content_type, _ = mimetypes.guess_type(str(file_path))
    if content_type is None:
        content_type = "application/octet-stream"

    # OSS 三级域名: bucket.host/object_key
    parsed = urllib.parse.urlparse(OSS_ENDPOINT)
    host = parsed.netloc
    bucket_host = f"{OSS_BUCKET_NAME}.{host}"
    url = f"https://{bucket_host}/{object_key}"

    # 签名 canonicalized resource: 必须带 bucket 前缀 /{bucket}/{key}
    canonicalized_resource = f"/{OSS_BUCKET_NAME}/{object_key}"
    date_str = formatdate(usegmt=True)
    string_to_sign = (
        f"PUT\n{content_md5}\n{content_type}\n{date_str}\n{canonicalized_resource}"
    )
    signature = base64.b64encode(
        hmac.new(OSS_SECRET_KEY.encode(), string_to_sign.encode(), hashlib.sha1).digest()
    ).decode()

    req = Request(
        url,
        data=data,
        headers={
            "Authorization": f"OSS {OSS_ACCESS_KEY}:{signature}",
            "Date": date_str,
            "Content-Type": content_type,
            "Content-MD5": content_md5,
            "Host": bucket_host,
        },
        method="PUT",
    )

    ssl_ctx = ssl.create_default_context()
    ssl_ctx.check_hostname = False
    ssl_ctx.verify_mode = ssl.CERT_NONE

    with urlopen(req, timeout=120, context=ssl_ctx) as resp:
        return resp.status


def upload_to_oss(file_path: str) -> str:
    """上传本地文件到阿里云 OSS，返回公共读 URL（bucket 设为公共读，URL 永久有效）。

    Args:
        file_path: 本地文件路径（绝对路径或相对路径）

    Returns:
        上传成功返回公共读 URL，失败返回 None。
    """
    file_path = Path(file_path).resolve()
    if not file_path.exists():
        print(f"  文件不存在: {file_path}", file=sys.stderr)
        return None
    if not file_path.is_file():
        print(f"  不是有效文件: {file_path}", file=sys.stderr)
        return None

    allowed_ext = {".jpg", ".jpeg", ".png", ".bmp", ".pdf"}
    if file_path.suffix.lower() not in allowed_ext:
        print(f"  不支持的文件格式: {file_path.suffix}，图片/PDF 支持: {allowed_ext}", file=sys.stderr)
        print("  OFD/XML 请使用 scripts/recogcollect_file.py 走影像识别采集 MCP", file=sys.stderr)
        return None

    max_size = 8 * 1024 * 1024
    if file_path.stat().st_size > max_size:
        size_mb = file_path.stat().st_size / (1024 * 1024)
        print(f"  文件过大: {size_mb:.1f}MB，上限 8MB", file=sys.stderr)
        return None

    missing = _check_oss_config()
    if missing:
        print(f"  OSS 配置缺失: {', '.join(missing)}", file=sys.stderr)
        return None

    try:
        date_str = time.strftime("%Y%m%d")
        ts = f"{int(time.time())}_{uuid.uuid4().hex[:8]}"

        # 中文文件名转 ASCII 临时路径，避免 URL 编码问题
        safe_name = file_path.name.encode("ascii", errors="replace").decode("ascii")
        # 替换非 ASCII 字符为时间戳后缀
        if safe_name != file_path.name:
            ext = file_path.suffix or ".dat"
            safe_name = f"file_{ts}{ext}"

        object_key = f"{OSS_PREFIX}/{date_str}/{ts}_{safe_name}"
        status = _upload_to_oss_raw(file_path, object_key)

        if status < 300:
            public_url = f"https://{OSS_BUCKET_DOMAIN}/{object_key}"
            print(f"  上传成功，公共读 URL（永久有效）")
            return public_url
        else:
            print(f"  OSS 上传失败: HTTP {status}", file=sys.stderr)
            return None

    except Exception as exc:
        print(f"  OSS 上传异常: {exc}", file=sys.stderr)
        return None


def call_ocr(server_url: str, file_url: str, service_mode: str = "0", service_mold: str = "1") -> bool:
    """调用百望 OCR 接口。

    Args:
        server_url: MCP 服务 URL（百望云格式）
        file_url: 文件公共读 URL（OSS 上传后的 URL）
        service_mode: 服务模式，默认 "0"
        service_mold: 服务模板，默认 "1"

    Returns:
        成功返回 True，失败返回 False。
    """
    params = {
        "fileUrl": file_url,
        "serviceMode": service_mode,
        "serviceMold": service_mold,
    }

    method = "baiwang.ocr.stand.tickets"

    parsed = urllib.parse.urlparse(server_url)
    qs = urllib.parse.parse_qs(parsed.query)
    qs["method"] = [method]
    new_query = urllib.parse.urlencode(qs, doseq=True)
    request_url = urllib.parse.urlunparse((
        parsed.scheme, parsed.netloc, parsed.path,
        parsed.params, new_query, parsed.fragment
    ))

    data = json.dumps(params).encode("utf-8")

    # 打印入参（脱敏）
    print(f"[OCR] 请求 URL: {request_url[:80]}...")
    print(f"[OCR] 请求参数: {json.dumps(params, ensure_ascii=False)}")

    req = Request(
        request_url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        ssl_ctx = ssl.create_default_context()
        ssl_ctx.check_hostname = False
        ssl_ctx.verify_mode = ssl.CERT_NONE
        with urlopen(req, timeout=120, context=ssl_ctx) as response:
            raw = response.read().decode("utf-8")
            result = json.loads(raw)

            # 打印完整反参
            print(f"[OCR] 响应: {raw}")

            if result.get("success"):
                print("\nOCR 调用成功：")
                # 实际格式: {"success": true, "response": [/* array */]}
                resp = result.get("response", {})
                # response 可能是列表（百望新格式）或字典（旧格式）
                if isinstance(resp, list):
                    # 取第一个结果
                    ocr_data = resp[0] if resp else {}
                elif isinstance(resp, dict):
                    ocr_data = resp.get("data", resp)
                else:
                    ocr_data = {}
                print(json.dumps(ocr_data, ensure_ascii=False, indent=2))
                return True
            else:
                # 错误响应可能在顶层或 response 下
                err = result.get("errorResponse") or result.get("response", {}).get("errorResponse", {})
                print(f"\nOCR 调用失败：[{err.get('code')}] {err.get('message')} (subCode={err.get('subCode')})")
                return False

    except HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"\nHTTP {e.code}: {body}")
        return False
    except URLError as e:
        print(f"\n网络错误: {e.reason}")
        return False
    except Exception as e:
        print(f"\n调用异常: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="上传文件到阿里云 OSS 并调用百望 OCR 接口")
    parser.add_argument("file_path", help="本地发票文件路径（图片/PDF）")
    parser.add_argument("--service-mode", default="0", help="服务模式（默认 0）")
    parser.add_argument("--service-mold", default="1", help="服务模板（默认 1）")
    parser.add_argument("--upload-only", action="store_true", help="仅上传文件到 OSS，不调用 OCR")

    args = parser.parse_args()

    print(f"文件路径: {args.file_path}")
    print(f"OSS Bucket: {OSS_BUCKET_NAME}")
    print()

    print("[Step 1] 上传文件到阿里云 OSS...")
    public_url = upload_to_oss(args.file_path)
    if not public_url:
        print("  上传失败，终止执行", file=sys.stderr)
        sys.exit(1)
    print(f"  公共读 URL: {public_url}")

    if args.upload_only:
        print(f"\n上传完成，URL: {public_url}")
        return

    print("\n[Step 2] 调用百望 OCR 接口...")
    if not OCR_URL:
        print("  环境变量 BAIWANG_OCR_STANDARD_URL 未设置，无法调用 OCR", file=sys.stderr)
        sys.exit(1)
    print(f"  服务 URL: {OCR_URL[:60]}...")

    success = call_ocr(OCR_URL, public_url, args.service_mode, args.service_mold)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
