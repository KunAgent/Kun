#!/usr/bin/env python3
"""
调用 knot 平台智能体的代理脚本。
通过 AG-UI 协议（SSE 流式）调用指定智能体，提取最终回答文本返回。

使用方式:
    python call_knot_agent.py --message "你的问题"
    python call_knot_agent.py --message "追问" --conversation-id "xxx"
    python call_knot_agent.py --message "批量询价..." --run-dir "./inquiry_runs/20260611_1730"
    python call_knot_agent.py --resume "./inquiry_runs/20260611_1730"

鉴权:
    默认走浏览器 OAuth：首次调用会自动弹出浏览器授权页，成功后 ticket 缓存到
    ~/.workbuddy/cpq/knot-ticket.json，有效期 24h，到期前自动续。

    单次"鉴权预热"（不发消息、只确保 ticket 有效）:
        python call_knot_agent.py --ensure-auth

环境变量（已 deprecated · 仅作历史兼容保留 · 文档不再要求设置）:
    KNOT_API_TOKEN: 旧式 API Token；设置后跳过浏览器授权，直接走 x-knot-api-token
    KNOT_API_USER:  调用者企微英文名；仅在 KNOT_API_TOKEN 模式下生效

进度信息:
    脚本会将进度信息输出到 stderr，确保调用方知道脚本仍在运行。
    最终结果以 JSON 形式输出到 stdout。
    传入 --run-dir / --output / --state-file / --log-file 时，会额外持久化状态、结果和日志。
"""

import argparse
import json
import os
import platform
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.parse
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

# requests 只在真正调用 knot 时懒加载，保证 --resume 只读查看不依赖网络库。

# ============================================================
# 常量配置
# ============================================================

AGENT_ID = "e1ff75c57eab4e0786a6b527275adbb5"
API_BASE = "https://knot.woa.com/apigw/api/v1/agents/agui"
API_URL = f"{API_BASE}/{AGENT_ID}"
DEFAULT_TIMEOUT = 1800  # 30 分钟，复杂查价可能耗时很长
DEFAULT_RUNS_DIR = Path.home() / ".workbuddy" / "inquiry-price-runs"

# 鉴权：TAI Ticket（通过 mcp.cpq.woa.com OAuth 获取）
AUTH_GATEWAY = "https://cpq.woa.com"
TICKET_CACHE_PATH = Path.home() / ".workbuddy" / "cpq" / "knot-ticket.json"
TICKET_TTL_SECONDS = 23 * 3600  # ticket 有效期 24h，提前 1h 刷新
AUTH_CALLBACK_PORT = 19876

# 进度输出间隔（秒）：每隔多久没收到文本事件就输出一次心跳
HEARTBEAT_INTERVAL = 15

# 连接中断重试配置
MAX_RETRIES = 2  # 最多重试 2 次（总共最多 3 次请求）
RETRY_DELAY = 3  # 重试前等待秒数

# 文件下载链接基础 URL
DOWNLOAD_BASE_URL = "https://knot.woa.com/api/v1/workspace/download_file"

_ACTIVE_RUN_STORE = None


# ============================================================
# 运行状态持久化
# ============================================================


def iso_now() -> str:
    """返回带本地时区的 ISO 时间戳。"""
    return datetime.now().astimezone().isoformat(timespec="seconds")


