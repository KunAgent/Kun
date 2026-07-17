"""编排器主循环（结论协议版）。

本模块实现基于 Knot 回复中 [结论]/[结果信息] 标记的编排主循环：
- 单次调用内自动连跑多轮，直至全部终态或出现待确认（asking）
- 异常（exception）在同轮内自动重试，预算为 1
- 可选 `per_task_timeout`：单任务挂钟上限，超时标 `timeout` 终态且不写入 round_N_results.json
- 终态集合：(concluded, failed, timeout, aborted_by_user)

退出码：0 = 全部终态；10 = 仍有 asking 待用户确认（写 pending.json）。无 classify 相关退出码。
"""
import hashlib
import json
import os
import signal
import subprocess
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .conclusion import parse_conclusion, parse_price, parse_four_layer
from .pending import build_pending
from .run_dir import (
    atomic_write_json,
    read_json,
    acquire_run_lock,
    release_run_lock,
    read_run_lock_info,
)
from .summary import write_summary_xlsx, write_summary_md


_DEFAULT_CONCURRENCY = 6

# 当 worker 进程崩溃且未写 result.json 时，从 worker_stderr.log 读取的最大字节数。
# 取 4KB 足以覆盖一条 ImportError + traceback；过大时只取尾部，避免日志洪水进 result.json。
_WORKER_STDERR_TAIL_BYTES = 4096

# ⚠️ 与 orchestrator/_task_worker.py 的 _FALLBACK_DIR / _fallback_path_for 必须保持一致。
# worker 在原位 --result 写盘失败时（沙箱 / 权限 / 跨设备）会降级写到这里，
# 主进程发现 result_path 不存在时按相同算法兜底读取，避免 RUN_DIR 被外部传入到
# 不可写位置时整轮静默失败。
_WORKER_FALLBACK_DIR = Path(tempfile.gettempdir()) / "inquiry-fallback"


def _worker_fallback_path_for(result_path: Path) -> Path:
    """主进程侧：用与 worker 完全相同的算法计算 fallback 路径。"""
    abs_path = str(result_path.resolve()) if result_path.is_absolute() \
        else str(Path(result_path).absolute())
    digest = hashlib.sha256(abs_path.encode("utf-8")).hexdigest()[:16]
    return _WORKER_FALLBACK_DIR / f"{digest}.json"


def _close_worker_stderr(info: Dict) -> None:
    """关闭 worker 子进程的 stderr 文件句柄（无论结果如何都必须调用，避免 fd 泄漏）。"""
    fh = info.get("stderr_fh")
    if fh is not None:
        try:
            fh.close()
        except Exception:
            pass


def _read_worker_stderr_tail(info: Dict) -> str:
    """读取 worker_stderr.log 尾部内容，用于 worker 早期崩溃时的诊断信息注入。

    优先在调用本函数前先 _close_worker_stderr(info)，确保 buffer 已 flush 到磁盘。
    返回去除尾部空白的字符串；读取失败 / 文件不存在 / 内容为空时返回 ""。
    """
    path = info.get("stderr_path")
    if path is None:
        return ""
    try:
        if not path.exists():
            return ""
        size = path.stat().st_size
        if size == 0:
            return ""
        with path.open("rb") as f:
            if size > _WORKER_STDERR_TAIL_BYTES:
                f.seek(-_WORKER_STDERR_TAIL_BYTES, 2)
            data = f.read()
        return data.decode("utf-8", errors="replace").strip()
    except Exception:
        return ""

