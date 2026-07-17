"""references/workflow/<name>/run.py 共享辅助层。

统一三件事：
  1) 解析命令行/环境变量参数（输出目录、产品包含/排除、时间窗口、二阶段抽样上限、调查目标）。
  2) 提供 has(a, "CWP") 形式的产品门禁，便于在 run.py 主体里按产品集裁剪查询。
  3) emit(a, html, name) 按 a.out_dir 决定写文件还是输出 stdout，并打印写入路径到 stderr。

向后兼容：
  - 位置参数仍是 [out_dir]，与之前已铺好的调用方式（python3 run.py /tmp/reports）兼容。
  - TC_SEC_INCLUDE / TC_SEC_EXCLUDE / TC_SEC_HOURS / TC_SEC_DAYS / TC_SEC_DETAIL_MAX
    / TC_SEC_TARGET_IP / TC_SEC_TARGET_UUID / TC_SEC_TARGET_QUUID 全部继续生效；
    CLI flag 优先级高于 ENV，ENV 高于默认值。

CLI 形式（每条 run.py 都接收）：
  python3 run.py [out_dir] \\
      [--out-dir DIR] \\
      [--include CWP,WAF | --exclude CFW] \\
      [--hours N | --days N] \\
      [--detail-max N] \\
      [--top N] \\
      [--severity-min critical|high|medium|low|info] \\
      [--limit N] \\
      [--target-ip IP] [--target-uuid UUID] [--target-quuid QUUID]

参数全部可选，对当前 workflow 不适用的会被忽略（例如密钥审计的 --hours）。

设计边界（重要）：
  本层故意只暴露**值类参数**（数量、阈值、时间窗），不暴露任何会改变 API
  字段名 / 过滤键 / Filter 维度的参数。每个 API 的 Filter 字段名（Name vs Key
  vs FilterField）、时间字段（FromTime vs StartTime）、list_key（Data/List/...）
  都已在 run.py 里按真实签名固化，禁止通过参数让上层调用方临时改写——否则极易
  出现"参数名看起来合理但 API 实际不接受"的静默失败。
"""

import argparse
import os
import sys


_SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"]


def _split_csv(s):
    return {x.strip().upper() for x in (s or "").split(",") if x.strip()}


