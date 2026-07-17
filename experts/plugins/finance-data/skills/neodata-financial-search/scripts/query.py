#!/usr/bin/env python3
"""NeoData 金融数据查询客户端（通过代理 API）

Usage:
    python query.py --query "腾讯最新财报"
    python query.py --query "贵州茅台股价" --data-type api
    python query.py --save-token "<token>"

鉴权优先级: --token 参数 > skills 目录下 .neodata_token 缓存文件（12 小时有效期）

环境变量 (可选):
    NEODATA_ENDPOINT - 代理 URL (可选，默认 https://copilot.tencent.com/agenttool/v1/neodata)
"""

import argparse
import json
import os
import stat
import sys
import time
from pathlib import Path
from typing import Optional

# Windows 控制台中文输出兼容：尽量让 stdout/stderr 走 UTF-8，避免 GBK 下乱码/报错
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except Exception:
        pass

# requests 为可选依赖：缺失时（如 Windows 内置 Python 未预装）先尝试自动安装修复，
# 安装失败再退化到标准库 urllib，保证任何环境下都能正常工作。
try:
    import requests  # type: ignore
except ImportError:
    requests = None


def _ensure_requests() -> bool:
    """缺失 requests 时尝试自动安装到当前解释器（自动环境修复）。

    - 仅在真正需要发起网络请求时调用，--save-token 等离线操作不触发。
    - 静默执行、带超时；失败时返回 False，由调用方退化到 urllib。
    """
    global requests
    if requests is not None:
        return True
    try:
        import subprocess
        import importlib
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "--quiet", "--disable-pip-version-check", "requests"],
            check=True,
            timeout=120,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        requests = importlib.import_module("requests")  # type: ignore
        return True
    except Exception:
        return False

DEFAULT_ENDPOINT = "https://copilot.tencent.com/agenttool/v1/neodata"
SKILLS_DIR = Path(__file__).resolve().parent.parent.parent  # ~/.workbuddy/skills/
TOKEN_FILE = SKILLS_DIR / ".neodata_token"
LEGACY_TOKEN_FILE = Path.home() / ".workbuddy" / ".neodata_token"
TOKEN_TTL_SECONDS = 12 * 3600  # 12 小时


def _migrate_legacy_token() -> None:
    """旧路径存在且新路径不存在时，自动迁移"""
    if LEGACY_TOKEN_FILE.exists() and not TOKEN_FILE.exists():
        try:
            TOKEN_FILE.write_text(LEGACY_TOKEN_FILE.read_text())
            TOKEN_FILE.chmod(stat.S_IRUSR | stat.S_IWUSR)
            LEGACY_TOKEN_FILE.unlink()
        except (PermissionError, OSError):
            pass


def _read_token_file() -> Optional[str]:
    """从缓存文件读取 token，超过 12 小时返回 None"""
    _migrate_legacy_token()
    try:
        raw = TOKEN_FILE.read_text().strip()
        if not raw:
            return None

        # 新格式: JSON {"token": "...", "saved_at": 1234567890}
        try:
            data = json.loads(raw)
            saved_at = data.get("saved_at", 0)
            token = data.get("token", "")
            if not token:
                return None
            # 检查是否过期
            if time.time() - saved_at > TOKEN_TTL_SECONDS:
                print("TOKEN_EXPIRED", file=sys.stderr)
                return None
            return token
        except (json.JSONDecodeError, TypeError):
            # 兼容旧格式: 纯文本 token（无时间戳，视为已过期）
            print("TOKEN_EXPIRED", file=sys.stderr)
            return None

    except FileNotFoundError:
        print("TOKEN_MISSING", file=sys.stderr)
        return None
    except PermissionError:
        print("TOKEN_MISSING", file=sys.stderr)
        return None


def _save_token_file(token: str) -> None:
    """将 token 和时间戳写入缓存文件（权限 600）"""
    TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
    data = {
        "token": token.strip(),
        "saved_at": int(time.time()),
    }
    TOKEN_FILE.write_text(json.dumps(data))
    TOKEN_FILE.chmod(stat.S_IRUSR | stat.S_IWUSR)
    # 清理旧路径
    if LEGACY_TOKEN_FILE.exists():
        try:
            LEGACY_TOKEN_FILE.unlink()
        except (PermissionError, OSError):
            pass


def query_neodata(
    query: str,
    data_type: str = "all",
    token: Optional[str] = None,
    endpoint: Optional[str] = None,
) -> dict:
    url = endpoint or os.getenv("NEODATA_ENDPOINT", DEFAULT_ENDPOINT)
    jwt_token = token or _read_token_file()
    if not jwt_token:
        sys.exit(1)

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {jwt_token}",
    }

    # channel 和 sub_channel 为固定字段，必须显式传入
    payload: dict = {
        "query": query,
        "channel": "neodata",
        "sub_channel": "workbuddy",
    }
    if data_type != "all":
        payload["data_type"] = data_type

    # 优先确保 requests 可用（缺失时自动安装修复），失败则退化到标准库 urllib
    if requests is None:
        _ensure_requests()

    if requests is not None:
        resp = requests.post(url, headers=headers, json=payload, timeout=30)
        resp.raise_for_status()
        return resp.json()

    # 退化路径：无 requests 且自动安装失败时使用标准库 urllib（功能等价）
    return _urllib_post(url, headers, payload)


def _urllib_post(url: str, headers: dict, payload: dict) -> dict:
    """标准库实现的 POST JSON，作为 requests 缺失时的退化方案。"""
    import urllib.request
    import urllib.error

    body = json.dumps(payload).encode("utf-8")
    req_headers = dict(headers)
    req = urllib.request.Request(url, data=body, headers=req_headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw)
    except urllib.error.HTTPError as e:
        # 与 requests.raise_for_status() 行为对齐：非 2xx 抛出异常
        detail = ""
        try:
            detail = e.read().decode("utf-8")
        except Exception:
            pass
        raise RuntimeError(f"HTTP {e.code} {e.reason}: {detail}") from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"请求失败: {e.reason}") from e


def main():
    parser = argparse.ArgumentParser(description="NeoData 金融数据查询")
    parser.add_argument("--query", "-q", default=None, help="自然语言查询")
    parser.add_argument("--token", "-t", default=None, help="Token（优先级高于缓存文件）")
    parser.add_argument("--data-type", "-d", default="all", choices=["all", "api", "doc"], help="数据类型 (默认: all)")
    parser.add_argument("--save-token", default=None, metavar="TOKEN", help="将 token 保存到缓存文件（12 小时有效期）")

    args = parser.parse_args()

    # --save-token 模式：保存后退出
    if args.save_token:
        _save_token_file(args.save_token)
        print(f"Token 已保存到 {TOKEN_FILE}（有效期 12 小时）")
        return

    if not args.query:
        parser.error("--query 或 --save-token 必须提供其一")

    try:
        result = query_neodata(
            query=args.query,
            data_type=args.data_type,
            token=args.token,
        )
    except Exception as e:
        # 兼容两条网络路径：requests.RequestException 与 urllib 退化路径的 RuntimeError
        print(f"请求失败: {e}", file=sys.stderr)
        sys.exit(1)

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
