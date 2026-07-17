#!/usr/bin/env python3
"""
调用 knot 平台智能体的代理脚本。
通过 AG-UI 协议（SSE 流式）调用指定智能体，提取最终回答文本返回。

使用方式:
    python call_knot_agent.py --message "你的问题"
    python call_knot_agent.py --message "追问" --conversation-id "xxx"

环境变量:
    KNOT_API_TOKEN: knot 平台 API Token
    KNOT_API_USER:  调用者企微英文名

进度信息:
    脚本会将进度信息输出到 stderr，确保调用方知道脚本仍在运行。
    最终结果以 JSON 形式输出到 stdout。
"""

import argparse
import json
import os
import sys
import threading
import time
import urllib.parse

import requests

# ============================================================
# 常量配置
# ============================================================

AGENT_ID = "e1ff75c57eab4e0786a6b527275adbb5"
API_BASE = "https://knot.woa.com/apigw/api/v1/agents/agui"
API_URL = f"{API_BASE}/{AGENT_ID}"
DEFAULT_TIMEOUT = 1800  # 30 分钟，复杂查价可能耗时很长
MAX_RETRIES = 1  # 临时性网络 / 5xx 故障最多安全重试 1 次

# 进度输出间隔（秒）：每隔多久没收到文本事件就输出一次心跳
HEARTBEAT_INTERVAL = 15

# 文件下载链接基础 URL
DOWNLOAD_BASE_URL = "https://knot.woa.com/api/v1/workspace/download_file"


# ============================================================
# 进度输出
# ============================================================


def progress(msg: str):
    """输出进度信息到 stderr，不影响 stdout 的 JSON 输出。"""
    print(f"[knot-agent] {msg}", file=sys.stderr, flush=True)


class HeartbeatThread(threading.Thread):
    """
    独立心跳线程：每隔 HEARTBEAT_INTERVAL 秒向 stderr 输出一行心跳，
    不依赖 iter_lines() 的循环节奏，即使主线程阻塞在等待 SSE 数据也能持续输出。
    这样 IDE（CodeBuddy / Claude Code / WorkBuddy）不会因为长时间无输出而 kill 进程。
    """

    def __init__(self, start_time: float, interval: int = HEARTBEAT_INTERVAL):
        super().__init__(daemon=True)
        self._stop_event = threading.Event()
        self._start_time = start_time
        self._interval = interval
        # 主线程可更新这些状态，心跳线程读取并输出
        self.current_step = ""
        self.tool_call_count = 0

    def run(self):
        while not self._stop_event.wait(self._interval):
            elapsed = int(time.time() - self._start_time)
            status = f"仍在运行... 已耗时 {elapsed}s"
            if self.current_step:
                status += f" | 当前步骤: {self.current_step}"
            if self.tool_call_count > 0:
                status += f" | 已调用 {self.tool_call_count} 个工具"
            progress(status)

    def stop(self):
        self._stop_event.set()


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
# 核心逻辑
# ============================================================


