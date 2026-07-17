"""单 task 子进程入口。

调用方：`python3 -m orchestrator._task_worker --request <path> --result <path>
                                              --sub-run-dir <path>`

行为：
1. 从 --request JSON 文件读 {task_id, message, conversation_id}
2. **入口先做 sub_run_dir 可写性 probe**：第一时间暴露权限 / 跨设备 / 沙箱拒绝
   等"目录不可写"问题，避免拖到 _atomic_write_json 才崩
3. 调 call_knot_agent.call_knot_agent(...) 并把环境变量 KNOT_API_TOKEN/USER 透传
4. 把返回值原子写到 --result（包成 {success, answer, conversation_id, download_links, error}）；
   写盘失败时**降级写到 _FALLBACK_DIR**（系统临时目录），并在 stderr 输出完整 traceback，
   让 main_loop 的 worker_stderr.log + fallback result.json 双链路至少一条可读
5. 如果设置了 INQUIRY_PARALLEL_FAKE_WORKER_* 环境变量，跳过真实 call_knot_agent，
   按 fake 协议返回（见下方）；用于测试，让 subprocess 路径不依赖网络。

退出码：
- 0：result.json 已写到原位（业务成功 / 业务失败都用这个）
- 2：原位写失败但 fallback 已写出（main_loop 应去 fallback 找）
- 1+：所有写盘均失败，stderr 应有 traceback；main_loop 走 worker_stderr.log 兜底
"""
import argparse
import hashlib
import json
import os
import sys
import tempfile
import time
import traceback
from pathlib import Path


# 当 --result 原位写失败（沙箱 / 权限 / 跨设备）时，worker 把 result 降级写到这里。
# main_loop 的"worker died without result"分支会按相同算法计算 fallback 路径并兜底读取。
_FALLBACK_DIR = Path(tempfile.gettempdir()) / "inquiry-fallback"


def _fallback_path_for(result_path: Path) -> Path:
    """根据 --result 的绝对路径计算稳定的 fallback 路径。

    用 sha256(absolute_result_path) 前 16 位作为文件名，保证：
    - 同一 task 同一轮的 worker 与 main_loop 算出来的路径一致
    - 不同 task / 不同轮不会撞名（即使 task_id 相同）
    - 文件名不含特殊字符，跨平台安全
    """
    abs_path = str(result_path.resolve()) if result_path.is_absolute() \
        else str(Path(result_path).absolute())
    digest = hashlib.sha256(abs_path.encode("utf-8")).hexdigest()[:16]
    return _FALLBACK_DIR / f"{digest}.json"


def _probe_writable(directory: Path) -> "tuple[bool, str]":
    """在 directory 内尝试写一个微小的 probe 文件，立即删除。

    返回 (ok, error_msg)。OK 表示该目录此刻可写，可以放心走 _atomic_write_json。
    用途：worker 入口提前暴露"目录看似存在但实际不可写"（沙箱 / 只读挂载 / NFS 锁等）。
    """
    try:
        directory.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        return False, f"mkdir failed: {type(e).__name__}: {e}"
    probe = directory / f".write_probe.{os.getpid()}"
    try:
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        return True, ""
    except Exception as e:
        return False, f"probe write failed: {type(e).__name__}: {e}"


def _atomic_write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.tmp.{os.getpid()}")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)


class _ModuleIdentityError(RuntimeError):
    """call_knot_agent 模块身份校验失败专用异常。

    用独立异常类便于：
    - 测试时精确捕获（不被普通 RuntimeError 误吞）
    - 错误信息 type 名清晰可读，落到 worker exception 路径时一眼能识别
    """


def _verify_module_identity(module, expected_dir: Path) -> None:
    """校验 import 进来的 call_knot_agent 是否来自我们期望的 scripts_dir。

    防御场景（probability 低 · impact 高）：
    用户系统的 site-packages 里如果凑巧有同名 package（理论上 PEP 328 + sys.path
    优先级保证不会发生 · 但仍存在 .pth 文件 / namespace package 等边缘玩法），
    `import call_knot_agent` 会成功但拿到了别的代码 · 后续调用全是 AttributeError
    或行为漂移 · 极难诊断。本函数在 import 后立刻校验 __file__ 路径前缀 ·
    不匹配立刻 raise · 由调用方落入 "worker exception:" 路径（命中 unrecoverable
    白名单 · 不进重试预算 · 不放大噪音）。
    """
    actual_file = getattr(module, "__file__", None)
    if not actual_file:
        raise _ModuleIdentityError(
            f"imported call_knot_agent has no __file__ attribute "
            f"(可能是 namespace package 或被异常注入)"
        )
    actual_path = Path(actual_file).resolve()
    expected_root = expected_dir.resolve()
    try:
        actual_path.relative_to(expected_root)
    except ValueError:
        raise _ModuleIdentityError(
            f"call_knot_agent 模块路径 shadow 检测：\n"
            f"  实际加载: {actual_path}\n"
            f"  期望来自: {expected_root}\n"
            f"提示: 检查 sys.path / site-packages / PYTHONPATH 是否被外部注入了"
            f"同名包"
        )