PROTOCOL_SUFFIX = """---
请严格按以下结构返回最终结果（[结论]/[结果信息] 必填，[价格]/[四层] 在能给出时附上）：

[结论] 成功 | 失败 | 异常 | 待确认（仅四选一，不能是其他文字）
[结果信息] <你的完整原始回复内容，包含价格 / 报价单 / 追问 / 错误细节等，原样保留>
[价格] 原价=<数值+单位> 折扣价=<数值+单位> 币种=<如 CNY / USD> 计费周期=<如 1月 / 1年 / 1小时按量>
[四层] <该商品的腾讯云四层商品编码，形如 一级.二级.三级.四级>

四态语义：
- 成功：已查到有效价格 / 已生成完整报价单
- 失败：明确无法报价（商品不存在 / 配置不支持 / 区域不支持等终态原因）
- 异常：系统类错误（限流 / 上游 500 / 工具调用失败等可重试错误）
- 待确认：需要用户补充信息才能继续（缺地域 / 缺时长 / 缺规格等）

格式约束：
- [结论] 行必须独立成行，紧跟一个空格再写四态之一
- [结果信息] 行后续内容直到 [价格] / [四层] 行之前（都没有时直到回复结束）
- **[结论]=待确认 时也必须有 [结果信息] 行**：把要追问用户的问题（缺什么规格 / 缺什么参数）
  完整写在 [结果信息] 行之后；客户端会把这段内容直接展示给用户做澄清，
  写得越具体（带出可选值列表），用户回答越准；不要只写一句"信息不足"
- [价格] 行仅在 [结论]=成功 且确有价格时给出，独立成行放在 [四层] 之前；数值与单位必须直接来自你的查询结果原文，禁止做任何换算 / 估算 / 推测；查不到价就整行省略
- [四层] 行仅在能确定该商品的腾讯云四层商品编码时给出，独立成行放在最后；编码原样返回你查到的真实结果，不要翻译 / 补全 / 猜测 / 编造；查不到就整行省略
- 如不按此结构返回，本地将判定为「异常」并安排重试"""

# 终态集合：以下状态的任务永不参与新一轮 todo
_TERMINAL_STATUSES = {"concluded", "failed", "aborted_by_user", "timeout"}


def _iso_now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _stderr(msg: str) -> None:
    print(f"[orchestrator] {msg}", file=sys.stderr, flush=True)


def _append_run_progress(run_dir: Path, msg: str) -> None:
    """同步写一行到 <run_dir>/orchestrator_progress.log。

    设计原因：stdout / stderr 在被 `>file 2>&1 &` 重定向到日志再 detach 后，
    在某些 shell 模型下（例如 IDE 内置 bash 工具的多次独立 session）很难可靠
    `tail -f`；额外把进度行写到 run-dir 内固定文件，后续 `--status` / 用户手动
    `tail` 都能拿到。失败静默（不影响主循环）。
    """
    try:
        run_dir.mkdir(parents=True, exist_ok=True)
        log = run_dir / "orchestrator_progress.log"
        with log.open("a", encoding="utf-8") as f:
            f.write(f"{datetime.now().astimezone().isoformat(timespec='seconds')} {msg}\n")
    except Exception:
        pass


def _detect_current_round(run_dir: Path) -> int:
    """根据现有 round_N_results.json 判断当前进行到哪一轮。"""
    n = 0
    while (run_dir / f"round_{n+1}_results.json").exists():
        n += 1
    return n


def _build_round_request_for_task(
    t: Dict, prev_state: Dict, answers: Dict,
    common_context_suffix: str = "",
) -> Optional[Dict]:
    """决定本轮某个任务发什么 message + 用什么 conversation_id。

    所有新发起的 message 末尾都拼接 PROTOCOL_SUFFIX；
    exception 重试路径复用 prev_state.last_round_message（已含协议）。
    """
    tid = t["task_id"]
    status = prev_state.get("status", "pending")

    if status == "pending":
        msg = t["message"]
        if common_context_suffix:
            msg = msg + "\n\n" + common_context_suffix
        msg = msg + "\n\n" + PROTOCOL_SUFFIX
        return {"task_id": tid, "message": msg, "conversation_id": ""}

    if status in _TERMINAL_STATUSES:
        return None

    if status == "asking":
        user_text = answers.get("task_answers", {}).get(tid)
        if not user_text:
            return None
        msg = user_text + "\n\n" + PROTOCOL_SUFFIX
        return {"task_id": tid, "message": msg,
                "conversation_id": prev_state.get("conversation_id", "")}

    if status == "exception":
        # 预算 1 次重试：首次异常后 exception_retry_count==1 仍需重试一轮；
        # 第二次异常时 apply_result_to_state 已直接转 failed（终态），
        # 因此 exception 状态下 count 不会到 2。
        if prev_state.get("exception_retry_count", 0) >= 2:
            return None
        last_msg = prev_state.get("last_round_message")
        if not last_msg:
            last_msg = t["message"] + "\n\n" + PROTOCOL_SUFFIX
        return {"task_id": tid, "message": last_msg,
                "conversation_id": prev_state.get("conversation_id", "")}

    return None