def make_run_id() -> str:
    """生成适合目录名的运行 ID。"""
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def atomic_write_json(path: Path, data: Dict[str, Any]) -> None:
    """原子写 JSON，避免进程中断造成半截文件。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_name(f"{path.name}.tmp.{os.getpid()}")
    with tmp_path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp_path, path)


class RunStore:
    """负责本次调用的 request/state/result/log 持久化。"""

    def __init__(
        self,
        run_dir: str = "",
        output_file: str = "",
        state_file: str = "",
        log_file: str = "",
        run_id: str = "",
    ):
        self.lock = threading.RLock()
        self.run_id = run_id or make_run_id()

        self.run_dir: Optional[Path] = Path(run_dir).expanduser() if run_dir else None
        if self.run_dir is None and run_id:
            self.run_dir = DEFAULT_RUNS_DIR / self.run_id

        if self.run_dir is not None:
            self.run_dir.mkdir(parents=True, exist_ok=True)
            if not run_id:
                self.run_id = self.run_dir.name or self.run_id

        self.output_file: Optional[Path] = Path(output_file).expanduser() if output_file else None
        self.state_file: Optional[Path] = Path(state_file).expanduser() if state_file else None
        self.log_file: Optional[Path] = Path(log_file).expanduser() if log_file else None
        self.request_file: Optional[Path] = None

        if self.run_dir is not None:
            self.output_file = self.output_file or (self.run_dir / "result.json")
            self.state_file = self.state_file or (self.run_dir / "state.json")
            self.log_file = self.log_file or (self.run_dir / "progress.log")
            self.request_file = self.run_dir / "request.json"

        if self.log_file:
            try:
                self.log_file.parent.mkdir(parents=True, exist_ok=True)
                self.log_file.touch(exist_ok=True)
            except Exception:
                pass

        self.state: Dict[str, Any] = {
            "run_id": self.run_id,
            "status": "initialized",
            "conversation_id": "",
            "started_at": iso_now(),
            "updated_at": iso_now(),
            "last_step": "",
            "tool_call_count": 0,
            "download_links_count": 0,
            "error": "",
        }
        self.update_state(status="initialized")

    def write_request(self, message: str, conversation_id: str, timeout: int) -> None:
        """保存本次请求元信息，不保存 token。"""
        if not self.request_file:
            return
        data = {
            "run_id": self.run_id,
            "created_at": iso_now(),
            "message": message,
            "conversation_id": conversation_id,
            "timeout": timeout,
        }
        try:
            atomic_write_json(self.request_file, data)
        except Exception:
            pass

    def update_state(self, **kwargs: Any) -> None:
        """更新并写入 state.json。"""
        with self.lock:
            self.state.update(kwargs)
            self.state["updated_at"] = iso_now()
            if not self.state_file:
                return
            try:
                atomic_write_json(self.state_file, self.state)
            except Exception:
                pass

    def append_log(self, msg: str) -> None:
        """追加写入 progress.log。"""
        if not self.log_file:
            return
        try:
            self.log_file.parent.mkdir(parents=True, exist_ok=True)
            with self.log_file.open("a", encoding="utf-8") as f:
                f.write(f"{iso_now()} [knot-agent] {msg}\n")
        except Exception:
            pass

    def write_result(self, result: Dict[str, Any], final_status: Optional[str] = None) -> None:
        """写入最终 result.json，并同步最终状态。"""
        if self.output_file:
            try:
                atomic_write_json(self.output_file, result)
            except Exception:
                pass

        status = final_status or ("success" if result.get("success") else "failed")
        self.update_state(
            status=status,
            conversation_id=result.get("conversation_id", self.state.get("conversation_id", "")),
            download_links_count=len(result.get("download_links", []) or []),
            error=result.get("error", ""),
        )

    def mark_interrupted(self, error: str = "进程被中断") -> None:
        """标记运行被中断，尽量保留已知 conversation_id。"""
        self.update_state(status="interrupted", error=error)
        self.append_log(error)


# ============================================================
# 进度输出
# ============================================================


def set_active_run_store(run_store: Optional[RunStore]) -> None:
    global _ACTIVE_RUN_STORE
    _ACTIVE_RUN_STORE = run_store


def progress(msg: str):
    """输出进度信息到 stderr，不影响 stdout 的 JSON 输出。"""
    print(f"[knot-agent] {msg}", file=sys.stderr, flush=True)
    if _ACTIVE_RUN_STORE is not None:
        _ACTIVE_RUN_STORE.append_log(msg)


class HeartbeatThread:
    """
    独立心跳线程：无论 iter_lines() 是否阻塞，每隔 HEARTBEAT_INTERVAL 秒
    都会向 stderr 输出一行心跳，确保调用方（IDE/CodeBuddy）知道进程还活着。
    """

    def __init__(self, interval: int = HEARTBEAT_INTERVAL):
        self.interval = interval
        self.start_time = time.time()
        self._stop_event = threading.Event()
        self._current_step = ""
        self._tool_call_count = 0
        self._lock = threading.Lock()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def start(self):
        self._thread.start()

    def stop(self):
        self._stop_event.set()

    def update_step(self, step: str):
        with self._lock:
            self._current_step = step

    def update_tool_count(self, count: int):
        with self._lock:
            self._tool_call_count = count

    def _run(self):
        while not self._stop_event.is_set():
            self._stop_event.wait(self.interval)
            if self._stop_event.is_set():
                break
            elapsed = int(time.time() - self.start_time)
            with self._lock:
                status = f"仍在运行... 已耗时 {elapsed}s"
                if self._current_step:
                    status += f" | 当前步骤: {self._current_step}"
                if self._tool_call_count > 0:
                    status += f" | 已调用 {self._tool_call_count} 个工具"
            progress(status)


# ============================================================
# 鉴权：TAI Ticket（借用 mcp.cpq.woa.com OAuth 流程）
# 所有 knot 鉴权方案参考：https://iwiki.woa.com/p/4016457374
# ============================================================


def get_local_ip() -> str:
    """获取本机出口 IP（固定、真实；不发送任何数据）。"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def load_cached_ticket() -> Optional[Dict[str, Any]]:
    """读取缓存的 ticket；若不存在或已过期返回 None。"""
    try:
        if not TICKET_CACHE_PATH.exists():
            return None
        data = json.loads(TICKET_CACHE_PATH.read_text(encoding="utf-8"))
        cached_at = data.get("cached_at", 0)
        if time.time() - cached_at < TICKET_TTL_SECONDS:
            return data
    except Exception:
        pass
    return None