def _write_result_with_fallback(
    result_path: Path,
    result: dict,
) -> "tuple[int, str]":
    """把 result 写到原位；失败时降级写 fallback。

    返回 (exit_code, note):
    - (0, "")        原位写成功
    - (2, msg)       原位写失败但 fallback 写成功；msg 是原位写的错因
    - (1, msg)       原位 + fallback 都失败；msg 含两条错因
    """
    try:
        _atomic_write_json(result_path, result)
        return 0, ""
    except Exception as primary_err:
        primary_tb = traceback.format_exc()
        # 把原位写失败的原因合并进 result.error，让 fallback 文件自带诊断
        merged = dict(result)
        merged["error"] = (
            f"{result.get('error', '') or ''}\n"
            f"--- primary write failed ---\n"
            f"{type(primary_err).__name__}: {primary_err}\n{primary_tb}"
        ).strip()
        try:
            fb_path = _fallback_path_for(result_path)
            _atomic_write_json(fb_path, merged)
            # 同时把这条错误打到 stderr，让 main_loop 的 worker_stderr.log 也能拿到
            print(
                f"[worker] primary result write failed → fallback written to {fb_path}\n"
                f"{primary_tb}",
                file=sys.stderr,
                flush=True,
            )
            return 2, f"primary={type(primary_err).__name__}: {primary_err}; fallback=ok({fb_path})"
        except Exception as fb_err:
            print(
                f"[worker] BOTH primary and fallback write failed.\n"
                f"primary error:\n{primary_tb}\n"
                f"fallback error:\n{traceback.format_exc()}",
                file=sys.stderr,
                flush=True,
            )
            return 1, (
                f"primary={type(primary_err).__name__}: {primary_err}; "
                f"fallback={type(fb_err).__name__}: {fb_err}"
            )