def _run_round_with_timeout(
    todo: List[Dict],
    run_dir: Path,
    round_no: int,
    concurrency: int,
    per_task_timeout: int,
    task_states: Dict,
    progress_interval: int = 30,
) -> Tuple[Dict[str, Dict], List[str]]:
    """执行一轮任务（subprocess pool 版）。

    - 严格 ≤ concurrency 个子进程并发；任一槽位空出立即启下一个 queue 任务
    - per_task_timeout 真正 terminate/kill 子进程并立即释放槽
    - 收到 SIGINT/SIGTERM 时优雅 drain 所有运行中子进程后再传播信号
    - 子进程 stdout 直接 DEVNULL；stderr 写到 sub_run_dir/worker_stderr.log，
      子进程崩溃（无 result.json 写出）时主进程把这份日志的尾部注入到
      `error` 字段，避免 ImportError / sys.path 故障等早期失败被静默吞掉。
    - progress_interval: 每隔 N 秒输出一行 stdout 心跳进度（0 关闭）
    """
    results: Dict[str, Dict] = {}
    timeouts: List[str] = []
    queue: List[Dict] = list(todo)
    # proc -> {"req": ..., "started_at": float, "result_path": Path, "task_id": str}
    running: Dict[subprocess.Popen, Dict] = {}
    total = len(todo)
    done_count = 0
    round_start_time = time.time()
    last_progress_time = round_start_time
    signal_received: List[Optional[int]] = [None]

    def _terminate_all_running(grace_seconds: float = 2.0) -> None:
        if not running:
            return
        for proc in list(running):
            try:
                if proc.poll() is None:
                    proc.terminate()
            except Exception:
                pass
        deadline = time.time() + grace_seconds
        for proc in list(running):
            try:
                proc.wait(timeout=max(0.0, deadline - time.time()))
            except subprocess.TimeoutExpired:
                try:
                    proc.kill()
                    proc.wait(timeout=1.0)
                except Exception:
                    pass
            except Exception:
                pass
        # 关闭所有 worker stderr fh，避免 fd 泄漏
        for proc, info in list(running.items()):
            _close_worker_stderr(info)

    def _on_signal(signum, frame):  # noqa: ARG001
        if signal_received[0] is None:
            signal_received[0] = signum
            _stderr(
                f"[orchestrator] 收到信号 {signum}，"
                f"正在 terminate {len(running)} 个运行中子进程..."
            )

    # 仅在主线程注册；调用 _run_round_with_timeout 的路径就是主线程
    old_sigint = signal.signal(signal.SIGINT, _on_signal)
    old_sigterm = signal.signal(signal.SIGTERM, _on_signal)

    # 路径布局：<skill>/scripts/orchestrator/main_loop.py
    #   → parent.parent = <skill>/scripts （= orchestrator 包所在目录）
    scripts_dir = Path(__file__).resolve().parent.parent
    worker_cmd_prefix = [sys.executable, "-m", "orchestrator._task_worker"]
    env_for_workers = os.environ.copy()
    # 让子进程 import orchestrator 包：把 scripts/ 放进 PYTHONPATH
    env_for_workers["PYTHONPATH"] = (
        f"{scripts_dir}{os.pathsep}{env_for_workers.get('PYTHONPATH', '')}"
    )
    # 关闭 .pyc 写入：避免下面三类边缘风险（任一命中都会让 worker import 行为漂移）
    #   1. 仓库切版本时 scripts/__pycache__/ 留下的旧版 .pyc
    #      （历史教训：orchestrator 曾从 scripts 同级单文件 orchestrator.py 移到
    #       scripts/orchestrator/ 包，老 .pyc 在某些 Python 版本下会被优先加载）
    #   2. sub_run_dir / scripts_dir 在 IDE 沙箱 / 同步盘下"看着可写但实际拒绝"，
    #      Python 写 .pyc 失败导致 import 阶段抛异常
    #   3. 跨设备 / 只读挂载场景下 Python 自动重试写 .pyc 引入额外延迟与噪音
    env_for_workers["PYTHONDONTWRITEBYTECODE"] = "1"

    try:
        while queue or running:
            if signal_received[0] is not None:
                _terminate_all_running()
                signal.signal(signal.SIGINT, old_sigint)
                signal.signal(signal.SIGTERM, old_sigterm)
                raise KeyboardInterrupt() if signal_received[0] == signal.SIGINT \
                    else SystemExit(128 + signal_received[0])

            # ① 填满空槽
            while queue and len(running) < concurrency:
                req = queue.pop(0)
                tid = req["task_id"]
                sub_dir = run_dir / "tasks" / tid / f"round_{round_no}"
                sub_dir.mkdir(parents=True, exist_ok=True)
                request_path = sub_dir / "request.json"
                result_path = sub_dir / "result.json"
                atomic_write_json(request_path, req)
                # 清掉历史 result，确保拿到的是本轮的
                if result_path.exists():
                    try:
                        result_path.unlink()
                    except OSError:
                        pass
                cmd = worker_cmd_prefix + [
                    "--request", str(request_path),
                    "--result", str(result_path),
                    "--sub-run-dir", str(sub_dir),
                ]
                # stderr 写文件而不是 DEVNULL：worker 进程级早期故障
                # （ImportError / 解释器路径错 / sys.path 故障）才不会被吞掉。
                worker_stderr_path = sub_dir / "worker_stderr.log"
                worker_stderr_fh = open(worker_stderr_path, "wb")
                proc = subprocess.Popen(
                    cmd,
                    cwd=str(scripts_dir),
                    env=env_for_workers,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=worker_stderr_fh,
                )
                running[proc] = {
                    "req": req, "started_at": time.time(),
                    "result_path": result_path, "task_id": tid,
                    "stderr_path": worker_stderr_path,
                    "stderr_fh": worker_stderr_fh,
                }
                # 记录本轮发送的 message（与原实现等价）
                task_states.setdefault(tid, {})["last_round_message"] = req["message"]

            if not running:
                continue

            time.sleep(0.5)
            now = time.time()

            # ② 收已完成进程
            finished = [p for p in running if p.poll() is not None]
            for proc in finished:
                info = running.pop(proc)
                tid = info["task_id"]
                rp = info["result_path"]
                # 先关 fh 让 stderr buffer flush 到磁盘，再读尾部
                _close_worker_stderr(info)
                if rp.exists():
                    try:
                        result = json.loads(rp.read_text(encoding="utf-8"))
                    except Exception as e:
                        result = {
                            "success": False, "answer": "",
                            "conversation_id": "",
                            "download_links": [],
                            "error": f"worker result parse failed: {e}",
                        }
                else:
                    # 原位无 result.json：先看 worker 是不是降级写到了 fallback。
                    # rc==2 是 worker 显式约定的"原位失败但 fallback 已写"信号，
                    # 但即使 rc != 2 也兜底查一下 fallback（worker 实现可能演进）。
                    fb_path = _worker_fallback_path_for(rp)
                    fb_loaded = False
                    if fb_path.exists():
                        try:
                            result = json.loads(fb_path.read_text(encoding="utf-8"))
                            fb_loaded = True
                            _stderr(
                                f"round {round_no}: task {tid} 原位 result 缺失，"
                                f"已从 fallback 加载: {fb_path}"
                            )
                            # 读完即清，避免下一轮误读旧结果
                            try:
                                fb_path.unlink()
                            except OSError:
                                pass
                        except Exception as fb_err:
                            _stderr(
                                f"round {round_no}: task {tid} fallback 解析失败: {fb_err}"
                            )

                    if not fb_loaded:
                        # worker 早期崩溃 / 双写失败：把 stderr 尾部读出来注入 error，
                        # 让 ImportError / Python 解释器路径错 / 沙箱拒绝等问题肉眼可见。
                        stderr_tail = _read_worker_stderr_tail(info)
                        err = f"worker died without result (rc={proc.returncode})"
                        if stderr_tail:
                            err += f"\n--- worker stderr (tail) ---\n{stderr_tail}"
                        result = {
                            "success": False, "answer": "",
                            "conversation_id": "",
                            "download_links": [],
                            "error": err,
                        }
                results[tid] = result
                done_count += 1
                _stderr(f"round {round_no}: {done_count}/{total} done")

            # ③ 检查超时（per_task_timeout > 0 时启用）
            if per_task_timeout > 0:
                expired = [p for p in running
                           if now - running[p]["started_at"] >= per_task_timeout]
                for proc in expired:
                    info = running.pop(proc)
                    tid = info["task_id"]
                    rp = info["result_path"]
                    # 抢救：在 step ② 与 step ③ 之间，子进程可能已经自然完成
                    # 并写好了 result.json。这种边界情况下不应误判为 timeout，
                    # 否则会丢一个合法 conclusion。
                    if proc.poll() is not None and rp.exists():
                        try:
                            _close_worker_stderr(info)
                            results[tid] = json.loads(rp.read_text(encoding="utf-8"))
                            done_count += 1
                            _stderr(f"round {round_no}: {done_count}/{total} done")
                            continue
                        except Exception:
                            pass  # 解析失败则继续走 timeout 路径
                    try:
                        if proc.poll() is None:
                            proc.terminate()
                            try:
                                proc.wait(timeout=2.0)
                            except subprocess.TimeoutExpired:
                                proc.kill()
                                proc.wait(timeout=1.0)
                    except Exception as e:
                        _stderr(f"round {round_no}: kill {tid} 时异常: {e}")
                    _close_worker_stderr(info)
                    timeouts.append(tid)
                    done_count += 1
                    _stderr(
                        f"round {round_no}: task {tid} 超时（>{per_task_timeout}s），"
                        f"已 terminate 子进程，槽位释放"
                    )

            # ④ 定期输出进度心跳到 stdout（IDE 可见）
            if progress_interval > 0 and now - last_progress_time >= progress_interval:
                elapsed = now - round_start_time
                elapsed_str = f"{elapsed:.0f}s"
                if elapsed >= 60:
                    elapsed_str = f"{elapsed/60:.1f}min"
                print(
                    f"[进度] 第{round_no}轮: {done_count}/{total} 已完成, "
                    f"{len(running)} 执行中, "
                    f"耗时 {elapsed_str}",
                    flush=True,
                )
                last_progress_time = now

        return results, timeouts
    finally:
        # 兜底：无论怎样退出，确保没有孤儿子进程
        _terminate_all_running(grace_seconds=1.0)
        signal.signal(signal.SIGINT, old_sigint)
        signal.signal(signal.SIGTERM, old_sigterm)