def args(default_products, name=None):
    """解析参数并返回 argparse.Namespace。

    Args:
        default_products: README frontmatter 里的 products 列表（如 ["CWP","WAF","CFW","TCSS"]），
                         未传 --include/--exclude 时作为默认产品集。
        name: 可选 workflow 名（默认从调用栈上一级文件名所在目录推断）。

    Returns:
        Namespace:
          .out_dir: 写文件目录或 None
          .products: 大写产品集合（set）
          .hours / .days / .detail_max: int 或 None
          .target_ip / .target_uuid / .target_quuid: str 或 ""
          .name: workflow 名
    """
    p = argparse.ArgumentParser(add_help=True)
    p.add_argument("out_dir", nargs="?", default=None,
                   help="可选位置参数：HTML 写入目录；省略则输出到 stdout。")
    p.add_argument("--out-dir", dest="out_dir2", default=None,
                   help="同位置参数；显式形式。")
    p.add_argument("--include", default=None,
                   help="逗号分隔产品名，仅查询其中开通的（与 --exclude 互斥）。")
    p.add_argument("--exclude", default=None,
                   help="逗号分隔产品名，从默认集中排除这些（与 --include 互斥）。")
    p.add_argument("--hours", type=int, default=None,
                   help="时间窗口（小时），仅对有时间窗的工作流生效。")
    p.add_argument("--days", type=int, default=None,
                   help="时间窗口（天），仅对有时间窗的工作流生效。")
    p.add_argument("--detail-max", dest="detail_max", type=int, default=None,
                   help="二阶段抽样上限，仅 secret_key_health_check / firewall_policy_review 生效。")
    p.add_argument("--top", dest="top", type=int, default=None,
                   help="Top N 报表的 N（攻击源 IP / 攻击端口 / Top 漏洞 等），仅相关工作流生效。")
    p.add_argument("--severity-min", dest="severity_min", default=None,
                   choices=_SEVERITY_ORDER,
                   help="只展示等级 >= 阈值的事件（critical>high>medium>low>info）。仅 daily/incident/attack 等含等级的工作流生效。")
    p.add_argument("--limit", dest="limit", type=int, default=None,
                   help="单次 wf.batch 调用的 Limit（默认 100），仅控制每页抓取条数，分页仍由 wf.page 自动补全。")
    p.add_argument("--target-ip", dest="target_ip", default=None,
                   help="incident_investigation 调查目标 IP。")
    p.add_argument("--target-uuid", dest="target_uuid", default=None,
                   help="incident_investigation 主机 UUID。")
    p.add_argument("--target-quuid", dest="target_quuid", default=None,
                   help="incident_investigation CVM Quuid（资产快照）。")
    a = p.parse_args()

    a.out_dir = a.out_dir or a.out_dir2 or None
    if a.out_dir:
        a.out_dir = os.path.expanduser(a.out_dir)

    inc = a.include if a.include is not None else os.environ.get("TC_SEC_INCLUDE", "")
    exc = a.exclude if a.exclude is not None else os.environ.get("TC_SEC_EXCLUDE", "")
    if inc and exc:
        sys.stderr.write("[wf_run] --include 与 --exclude 同时给出，按 --include 处理\n")
        exc = ""
    base = {p.upper() for p in default_products}
    if inc:
        a.products = _split_csv(inc) & base if False else _split_csv(inc)
    elif exc:
        a.products = base - _split_csv(exc)
    else:
        a.products = base

    if a.hours is None:
        v = os.environ.get("TC_SEC_HOURS")
        a.hours = int(v) if v and v.isdigit() else None
    if a.days is None:
        v = os.environ.get("TC_SEC_DAYS")
        a.days = int(v) if v and v.isdigit() else None
    if a.detail_max is None:
        v = os.environ.get("TC_SEC_DETAIL_MAX")
        a.detail_max = int(v) if v and v.isdigit() else None
    if a.top is None:
        v = os.environ.get("TC_SEC_TOP")
        a.top = int(v) if v and v.isdigit() else None
    if a.severity_min is None:
        v = (os.environ.get("TC_SEC_SEVERITY_MIN") or "").strip().lower()
        a.severity_min = v if v in _SEVERITY_ORDER else None
    if a.limit is None:
        v = os.environ.get("TC_SEC_LIMIT")
        a.limit = int(v) if v and v.isdigit() else None

    a.target_ip = (a.target_ip or os.environ.get("TC_SEC_TARGET_IP") or "").strip()
    a.target_uuid = (a.target_uuid or os.environ.get("TC_SEC_TARGET_UUID") or "").strip()
    a.target_quuid = (a.target_quuid or os.environ.get("TC_SEC_TARGET_QUUID") or "").strip()

    a.name = name
    return a


def has(a, *prods):
    """a.products 是否覆盖给定产品集合的全部成员（任一缺失即 False）。

    has(a, "CWP")            → 单产品门禁
    has(a, "CWP", "WAF")     → 联合门禁（两者都启用才返回 True）
    """
    return all(p.upper() in a.products for p in prods)


def any_of(a, *prods):
    """有任一产品启用就 True，用于"两选一"分支。"""
    return any(p.upper() in a.products for p in prods)


def emit(a, html, name=None):
    """按 a.out_dir 决定写文件或写 stdout。

    Args:
        a:    args() 返回的 Namespace
        html: 完整 HTML 字符串
        name: 输出文件名（不含 .html），缺省取 a.name 或调用方所在目录名。
    """
    if name is None:
        name = a.name
    if name is None:
        try:
            caller = sys._getframe(1).f_globals.get("__file__", "")
            name = os.path.basename(os.path.dirname(os.path.abspath(caller))) or "report"
        except Exception:
            name = "report"

    if a.out_dir:
        os.makedirs(a.out_dir, exist_ok=True)
        path = os.path.join(a.out_dir, name + ".html")
        with open(path, "w", encoding="utf-8") as f:
            f.write(html)
        sys.stderr.write(f"[run.py] HTML 报告已写入 {path}\n")
    else:
        sys.stdout.write(html)
        if not html.endswith("\n"):
            sys.stdout.write("\n")