def _maybe_fake_response(req: dict) -> "dict | None":
    """fake worker hook.

    通过环境变量驱动，避免子进程依赖网络。三种模式：

    1. INQUIRY_PARALLEL_FAKE_WORKER_SCRIPT=<path>
       从文件加载 Python 模块，调用其 respond(req) 函数。
       优先级最高，支持有状态逻辑（通过磁盘计数器等）。

    2. INQUIRY_PARALLEL_FAKE_WORKER_FILE=<path>
       从文件读 JSON。可包含可选 "sleep_seconds"（int / float）。
       JSON 结构：
       {
         "sleep_seconds": 3.0,   # 可选；模拟慢任务
         "response": {           # 必填；call_knot_agent 风格的返回 dict
           "success": true, "answer": "[结论] 成功\\n[结果信息] ok",
           "conversation_id": "cid", "download_links": [], "error": ""
         },
         "per_task_match": "task_001"   # 可选：仅当 req.task_id == 此值才用 fake；
                                          # 否则正常 fall through
       }

    3. INQUIRY_PARALLEL_FAKE_WORKER_INLINE=<json-string>
       同上，但内联（用于无文件场景）。

    返回 dict 表示要用 fake；返回 None 表示走真实 call_knot_agent。
    """
    # Mode 1: script-based fake (stateful via disk)
    script_path = os.environ.get("INQUIRY_PARALLEL_FAKE_WORKER_SCRIPT", "")
    if script_path:
        try:
            import importlib.util
            spec = importlib.util.spec_from_file_location("fake_worker_user", script_path)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod.respond(req)
        except Exception as e:
            return {
                "success": False, "answer": "",
                "conversation_id": req.get("conversation_id", ""),
                "download_links": [],
                "error": f"fake worker script failed: {e}\n{traceback.format_exc()}",
            }

    # Mode 2 & 3: file/inline JSON fake
    fake_path = os.environ.get("INQUIRY_PARALLEL_FAKE_WORKER_FILE", "")
    fake_inline = os.environ.get("INQUIRY_PARALLEL_FAKE_WORKER_INLINE", "")
    if not fake_path and not fake_inline:
        return None

    try:
        if fake_path:
            cfg = json.loads(Path(fake_path).read_text(encoding="utf-8"))
        else:
            cfg = json.loads(fake_inline)
    except Exception as e:
        return {
            "success": False, "answer": "",
            "conversation_id": req.get("conversation_id", ""),
            "download_links": [],
            "error": f"fake worker config parse failed: {e}",
        }

    match = cfg.get("per_task_match")
    if match and req.get("task_id") != match:
        return None

    sleep = float(cfg.get("sleep_seconds", 0))
    if sleep > 0:
        time.sleep(sleep)

    resp = cfg.get("response")
    if not isinstance(resp, dict):
        return {
            "success": False, "answer": "",
            "conversation_id": req.get("conversation_id", ""),
            "download_links": [],
            "error": "fake worker config missing 'response'",
        }
    return resp


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    parser.add_argument("--result", required=True)
    parser.add_argument("--sub-run-dir", required=True)
    args = parser.parse_args()

    # 让 worker 能 import scripts/ 下的 call_knot_agent
    # 路径布局：<skill>/scripts/orchestrator/_task_worker.py
    #   → parent.parent = <skill>/scripts
    #   → parent.parent.parent = <skill>
    scripts_dir = Path(__file__).resolve().parent.parent
    skill_root = scripts_dir.parent
    sys.path.insert(0, str(skill_root))
    sys.path.insert(0, str(scripts_dir))

    result_path = Path(args.result)
    sub_run_dir = Path(args.sub_run_dir)

    # === 入口可写性 probe ===
    # RUN_DIR 由调用方传入（可能在 IDE 沙箱 / 同步盘 / NFS 等"看着像目录但写不了"的位置）。
    # 提前 probe 一下，让"目录不可写"问题在第一行错误里就明确，
    # 而不是拖到 _atomic_write_json 才报，且让用户看到"在哪个目录"出问题。
    ok, probe_err = _probe_writable(sub_run_dir)
    if not ok:
        diag = {
            "success": False, "answer": "", "conversation_id": "",
            "download_links": [],
            "error": (
                f"worker exception: sub_run_dir not writable: {sub_run_dir}\n"
                f"原因: {probe_err}\n"
                f"提示: 请确认 --run-dir 指向的目录在当前进程下可写"
                f"（常见原因：IDE 沙箱拒绝 / 同步盘锁定 / NFS 权限 / 跨设备挂载）"
            ),
        }
        # 把同样信息再打一份到 stderr，确保即使写盘全失败 main_loop 也能从 stderr 看到
        print(diag["error"], file=sys.stderr, flush=True)
        rc, _ = _write_result_with_fallback(result_path, diag)
        return rc

    try:
        req = json.loads(Path(args.request).read_text(encoding="utf-8"))
    except Exception as e:
        diag = {
            "success": False, "answer": "", "conversation_id": "",
            "download_links": [],
            "error": (
                f"worker exception: failed to read request {args.request}: "
                f"{type(e).__name__}: {e}\n{traceback.format_exc()}"
            ),
        }
        print(diag["error"], file=sys.stderr, flush=True)
        rc, _ = _write_result_with_fallback(result_path, diag)
        return rc

    fake = _maybe_fake_response(req)
    if fake is not None:
        rc, _ = _write_result_with_fallback(result_path, fake)
        return rc

    try:
        import call_knot_agent  # type: ignore
        # 防御 site-packages 同名 shadow（详见 _verify_module_identity docstring）
        _verify_module_identity(call_knot_agent, scripts_dir)
        run_store = call_knot_agent.RunStore(run_dir=args.sub_run_dir)
        result = call_knot_agent.call_knot_agent(
            message=req["message"],
            conversation_id=req.get("conversation_id", ""),
            token=os.environ.get("KNOT_API_TOKEN", ""),
            user=os.environ.get("KNOT_API_USER", ""),
            run_store=run_store,
        )
    except Exception as e:
        tb = traceback.format_exc()
        # 把 traceback 同步打到 stderr：即使写盘成功，也让 worker_stderr.log 留一份诊断
        print(
            f"[worker] call_knot_agent raised: {type(e).__name__}: {e}\n{tb}",
            file=sys.stderr,
            flush=True,
        )
        result = {
            "success": False, "answer": "",
            "conversation_id": req.get("conversation_id", ""),
            "download_links": [],
            "error": f"worker exception: {type(e).__name__}: {e}\n{tb}",
        }

    rc, _ = _write_result_with_fallback(result_path, result)
    return rc


if __name__ == "__main__":
    sys.exit(main())