_UNRECOVERABLE_ERROR_MARKERS: Tuple[str, ...] = (
    # 来自 _task_worker.py 的 try/except，包含 ImportError / ModuleNotFoundError / 解释器路径错等
    "worker exception:",
    # main_loop step ② 的兜底：子进程崩溃且未写 result.json
    "worker died without result",
    # 缺依赖（来自 ensure-auth 升级版 / worker exception 透传的 ModuleNotFoundError 文本）
    "ModuleNotFoundError",
    "No module named",
    "缺依赖:",
    # _task_worker.py 入口 probe 检测到 sub_run_dir 不可写
    # （IDE 沙箱 / NFS / 跨设备 / 同步盘等环境问题，重试无意义）
    "sub_run_dir not writable",
)


def _is_unrecoverable_worker_error(error_text: str) -> bool:
    """判断 error 文本是否属于"worker 进程级故障"。

    这类故障（ImportError / 解释器路径错 / 缺依赖等）在并发 fan-out 下会同步发生在
    每个 worker 上，自动重试 1 轮只会浪费时间并放大噪音。识别命中的话直接转 failed
    终态，不进 exception 重试预算。

    普通 401 / 500 / 网络断连等可恢复错误不命中此白名单，仍走原有 exception 重试。
    """
    if not error_text:
        return False
    return any(marker in error_text for marker in _UNRECOVERABLE_ERROR_MARKERS)


