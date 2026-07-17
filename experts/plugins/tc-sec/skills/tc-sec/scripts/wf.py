#!/usr/bin/env python3
"""Workflow 辅助库：封装并发执行、分页、时间参数、中间数据落盘，减少 AI 生成脚本的字符数。

约束红线（违反会破坏插件或数据准确性）：
- 所有 tccli 调用必须经 tccli_cli.py（本模块暴露的 T 即指向它，不提供裸 tccli 捷径）
- 所有时间参数经 time_util.py（本模块禁 import datetime / time.strftime；只用 time.time() 取整数时间戳作落盘文件名）
- 统计数值以 API 返回的 TotalCount 为准，page 返回的 dict 保留 TotalCount，禁止用 len(list_key) 当总数
- 分页补页判据为 len(首页已采) < TotalCount（非单纯 total>limit），总量超 MAX_TOTAL(10000) 截断并在返回 dict 加 _Capped/_CappedAt 标注，报告中须据此标注"仅前 N 条"
- exec 用 _extract_json 容错提取（处理 tccli 混杂输出），仍解析失败返回 {"Error":{"Code":"ParseFailed",...},"dump":path}
- 统一分页入口 page() 自动探测分页/filter 位置：先顶层 --Limit/--Offset + 顶层 --Filters；被 'Unknown options: --Limit/--Offset' 拒绝则 fallback 到整体 --Filter JSON（含 Limit/Offset/Filters，csip 等）。filter 自动从 {Key,Values} 适配 {Name,Values}。调用方一律用 wf.page，无需关心分页/filter 位置（无 pagef/pageo）。真失败（权限/未开通/网络）不触发 fallback，原样返回 Error
- 命令数组约定 [PY,T,product,action,...]（PY=wf.PY=sys.executable），exec/batch 依赖 c[2]=product c[3]=action 生成落盘文件名
- 失败统一返回大写 Error 键 {"Error":{"Code","Message"}}，调用方用 "Error" in d 判断
- 默认 max_workers=5 防 API 限频
"""

import json
import os
import subprocess
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from itertools import count

import base

SCR = base.scripts_dir()
T = base.tccli_cli_path()
TU = base.time_util_path()
PY = base.python()

_TS = str(int(time.time()))
_TMP = os.path.join(tempfile.gettempdir(), "tc-sec_workflow")
os.makedirs(_TMP, exist_ok=True)

_SEQ = count()

MAX_TOTAL = 10000  # 单 Action 分页采集总量上限，防 TotalCount 异常导致海量请求（超出则截断并标注）


def _plan_offsets(total, limit, merged_len):
    """根据 TotalCount 与已采首页量计算补页 offsets。返回 (offsets, capped: bool)。

    补页判据：len(merged) < total（首页量不足总数才补，避免 TotalCount 缺失=0 误判为"已采完"以外的方向、也避免 total>limit 但首页已给全量的误补）。
    总量超 MAX_TOTAL 则截断到上限并标记 capped，调用方据此标注截断。
    """
    if total <= 0 or merged_len >= total:
        return [], False
    cap = min(total, MAX_TOTAL)
    offsets = list(range(limit, cap, limit))
    return offsets, cap < total


def _dump_name(cmd):
    """从命令数组取 product_action 生成落盘文件名；加进程内序号保证并发同名命令不冲突。"""
    try:
        base_name = f"{cmd[2]}_{cmd[3]}"
    except (IndexError, TypeError):
        base_name = f"cmd_{abs(hash(tuple(cmd)))}"
    return os.path.join(_TMP, f"{base_name}_{_TS}_{next(_SEQ)}.json")


def _extract_json(text):
    """从可能含非 JSON 前缀/后缀的输出中提取首个合法 JSON 对象/数组（容错：tccli 偶有日志/警告混入 stdout）。无则返回 None。

    策略：定位首个 { 或 [，先尝试到末尾整体解析；失败则从末尾回扫闭合括号找合法前缀。避免 O(n²) 反复全量解析。
    """
    text = text.strip() if isinstance(text, str) else ""
    if not text:
        return None
    start = text.find("{")
    if start < 0:
        start = text.find("[")
    if start < 0:
        return None
    cand = text[start:]
    try:
        return json.loads(cand)
    except Exception:
        pass
    close = "}" if cand.startswith("{") else "]"
    idx = cand.rfind(close)
    while idx > 0:
        try:
            return json.loads(cand[:idx + 1])
        except Exception:
            idx = cand.rfind(close, 0, idx)
    return None


