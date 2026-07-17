"""run-dir 工具：沙箱目录探测、原子写、JSON 读取、单实例锁。

设计依据：spec §3.4 + §3.5

补充（2026-06）：新增 `acquire_run_lock` / `release_run_lock` / `read_run_lock_info`
三件套，用 `_locking.try_acquire/release` 给 run-dir 加 advisory exclusive lock，
避免 AI / 用户在跨 shell 反复"重启"编排器时多个 main_loop 抢同一个 run-dir 的
task_states.json。

锁的语义：
- 同一 run-dir 同一时刻只允许一个 orchestrator 持锁
- 锁文件存在但 try_acquire 成功 → 上一个进程已死，当前可以接管
- 锁文件存在且 try_acquire 失败 → 真正有活的 orchestrator，本次 fail-fast
- 锁文件里写入 {pid, started_at, hostname, python_executable} 用于 --status 排障

平台支持（2026-06-22 P0 修订）：
- POSIX：fcntl.flock(LOCK_EX | LOCK_NB)
- Windows：msvcrt.locking(LK_NBLCK, ...)
- 两者皆为内核维护，进程死后自动释放
- 不要用 PID 文件 + `kill -0` 自己造锁——跨 shell + 跨 ssh + PID 复用都会假阳性
"""
import json
import os
import secrets
import socket
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

from . import _locking


def _can_write(path: Path) -> bool:
    try:
        path.mkdir(parents=True, exist_ok=True)
        probe = path / f".write_probe_{os.getpid()}"
        probe.write_text("x")
        probe.unlink()
        return True
    except Exception:
        return False


def pick_sandbox_root(cwd: Optional[Path] = None) -> Path:
    """按 spec §3.4 的优先级探测可写沙箱根目录。

    本 skill 的临时数据统一落在 `<workspace>/.tmp/inquiry-price-runs/` 下，
    以与 `.codebuddy/`（项目持久数据）解耦。无可写候选项时回退到 HOME。
    """
    cwd = cwd or Path.cwd()

    candidates = []

    cb_ws = os.environ.get("CODEBUDDY_WORKSPACE")
    if cb_ws:
        candidates.append(Path(cb_ws) / ".tmp" / "inquiry-price-runs")

    ws = os.environ.get("WORKSPACE_FOLDER")
    if ws:
        candidates.append(Path(ws) / ".tmp" / "inquiry-price-runs")

    candidates.append(cwd / ".tmp" / "inquiry-price-runs")

    home = Path(os.environ.get("HOME", str(Path.home())))
    candidates.append(home / ".workbuddy" / "inquiry-price-runs")

    for c in candidates:
        if _can_write(c):
            return c

    return candidates[-1]


def new_run_dir_name() -> str:
    """生成形如 run_20260616_152300_a3f7 的目录名。"""
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    rand = secrets.token_hex(2)
    return f"run_{ts}_{rand}"