def apply_result_to_state(st: Dict, rr: Dict) -> None:
    """把一轮 call_knot_agent 结果应用到一个 task_state 上（原地修改）。

    决策表（spec §5.4）：
      - call_knot success=False 且 error 命中 worker 进程级故障白名单 → failed（不重试）
      - call_knot success=False 其它情况 → exception（重试预算决定是否转 failed）
      - parse_conclusion 合法且 success → concluded（清零 exception_retry_count）
      - parse_conclusion 合法且 failed → failed（清零 exception_retry_count）
      - parse_conclusion 合法且 pending → asking（清零 exception_retry_count）
      - parse_conclusion 合法且 exception，或 malformed → 走异常预算路径

    注意：每个 round 只调用一次；`download_links` / `conversation_id` 仅在本轮非空时覆盖，
    否则保留上一轮值（避免覆盖已累计的有效链接 / cid）。
    """
    st["rounds_taken"] = st.get("rounds_taken", 0) + 1
    if rr.get("conversation_id"):
        st["conversation_id"] = rr["conversation_id"]
    new_links = rr.get("download_links") or []
    if new_links:
        st["download_links"] = new_links
    st["last_round_answer"] = rr.get("answer", "")
    st["last_round_error"] = rr.get("error", "")

    if not rr.get("success"):
        err = rr.get("error", "") or ""
        st["conclusion"] = None
        st["result_info"] = err
        if _is_unrecoverable_worker_error(err):
            # worker 进程级故障：6 个 worker 同时报 ImportError 时，重试再 6 次只会
            # 放大噪音；直接转 failed 终态，由 SKILL.md 步骤 4.5 后的 ensure-auth
            # 升级版承担"前置环境探测"职责。
            st["status"] = "failed"
            st["conclusion"] = "失败"
            st["result_info"] = (
                f"[orchestrator] worker 进程级故障，不重试；"
                f"原因：{err}"
            )
            st["exception_retry_count"] = 0
            return
        # 系统级失败（网络/认证/HTTP error）→ 视为异常，不解析 answer
        _bump_exception_or_fail(st)
        return

    conclusion, info = parse_conclusion(rr.get("answer", ""))
    st["conclusion"] = conclusion
    st["result_info"] = info

    if conclusion == "成功":
        st["status"] = "concluded"
        # 价格值与单位原样取自远端 [价格] 段，零本地解析/换算（铁律 6 改造版）
        st["price_info"] = parse_price(rr.get("answer", ""))
        # 四层商品编码原样取自远端 [四层] 段（远端没给则为 ""），供 CPQ 选品复用
        st["four_layer"] = parse_four_layer(rr.get("answer", ""))
        st["exception_retry_count"] = 0
        return
    if conclusion == "失败":
        st["status"] = "failed"
        st["exception_retry_count"] = 0
        return
    if conclusion == "待确认":
        st["status"] = "asking"
        st["exception_retry_count"] = 0
        return
    # 异常或 malformed：走预算路径
    _bump_exception_or_fail(st)