def save_ticket(ticket: str, staffname: str, staffid: str) -> None:
    """将 ticket 写入缓存文件。"""
    TICKET_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    data = {
        "ticket": ticket,
        "staffname": staffname,
        "staffid": staffid,
        "cached_at": time.time(),
    }
    tmp = TICKET_CACHE_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, TICKET_CACHE_PATH)


def login_with_browser() -> Dict[str, str]:
    """
    发起浏览器 OAuth 授权流程，返回 {"ticket": ..., "staffname": ..., "staffid": ...}。

    TCP socket server 在后台线程运行，主线程打印 URL 后立即返回可见，
    等待 done 事件（可被 Ctrl+C / SIGINT 中断）。
    """
    # 沙箱环境可通过 KNOT_CALLBACK_URL 指定公网可达的回调地址
    # 例如：KNOT_CALLBACK_URL=https://<sandbox-id>-19876.e2b.dev/cb
    callback_url = os.environ.get("KNOT_CALLBACK_URL", "") or f"http://localhost:{AUTH_CALLBACK_PORT}/cb"
    local_redirect = urllib.parse.quote(callback_url, safe="")
    auth_url = f"{AUTH_GATEWAY}/_tai_auth/?local_redirect={local_redirect}"

    # 共享状态
    result: Dict[str, str] = {}
    done = threading.Event()
    exc_holder: list = []

    def _serve() -> None:
        srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            srv.bind(("0.0.0.0", AUTH_CALLBACK_PORT))
            srv.listen(5)
            srv.settimeout(2)  # 短超时，让循环能响应 done 事件

            while not done.is_set():
                try:
                    conn, _ = srv.accept()
                except socket.timeout:
                    continue

                with conn:
                    data = b""
                    conn.settimeout(10)
                    try:
                        while b"\r\n\r\n" not in data:
                            chunk = conn.recv(4096)
                            if not chunk:
                                break
                            data += chunk
                    except OSError:
                        pass

                    request_line = data.decode("utf-8", errors="replace").split("\r\n")[0]
                    path = request_line.split(" ")[1] if " " in request_line else "/"
                    parsed = urllib.parse.urlparse(path)
                    params = urllib.parse.parse_qs(parsed.query)
                    ticket    = params.get("ticket",    [""])[0]
                    staffname = params.get("staffname", [""])[0]
                    staffid   = params.get("staffid",   [""])[0]

                    # 始终回一个 200，让浏览器显示成功页面
                    body = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Knot 授权成功</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="min-h-screen flex items-center justify-center
             bg-gradient-to-br from-slate-50 to-slate-100
             dark:from-slate-900 dark:to-slate-800">
  <div class="rounded-2xl shadow-xl px-12 py-10 flex flex-col items-center gap-5 max-w-sm w-full mx-4
              bg-white border border-slate-200
              dark:bg-white/5 dark:backdrop-blur dark:border-white/10">
    <div class="w-16 h-16 rounded-full flex items-center justify-center
                bg-emerald-50 dark:bg-emerald-500/20">
      <svg class="w-8 h-8 text-emerald-500 dark:text-emerald-400"
           fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    </div>
    <div class="text-center">
      <p class="text-sm tracking-widest uppercase mb-1
                text-slate-400 dark:text-white/40">Knot</p>
      <h1 class="text-2xl font-semibold
                 text-slate-800 dark:text-white">授权成功</h1>
    </div>
    <p class="text-sm text-center leading-relaxed
              text-slate-500 dark:text-white/50">
      身份验证已完成，可以关闭此页面<br />并返回命令行继续操作。
    </p>
    <div class="w-full h-px bg-slate-100 dark:bg-white/10"></div>
    <p class="text-xs text-slate-300 dark:text-white/25">
      Ticket 已安全写入本地缓存，有效期 24 小时
    </p>
  </div>