def atomic_write_json(path: Path, data) -> None:
    """原子写 JSON。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.tmp.{os.getpid()}")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)


def read_json(path: Path):
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


# ============================================================
# 单实例锁（advisory · 跨平台 fcntl/msvcrt）
# ============================================================
#
# 用法（main_loop 入口）：
#     handle = acquire_run_lock(run_dir)
#     if handle is None:
#         info = read_run_lock_info(run_dir)
#         print(f"已有 orchestrator 在跑此 run-dir：{info}", file=sys.stderr)
#         return 1   # 退出码 1 由 SKILL.md 收口
#     try:
#         ...        # 真正的主循环
#     finally:
#         release_run_lock(handle)
#
# 设计原则：
# - 锁文件里写**JSON 元信息**而不是裸 pid · 排障时 `--status` / `cat` 一目了然
# - POSIX 用 fcntl.flock，Windows 用 msvcrt.locking · 进程死掉内核自动释放
# - 没有任何锁后端时（极少见）走 windows_fallback：只写元信息文件，不抢锁

_LOCK_FILENAME = ".orchestrator.lock"


class _LockHandle:
    """持有打开的锁文件 + 锁状态。release_run_lock 用。"""
    __slots__ = ("path", "fd", "windows_fallback")

    def __init__(self, path: Path, fd: Optional[int], windows_fallback: bool = False):
        self.path = path
        self.fd = fd
        # windows_fallback=True 表示"无任何锁后端，只写了元信息文件"。
        # 注意：Windows 上有 msvcrt 时不会走 fallback，会走真锁分支。
        self.windows_fallback = windows_fallback


def _build_lock_meta() -> Dict[str, Any]:
    return {
        "pid": os.getpid(),
        "started_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "started_at_epoch": time.time(),
        "hostname": socket.gethostname(),
        "python_executable": sys.executable,
        "argv": sys.argv,
        "lock_backend": _locking.backend_name(),
    }


def acquire_run_lock(run_dir: Path) -> Optional[_LockHandle]:
    """尝试给 run_dir 加独占锁。返回 handle 表示成功；None 表示已被占用。

    锁文件路径：<run_dir>/.orchestrator.lock
    成功后会向锁文件写入 JSON 元信息（pid / started_at / hostname / argv）。
    """
    run_dir.mkdir(parents=True, exist_ok=True)
    lock_path = run_dir / _LOCK_FILENAME

    # 极少见：Python 编译时既无 fcntl 也无 msvcrt → 降级写元信息文件，不抢锁
    if not _locking.IS_AVAILABLE:
        try:
            with lock_path.open("w", encoding="utf-8") as f:
                json.dump(_build_lock_meta(), f, ensure_ascii=False, indent=2)
        except Exception:
            pass
        return _LockHandle(path=lock_path, fd=None, windows_fallback=True)

    # POSIX(fcntl) / Windows(msvcrt)：通过 _locking 抽象抢真锁
    # Windows msvcrt.locking 要求文件至少有 1 个字节才能锁首字节区间，
    # 这里 O_RDWR | O_CREAT 后写入一个占位字节再 seek 回 0，POSIX 也吃这个组合
    fd = os.open(str(lock_path), os.O_RDWR | os.O_CREAT, 0o644)
    try:
        # 确保文件至少 1 字节（Windows 需要）
        try:
            stat_size = os.fstat(fd).st_size
            if stat_size == 0:
                os.write(fd, b" ")
                os.fsync(fd)
                os.lseek(fd, 0, os.SEEK_SET)
        except Exception:
            pass

        if not _locking.try_acquire(fd):
            os.close(fd)
            return None
    except Exception:
        os.close(fd)
        raise

    # 锁拿到了 · 写元信息（先 truncate · 否则会留旧 pid）
    # Windows msvcrt 锁的是 [0, 1)，ftruncate 也合法（锁是字节区间，不阻止 truncate）
    try:
        os.ftruncate(fd, 0)
        os.lseek(fd, 0, os.SEEK_SET)
        meta = json.dumps(_build_lock_meta(), ensure_ascii=False, indent=2) + "\n"
        os.write(fd, meta.encode("utf-8"))
        os.fsync(fd)
    except Exception:
        # 写元信息失败不应阻塞主流程 · 锁本身已经拿到
        pass

    return _LockHandle(path=lock_path, fd=fd, windows_fallback=False)


def release_run_lock(handle: Optional[_LockHandle]) -> None:
    """释放锁。幂等，安全可重入。"""
    if handle is None:
        return
    if handle.fd is None:
        # 无锁后端的 fallback：删元信息文件
        try:
            handle.path.unlink(missing_ok=True)  # type: ignore[arg-type]
        except Exception:
            pass
        return
    _locking.release(handle.fd)
    try:
        os.close(handle.fd)
    except Exception:
        pass
    # 锁文件保留以便 --status 读历史 · 关闭即释放（fcntl/msvcrt 行为）。
    # 如果想"干净退出"也可以 unlink；这里选择保留，便于事后排障。


def read_run_lock_info(run_dir: Path) -> Dict[str, Any]:
    """只读获取锁文件里的元信息，并实时检测锁是否仍被持有。

    返回字段：
        present: bool        — 锁文件是否存在
        meta: dict           — 锁文件里的 JSON 元信息（可能为空）
        held: Optional[bool] — True=有进程持锁 · False=无进程持锁 · None=无法判断
    """
    lock_path = run_dir / _LOCK_FILENAME
    if not lock_path.exists():
        return {"present": False, "meta": {}, "held": False}

    meta: Dict[str, Any] = {}
    try:
        meta = json.loads(lock_path.read_text(encoding="utf-8"))
    except Exception:
        meta = {}

    if not _locking.IS_AVAILABLE:
        return {"present": True, "meta": meta, "held": None}

    # 用非阻塞独占锁试探：能拿到说明没人持锁 · 拿不到说明有活进程
    fd = os.open(str(lock_path), os.O_RDWR)
    held = True
    try:
        if _locking.try_acquire(fd):
            _locking.release(fd)
            held = False
        else:
            held = True
    finally:
        try:
            os.close(fd)
        except Exception:
            pass

    return {"present": True, "meta": meta, "held": held}