def _bump_exception_or_fail(st: Dict) -> None:
    """异常自动重试预算管理：第一次置 exception；第二次转 failed 终态。"""
    prev_count = st.get("exception_retry_count", 0)
    if prev_count >= 1:
        # 预算耗尽 → 失败终态
        last_info = st.get("result_info") or st.get("last_round_error") or ""
        st["status"] = "failed"
        st["conclusion"] = "失败"
        st["result_info"] = (
            f"[orchestrator] 异常重试耗尽；最后一轮原因：{last_info}"
        )
        return
    st["status"] = "exception"
    st["exception_retry_count"] = prev_count + 1


def run_orchestrator(run_dir: Path,
                     concurrency: int = _DEFAULT_CONCURRENCY,
                     per_task_timeout: int = 0,
                     resume: bool = False,
                     max_auto_rounds: int = 20,
                     progress_interval: int = 30,
                     batch_task_ids: Optional[List[str]] = None) -> int:
    """编排器主入口（结论协议版）。

    新行为：
        - 一次调用内自动连跑多轮，直到全部终态 或 出现 asking 待用户
        - exception 自动重试由 _build_round_request_for_task 控制（预算 1）
        - 不再写 classify_request / 不读 classify_response
        - **入口先抢 run-dir 单实例锁**：避免跨 shell 反复"重启"造成多 main_loop
          抢同一目录 task_states.json 的混乱状态（2026-06-20 排障教训）
        - **批次模式（2026-06-22 引入）**：传 ``batch_task_ids`` 时，本次调用仅处理
          该子集 ∩ (pending + exception + 已答 asking)；退出码 0/10 的判定也只看
          这个子集（"本批"语义）。其它任务保持现状不被发请求。
          summary.xlsx 仍按全量 task_states 写入（全局快照），保持产物契约不变。

    退出码扩展：
        - 0  全部终态（批模式：本批全终态；非批模式：全局全终态）
        - 1  CLI 误用 / IO 异常 / **run-dir 已被其它 orchestrator 持有**
        - 10 仍有 asking 待用户（批模式：本批；非批模式：全局）
    """
    # === 单实例锁 ===
    lock_handle = acquire_run_lock(run_dir)
    if lock_handle is None:
        info = read_run_lock_info(run_dir)
        meta = info.get("meta", {})
        _stderr(
            "另一个 orchestrator 已在处理此 run-dir，本次拒绝启动以避免状态冲突。\n"
            f"  run-dir   : {run_dir}\n"
            f"  锁持有者   : pid={meta.get('pid')} host={meta.get('hostname')} "
            f"started_at={meta.get('started_at')}\n"
            f"  python    : {meta.get('python_executable')}\n"
            f"建议：用 `--status {run_dir}` 查看进度；或先 kill 该进程再重跑。"
        )
        return 1

    try:
        return _run_orchestrator_locked(
            run_dir=run_dir,
            concurrency=concurrency,
            per_task_timeout=per_task_timeout,
            resume=resume,
            max_auto_rounds=max_auto_rounds,
            progress_interval=progress_interval,
            batch_task_ids=batch_task_ids,
        )
    finally:
        release_run_lock(lock_handle)


