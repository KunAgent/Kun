# -*- coding: utf-8 -*-
try:
    from agents import RunContextWrapper
    from agents.mcp import MCPServerSse, MCPServerStreamableHttp
except ImportError as _agents_import_err:
    # Fallback when openai-agents package is not installed
    import sys, os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from run_context_wrapper import RunContextWrapper

    _AGENTS_MISSING_MSG = (
        "MCP tools require the 'openai-agents' package. "
        "Install with: pip install openai-agents"
    )

    class _MCPServerStub:
        """Stub that raises a clear error when MCP is used without openai-agents."""
        def __init__(self, **kwargs):
            self._name = kwargs.get("name", "unknown")

        async def connect(self):
            raise ImportError(
                f"Cannot connect MCP server '{self._name}': {_AGENTS_MISSING_MSG}"
            )

        async def cleanup(self):
            pass

    MCPServerSse = _MCPServerStub
    MCPServerStreamableHttp = _MCPServerStub
import asyncio
from datetime import timedelta
from loguru import logger
import traceback
from typing import Dict, List, Optional, Union

from dashboard_strategy.context import GameContext


class MCPServerException(Exception):
    """Base exception for MCP server related errors."""
    pass


class MCPServerConnectionException(MCPServerException):
    """Exception raised when MCP server connection fails."""
    pass


class MCPServerTimeoutException(MCPServerException):
    """Exception raised when MCP server times out."""
    pass


class MCPServerNotAvailableException(MCPServerException):
    """Exception raised when MCP server is not available."""
    pass


async def create_dashboard_mcp_servers(context: RunContextWrapper[GameContext], mcp_start_event: asyncio.Event,
                                       mcp_configs: List[Dict[str, any]]) -> List[Union[MCPServerSse, MCPServerStreamableHttp]]:
    """
    Create and manage MCP servers for dashboard agent, similar to ds agent's approach.
    Only creates MCP servers when needed and properly cleans them up.
    """
    if len(mcp_configs) == 0:
        return
    mcp_servers: List[Union[MCPServerSse, MCPServerStreamableHttp]] = []
    for mcp_config in mcp_configs:
        try:
            params = mcp_config.get("params", {})
            url = params.get("url", "")

            if "/sse" in url.lower():
                mcp_server = MCPServerSse(
                    name=mcp_config.get("name"),
                    params=params,
                    client_session_timeout_seconds=params.get("timeout", 60),
                )
            else:
                if "timeout" in params and not isinstance(params["timeout"], timedelta):
                    params["timeout"] = timedelta(seconds=params["timeout"])

                mcp_server = MCPServerStreamableHttp(
                    name=mcp_config.get("name"),
                    params=params,
                    client_session_timeout_seconds=params.get("timeout", 60),
                )

            await mcp_server.connect()
            logger.info(f"[MCP Lifecycle] Created MCP server: {mcp_config.get('name', 'Unknown')} at {url}")
            mcp_servers.append(mcp_server)

        except Exception as e:
            error_msg = f"Failed to create MCP server {mcp_config.get('name', 'Unknown')}: {e}"
            logger.error(f"[MCP Lifecycle] {error_msg}")

    context.context.dashboard_inner_vars["dashboard_mcp_server"].extend(mcp_servers)
    mcp_start_event.set()
    try:
        await asyncio.sleep(99999)
    except asyncio.CancelledError:
        logger.warning("[MCP Lifecycle] create_dashboard_mcp_servers cancelled; starting cleanup")
        for mcp_server in mcp_servers:
            try:
                await mcp_server.cleanup()
                logger.info(f"[MCP Lifecycle] Cleaned up MCP server")
            except Exception:
                logger.error(traceback.format_exc())
        raise
    except Exception:
        for mcp_server in mcp_servers:
            try:
                await mcp_server.cleanup()
                logger.info(f"[MCP Lifecycle] Cleaned up MCP server")
            except Exception:
                logger.error(traceback.format_exc())


