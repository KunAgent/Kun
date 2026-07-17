#!/usr/bin/env python3
"""操作系统与执行环境探测层。

把所有需要动态探测才能确定的变量（Python 解释器名、tccli 路径、真实 HOME、
隔离 HOME 的环境变量设置、插件根路径、各脚本路径）收敛在此。其他脚本通过
`import base` 获取，不再关心是 python 还是 python3、HOME 在哪、平台是 win32
还是 posix 等差异。

设计原则：
- 路径以本文件 __file__ 为锚点自定位，不依赖 CODEBUDDY_PLUGIN_ROOT 环境变量
  （该变量作为可选优先项，缺省时回退到 __file__ 推导，保证软链/拷贝部署都能工作）
- 跨平台：mac/linux/windows 均用标准库，零硬编码平台路径/命令/分隔符
"""

import os
import shutil
import subprocess
import sys

_THIS = os.path.dirname(os.path.abspath(__file__))

# 让本进程 spawn 的所有子进程（scripts 互调、time_util、经 make_isolated_home_env 的 tccli）
# 启动即进入 Python UTF-8 Mode，避免 Windows 默认 locale 编码（cp936/GBK）导致中文乱码。
# setdefault 不覆盖用户已显式设置的值。
os.environ.setdefault("PYTHONUTF8", "1")
os.environ.setdefault("PYTHONIOENCODING", "utf-8")

# 当前进程启动时 PYTHONUTF8 尚未生效，故标准流仍需显式 reconfigure 为 utf-8。
try:
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except (AttributeError, ValueError, OSError):
    pass

def is_windows():
    """是否 Windows 平台。"""
    return sys.platform == "win32"


def python():
    """当前 Python 解释器可执行路径（跨平台，替代硬编码 python/python3）。"""
    return sys.executable or "python3"


def which(cmd):
    """查找可执行文件路径，未找到返回 None。"""
    return shutil.which(cmd)


def tccli():
    """tccli 可执行路径，未安装返回 None。"""
    return shutil.which("tccli")


def _pip_bin_dir():
    """pip 安装可执行文件的目录（Windows: Scripts，posix: bin）。

    装出的 tccli 通常落在此目录，但它可能不在当前进程 PATH 里，
    需补进 PATH 后 shutil.which 才能找到。
    """
    candidate = os.path.join(sys.prefix, "Scripts" if is_windows() else "bin")
    return candidate if os.path.isdir(candidate) else None


def _refresh_path_for_tccli():
    """把 pip 安装目录补进当前进程 PATH，使新装的 tccli 可被 which 找到。

    pip install 在子进程内完成，不会改本进程的 PATH；若不补，装完仍 which 不到。
    """
    extra = _pip_bin_dir()
    if not extra:
        return
    paths = os.environ.get("PATH", "").split(os.pathsep)
    if extra not in paths:
        os.environ["PATH"] = extra + os.pathsep + os.environ.get("PATH", "")


def ensure_tccli_installed(timeout=300):
    """确保 tccli 已安装；未装则自动 `python -m pip install tccli`。

    供 check 脚本调用：探测 tccli → 未装则用当前解释器装 → 装完补 PATH 重新探测。
    跨平台（用 sys.executable，不硬编码 pip/pip3）、仅用标准库、不 sys.exit。
    失败时优雅降级，由调用方决定如何转述。

    返回 (ok: bool, message: str)：
      - (True, "")：已安装（原本就在或自动安装成功）
      - (False, msg)：未安装且自动安装失败，msg 含可转述的失败原因
    """
    if tccli():
        return True, ""

    # 用 `python -m pip` 而非裸 pip：跨平台、与当前解释器绑定，避免 pip.exe 路径问题。
    cmd = [python(), "-m", "pip", "install", "tccli"]
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return False, f"自动安装超时（{timeout}s）。请手动执行：{python()} -m pip install tccli"
    except Exception as e:
        return False, f"自动安装失败（无法启动 pip）：{e}。请手动执行：{python()} -m pip install tccli"

    if result.returncode != 0:
        tail = (result.stderr or result.stdout or "").strip().splitlines()
        tail = "\n".join(tail[-5:]) if tail else ""
        hint = f"\n{tail}" if tail else ""
        return False, f"自动安装失败（pip 退出码 {result.returncode}）。请手动执行：{python()} -m pip install tccli{hint}"

    # 装完补 PATH 再探测；若仍找不到，提示重开终端（PATH 未刷新）。
    _refresh_path_for_tccli()
    if tccli():
        return True, ""

    return False, (
        "tccli 已安装，但当前终端未在 PATH 中识别到它。请新开一个终端后重新运行检查；"
        f"或手动确认 {python()} -m pip show tccli 已安装成功。"
    )


def real_home():
    """真实用户 HOME 目录（.tccli 配置所在）。"""
    return os.path.expanduser("~")


def make_isolated_home_env(tmp_home):
    """构造带隔离 HOME 的 env 副本（用于并发 tccli 调用，避免 ~/.tccli 争抢）。

    Windows 设置 USERPROFILE，posix 设置 HOME；其余环境变量继承当前进程。
    """
    env = os.environ.copy()
    env["PYTHONWARNINGS"] = "ignore"
    if is_windows():
        env["USERPROFILE"] = tmp_home
    else:
        env["HOME"] = tmp_home
    return env


def plugin_root():
    """插件根目录（含 .codebuddy-plugin/、skills/、agents/ 等）。

    优先 CODEBUDDY_PLUGIN_ROOT 环境变量；否则由本文件位置向上推导
   （scripts → tc-sec → skills → plugin_root）。
    """
    env_root = os.environ.get("CODEBUDDY_PLUGIN_ROOT")
    if env_root and os.path.isdir(env_root):
        return env_root
    # scripts -> tc-sec -> skills -> plugin_root
    return os.path.dirname(os.path.dirname(os.path.dirname(_THIS)))


def scripts_dir():
    """skills/tc-sec/scripts 目录（本文件所在）。"""
    return _THIS


def script_path(name):
    """scripts 目录下某脚本的绝对路径。"""
    return os.path.join(_THIS, name)


def tccli_cli_path():
    return script_path("tccli_cli.py")


def time_util_path():
    return script_path("time_util.py")


def report_html_path():
    return script_path("report_html.py")


def wf_path():
    return script_path("wf.py")


_WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]


def format_date_cn(date_str):
    """把 'YYYY-MM-DD' 格式化为中文显示 'YYYY年M月D日（周X）'；解析失败原样返回。

    供报告层显示用（非 API 时间参数）。datetime 解析收敛在此，调用方无需 import datetime。
    """
    from datetime import datetime
    try:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
        return f"{dt.year}年{dt.month}月{dt.day}日（{_WEEKDAYS[dt.weekday()]}）"
    except (ValueError, TypeError):
        return date_str