def _run_orchestrator_locked(run_dir: Path,
                             concurrency: int,
                             per_task_timeout: int,
                             resume: bool,
                             max_auto_rounds: int,
                             progress_interval: int,
                             batch_task_ids: Optional[List[str]] = None) -> int:
    """run_orchestrator 的真正实现 · 在持锁状态下运行。"""
    tasks = read_json(run_dir / "tasks.json")
    states_path = run_dir / "task_states.json"
    if states_path.exists():
        task_states: Dict[str, Dict] = read_json(states_path)
    else:
        task_states = {
            t["task_id"]: {
                "status": "pending", "rounds_taken": 0,
                "exception_retry_count": 0,
                "conversation_id": "", "download_links": [],
                "conclusion": None, "result_info": "", "price_info": "",
                "last_round_answer": "", "last_round_error": "",
                "last_round_message": "",
            } for t in tasks["tasks"]
        }

    answers: Dict = {}
    if resume:
        ans_path = run_dir / "answers.json"
        if ans_path.exists():
            answers = read_json(ans_path)
        if answers.get("abort"):
            for tid, st in task_states.items():
                if st.get("status") not in _TERMINAL_STATUSES:
                    st["status"] = "aborted_by_user"
            atomic_write_json(states_path, task_states)
            _write_final(run_dir, tasks, task_states)
            return 0

    common_ctx = tasks.get("common_context_suffix", "") or ""

    # 批次模式：把 batch_task_ids 转成 set 便于 O(1) 过滤；None / 空 → 老行为。
    # 退出码 0/10 的判定也按这个集合（"本批"语义）。所有未列入的任务保持现状不被发请求。
    # 详见 docs/2026-06-22-batching-design.md §4.B2。
    batch_set: Optional[set] = (
        {tid for tid in batch_task_ids} if batch_task_ids else None
    )
    if batch_set is not None:
        # 校验：batch_task_ids 都应是 tasks.json 中存在的 id；否则给个清晰报错
        all_tids = {t["task_id"] for t in tasks["tasks"]}
        unknown = batch_set - all_tids
        if unknown:
            _stderr(
                f"--batch-task-ids 包含未知 task_id（不在 tasks.json 中）："
                f"{sorted(unknown)}；本次拒绝执行。"
            )
            return 1
        _stderr(
            f"批次模式：仅处理 {len(batch_set)}/{len(all_tids)} 个 task_id（其余保持现状）"
        )
        _append_run_progress(
            run_dir,
            f"批次模式启动 · batch_size={len(batch_set)} · 全量={len(all_tids)}"
        )

    def _is_in_batch(tid: str) -> bool:
        return batch_set is None or tid in batch_set

    def _all_batch_terminal() -> bool:
        if batch_set is None:
            return all(st.get("status") in _TERMINAL_STATUSES
                       for st in task_states.values())
        return all(
            task_states.get(tid, {}).get("status") in _TERMINAL_STATUSES
            for tid in batch_set
        )

    def _any_batch_asking() -> bool:
        if batch_set is None:
            return any(st.get("status") == "asking"
                       for st in task_states.values())
        return any(
            task_states.get(tid, {}).get("status") == "asking"
            for tid in batch_set
        )

    for _auto_round in range(max_auto_rounds):
        todo: List[Dict] = []
        for t in tasks["tasks"]:
            if not _is_in_batch(t["task_id"]):
                continue
            prev = task_states.get(t["task_id"], {})
            req = _build_round_request_for_task(
                t, prev, answers, common_context_suffix=common_ctx
            )
            if req is not None:
                todo.append(req)

        if not todo:
            # 检查是否有 exception 任务但预算已耗尽 → 转 failed
            _finalize_exhausted_exceptions(task_states)
            atomic_write_json(states_path, task_states)
            if _all_batch_terminal():
                _write_final(run_dir, tasks, task_states)
                return 0
            # 本批有 asking（或罕见的 exception 兜底未能落 failed）→ pending
            _write_pending(run_dir, tasks, task_states)
            return 10

        round_no = _detect_current_round(run_dir) + 1
        round_msg = (
            f"开始第 {round_no} 轮，{len(todo)} 个任务，"
            f"并发 {concurrency}，超时 {per_task_timeout if per_task_timeout > 0 else '关闭'}"
        )
        _stderr(round_msg)
        _append_run_progress(run_dir, round_msg)

        results, timeouts = _run_round_with_timeout(
            todo=todo, run_dir=run_dir, round_no=round_no,
            concurrency=concurrency, per_task_timeout=per_task_timeout,
            task_states=task_states,
            progress_interval=progress_interval,
        )

        # timeout 直接终态
        for tid in timeouts:
            st = task_states.setdefault(tid, {})
            st["status"] = "timeout"
            st["rounds_taken"] = st.get("rounds_taken", 0) + 1
            st["last_round_error"] = (
                f"本地超时（>{per_task_timeout}s 未完成，已标记终态，不重试）"
                if per_task_timeout > 0 else "本地超时"
            )

        # 应用本轮 conclusion 结果
        for tid, rr in results.items():
            st = task_states.setdefault(tid, {})
            apply_result_to_state(st, rr)

        atomic_write_json(run_dir / f"round_{round_no}_results.json", {
            "round": round_no, "completed_at": _iso_now(),
            "results": results, "local_timeouts": timeouts,
        })
        atomic_write_json(states_path, task_states)
        # 每轮收尾写一行进度日志（供 --status / tail 排障）
        _state_summary: Dict[str, int] = {}
        for _st in task_states.values():
            _s = _st.get("status", "pending")
            _state_summary[_s] = _state_summary.get(_s, 0) + 1
        _append_run_progress(
            run_dir,
            f"第 {round_no} 轮结束 · 状态分布={_state_summary} · "
            f"本轮 timeouts={len(timeouts)}"
        )

        # 归档本轮已消费的 answers
        ans_path = run_dir / "answers.json"
        if answers and ans_path.exists():
            archive = run_dir / f"answers_round_{round_no - 1}.json"
            try:
                if archive.exists():
                    ans_path.unlink()
                else:
                    ans_path.rename(archive)
            except OSError:
                pass
            answers = {}  # 后续自动续轮不再消费

        # 每轮覆盖式写 summary（便于实时观察）
        _write_final(run_dir, tasks, task_states)

    _stderr(f"达到 max_auto_rounds={max_auto_rounds} 上限，强制返回")
    _finalize_exhausted_exceptions(task_states)
    atomic_write_json(states_path, task_states)
    if _all_batch_terminal():
        return 0
    _write_pending(run_dir, tasks, task_states)
    return 10