async def restart_mcp_servers(
    context: RunContextWrapper[GameContext],
    max_retries: int = 2,
    retry_delay: float = 2.0,
    reason: Optional[str] = None,
    caller: Optional[str] = None,
):
    """
    Restart MCP servers with retry logic.
    """
    try:
        existing_servers = context.context.dashboard_inner_vars.get("dashboard_mcp_server")
        existing_count = len(existing_servers) if isinstance(existing_servers, list) else None
        no_mcp_available = context.context.dashboard_inner_vars.get("no_mcp_available")
        has_task = isinstance(context.context.dashboard_inner_vars.get("mcp_task"), asyncio.Task)
        session_id = getattr(context.context, "session_id", None)
        message_id = getattr(context.context, "message_id", None)
        inner_vars_id = id(getattr(context.context, "dashboard_inner_vars", None))
        logger.warning(
            "[MCP Lifecycle] restart_mcp_servers called"
            f" | reason={reason or 'unknown'}"
            f" | caller={caller or 'unknown'}"
            f" | session_id={session_id}"
            f" | message_id={message_id}"
            f" | existing_server_count={existing_count}"
            f" | no_mcp_available={no_mcp_available}"
            f" | has_mcp_task={has_task}"
            f" | dashboard_inner_vars_id={inner_vars_id}"
        )
        if not reason:
            stack = "".join(traceback.format_stack(limit=8))
            logger.warning(f"[MCP Lifecycle] restart_mcp_servers call stack (no reason provided):\n{stack}")
    except Exception:
        logger.warning("[MCP Lifecycle] Failed to log restart_mcp_servers trigger context")

    mcp_configs = get_dashboard_mcp_config(context)
    if len(mcp_configs) == 0:
        logger.info("[MCP Lifecycle] No MCP configuration provided, skipping restart")
        return []

    last_exception = None

    logger.info(f"[MCP Lifecycle] Starting MCP server restart process with {max_retries} max attempts")

    mcp_servers = context.context.dashboard_inner_vars.setdefault("dashboard_mcp_server", [])
    try:
        mcp_task = context.context.dashboard_inner_vars.get("mcp_task")
        if isinstance(mcp_task, asyncio.Task):
            logger.warning(
                "[MCP Lifecycle] Cancelling existing mcp_task before restart"
                f" | reason={reason or 'unknown'}"
                f" | caller={caller or 'unknown'}"
                f" | task_id={id(mcp_task)}"
                f" | task_done={mcp_task.done()}"
                f" | task_cancelled={mcp_task.cancelled()}"
            )
            mcp_task.cancel()
    except:
        logger.error("[MCP Lifecycle] Restart cleanup failed")
    try:
        prev_count = len(mcp_servers) if isinstance(mcp_servers, list) else None
        if prev_count:
            logger.warning(
                "[MCP Lifecycle] Clearing dashboard_mcp_server list before restart"
                f" | prev_count={prev_count}"
                f" | reason={reason or 'unknown'}"
                f" | caller={caller or 'unknown'}"
            )
    except Exception:
        logger.warning("[MCP Lifecycle] Failed to log server list clear context")
    mcp_servers.clear()

    for attempt in range(1, max_retries + 1):
        try:
            logger.info(f"[MCP Lifecycle] Restart attempt {attempt}/{max_retries}")

            mcp_start_event = asyncio.Event()
            mcp_task = asyncio.create_task(create_dashboard_mcp_servers(context, mcp_start_event, mcp_configs))
            await mcp_start_event.wait()
            context.context.dashboard_inner_vars["mcp_task"] = mcp_task
            mcp_servers = context.context.dashboard_inner_vars["dashboard_mcp_server"]
            if len(mcp_servers) == 0 and len(mcp_configs) > 0:
                logger.error("[MCP Lifecycle] No MCP servers were successfully created")
                raise MCPServerNotAvailableException("No MCP servers were successfully created")

            logger.info(f"[MCP Lifecycle] Successfully restarted {len(mcp_servers)} MCP servers on attempt {attempt}")

            return
        except MCPServerException as e:
            last_exception = e
            logger.warning(f"[MCP Lifecycle] Restart attempt {attempt} failed: {e}")

            if attempt < max_retries - 1:
                logger.info(f"[MCP Lifecycle] Waiting {retry_delay} seconds before retry...")
                await asyncio.sleep(retry_delay)
                retry_delay *= 1.5
        except Exception as e:
            last_exception = MCPServerException(f"Unexpected error during MCP server restart: {e}")
            logger.error(f"[MCP Lifecycle] Unexpected error on restart attempt {attempt}: {e}")

            if attempt < max_retries - 1:
                await asyncio.sleep(retry_delay)
                retry_delay *= 1.5

    error_msg = f"Failed to restart MCP servers after {max_retries} attempts"
    logger.error(f"[MCP Lifecycle] {error_msg}")
    raise MCPServerException(error_msg) from last_exception