def product_zh(code):
    """产品代码 → 中文名（用于 H.wrap 的 sources / unavailable）。"""
    return {
        "CWP": "主机安全 CWP",
        "WAF": "Web 应用防火墙 WAF",
        "CFW": "云防火墙 CFW",
        "TCSS": "容器安全 TCSS",
        "CSIP": "安全中心 CSIP",
        "KMS": "密钥管理 KMS",
        "SSM": "凭据管理 SSM",
        "BH": "堡垒机 BH",
        "CDS": "数据安全 CDS",
    }.get(code.upper(), code)


def severity_filter(a, sev):
    """检查事件 severity 是否满足 a.severity_min 阈值；未设阈值则恒 True。

    sev 取值：critical / high / medium / low / info（大小写不敏感；
    其它值视为 medium，避免静默丢弃未知等级的事件）。"""
    if not a.severity_min:
        return True
    s = (sev or "medium").lower()
    if s not in _SEVERITY_ORDER:
        s = "medium"
    return _SEVERITY_ORDER.index(s) <= _SEVERITY_ORDER.index(a.severity_min)


def top_n(a, default):
    """取 a.top；未传则用脚本默认。"""
    return a.top if a.top and a.top > 0 else default


def page_limit(a, default=100):
    """取 a.limit；未传则用脚本默认（通常 100）。"""
    return a.limit if a.limit and a.limit > 0 else default


def is_unavailable(d):
    """统一判定一个 wf.batch / wf.exec 返回值是否代表"产品未开通 / 调用失败 / 无数据"。

    True 的情况：
      - None（命令未发送或返回为空）
      - 非 dict
      - dict 含 "Error" 键（API 返回错误，包括 ResourceNotFound/UnauthorizedOperation 等）
      - dict 是空 {}（部分产品未开通时 wf 包装返回空）

    注意：返回 dict 但所有字段为 0 不算 unavailable（那是合法的"开通了但无数据"）。
    "全 0=未开通" 的判定需要在调用方按 API 字段语义自己判（比如 WAF AttackCount==0
    且 AccessCount==0 才算未开通），不能在这里盲判。
    """
    if d is None:
        return True
    if not isinstance(d, dict):
        return True
    if "Error" in d:
        return True
    if not d:
        return True
    return False


def all_unavailable(*ds):
    """所有给定结果都 unavailable 才返回 True；任一可用就 False。"""
    return all(is_unavailable(d) for d in ds)


def detect_enabled(timeout=15):
    """同步调 check_products_enabled.py 拿真实开通列表，返回大写产品集合。

    失败时返回 None（调用方可继续以 a.products 全集发请求，让单条调用层自己暴露错误）。
    成功返回如 {"CWP","TCSS","SSM","KMS","CSIP"}。

    供 run.py 在拿 a 后立即调一次：
      enabled = detect_enabled()
      if enabled is not None:
          a.products = a.products & enabled  # 仅查实际开通的，未开通的进 unavailable
    """
    import json as _json
    import subprocess as _subprocess
    from base import script_path
    try:
        r = _subprocess.run(
            [sys.executable, script_path("check_products_enabled.py"), "--json", "all"],
            capture_output=True, text=True, timeout=timeout,
        )
        if r.returncode != 0:
            return None
        data = _json.loads(r.stdout)
        summary = data.get("summary") or {}
        activated = summary.get("activated") or []
        return {p.upper() for p in activated}
    except Exception:
        return None


def apply_enabled(a, enabled):
    """把 detect_enabled() 的结果应用到 a：

    - 缩小 a.products 到实际开通集合（取交集）
    - 在 a 上挂一个 a.skipped_products 集合，记录"用户希望查但实际未开通"的产品，
      由调用方决定是否加进 H.wrap(unavailable=...) 列表。

    detect_enabled 返回 None 时不做任何改动（让脚本退化为按 Error/空 dict 判定）。
    """
    if enabled is None:
        a.skipped_products = set()
        return
    requested = set(a.products)
    a.products = requested & enabled
    a.skipped_products = requested - enabled
