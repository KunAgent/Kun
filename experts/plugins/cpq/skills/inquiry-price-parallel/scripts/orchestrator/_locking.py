"""跨平台 advisory file lock 兼容层。

POSIX：fcntl.flock(LOCK_EX | LOCK_NB)
Windows：msvcrt.locking(LK_NBLCK, ...)

两者都是"内核维护、进程死后自动释放"，不依赖外部清理（PID 文件 + kill -0
那种自造锁会因 PID 复用 / 跨 shell / 跨 ssh 出现假阳性，禁用）。

公共契约：
- `try_acquire(fd) -> bool`：非阻塞 LOCK_EX；拿到返回 True，被占返回 False
- `release(fd) -> None`：释放当前进程在该 fd 上的锁；未持有时是 no-op
- `IS_AVAILABLE: bool`：本平台是否支持真互斥锁（决定 acquire_run_lock 是否走降级）

Windows 行为说明：
- msvcrt.locking 是按字节区间锁。我们统一锁文件首字节（offset 0, length 1）
- 同一进程多次 LK_NBLCK 同一区间会失败（不是递归锁）— 调用方不应重复 acquire
- 进程异常退出时 OS 自动释放（Windows kernel 会清理 file lock）
"""
from __future__ import annotations

import os
import sys
from typing import Optional


# ============================================================
# 后端选择：POSIX (fcntl) / Windows (msvcrt)
# ============================================================

_BACKEND = None  # "posix" | "windows" | None
_fcntl = None
_msvcrt = None

try:  # POSIX
    import fcntl as _fcntl  # type: ignore
    _BACKEND = "posix"
except ImportError:
    try:  # Windows
        import msvcrt as _msvcrt  # type: ignore
        _BACKEND = "windows"
    except ImportError:
        _BACKEND = None  # 极少见（如某些嵌入式 Python）→ 上层走降级


IS_AVAILABLE: bool = _BACKEND is not None


# Windows msvcrt.locking 的"区间长度" — 锁文件首字节即可
_WIN_LOCK_LEN = 1


def try_acquire(fd: int) -> bool:
    """非阻塞独占锁。拿到返回 True；已被占用返回 False。

    其它 OSError（如 fd 不可写）会原样抛出 — 调用方应当先确认 fd 是 O_RDWR 打开。
    """
    if _BACKEND == "posix":
        try:
            _fcntl.flock(fd, _fcntl.LOCK_EX | _fcntl.LOCK_NB)  # type: ignore[union-attr]
            return True
        except BlockingIOError:
            return False
        except OSError as e:
            # EWOULDBLOCK 在某些平台上 errno 不同，统一当作"被占"
            import errno
            if e.errno in (errno.EWOULDBLOCK, errno.EAGAIN, errno.EACCES):
                return False
            raise

    if _BACKEND == "windows":
        # msvcrt.locking 必须从 fd 当前 offset 开始；先 seek 到 0
        try:
            os.lseek(fd, 0, os.SEEK_SET)
            _msvcrt.locking(fd, _msvcrt.LK_NBLCK, _WIN_LOCK_LEN)  # type: ignore[union-attr]
            return True
        except OSError:
            # Windows 在锁冲突时抛 OSError(EACCES/EDEADLK)
            return False

    # 没有任何锁后端 → 退化为"假装拿到"。上层 acquire_run_lock 应通过
    # IS_AVAILABLE 判断是否走 windows_fallback 元信息分支，不应走到这里。
    return True


def release(fd: int) -> None:
    """释放锁。幂等，未持有时是 no-op。"""
    if _BACKEND == "posix":
        try:
            _fcntl.flock(fd, _fcntl.LOCK_UN)  # type: ignore[union-attr]
        except Exception:
            pass
        return

    if _BACKEND == "windows":
        try:
            os.lseek(fd, 0, os.SEEK_SET)
            _msvcrt.locking(fd, _msvcrt.LK_UNLCK, _WIN_LOCK_LEN)  # type: ignore[union-attr]
        except Exception:
            pass
        return

    # 无后端：no-op
    return


def backend_name() -> str:
    """返回 'posix' / 'windows' / 'none'，主要给 --status 输出用。"""
    return _BACKEND or "none"