async def cleanup_mcp_servers(
    context: RunContextWrapper[GameContext],
    reason: Optional[str] = None,
    caller: Optional[str] = None,
):
    """Cleanup MCP lifecycle task/servers, used by run_tool on process end."""
    mcp_task = context.context.dashboard_inner_vars.get("mcp_task")
    if isinstance(mcp_task, asyncio.Task):
        logger.warning(
            "[MCP Lifecycle] cleanup_mcp_servers cancelling mcp_task"
            f" | reason={reason or 'unknown'}"
            f" | caller={caller or 'unknown'}"
            f" | task_id={id(mcp_task)}"
            f" | task_done={mcp_task.done()}"
            f" | task_cancelled={mcp_task.cancelled()}"
        )
        mcp_task.cancel()
        try:
            await mcp_task
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.error(traceback.format_exc())

    context.context.dashboard_inner_vars["mcp_task"] = None
    mcp_servers = context.context.dashboard_inner_vars.setdefault("dashboard_mcp_server", [])
    mcp_servers.clear()


def has_mcp_server(context=None) -> bool:
    """
    Check if MCP server is available.
    """
    mcp_servers = context.context.dashboard_inner_vars.get("dashboard_mcp_server")
    return mcp_servers is not None and len(mcp_servers) > 0


def should_use_mcp_for_game(game_codes: list) -> bool:
    """
    Determine if MCP should be used based on game code.
    Default: always True — all games are allowed to use MCP in react agent.
    """
    return bool(game_codes)


def get_dashboard_mcp_config(context: RunContextWrapper[GameContext]) -> List[Dict[str, any]]:
    """
    Get the MCP configuration for dashboard agent.
    """
    from dashboard_common.config import globalvar as gl
    env = gl.get_value("ENV", expected_type=str)

    rb_system_json = gl.get_value("rb_system_json", expected_type=dict)
    if not rb_system_json or "dashboard_mcp" not in rb_system_json:
        context.context.dashboard_inner_vars["no_mcp_available"] = True
        context.context.dashboard_inner_vars["mcp_unavailable_reason"] = "MCP config missing: dashboard_mcp is not present in rb_system_json"
        return []

    dashboard_mcp_config = rb_system_json["dashboard_mcp"]
    host = dashboard_mcp_config.get("host", "")
    token = dashboard_mcp_config.get("token", "")

    if not host or not token:
        missing = "host" if not host else "token"
        reason = f"MCP config incomplete: dashboard_mcp missing {missing} (env={env})"
        context.context.dashboard_inner_vars["no_mcp_available"] = True
        context.context.dashboard_inner_vars["mcp_unavailable_reason"] = reason
        logger.error(reason)
        return []

    return [{
        "name": "Dashboard Agent MCP Server",
        "params": {
            "url": f"{host}",
            "headers": {
                "Authorization": f"Bearer {token}"
            },
            "timeout": 60,
            "sse_read_timeout": 30,
        }
    }]