def call_knot_agent(
    message: str,
    conversation_id: str = "",
    token: str = "",
    user: str = "",
    timeout: int = DEFAULT_TIMEOUT,
    max_retries: int = MAX_RETRIES,
) -> dict:
    """
    调用 knot 智能体并返回最终回答。

    Args:
        message: 用户提问内容
        conversation_id: 会话 ID（为空则新建会话）
        token: knot API token
        user: 调用者企微英文名
        timeout: 请求超时秒数
        max_retries: 临时性故障最大重试次数

    Returns:
        dict: {"success": bool, "answer": str, "conversation_id": str, "download_links": list, "error": str}
    """

    def failure(error: str, result_conversation_id: str = "") -> dict:
        return {
            "success": False,
            "answer": "",
            "conversation_id": result_conversation_id,
            "download_links": [],
            "error": error,
        }

    def should_retry(attempt: int) -> bool:
        return attempt < max_retries

    # 参数校验
    if not message.strip():
        return failure("message 不能为空")

    if not token:
        return failure("未提供 KNOT_API_TOKEN")

    # 构造请求
    headers = {
        "Content-Type": "application/json",
        "x-knot-api-token": token,
    }

    # x-knot-api-user 为可选，设置了才传
    if user:
        headers["x-knot-api-user"] = user

    body = {
        "input": {
            "message": message,
            "conversation_id": conversation_id,
            "stream": True,
            "enable_web_search": False,
        }
    }

    last_error = ""
    last_conversation_id = conversation_id

    for attempt in range(max_retries + 1):
        if attempt > 0:
            progress(f"正在进行第 {attempt} 次安全重试...")

        # 发起流式请求
        progress("正在连接 knot 智能体...")
        start_time = time.time()

        try:
            response = requests.post(
                API_URL,
                json=body,
                headers=headers,
                stream=True,
                timeout=timeout,
                proxies={"http": None, "https": None},  # 绕过本地代理直连内网，避免代理 read timeout 导致 SSE 断流
            )
        except requests.exceptions.Timeout:
            last_error = f"请求超时（{timeout}秒）"
            if should_retry(attempt):
                progress(f"{last_error}，准备重试...")
                time.sleep(1)
                continue
            return failure(last_error, last_conversation_id)
        except requests.exceptions.ConnectionError as e:
            last_error = f"网络连接失败: {e}"
            if should_retry(attempt):
                progress("网络连接失败，准备重试...")
                time.sleep(1)
                continue
            return failure(last_error, last_conversation_id)
        except requests.exceptions.RequestException as e:
            last_error = f"请求异常: {e}"
            if should_retry(attempt):
                progress("请求异常，准备重试...")
                time.sleep(1)
                continue
            return failure(last_error, last_conversation_id)

        # HTTP 状态码检查：4xx 不重试，5xx 最多重试一次
        if response.status_code != 200:
            error_text = response.text[:500] if response.text else f"HTTP {response.status_code}"
            last_error = f"HTTP 错误: {error_text}"
            if response.status_code >= 500 and should_retry(attempt):
                progress(f"HTTP {response.status_code} 临时错误，准备重试...")
                time.sleep(1)
                continue
            return failure(last_error, last_conversation_id)

        progress("已连接，等待智能体响应...")

        # 解析 SSE 流式事件
        result_parts = []
        result_conversation_id = conversation_id
        error_message = ""
        tool_call_count = 0
        received_agent_event = False

        # 文件下载链接相关状态
        download_links = []  # 最终收集的下载链接列表
        pending_download_tool = {}  # 正在追踪的 display_download_links 工具调用
        # 格式: {tool_call_id: {"file_paths": [...], "workspace": "..."}}

        # 启动独立心跳线程（不依赖 iter_lines() 循环节奏）
        heartbeat = HeartbeatThread(start_time)
        heartbeat.start()

        try:
            for line in response.iter_lines():
                if not line:
                    continue

                chunk_str = line.decode("utf-8").lstrip("data:").strip()

                if chunk_str == "[DONE]":
                    break

                # 尝试解析 JSON
                try:
                    msg = json.loads(chunk_str)
                except json.JSONDecodeError:
                    continue

                if "type" not in msg:
                    continue

                received_agent_event = True
                msg_type = msg["type"]
                raw_event = msg.get("rawEvent", {})

                # 提取 conversation_id（从第一个带 conversation_id 的事件获取）
                if "conversation_id" in raw_event and raw_event["conversation_id"]:
                    result_conversation_id = raw_event["conversation_id"]
                    last_conversation_id = result_conversation_id

                # 只收集最终回答文本
                if msg_type == "TEXT_MESSAGE_CONTENT":
                    content = raw_event.get("content", "")
                    if content:
                        result_parts.append(content)

                # 追踪生命周期事件（输出进度 + 同步心跳线程状态）
                elif msg_type == "STEP_STARTED":
                    step_name = raw_event.get("step_name", "")
                    if step_name:
                        heartbeat.current_step = step_name
                        elapsed = int(time.time() - start_time)
                        progress(f"[{elapsed}s] 步骤开始: {step_name}")

                elif msg_type == "STEP_FINISHED":
                    step_name = raw_event.get("step_name", "")
                    elapsed = int(time.time() - start_time)
                    progress(f"[{elapsed}s] 步骤完成: {step_name}")

                # 追踪工具调用
                elif msg_type == "TOOL_CALL_START":
                    tool_call_count += 1
                    heartbeat.tool_call_count = tool_call_count
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
                        progress(f"错误: {error_content[:200]}")
        except (
            requests.exceptions.ChunkedEncodingError,
            requests.exceptions.ConnectionError,
            requests.exceptions.ReadTimeout,
            requests.exceptions.Timeout,
        ) as e:
            heartbeat.stop()
            elapsed = int(time.time() - start_time)
            last_error = f"SSE 流式连接中断: {e}"
            last_conversation_id = result_conversation_id
            progress(f"[{elapsed}s] SSE 流中断: {type(e).__name__}")

            # 如果还没收到任何智能体事件，可以安全重试
            if not received_agent_event and should_retry(attempt):
                progress("SSE 连接在收到智能体事件前中断，准备重试...")
                time.sleep(1)
                continue

            # 已收到部分回答文本 → 保留已收内容，标记为成功（附带流中断警告）
            partial_answer = "".join(result_parts)
            if partial_answer:
                warning = f"\n\n---\n⚠️ 注意：SSE 流式连接在 {elapsed}s 时中断，以上为已接收到的部分回答，可能不完整。可使用 conversation_id 继续跟进获取完整结果。"
                progress(f"流中断但已收到 {len(result_parts)} 段文本（{len(partial_answer)} 字符），保留已收内容返回")
                return {
                    "success": True,
                    "answer": partial_answer + warning,
                    "conversation_id": result_conversation_id,
                    "download_links": download_links,
                    "error": "",
                }

            # 已收到智能体事件但没有文本 → 返回失败但保留 conversation_id
            suffix = "（已收到部分事件但无文本内容，为避免重复提交未自动重试；可使用返回的 conversation_id 继续跟进）"
            return failure(last_error + suffix, result_conversation_id)
        except requests.exceptions.RequestException as e:
            heartbeat.stop()
            last_error = f"SSE 读取异常: {e}"
            last_conversation_id = result_conversation_id
            if not received_agent_event and should_retry(attempt):
                progress("SSE 读取异常，准备重试...")
                time.sleep(1)
                continue
            return failure(last_error, result_conversation_id)
        except Exception as e:
            heartbeat.stop()
            last_error = f"解析 SSE 响应时发生异常: {type(e).__name__}: {e}"
            return failure(last_error, result_conversation_id)

        # 停止心跳线程
        heartbeat.stop()

        # 输出完成信息
        elapsed = int(time.time() - start_time)
        progress(f"完成，总耗时 {elapsed}s")

        # 构造返回结果
        if error_message and not result_parts:
            return failure(error_message, result_conversation_id)

        answer = "".join(result_parts)

        if not answer and not error_message:
            return failure("智能体未返回任何回答内容", result_conversation_id)

        return {
            "success": True,
            "answer": answer,
            "conversation_id": result_conversation_id,
            "download_links": download_links,
            "error": "",
        }

    return failure(last_error or "请求失败", last_conversation_id)