def exec(cmd):
    """执行单条命令数组，返回解析后 dict。json.loads 前先落盘原始 stdout；用 _extract_json 容错提取（处理混杂输出），仍失败返回 {"Error":{...},"dump":path}。"""
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    dump = _dump_name(cmd)
    try:
        with open(dump, "w", encoding="utf-8") as f:
            f.write(r.stdout)
    except OSError:
        dump = None
    parsed = _extract_json(r.stdout)
    if isinstance(parsed, dict):
        return parsed
    err = {"Error": {"Code": "ParseFailed", "Message": (r.stderr or r.stdout)[:500]}}
    if dump:
        err["dump"] = dump
    return err


def batch(cmds, workers=5):
    """并发执行命令列表，返回 {f"{product}.{action}": data} 字典。同名 action 自动追加 _N 后缀。"""
    def run(c):
        return f"{c[2]}.{c[3]}", exec(c)
    res = {}
    dup = {}
    with ThreadPoolExecutor(max_workers=workers) as ex:
        fs = [ex.submit(run, c) for c in cmds]
        for f in as_completed(fs):
            k, d = f.result()
            if k in res:
                dup[k] = dup.get(k, 0) + 1
                k = f"{k}_{dup[k]}"
            res[k] = d
    return res


def pmap(fn, items, workers=5):
    """并发执行自定义函数 fn(item)->(key,value)，返回聚合 dict。覆盖逐域名/逐 ID/按等级等变体。"""
    res = {}
    with ThreadPoolExecutor(max_workers=workers) as ex:
        fs = [ex.submit(fn, it) for it in items]
        for f in as_completed(fs):
            k, v = f.result()
            res[k] = v
    return res


def _paginate_top(cmd_base, list_key, limit, workers):
    """顶层分页内核：分页参数 --Limit/--Offset 在命令行顶层（cwp/waf 等主流 API）。filter 已由调用方拼进 cmd_base 的 --Filters。首页失败（含 Error）原样返回。补页判据 len(merged)<total，总量超 MAX_TOTAL 截断并标注。"""
    first = exec(cmd_base + ["--Limit", str(limit), "--Offset", "0", "--output", "json"])
    if not isinstance(first, dict) or "Error" in first:
        return first
    total = first.get("TotalCount", 0)
    merged = first.get(list_key, [])
    if not isinstance(merged, list):
        merged = []
    offsets, capped = _plan_offsets(total, limit, len(merged))
    if offsets:
        def fetch(off):
            return exec(cmd_base + ["--Limit", str(limit), "--Offset", str(off), "--output", "json"])

        pages = pmap(lambda o, f=fetch: (o, f(o)), offsets, workers=workers).values()
        for p in pages:
            if isinstance(p, dict) and "Error" not in p and isinstance(p.get(list_key), list):
                merged.extend(p[list_key])
    if capped:
        merged = merged[:MAX_TOTAL]
        first["_Capped"] = True
        first["_CappedAt"] = MAX_TOTAL
    first[list_key] = merged
    return first


def _adapt_filters(filters):
    """把传入的 filters（Python list）适配为 csip --Filter 对象内的 Filters 数组格式。
    入参元素可为 {Key,Values}（cwp 顶层 --Filters 风格）或 {Name,Values}（csip 风格），统一输出 {Name,Values}。
    同时兼容 Values 已是 list 或单值。"""
    out = []
    for f in filters or []:
        if not isinstance(f, dict):
            continue
        name = f.get("Name") or f.get("Key")
        vals = f.get("Values")
        if not isinstance(vals, list):
            vals = [vals] if vals is not None else []
        if name:
            out.append({"Name": name, "Values": vals})
    return out


def _paginate_filter(cmd_base, list_key, limit, workers, filters=None):
    """对象内分页内核：分页参数与过滤条件都落在单个 --Filter JSON 对象内（csip DescribeRiskCenter* 等）。
    用整体 --Filter '{"Limit","Offset","Filters"}' 传递（实测比点号路径 --Filter.Limit 可靠，点号路径对嵌套 Filters 数组常返回空）。
    filters 为 Python list，经 _adapt_filters 适配为 csip 的 Name/Values 格式后塞进 Filter.Filters。
    首页失败（含 Error）原样返回。补页判据 len(merged)<total，总量超 MAX_TOTAL 截断并标注。"""
    def build(off):
        flt = {"Limit": limit, "Offset": off}
        af = _adapt_filters(filters)
        if af:
            flt["Filters"] = af
        return cmd_base + ["--Filter", json.dumps(flt, ensure_ascii=False), "--output", "json"]
    first = exec(build(0))
    if not isinstance(first, dict) or "Error" in first:
        return first
    total = first.get("TotalCount", 0)
    merged = first.get(list_key, [])
    if not isinstance(merged, list):
        merged = []
    offsets, capped = _plan_offsets(total, limit, len(merged))
    if offsets:
        pages = pmap(lambda o: (o, exec(build(o))), offsets, workers=workers).values()
        for p in pages:
            if isinstance(p, dict) and "Error" not in p and isinstance(p.get(list_key), list):
                merged.extend(p[list_key])
    if capped:
        merged = merged[:MAX_TOTAL]
        first["_Capped"] = True
        first["_CappedAt"] = MAX_TOTAL
    first[list_key] = merged
    return first