def _finalize_exhausted_exceptions(task_states: Dict) -> None:
    """循环退出前最后一道保险：把仍处于 exception 且预算已耗尽的任务转 failed。

    正常情况下 apply_result_to_state 已经在轮内处理；但极端情形下
    （例如 build_request 已经返回 None 但状态尚未被另一次 apply 转换）
    这里兜底确保不会有 exception 状态遗留导致 pending.json 视为 asking。
    """
    for tid, st in task_states.items():
        # 与 _build_round_request_for_task 的阈值（>=2）对齐：只有在重试预算彻底耗尽
        # 后才把 exception 转 failed（兜底路径；正常情况下 apply_result_to_state 第二次
        # 异常时就已经把它转成 failed 了）。
        if st.get("status") == "exception" and st.get("exception_retry_count", 0) >= 2:
            st["status"] = "failed"
            last_info = st.get("result_info") or st.get("last_round_error") or ""
            st["conclusion"] = "失败"
            st["result_info"] = f"[orchestrator] 异常重试耗尽（兜底）；最后一轮原因：{last_info}"


def _write_pending(run_dir: Path, tasks: Dict, task_states: Dict) -> None:
    """写 pending.json（暂用扩展签名；Task 5 会真正重写 pending.py）。"""
    round_no = _detect_current_round(run_dir)
    pending = build_pending(round_no=round_no, tasks=tasks,
                             task_states=task_states)
    atomic_write_json(run_dir / "pending.json", pending)


def _write_final(run_dir: Path, tasks: Dict, task_states: Dict) -> None:
    write_summary_xlsx(run_dir / "summary.xlsx", tasks=tasks, task_states=task_states)
    write_summary_md(run_dir / "summary.md", run_id=run_dir.name,
                     tasks=tasks, task_states=task_states,
                     current_round=_detect_current_round(run_dir))