</body>
</html>"""
                    resp = (
                        "HTTP/1.1 200 OK\r\n"
                        "Content-Type: text/html; charset=utf-8\r\n"
                        f"Content-Length: {len(body.encode())}\r\n"
                        "Connection: close\r\n"
                        "\r\n"
                        + body
                    )
                    try:
                        conn.sendall(resp.encode())
                    except OSError:
                        pass

                    if ticket:
                        result.update({"ticket": ticket, "staffname": staffname, "staffid": staffid})
                        done.set()
                        return
                    # 没有 ticket（favicon 等杂请求），继续等待

        except Exception as e:
            exc_holder.append(e)
            done.set()
        finally:
            srv.close()

    # 后台启动 server
    t = threading.Thread(target=_serve, daemon=True)
    t.start()

    # URL 立即打印，用户随时可见
    progress(f"授权链接: {auth_url}")
    try:
        _open_browser(auth_url)
    except Exception as e:
        done.set()  # 通知后台线程退出
        raise RuntimeError(f"无法打开浏览器: {e}") from e
    progress("已尝试打开浏览器，等待完成登录（超时 120s）...")

    # 等待结果（可被 Ctrl+C 中断）
    if not done.wait(timeout=120):
        done.set()  # 通知后台线程退出
        raise TimeoutError("浏览器授权超时（120 秒），请重试")

    if exc_holder:
        raise exc_holder[0]

    return result


def _open_browser(url: str) -> None:
    """跨平台打开浏览器。"""
    system = platform.system()
    if system == "Darwin":
        subprocess.Popen(["open", url])
    elif system == "Windows":
        subprocess.Popen(["start", url], shell=True)
    else:
        subprocess.Popen(["xdg-open", url])


def build_auth_headers(token_override: str = "", user_override: str = "") -> Dict[str, str]:
    """
    构造 knot 请求鉴权 headers。

    优先级：
      1. token_override 或 KNOT_API_TOKEN 环境变量（兼容旧方式）
         → x-knot-api-token
      2. TAI Ticket（mcp.cpq.woa.com OAuth，缓存于 ~/.workbuddy/cpq/knot-ticket.json）
         → x-knot-third-tai-encrypted-ticket + x-knot-third-tai-browse-ip
    """
    api_token = token_override or os.environ.get("KNOT_API_TOKEN", "")
    if api_token:
        headers: Dict[str, str] = {"x-knot-api-token": api_token}
        user = user_override or os.environ.get("KNOT_API_USER", "")
        if user:
            headers["x-knot-api-user"] = user
        return headers

    # TAI Ticket 路径
    cached = load_cached_ticket()
    if cached:
        progress(f"使用缓存 ticket（staffname: {cached.get('staffname', '')}）")
    else:
        progress("未找到有效 ticket，开始浏览器授权...")
        try:
            login_result = login_with_browser()
        except TimeoutError:
            raise
        except Exception as e:
            raise RuntimeError(f"浏览器授权失败: {e}") from e

        ticket = login_result.get("ticket", "")
        if not ticket:
            raise RuntimeError("授权回调未返回 ticket，请重试")

        try:
            save_ticket(
                ticket,
                login_result.get("staffname", ""),
                login_result.get("staffid", ""),
            )
        except Exception as e:
            progress(f"⚠️  ticket 缓存写入失败（{e}），本次会话仍可正常使用")

        cached = {"ticket": ticket, **{k: login_result.get(k, "") for k in ("staffname", "staffid")}}
        progress(f"授权成功，staffname: {cached.get('staffname', '')}")

    return {
        "x-knot-third-tai-encrypted-ticket": cached["ticket"],
        "x-knot-third-tai-browse-ip": get_local_ip(),
    }


def build_download_url(file_path: str, workspace: str, uuid: str) -> str:
    """
    根据 display_download_links 工具事件的参数拼接文件下载链接。

    Args:
        file_path: 文件路径（如 tmp/xxx/xxx-最终报价.xlsx）
        workspace: 工作区路径（如 /data/knot/workspaces/agents/{agent_id}）
        uuid: 客户端 UUID（从 TOOL_CALL_RESULT.client_uuid 获取）

    Returns:
        完整的下载 URL
    """
    params = urllib.parse.urlencode({
        "uuid": uuid,
        "path": file_path,
        "workspace": workspace,
    })
    return f"{DOWNLOAD_BASE_URL}?{params}"


# ============================================================
# 恢复查看
# ============================================================


def read_json_file(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def resume_run(target: str) -> Dict[str, Any]:
    """读取已有运行目录或 JSON 文件；不自动继续业务流程。"""
    path = Path(target).expanduser()

    if not path.exists():
        return {
            "success": False,
            "answer": "",
            "conversation_id": "",
            "download_links": [],
            "error": f"resume 目标不存在: {path}",
        }

    if path.is_dir():
        result_file = path / "result.json"
        state_file = path / "state.json"
        if result_file.exists():
            return read_json_file(result_file)
        if state_file.exists():
            state = read_json_file(state_file)
            conversation_id = state.get("conversation_id", "")
            return {
                "success": False,
                "answer": "",
                "conversation_id": conversation_id,
                "download_links": [],
                "error": "未找到 result.json，仅找到 state.json；如需继续，请使用 conversation_id 发起新调用。",
                "state": state,
                "resume_hint": (
                    "python call_knot_agent.py --message \"请继续\" "
                    f"--conversation-id \"{conversation_id}\" --run-dir \"<new-run-dir>\""
                    if conversation_id
                    else "state.json 中没有 conversation_id，无法基于该状态接续。"
                ),
            }
        return {
            "success": False,
            "answer": "",
            "conversation_id": "",
            "download_links": [],
            "error": f"目录中未找到 result.json 或 state.json: {path}",
        }

    if path.is_file():
        return read_json_file(path)

    return {
        "success": False,
        "answer": "",
        "conversation_id": "",
        "download_links": [],
        "error": f"不支持的 resume 目标: {path}",
    }


# ============================================================
# 核心逻辑
# ============================================================


def call_knot_agent(
    message: str,
    conversation_id: str = "",
    token: str = "",
    user: str = "",
    timeout: int = DEFAULT_TIMEOUT,
    run_store: Optional[RunStore] = None,
) -> dict:
    """
    调用 knot 智能体并返回最终回答。

    Args:
        message: 用户提问内容
        conversation_id: 会话 ID（为空则新建会话）
        token: knot API token
        user: 调用者企微英文名
        timeout: 请求超时秒数
        run_store: 可选的运行状态持久化对象

    Returns:
        dict: {"success": bool, "answer": str, "conversation_id": str, "download_links": list, "error": str}
    """
    # 参数校验
    if not message.strip():
        return {"success": False, "answer": "", "conversation_id": conversation_id, "download_links": [], "error": "message 不能为空"}

    # requests 只在真实调用 knot 时导入，避免 --resume 或本地参数校验因依赖缺失失败。
    import requests

    # 构造鉴权 headers（自动处理 TAI ticket / API token 两种方式）
    try:
        auth_headers = build_auth_headers(token, user)
    except TimeoutError as e:
        return {"success": False, "answer": "", "conversation_id": conversation_id, "download_links": [], "error": str(e)}
    except Exception as e:
        return {"success": False, "answer": "", "conversation_id": conversation_id, "download_links": [], "error": f"获取鉴权信息失败: {e}"}

    headers = {
        "Content-Type": "application/json",
        **auth_headers,
    }

    # 发起流式请求（含连接中断自动恢复）
    start_time = time.time()
    result_parts = []
    result_conversation_id = conversation_id
    download_links = []
    retries = 0
    current_message = message

    if run_store is not None:
        run_store.update_state(status="running", conversation_id=result_conversation_id)

    while True:
        progress("正在连接 knot 智能体...")

        try:
            response = requests.post(
                API_URL,
                json={
                    "input": {
                        "message": current_message,
                        "conversation_id": result_conversation_id,
                        "stream": True,
                        "enable_web_search": False,
                    }
                },
                headers=headers,
                stream=True,
                timeout=timeout,
                # 绕过本地代理直连 knot 服务端
                # WorkBuddy 桌面端自带代理（127.0.0.1:53500）有 ~60s 读超时，
                # 会在 SSE 长时间无数据时主动断开连接（ChunkedEncodingError）。
                # knot.woa.com 是内网服务，无需代理。
                proxies={"http": None, "https": None},
            )
        except requests.exceptions.Timeout:
            return {"success": False, "answer": "", "conversation_id": result_conversation_id, "download_links": [], "error": f"请求超时（{timeout}秒）"}
        except requests.exceptions.ConnectionError as e:
            if retries < MAX_RETRIES:
                retries += 1
                elapsed = int(time.time() - start_time)
                progress(f"[{elapsed}s] 连接失败，{RETRY_DELAY}s 后重试（第 {retries}/{MAX_RETRIES} 次）...")
                time.sleep(RETRY_DELAY)
                continue
            return {"success": False, "answer": "", "conversation_id": result_conversation_id, "download_links": [], "error": f"网络连接失败: {e}"}
        except requests.exceptions.RequestException as e:
            return {"success": False, "answer": "", "conversation_id": result_conversation_id, "download_links": [], "error": f"请求异常: {e}"}

        # HTTP 状态码检查
        if response.status_code != 200:
            error_text = response.text[:500] if response.text else f"HTTP {response.status_code}"
            return {"success": False, "answer": "", "conversation_id": result_conversation_id, "download_links": [], "error": f"HTTP 错误: {error_text}"}

        progress("已连接，等待智能体响应...")

        # 启动独立心跳线程（不依赖 iter_lines 循环节奏）
        heartbeat = HeartbeatThread(interval=HEARTBEAT_INTERVAL)
        heartbeat.start()

        # 解析 SSE 流式事件
        error_message = ""
        current_step = ""
        tool_call_count = 0
        received_done = False

        # 文件下载链接相关状态
        pending_download_tool = {}  # 正在追踪的 display_download_links 工具调用

        try:
            for line in response.iter_lines():
                if not line:
                    continue

                chunk_str = line.decode("utf-8").lstrip("data:").strip()

                if chunk_str == "[DONE]":
                    received_done = True
                    break

                # 尝试解析 JSON
                try:
                    msg = json.loads(chunk_str)
                except json.JSONDecodeError:
                    continue

                if "type" not in msg:
                    continue

                msg_type = msg["type"]
                raw_event = msg.get("rawEvent", {})

                # 提取 conversation_id（从第一个带 conversation_id 的事件获取）
                if "conversation_id" in raw_event and raw_event["conversation_id"]:
                    new_conversation_id = raw_event["conversation_id"]
                    if new_conversation_id != result_conversation_id:
                        result_conversation_id = new_conversation_id
                        if run_store is not None:
                            run_store.update_state(status="running", conversation_id=result_conversation_id)
                    else:
                        result_conversation_id = new_conversation_id

                # 只收集最终回答文本
                if msg_type == "TEXT_MESSAGE_CONTENT":
                    content = raw_event.get("content", "")
                    if content:
                        result_parts.append(content)

                # 追踪生命周期事件（输出进度）
                elif msg_type == "STEP_STARTED":
                    step_name = raw_event.get("step_name", "")
                    if step_name:
                        current_step = step_name
                        heartbeat.update_step(step_name)
                        if run_store is not None:
                            run_store.update_state(last_step=step_name)
                        elapsed = int(time.time() - start_time)
                        progress(f"[{elapsed}s] 步骤开始: {step_name}")

                elif msg_type == "STEP_FINISHED":
                    step_name = raw_event.get("step_name", "")
                    token_usage = raw_event.get("token_usage", {})
                    elapsed = int(time.time() - start_time)
                    tokens_info = ""
                    if token_usage:
                        total = token_usage.get("total_tokens", 0)
                        if total:
                            tokens_info = f" (tokens: {total})"
                    progress(f"[{elapsed}s] 步骤完成: {step_name}{tokens_info}")

                # 追踪工具调用
                elif msg_type == "TOOL_CALL_START":
                    tool_call_count += 1
                    heartbeat.update_tool_count(tool_call_count)
                    if run_store is not None:
                        run_store.update_state(tool_call_count=tool_call_count)
                    elapsed = int(time.time() - start_time)
                    tool_name = raw_event.get("name", "")
                    progress(f"[{elapsed}s] 正在调用工具 #{tool_call_count}...")

                    # 标记 display_download_links 工具调用，后续收集其参数和结果
                    if tool_name == "display_download_links":
                        tool_call_id = raw_event.get("tool_call_id", "")
                        if tool_call_id:
                            pending_download_tool[tool_call_id] = {"file_paths": [], "workspace": ""}

                elif msg_type == "TOOL_CALL_ARGS":
                    tool_call_id = raw_event.get("tool_call_id", "")
                    # 如果是 display_download_links 的参数，提取 filePaths 和 workspace
                    if tool_call_id in pending_download_tool:
                        document = raw_event.get("document", {})
                        if document:
                            pending_download_tool[tool_call_id]["file_paths"] = document.get("filePaths", [])
                            pending_download_tool[tool_call_id]["workspace"] = document.get("workspace", "")

                elif msg_type == "TOOL_CALL_END":
                    elapsed = int(time.time() - start_time)
                    progress(f"[{elapsed}s] 工具调用 #{tool_call_count} 完成")

                elif msg_type == "TOOL_CALL_RESULT":
                    tool_call_id = raw_event.get("tool_call_id", "")
                    # 如果是 display_download_links 的结果，提取 client_uuid 并拼接下载链接
                    if tool_call_id in pending_download_tool:
                        result_data = raw_event.get("result", {})
                        client_uuid = result_data.get("client_uuid", "")
                        tool_info = pending_download_tool.pop(tool_call_id)

                        if client_uuid and tool_info["workspace"]:
                            for fp in tool_info["file_paths"]:
                                url = build_download_url(fp, tool_info["workspace"], client_uuid)
                                file_name = fp.split("/")[-1] if "/" in fp else fp
                                download_links.append({"file_name": file_name, "url": url})
                                if run_store is not None:
                                    run_store.update_state(download_links_count=len(download_links))
                                progress(f"检测到文件输出: {file_name}")

                # 思考过程（只报进度，不收集内容）
                elif msg_type == "THINKING_TEXT_MESSAGE_START":
                    elapsed = int(time.time() - start_time)
                    progress(f"[{elapsed}s] 智能体正在思考...")

                # 捕获错误
                elif msg_type == "RUN_ERROR":
                    tip_option = raw_event.get("tip_option", {})
                    error_content = tip_option.get("content", "")
                    if error_content:
                        error_message = error_content
                        if run_store is not None:
                            run_store.update_state(error=error_content)
                        progress(f"错误: {error_content[:200]}")

        except (requests.exceptions.ChunkedEncodingError, requests.exceptions.ConnectionError) as e:
            # 连接在读取过程中断开
            heartbeat.stop()
            elapsed = int(time.time() - start_time)
            progress(f"[{elapsed}s] 连接中断: {type(e).__name__}")

            # 无论是否已收到部分内容，只要有 conversation_id 就尝试恢复
            # 因为部分内容可能是截断的（思考过程而非最终回答）
            if result_conversation_id and retries < MAX_RETRIES:
                retries += 1
                progress(f"尝试恢复连接（第 {retries}/{MAX_RETRIES} 次）...使用 conversation_id 继续")
                time.sleep(RETRY_DELAY)
                current_message = "请继续"
                # 不清空 result_parts —— 累积已收到的内容
                continue

            # 重试次数用尽，如果有部分内容就返回（标记为部分结果）
            if result_parts:
                progress("重试次数用尽，返回已收到的部分内容")
                break

            return {
                "success": False,
                "answer": "",
                "conversation_id": result_conversation_id,
                "download_links": [],
                "error": f"连接中断 (Response ended prematurely): {e}",
            }

        finally:
            heartbeat.stop()

        # 检查是否正常结束
        if not received_done and not error_message:
            # 连接结束但没收到 [DONE]（可能有部分内容，可能没有）
            elapsed = int(time.time() - start_time)
            progress(f"[{elapsed}s] 连接提前关闭（未收到 [DONE]）")

            if result_conversation_id and retries < MAX_RETRIES:
                retries += 1
                progress(f"尝试恢复（第 {retries}/{MAX_RETRIES} 次）...")
                time.sleep(RETRY_DELAY)
                current_message = "请继续"
                continue

            # 重试用尽
            if result_parts:
                progress("重试次数用尽，返回已收到的部分内容")
                break

            return {
                "success": False,
                "answer": "",
                "conversation_id": result_conversation_id,
                "download_links": [],
                "error": "连接提前关闭 (Response ended prematurely)，智能体未返回内容",
            }

        # 正常结束，跳出重试循环
        break

    # 输出完成信息
    elapsed = int(time.time() - start_time)
    progress(f"完成，总耗时 {elapsed}s")

    # 构造返回结果
    if error_message and not result_parts:
        return {
            "success": False,
            "answer": "",
            "conversation_id": result_conversation_id,
            "download_links": [],
            "error": error_message,
        }

    answer = "".join(result_parts)

    if not answer and not error_message:
        return {
            "success": False,
            "answer": "",
            "conversation_id": result_conversation_id,
            "download_links": [],
            "error": "智能体未返回任何回答内容",
        }

    return {
        "success": True,
        "answer": answer,
        "conversation_id": result_conversation_id,
        "download_links": download_links,
        "error": "",
    }


# ============================================================
# CLI 入口
# ============================================================


def build_run_store(args: argparse.Namespace) -> Optional[RunStore]:
    """根据 CLI 参数决定是否启用持久化。"""
    if not any([args.run_dir, args.output, args.state_file, args.log_file, args.run_id]):
        return None
    return RunStore(
        run_dir=args.run_dir,
        output_file=args.output,
        state_file=args.state_file,
        log_file=args.log_file,
        run_id=args.run_id,
    )


def main():
    parser = argparse.ArgumentParser(description="调用 knot 平台智能体")
    parser.add_argument("--message", "-m", default="", help="用户提问内容；除 --resume 外必填")
    parser.add_argument("--conversation-id", "-c", default="", help="会话 ID（追问时传入上一轮返回的 ID）")
    parser.add_argument("--token", "-t", default="", help="(deprecated) knot API Token；不传则走浏览器 OAuth")
    parser.add_argument("--user", "-u", default="", help="(deprecated) 企微英文名；仅在 --token / KNOT_API_TOKEN 模式下生效")
    parser.add_argument("--ensure-auth", action="store_true", help="鉴权预热：确认 OAuth ticket 有效（首次会弹浏览器），不发送消息，立即返回")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT, help=f"请求超时秒数（默认 {DEFAULT_TIMEOUT}）")
    parser.add_argument("--run-dir", default="", help="本次运行目录；启用 request/state/result/log 自动落盘")
    parser.add_argument("--output", default="", help="最终 JSON 结果文件；默认 <run-dir>/result.json")
    parser.add_argument("--state-file", default="", help="中间状态文件；默认 <run-dir>/state.json")
    parser.add_argument("--log-file", default="", help="进度日志文件；默认 <run-dir>/progress.log")
    parser.add_argument("--run-id", default="", help=f"自定义运行 ID；未指定 --run-dir 时默认写入 {DEFAULT_RUNS_DIR}/<run-id>")
    parser.add_argument("--resume", default="", help="读取已有运行目录或 JSON 文件；只查看状态/结果，不自动继续业务流程")

    args = parser.parse_args()

    if args.resume:
        result = resume_run(args.resume)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        resume_target_exists = Path(args.resume).expanduser().exists()
        sys.exit(0 if resume_target_exists else 1)

    if args.ensure_auth:
        # 完整环境预热：在进入并发 fan-out 前一次性串行检查
        #   1) Python 版本（≥ 3.9）
        #   2) 必需依赖（requests / openpyxl）
        #   3) OAuth ticket（默认走浏览器，已 cached 时秒返回）
        # 任一失败 → exit 1 + 结构化 error，调用方（SKILL.md 步骤 4.5）据此把
        # 修复指引转给用户。永远不让"缺依赖 / Py 版本低"在并发 worker 阶段才暴露——
        # 那会被 main_loop 的 stderr=DEVNULL 吞掉，且被 exception 自动重试再放大一倍。
        if sys.version_info < (3, 9):
            ver = ".".join(str(x) for x in sys.version_info[:3])
            print(json.dumps(
                {
                    "authenticated": False,
                    "error": (
                        f"Python {ver} < 3.9，本 skill 要求 Python ≥ 3.9。"
                        f"请安装 Python 3.9+ 后重跑（IDE 内可用 install_binary 工具）。"
                    ),
                },
                ensure_ascii=False,
            ))
            sys.exit(1)

        missing: list = []
        for mod in ("requests", "openpyxl"):
            try:
                __import__(mod)
            except ImportError:
                missing.append(mod)
        if missing:
            print(json.dumps(
                {
                    "authenticated": False,
                    "error": (
                        f"缺依赖: {', '.join(missing)}；"
                        f"请运行 `pip install {' '.join(missing)}` 后重跑。"
                    ),
                    "missing_deps": missing,
                },
                ensure_ascii=False,
            ))
            sys.exit(1)

        try:
            build_auth_headers(token_override=args.token, user_override=args.user)
        except Exception as e:
            print(json.dumps(
                {"authenticated": False, "error": f"{type(e).__name__}: {e}"},
                ensure_ascii=False,
            ))
            sys.exit(1)
        cached = load_cached_ticket() or {}
        print(json.dumps(
            {
                "authenticated": True,
                "staffname": cached.get("staffname", ""),
                "staffid": cached.get("staffid", ""),
                "auth_mode": "token" if (args.token or os.environ.get("KNOT_API_TOKEN")) else "oauth",
            },
            ensure_ascii=False,
        ))
        sys.exit(0)

    if not args.message.strip():
        parser.error("--message is required unless --resume / --ensure-auth is used")

    run_store = build_run_store(args)
    set_active_run_store(run_store)

    if run_store is not None:
        run_store.write_request(args.message, args.conversation_id, args.timeout)

    def handle_sigterm(signum, frame):
        if run_store is not None:
            run_store.mark_interrupted(f"收到终止信号 {signum}")
        raise SystemExit(128 + signum)

    signal.signal(signal.SIGTERM, handle_sigterm)

    # 优先用命令行参数，其次用环境变量
    token = args.token or os.environ.get("KNOT_API_TOKEN", "")
    user = args.user or os.environ.get("KNOT_API_USER", "")

    try:
        # 调用智能体
        result = call_knot_agent(
            message=args.message,
            conversation_id=args.conversation_id,
            token=token,
            user=user,
            timeout=args.timeout,
            run_store=run_store,
        )
        final_status = None
        exit_code = 0 if result["success"] else 1
    except KeyboardInterrupt:
        conversation_id = args.conversation_id
        if run_store is not None:
            run_store.mark_interrupted("收到中断信号")
            conversation_id = run_store.state.get("conversation_id", conversation_id)
        result = {
            "success": False,
            "answer": "",
            "conversation_id": conversation_id,
            "download_links": [],
            "error": "进程被中断，已尽量保存 state.json",
        }
        final_status = "interrupted"
        exit_code = 130

    if run_store is not None:
        run_store.write_result(result, final_status=final_status)

    # 输出 JSON 结果到 stdout
    print(json.dumps(result, ensure_ascii=False, indent=2))

    # 非成功时退出码为 1
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