def _nested_pagination_rejected(first):
    """判别顶层分页首页是否因"分页位置错"而被 tccli 拒绝：返回 Error 且 Message 含 'Unknown options' 并涉及 Limit/Offset（csip 等不接受顶层 --Limit/--Offset 的 API，exit 255 客户端参数校验失败）。

    与真失败（权限/未开通/网络，服务端 API Error、Message 不含 Unknown options）无歧义区分，故可安全触发 fallback。
    """
    if not isinstance(first, dict) or "Error" not in first:
        return False
    msg = (first.get("Error", {}).get("Message") or "")
    return "Unknown options" in msg and ("--Limit" in msg or "--Offset" in msg or "Limit" in msg)


def page(product, action, list_key, filters=None, limit=100, workers=5, extra=None):
    """统一分页采集入口。返回含全量列表的 dict，TotalCount 保留。

    自动探测分页/filter 位置，调用方无需关心该 API 的 Limit/Offset 在顶层还是 --Filter 对象内：
    1. 先试顶层分页（--Limit/--Offset）+ 顶层 --Filters（若传 filters）。适用于 cwp/waf/cfw 等主流 API。
    2. 若顶层分页被 tccli 以 'Unknown options: --Limit/--Offset' 拒绝（Limit/Offset 嵌在 --Filter 对象内，如 csip DescribeRiskCenter*），自动 fallback 到对象内分页：用整体 --Filter JSON 一次性传 Limit/Offset/Filters 重试。filter 自动从 {Key,Values} 适配为 csip 的 {Name,Values}。
    3. 真失败（权限/未开通/网络）不会触发 fallback，原样返回 Error。

    filters: Python list，元素 {"Key"/"Name": ..., "Values": [...]}，两种键名都接受。
    extra: 额外参数列表（如 ['--StartTime', s, '--EndTime', e]），顶层与对象内两种模式都会附加。
    """
    cmd = [PY, T, product, action] + (extra or [])
    if filters:
        cmd = cmd + ["--Filters", json.dumps(filters, ensure_ascii=False)]
    first = _paginate_top(cmd, list_key, limit, workers)
    if _nested_pagination_rejected(first):
        # fallback 到对象内分页：cmd_base 必须剥掉顶层 --Filters（csip 等连顶层 --Filters 都拒），
        # filters 改由 _paginate_filter 塞进整体 --Filter JSON
        base = [PY, T, product, action] + (extra or [])
        return _paginate_filter(base, list_key, limit, workers, filters=filters)
    return first


def _time(cmd, *args):
    """调 time_util.py 子命令，返回 strip 后 stdout。"""
    r = subprocess.run([PY, TU, cmd] + list(args), capture_output=True, text=True, encoding="utf-8")
    return r.stdout.strip() if r.returncode == 0 else ""


def time(cmd, *args):
    """单值时间：time('now') / time('start-of','day') / time('today') / time('ago','7','d')。"""
    return _time(cmd, *args)


def time_range(value, unit):
    """时间范围对（过去 N 单位到现在）：返回 (start, end)。"""
    out = _time("range", str(value), unit)
    lines = out.split("\n") if out else []
    return (lines[0] if len(lines) > 0 else ""), (lines[1] if len(lines) > 1 else "")


def time_date_range(value, unit):
    """纯日期范围对（适用于 TCSS/CWP 等需 date 类型的 API）：返回 (start_date, end_date)。"""
    out = _time("date-range", str(value), unit)
    lines = out.split("\n") if out else []
    return (lines[0] if len(lines) > 0 else ""), (lines[1] if len(lines) > 1 else "")


def out(obj):
    """输出合法 JSON（ensure_ascii=False 保留中文）。"""
    print(json.dumps(obj, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser(description="tc-sec workflow 辅助库自检")
    p.add_argument("check", nargs="?", default="paths", choices=["paths", "time"])
    a = p.parse_args()
    if a.check == "paths":
        print(json.dumps({"SCR": SCR, "T": T, "TU": TU, "TMP": _TMP, "TS": _TS}, ensure_ascii=False, indent=2))
    elif a.check == "time":
        print(json.dumps({"now": time("now"), "today": time("today"),
                          "range_24h": time_range(24, "h")}, ensure_ascii=False, indent=2))