# ============================================================
# CLI 入口
# ============================================================


def main():
    parser = argparse.ArgumentParser(description="调用 knot 平台智能体")
    parser.add_argument("--message", "-m", required=True, help="用户提问内容")
    parser.add_argument("--conversation-id", "-c", default="", help="会话 ID（追问时传入上一轮返回的 ID）")
    parser.add_argument("--token", "-t", default="", help="knot API Token（覆盖环境变量 KNOT_API_TOKEN）")
    parser.add_argument("--user", "-u", default="", help="企微英文名（覆盖环境变量 KNOT_API_USER）")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT, help=f"请求超时秒数（默认 {DEFAULT_TIMEOUT}）")
    parser.add_argument("--max-retries", type=int, default=MAX_RETRIES, help=f"临时性故障最大重试次数（默认 {MAX_RETRIES}）")

    args = parser.parse_args()

    # 优先用命令行参数，其次用环境变量
    token = args.token or os.environ.get("KNOT_API_TOKEN", "")
    user = args.user or os.environ.get("KNOT_API_USER", "")

    # 调用智能体
    result = call_knot_agent(
        message=args.message,
        conversation_id=args.conversation_id,
        token=token,
        user=user,
        timeout=args.timeout,
        max_retries=args.max_retries,
    )

    # 输出 JSON 结果到 stdout
    print(json.dumps(result, ensure_ascii=False, indent=2))

    # 非成功时退出码为 1
    sys.exit(0 if result["success"] else 1)


if __name__ == "__main__":
    main()
