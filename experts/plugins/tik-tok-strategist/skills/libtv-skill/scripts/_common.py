"""agent-im OpenAPI 公共模块：创建会话、查询会话（鉴权为 Authorization: Bearer <access_key>）"""

import json
import os
import sys
import urllib.request
import urllib.error

# 默认 im 环境
IM_BASE = os.environ.get("OPENAPI_IM_BASE", os.environ.get("IM_BASE_URL", "https://im.liblib.tv"))
ACCESS_KEY = os.environ.get("LIBTV_ACCESS_KEY", "")

# 项目画布地址前缀，拼上 projectId 即项目地址
PROJECT_CANVAS_BASE = "https://www.liblib.tv/canvas?projectId="


def build_project_url(project_id: str) -> str:
    """根据 projectId（即 projectUuid）拼接项目画布地址"""
    if not project_id:
        return ""
    return PROJECT_CANVAS_BASE + project_id.strip()

if not ACCESS_KEY:
    print("错误：请设置 LIBTV_ACCESS_KEY 环境变量", file=sys.stderr)
    sys.exit(1)


def _headers():
    return {
        "Authorization": f"Bearer {ACCESS_KEY}",
        "Content-Type": "application/json",
    }


def api_post(path: str, body: dict) -> dict:
    """POST 请求 agent-im OpenAPI"""
    url = f"{IM_BASE.rstrip('/')}{path}"
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers=_headers(),
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8") if e.fp else ""
        print(f"API 错误 {e.code}: {err_body}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"网络错误: {e.reason}", file=sys.stderr)
        sys.exit(1)


def api_get(path: str) -> dict:
    """GET 请求 agent-im OpenAPI"""
    url = f"{IM_BASE.rstrip('/')}{path}"
    req = urllib.request.Request(url, method="GET", headers=_headers())
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8") if e.fp else ""
        print(f"API 错误 {e.code}: {err_body}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"网络错误: {e.reason}", file=sys.stderr)
        sys.exit(1)


def create_session(session_id: str = "", message: str = "") -> dict:
    """
    创建会话或向已有会话发消息。
    返回 data: { projectUuid, sessionId }。
    """
    body = {}
    if session_id:
        body["sessionId"] = session_id
    if message:
        body["message"] = message
    resp = api_post("/openapi/session", body)
    return resp.get("data", {})


def query_session(session_id: str, after_seq: int = 0) -> dict:
    """
    查询会话消息列表。
    返回 data: { messages: [...] }。
    """
    path = f"/openapi/session/{session_id}"
    if after_seq > 0:
        path += f"?afterSeq={after_seq}"
    resp = api_get(path)
    return resp.get("data", {})


def change_project() -> dict:
    """
    切换当前 accessKey 绑定的项目（调用 libtv 切换项目，后续 create_session 将使用新项目）。
    返回 data: { projectUuid }。
    """
    resp = api_post("/openapi/session/change-project", {})
    return resp.get("data", {})
