#!/usr/bin/env python3
"""元典法条检索 API 命令行工具（v1.3.2 - 开放平台版）"""

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode

from updater import SkillUpdater

BASE_URL = "https://open.chineselaw.com"
TIMEOUT = 60
COST_PER_CALL = "本次调用消耗 10 积分"
SKILL_ROOT = Path(__file__).parent.parent
ARCHIVE_DIR = SKILL_ROOT / "archive"

# 版本信息
CURRENT_VERSION = "1.3.3"

# 通用更新模块实例（从 SKILL.md frontmatter 自动推导更新地址）
_updater = SkillUpdater.from_skill_md(SKILL_ROOT)


def load_api_key():
    """从环境变量或 .env 文件加载 API Key"""
    key = os.environ.get("YD_API_KEY", "")
    if key:
        return key

    env_path = Path(__file__).parent / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                if k.strip() == "YD_API_KEY":
                    return v.strip()

    print("错误：未找到 YD_API_KEY。请在 scripts/.env 文件中配置，或设置环境变量。", file=sys.stderr)
    sys.exit(1)


def load_strategy():
    """从环境变量或 .env 文件加载检索策略，默认 balanced"""
    strategy = os.environ.get("YD_STRATEGY", "").strip().lower()
    if strategy:
        return strategy
    env_path = Path(__file__).parent / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                if k.strip() == "YD_STRATEGY":
                    return v.strip().lower()
    return "balanced"


def _common_headers():
    """返回公共请求头"""
    return {
        "X-API-Key": load_api_key(),
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def _query_fingerprint(endpoint, payload):
    """根据端点和请求参数生成指纹，用于归档查重"""
    raw = json.dumps({"endpoint": endpoint, "payload": payload}, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _make_archive_name(endpoint, payload):
    """生成归档文件名：YYYYMMDD_HHMMSS_{查询摘要}.json"""
    now = datetime.now()
    ts = now.strftime("%Y%m%d_%H%M%S")

    # 从 payload 中提取查询摘要
    summary = ""
    for key in ("query", "keyword", "qw", "fgmc", "name", "ah"):
        val = payload.get(key, "")
        if val:
            summary = str(val)
            break
    if not summary:
        summary = endpoint.split("/")[-1]

    # 清理文件名：移除特殊字符，截断
    summary = re.sub(r'[/\\:*?"<>|？\s]', '_', summary)
    summary = summary.strip('_')[:40]

    return f"{ts}_{summary}.json"


def _archive_lookup(endpoint, payload):
    """在归档中查找相同查询，命中返回 (response, archive_path)，未命中返回 (None, None)"""
    if not ARCHIVE_DIR.exists():
        return None, None

    fingerprint = _query_fingerprint(endpoint, payload)
    # 按时间倒序遍历，优先命中最新归档
    for path in sorted(ARCHIVE_DIR.glob("*.json"), reverse=True):
        try:
            record = json.loads(path.read_text("utf-8"))
            if record.get("fingerprint") == fingerprint:
                return record.get("response"), str(path)
        except (json.JSONDecodeError, KeyError):
            continue
    return None, None


YD_BASE = "https://ydzk.chineselaw.com"


def _normalize_url(raw):
    """将相对 URL 转为完整 URL，已经是完整的直接返回"""
    if not raw:
        return None
    if raw.startswith("http"):
        return raw
    return f"{YD_BASE}{raw}"


def _enrich_source_urls(endpoint, response):
    """从 API 响应中提取/构造来源 URL 列表"""
    urls = []
    if not isinstance(response, dict):
        return urls

    # ── 法条语义检索 law_vector_search ──
    if endpoint == "/open/law_vector_search":
        for item in _iter_items(response, "extra.fatiao"):
            fgid = item.get("fgid", "")
            num = item.get("num", "")
            title = item.get("fgtitle", "")
            if fgid:
                url = f"{YD_BASE}/zxt/statuteDetail/detailPage/{fgid}"
                if num:
                    tid = num.replace("第", "").replace("条", "")
                    url += f"?text={tid}"
                urls.append({"title": f"{title} {num}", "type": "法条", "url": url})

    # ── 法条详情 rh_ft_detail ──
    elif endpoint == "/open/rh_ft_detail":
        data = response.get("data")
        if isinstance(data, dict):
            raw = data.get("url", "")
            url = _normalize_url(raw)
            if url:
                urls.append({"title": data.get("title", ""), "type": "法条", "url": url})

    # ── 法条关键词检索 rh_ft_search ──
    elif endpoint == "/open/rh_ft_search":
        for item in _iter_items(response, "data"):
            raw = item.get("url", "")
            url = _normalize_url(raw)
            if not url:
                fgid = item.get("fgid", "")
                if fgid:
                    tid = item.get("tid", "")
                    url = f"{YD_BASE}/zxt/statuteDetail/detailPage/{fgid}"
                    if tid:
                        url += f"?text={tid}"
            if url:
                urls.append({"title": item.get("title", item.get("ftmc", "")), "type": "法条", "url": url})

    # ── 法规详情 rh_fg_detail ──
    elif endpoint == "/open/rh_fg_detail":
        data = response.get("data")
        if isinstance(data, dict):
            raw = data.get("url", "")
            url = _normalize_url(raw)
            fgid = data.get("id") or data.get("fgid", "")
            if not url and fgid:
                url = f"{YD_BASE}/zxt/statuteDetail/detailPage/{fgid}"
            if url:
                urls.append({"title": data.get("title", data.get("fgmc", "")), "type": "法规", "url": url})

    # ── 案例语义检索 case_vector_search ──
    elif endpoint == "/open/case_vector_search":
        for item in _iter_items(response, "extra.wenshu"):
            scid = item.get("scid", "")
            if scid:
                urls.append({
                    "title": f"{item.get('title', '')}（{item.get('ah', '')}）",
                    "type": "案例",
                    "url": f"{YD_BASE}/ydzk/caseDetail/case/{scid}",
                })

    # ── 案例关键词检索 rh_ptal_search ──
    elif endpoint == "/open/rh_ptal_search":
        for item in _iter_items(response, "data.lst"):
            raw = item.get("url", "")
            url = _normalize_url(raw)
            cid = item.get("id", "")
            if not url and cid:
                url = f"{YD_BASE}/ydzk/caseDetail/case/{cid}"
            if url:
                urls.append({
                    "title": f"{item.get('title', '')}（{item.get('ah', '')}）",
                    "type": "案例",
                    "url": url,
                })

    # ── 案例详情 rh_case_details ──
    elif endpoint == "/open/rh_case_details":
        for item in _iter_items(response, "data"):
            raw = item.get("url", "")
            url = _normalize_url(raw)
            if url:
                urls.append({
                    "title": f"{item.get('title', '')}（{item.get('ah', '')}）",
                    "type": "案例",
                    "url": url,
                })

    # ── 企业检索 rh_enterpriseSearch ──
    elif endpoint == "/open/rh_enterpriseSearch":
        for item in _iter_items(response, "data"):
            raw = item.get("url", "")
            url = _normalize_url(raw)
            if url:
                urls.append({"title": item.get("企业名称", ""), "type": "企业", "url": url})

    # ── 企业基本信息 rh_enterpriseBaseInfo ──
    elif endpoint == "/open/rh_enterpriseBaseInfo":
        data = response.get("data")
        if isinstance(data, dict):
            raw = data.get("url", "")
            url = _normalize_url(raw)
            if url:
                urls.append({"title": data.get("企业名称", ""), "type": "企业", "url": url})

    return urls


def _iter_items(response, dotpath):
    """按 dotpath（如 'extra.fatiao'）从 response 中迭代列表"""
    obj = response
    for key in dotpath.split("."):
        if isinstance(obj, dict):
            obj = obj.get(key)
        else:
            return []
    if isinstance(obj, list):
        return obj
    return []


def _archive_save(endpoint, payload, response):
    """将查询和响应归档"""
    ARCHIVE_DIR.mkdir(exist_ok=True)
    fingerprint = _query_fingerprint(endpoint, payload)
    filename = _make_archive_name(endpoint, payload)
    path = ARCHIVE_DIR / filename

    source_urls = _enrich_source_urls(endpoint, response)

    record = {
        "id": filename.replace(".json", ""),
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "endpoint": endpoint,
        "query": payload,
        "fingerprint": fingerprint,
        "source_urls": source_urls,
        "response": response,
    }
    path.write_text(json.dumps(record, ensure_ascii=False, indent=2), "utf-8")
    return str(path)


def api_post(endpoint, body, use_cache=True):
    """发送 POST 请求到元典开放平台 API（支持归档查重）"""
    if use_cache:
        cached, _ = _archive_lookup(endpoint, body)
        if cached is not None:
            return cached, True

    url = f"{BASE_URL}{endpoint}"
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = Request(url, data=data, headers=_common_headers())
    try:
        with urlopen(req, timeout=TIMEOUT) as resp:
            result = json.loads(resp.read().decode("utf-8"))
    except HTTPError as e:
        print(f"HTTP 错误 {e.code}: {e.reason}", file=sys.stderr)
        sys.exit(1)
    except URLError as e:
        print(f"网络错误: {e.reason}", file=sys.stderr)
        sys.exit(1)

    if use_cache:
        _archive_save(endpoint, body, result)
    return result, False


def api_get(endpoint, params=None, use_cache=True):
    """发送 GET 请求到元典开放平台 API（支持归档查重）"""
    if use_cache:
        cached, _ = _archive_lookup(endpoint, params or {})
        if cached is not None:
            return cached, True

    url = f"{BASE_URL}{endpoint}"
    if params:
        qs = urlencode({k: v for k, v in params.items() if v})
        if qs:
            url = f"{url}?{qs}"
    headers = {
        "X-API-Key": load_api_key(),
        "Accept": "application/json",
    }
    req = Request(url, headers=headers)
    try:
        with urlopen(req, timeout=TIMEOUT) as resp:
            result = json.loads(resp.read().decode("utf-8"))
    except HTTPError as e:
        print(f"HTTP 错误 {e.code}: {e.reason}", file=sys.stderr)
        sys.exit(1)
    except URLError as e:
        print(f"网络错误: {e.reason}", file=sys.stderr)
        sys.exit(1)

    if use_cache:
        _archive_save(endpoint, params or {}, result)
    return result, False


# ── 格式化输出 ──────────────────────────────────────────────


def format_law_results(data):
    """格式化法条检索结果为 Markdown"""
    if not data:
        return "未找到相关法条。"

    lines = []
    for i, item in enumerate(data, 1):
        title = item.get("fgtitle", item.get("ftmc", ""))
        if isinstance(title, list):
            title = title[0] if title else ""
        num = item.get("num", item.get("ft_num", item.get("tid", "")))
        lines.append(f"### {i}. {title or item.get('fgmc', '')} — {num}")
        lines.append("")

        content = item.get("content", "")
        if content:
            lines.append(f"> {content}")
            lines.append("")

        meta = []
        if item.get("effect1") or item.get("xljb_1"):
            meta.append(f"效力级别: {item.get('effect1', '') or item.get('xljb_1', '')}")
        if item.get("effect2") or item.get("xljb_2"):
            meta.append(f"二级效力: {item.get('effect2', '') or item.get('xljb_2', '')}")
        if item.get("sxx"):
            meta.append(f"时效性: {item['sxx']}")
        if item.get("start"):
            meta.append(f"实施日期: {item['start']}")
        if item.get("fbrq"):
            meta.append(f"发布日期: {item['fbrq']}")
        if item.get("fbbm"):
            meta.append(f"发布部门: {item['fbbm']}")
        if item.get("fwzh"):
            meta.append(f"发文字号: {item['fwzh']}")
        if meta:
            lines.append(" | ".join(meta))
            lines.append("")

    return "\n".join(lines)


def format_case_results(data):
    """格式化案例检索结果为 Markdown"""
    if not data:
        return "未找到相关案例。"

    lines = []
    for i, item in enumerate(data, 1):
        title = item.get("title", item.get("ah", ""))
        lines.append(f"### {i}. {title}")
        lines.append("")

        meta = []
        if item.get("ah"):
            meta.append(f"案号: {item['ah']}")
        if item.get("ajlb"):
            meta.append(f"类别: {item['ajlb']}")
        if item.get("anyou"):
            ay = item["anyou"]
            if isinstance(ay, list):
                ay = ", ".join(str(a) for a in ay)
            meta.append(f"案由: {ay}")
        if item.get("jbdw"):
            meta.append(f"法院: {item['jbdw']}")
        if item.get("cj"):
            meta.append(f"法院层级: {item['cj']}")
        if item.get("wszl"):
            meta.append(f"文书: {item['wszl']}")
        if item.get("jaDate") or item.get("cprq"):
            meta.append(f"日期: {item.get('jaDate') or item.get('cprq')}")
        if item.get("xzqh_p"):
            meta.append(f"省份: {item['xzqh_p']}")
        if meta:
            lines.append(" | ".join(meta))
            lines.append("")

        content = item.get("content", "")
        if content:
            text = str(content)
            if len(text) > 500:
                text = text[:500] + "..."
            lines.append(text)
            lines.append("")

    return "\n".join(lines)


def format_regulation_results(data):
    """格式化法规检索结果为 Markdown"""
    if not data:
        return "未找到相关法规。"

    lines = []
    for i, item in enumerate(data, 1):
        name = item.get("fgtitle", item.get("fgmc", ""))
        if isinstance(name, list):
            name = name[0] if name else ""
        lines.append(f"### {i}. {name}")
        lines.append("")

        meta = []
        if item.get("effect1") or item.get("xljb_1"):
            meta.append(f"效力级别: {item.get('effect1', '') or item.get('xljb_1', '')}")
        if item.get("sxx"):
            meta.append(f"时效性: {item['sxx']}")
        if item.get("fbrq"):
            meta.append(f"发布日期: {item['fbrq']}")
        if item.get("ssrq"):
            meta.append(f"实施日期: {item['ssrq']}")
        if item.get("fbbm"):
            meta.append(f"发布部门: {item['fbbm']}")
        if item.get("fgid"):
            meta.append(f"ID: {item['fgid']}")
        if meta:
            lines.append(" | ".join(meta))
            lines.append("")

        content = item.get("content", "")
        if content:
            text = str(content)
            if len(text) > 500:
                text = text[:500] + "..."
            lines.append(text)
            lines.append("")

    return "\n".join(lines)


def format_enterprise_results(data):
    """格式化企业检索结果为 Markdown"""
    if not data:
        return "未找到相关企业。"
    if isinstance(data, dict):
        data = [data]

    lines = []
    for i, item in enumerate(data, 1):
        name = item.get("name", item.get("企业名称", ""))
        lines.append(f"### {i}. {name}")
        lines.append("")

        meta = []
        credit_code = item.get("tyshxydm", item.get("统一社会信用代码", ""))
        if credit_code:
            meta.append(f"信用代码: {credit_code}")
        ent_type = item.get("企业类型", "")
        if ent_type:
            meta.append(f"类型: {ent_type}")
        status = item.get("经营状态", item.get("status", ""))
        if status:
            meta.append(f"状态: {status}")
        legal_person = item.get("法定代表人", item.get("legal_person", ""))
        if legal_person:
            meta.append(f"法定代表人: {legal_person}")
        if meta:
            lines.append(" | ".join(meta))
            lines.append("")

    return "\n".join(lines)


# ── 企业分项列表类型映射 ────────────────────────────────────

ENTERPRISE_LIST_TYPES = {
    "invest": ("/open/rh_enterpriseOutInvest", "对外投资"),
    "brand": ("/open/rh_enterpriseBrand", "商标"),
    "patent": ("/open/rh_enterprisePatent", "专利"),
    "soft-right": ("/open/rh_enterpriseSoftRight", "软件著作权"),
    "works-right": ("/open/rh_enterpriseWorksRight", "作品著作权"),
    "icp": ("/open/rh_enterpriseIcp", "网站备案"),
    "change-info": ("/open/rh_enterpriseChangeInfo", "变更记录"),
    "writ-agg": ("/open/rh_enterpriseWritAgg", "涉诉信息统计"),
    "writ-list": ("/open/rh_enterpriseWritList", "涉诉文书"),
    "court-session": ("/open/rh_enterpriseCourtSessionNotice", "开庭公告"),
    "court-notice": ("/open/rh_enterpriseCourtNotice", "法院公告"),
    "execution": ("/open/rh_enterpriseExecutions", "失信被执行人"),
    "executed-person": ("/open/rh_enterpriseExecutedPerson", "被执行人"),
    "frozen-equity": ("/open/rh_enterpriseFrozenEquity", "股权冻结"),
    "punishment": ("/open/rh_enterprisePunishment", "行政处罚"),
    "pledge": ("/open/rh_enterprisePledge", "股权出质"),
    "guaranty": ("/open/rh_enterpriseGuaranty", "对外担保"),
    "abnormal": ("/open/rh_enterpriseAbnormalOperation", "经营异常"),
    "tax": ("/open/rh_enterpriseCorporateTax", "欠税公告"),
    "serious-illegal": ("/open/rh_enterpriseSeriousIllegal", "严重违法"),
}


def format_enterprise_list_results(data, label):
    """格式化企业分项列表结果为 Markdown"""
    if not data:
        return f"未找到{label}相关记录。"
    if isinstance(data, dict):
        data = [data]

    lines = []
    for i, item in enumerate(data, 1):
        # 尝试从常见字段中提取标题
        title = ""
        for key in ("name", "名称", "企业名称", "商标名称", "专利名称", "软件名称",
                     "作品名称", "域名", "案号", "公告类型", "变更项目",
                     "被执行人名称", "处罚决定书文号", "出质人", "担保人",
                     "列入原因", "欠税税种", "违法行为"):
            val = item.get(key, "")
            if val:
                title = str(val)
                break
        lines.append(f"### {i}. {title or label}")
        lines.append("")

        meta = []
        for key, label_text in item.items():
            val = item.get(key, "")
            if val and key not in ("id",) and str(val).strip():
                meta.append(f"{key}: {val}")
        if meta:
            # 限制显示字段数量，避免输出过长
            for m in meta[:8]:
                lines.append(f"- {m}")
            lines.append("")

    return "\n".join(lines)


def format_hall_detect_results(data):
    """格式化幻觉检测结果为 Markdown"""
    if not data:
        return "检测结果为空。"

    lines = []

    # 高亮文本
    highlighted = data.get("highlighted_text", "")
    if highlighted:
        lines.append("## 检测文本（标注版）")
        lines.append("")
        lines.append(highlighted)
        lines.append("")

    # 法规检测结果
    regulations = data.get("regulations", [])
    if regulations:
        lines.append(f"## 法规检测（共 {len(regulations)} 条）")
        lines.append("")
        for i, reg in enumerate(regulations, 1):
            name = reg.get("name", "")
            clause = reg.get("clause", "")
            law_exists = reg.get("law_exists")
            exists_label = "存在" if law_exists else "不存在（疑似幻觉）"
            lines.append(f"### {i}. {name} {clause} — {exists_label}")
            lines.append("")

            if reg.get("content"):
                lines.append(f"> {reg['content']}")
                lines.append("")

            if reg.get("url"):
                lines.append(f"链接: {reg['url']}")
                lines.append("")

            sc = reg.get("semantic_compare", {})
            if sc and not sc.get("skipped"):
                conclusion = sc.get("结论", "")
                similarity = sc.get("语义相似度", "")
                lines.append(f"语义比对: {conclusion}（相似度: {similarity}）")
                if sc.get("说明"):
                    lines.append(f"说明: {sc['说明']}")
                if sc.get("要点"):
                    for point in sc["要点"]:
                        lines.append(f"- {point}")
                lines.append("")

    # 案例检测结果
    cases = data.get("cases", [])
    if cases:
        lines.append(f"## 案例检测（共 {len(cases)} 条）")
        lines.append("")
        for i, case in enumerate(cases, 1):
            name = case.get("name", "")
            case_number = case.get("case_number", "")
            lines.append(f"### {i}. {name}（{case_number}）")
            lines.append("")

            meta = []
            if case.get("case_type"):
                meta.append(f"案件类型: {case['case_type']}")
            if case.get("court"):
                meta.append(f"法院: {case['court']}")
            if case.get("judgment_date"):
                meta.append(f"裁判日期: {case['judgment_date']}")
            if meta:
                lines.append(" | ".join(meta))
                lines.append("")

            if case.get("url"):
                lines.append(f"链接: {case['url']}")
                lines.append("")
            if case.get("basic_facts"):
                text = str(case["basic_facts"])
                if len(text) > 300:
                    text = text[:300] + "..."
                lines.append(f"基本事实: {text}")
                lines.append("")
            if case.get("judgment_key_points"):
                text = str(case["judgment_key_points"])
                if len(text) > 300:
                    text = text[:300] + "..."
                lines.append(f"裁判要点: {text}")
                lines.append("")

    if not regulations and not cases:
        lines.append("未检测到法规或案例引用。")

    return "\n".join(lines)


# ── 子命令处理 ──────────────────────────────────────────────


def _print_footer():
    """打印调用成本提示"""
    print(f"\n--- {COST_PER_CALL} ---")


# ── 版本检测（委托给 updater 模块）──────────────────────


def cmd_check_update(args):
    _updater.cmd_check_update()


def cmd_do_update(args):
    _updater.cmd_do_update()


def cmd_search(args):
    """法条语义检索"""
    body = {
        "query": args.query,
        "rewrite_flag": args.rewrite_flag,
        "return_num": args.return_num,
    }
    fatiao_filter = {}
    if args.effect1:
        fatiao_filter["effect1"] = args.effect1
    if args.sxx:
        fatiao_filter["sxx"] = args.sxx
    if args.law_start:
        fatiao_filter["law_start"] = args.law_start
    if args.law_end:
        fatiao_filter["law_end"] = args.law_end
    if fatiao_filter:
        body["fatiao_filter"] = fatiao_filter

    result, cached = api_post("/open/law_vector_search", body)
    data = result.get("extra", {}).get("fatiao", result.get("data", []))
    print(format_law_results(data))
    _print_footer()


def cmd_keyword(args):
    """法条关键词检索"""
    # 处理 --expand 扩展关键词
    keyword = args.query
    if args.expand:
        expanded_terms = [t.strip() for t in args.expand.split(",") if t.strip()]
        if expanded_terms:
            keyword = f"{keyword} {' '.join(expanded_terms)}"
            # 有扩展词时自动切换为 OR 模式（如果用户未显式指定 search_mode）
            if not args.search_mode:
                args.search_mode = "or"
                print(f"[扩展检索] 已将关键词扩展为: {keyword}（OR 模式）")
            else:
                print(f"[扩展检索] 已将关键词扩展为: {keyword}")

    body = {"keyword": keyword}
    if args.search_mode:
        body["search_mode"] = args.search_mode
    if args.fgmc:
        body["fgmc"] = args.fgmc
    if args.effect1:
        body["xljb_1"] = " ".join(args.effect1)
    if args.sxx:
        body["sxx"] = " ".join(args.sxx)
    for date_field in ("fbrq_start", "fbrq_end", "ssrq_start", "ssrq_end"):
        val = getattr(args, date_field, None)
        if val:
            body[date_field] = val
    if args.top_k:
        body["top_k"] = args.top_k
    result, cached = api_post("/open/rh_ft_search", body)
    data = result.get("data", [])
    print(format_law_results(data))
    _print_footer()


def cmd_detail(args):
    """法条详情检索"""
    body = {"fgmc": args.query, "ftnum": args.ft_name}
    if args.reference_date:
        body["refer_date"] = args.reference_date
    result, cached = api_post("/open/rh_ft_detail", body)
    data = result.get("data")
    items = [data] if isinstance(data, dict) else (data or [])
    print(format_law_results(items))
    _print_footer()


def cmd_case(args):
    """案例关键词检索"""
    body = {}
    # 处理 --expand 扩展关键词
    query = args.query
    if args.expand:
        expanded_terms = [t.strip() for t in args.expand.split(",") if t.strip()]
        if expanded_terms:
            query = f"{query} {' '.join(expanded_terms)}" if query else " ".join(expanded_terms)
            # 有扩展词时自动切换为 OR 模式（如果用户未显式指定 search_mode）
            if not args.search_mode:
                args.search_mode = "or"
                print(f"[扩展检索] 已将关键词扩展为: {query}（OR 模式）")
            else:
                print(f"[扩展检索] 已将关键词扩展为: {query}")

    if query:
        body["qw"] = query
    if args.search_mode:
        body["search_mode"] = args.search_mode
    for field in ("ah", "title"):
        val = getattr(args, field, None)
        if val:
            body[field] = val
    for field in ("ay", "jbdw", "xzqh_p", "wszl"):
        val = getattr(args, field, None)
        if val:
            body[field] = val
    if args.ajlb:
        body["ajlb"] = args.ajlb
    for date_field in ("jarq_start", "jarq_end"):
        val = getattr(args, date_field, None)
        if val:
            body[date_field] = val
    if args.top_k:
        body["top_k"] = args.top_k

    # 普通案例专属参数
    if not args.authority_only:
        if args.fxgc:
            body["fxgc"] = args.fxgc
        if args.yyft:
            body["yyft"] = args.yyft
            if args.ft_search_mode:
                body["ft_search_mode"] = args.ft_search_mode

    # 根据 authority_only 路由到不同端点
    if args.authority_only:
        endpoint = "/open/rh_qwal_search"
    else:
        endpoint = "/open/rh_ptal_search"

    result, cached = api_post(endpoint, body)
    raw = result.get("data")
    data = raw.get("lst", []) if isinstance(raw, dict) else (raw or [])
    total = raw.get("total") if isinstance(raw, dict) else None
    if total is not None:
        print(f"共 {total} 条结果，显示前 {len(data)} 条\n")
    print(format_case_results(data))
    _print_footer()


def cmd_case_semantic(args):
    """案例语义检索"""
    body = {
        "query": args.query,
        "rewrite_flag": args.rewrite_flag,
        "return_num": args.return_num,
    }
    wenshu_filter = {}
    if args.xzqh_p:
        wenshu_filter["xzqh_p"] = args.xzqh_p
    if args.fayuan:
        wenshu_filter["fayuan"] = args.fayuan
    if args.wenshu_type:
        wenshu_filter["wenshu_type"] = args.wenshu_type
    if args.wszl:
        wenshu_filter["wszl"] = args.wszl
    if args.authority_only:
        wenshu_filter["dianxing"] = True
    if args.cj:
        wenshu_filter["cj"] = args.cj
    for date_field in ("jarq_start", "jarq_end"):
        val = getattr(args, date_field, None)
        if val:
            wenshu_filter[date_field] = val
    if wenshu_filter:
        body["wenshu_filter"] = wenshu_filter

    result, cached = api_post("/open/case_vector_search", body)
    data = result.get("extra", {}).get("wenshu", result.get("data", []))
    print(format_case_results(data))
    _print_footer()


def cmd_case_detail(args):
    """案例详情"""
    params = {"type": args.type}
    if args.id:
        params["id"] = args.id
    if args.ah:
        params["ah"] = args.ah
    if not args.id and not args.ah:
        print("错误：请提供 --id 或 --ah 参数", file=sys.stderr)
        sys.exit(1)
    result, cached = api_get("/open/rh_case_details", params)
    data = result.get("data", {})
    if isinstance(data, list):
        print(format_case_results(data))
    elif isinstance(data, dict):
        print(format_case_results([data]))
    _print_footer()


def cmd_regulation(args):
    """法规关键词检索"""
    body = {}
    # 处理 --expand 扩展关键词
    keyword = args.query
    if args.expand:
        expanded_terms = [t.strip() for t in args.expand.split(",") if t.strip()]
        if expanded_terms:
            keyword = f"{keyword} {' '.join(expanded_terms)}"
            if not args.search_mode:
                args.search_mode = "or"
                print(f"[扩展检索] 已将关键词扩展为: {keyword}（OR 模式）")
            else:
                print(f"[扩展检索] 已将关键词扩展为: {keyword}")

    if keyword:
        body["keyword"] = keyword
    if args.search_mode:
        body["search_mode"] = args.search_mode
    if args.fgmc:
        body["fgmc"] = args.fgmc
    if args.effect1:
        body["xljb_1"] = " ".join(args.effect1)
    if args.sxx:
        body["sxx"] = " ".join(args.sxx)
    for date_field in ("fbrq_start", "fbrq_end", "ssrq_start", "ssrq_end"):
        val = getattr(args, date_field, None)
        if val:
            body[date_field] = val
    if args.top_k:
        body["top_k"] = args.top_k
    result, cached = api_post("/open/rh_fg_search", body)
    data = result.get("data", [])
    print(format_regulation_results(data))
    _print_footer()


def cmd_regulation_detail(args):
    """法规详情"""
    body = {}
    if args.fgid:
        body["id"] = args.fgid
    if args.name:
        body["fgmc"] = args.name
    if not body:
        print("错误：请提供 --fgid 或 --name 参数", file=sys.stderr)
        sys.exit(1)
    if args.reference_date:
        body["refer_date"] = args.reference_date
    result, cached = api_post("/open/rh_fg_detail", body)
    data = result.get("data", {})
    if isinstance(data, list):
        print(format_regulation_results(data))
    elif isinstance(data, dict):
        print(format_regulation_results([data]))
    _print_footer()


def cmd_enterprise(args):
    """企业名称检索"""
    params = {"name": args.query}
    if args.num:
        params["num"] = args.num
    result, cached = api_get("/open/rh_company_info", params)
    raw = result.get("data")
    data = raw.get("lst", []) if isinstance(raw, dict) else (raw or [])
    total = raw.get("total") if isinstance(raw, dict) else None
    if total is not None:
        print(f"共 {total} 条结果，显示前 {len(data)} 条\n")
    print(format_enterprise_results(data))
    _print_footer()


def cmd_enterprise_detail(args):
    """企业详情"""
    params = {}
    if args.id:
        params["id"] = args.id
    if args.credit_code:
        params["tyshxydm"] = args.credit_code
    if not params:
        print("错误：请提供 --id 或 --credit-code 参数", file=sys.stderr)
        sys.exit(1)
    result, cached = api_get("/open/rh_company_detail", params)
    data = result.get("data", {})
    print(format_enterprise_results(data))
    _print_footer()


def cmd_archive_list(args):
    """列出历史检索记录"""
    if not ARCHIVE_DIR.exists():
        print("尚无检索记录。")
        return

    files = sorted(ARCHIVE_DIR.glob("*.json"), reverse=True)
    keyword = args.keyword.lower() if args.keyword else None
    entries = []

    for f in files:
        if f.name == "version_check.json":
            continue
        try:
            data = json.loads(f.read_text("utf-8"))
        except (json.JSONDecodeError, OSError):
            continue

        ts = data.get("timestamp", "")[:16]
        endpoint = data.get("endpoint", "")
        query = data.get("query", {})
        query_str = json.dumps(query, ensure_ascii=False)
        status = data.get("response", {}).get("status", "")

        if keyword:
            if keyword not in query_str.lower() and keyword not in endpoint.lower():
                continue

        entries.append({
            "file": f.name,
            "time": ts,
            "endpoint": endpoint,
            "query_summary": query_str[:80],
            "status": status,
        })

    if not entries:
        print("没有找到匹配的检索记录。")
        return

    for e in entries[:args.limit]:
        print(f"{e['time']}  {e['endpoint']}")
        print(f"  {e['query_summary']}")
        print()


def cmd_backfill_urls(_args):
    """回填现有 archive 记录的 source_urls"""
    if not ARCHIVE_DIR.exists():
        print("archive 目录不存在。")
        return

    files = sorted(ARCHIVE_DIR.glob("*.json"))
    updated = 0
    skipped = 0

    for f in files:
        if f.name == "version_check.json":
            continue
        try:
            record = json.loads(f.read_text("utf-8"))
        except (json.JSONDecodeError, OSError):
            continue

        endpoint = record.get("endpoint", "")
        response = record.get("response", {})
        existing = record.get("source_urls")

        new_urls = _enrich_source_urls(endpoint, response)

        if new_urls and new_urls != existing:
            record["source_urls"] = new_urls
            # 保持字段顺序：把 source_urls 放在 response 之前
            ordered = {}
            for k in ("id", "timestamp", "endpoint", "query", "fingerprint", "source_urls", "response"):
                if k in record:
                    ordered[k] = record[k]
            f.write_text(json.dumps(ordered, ensure_ascii=False, indent=2), "utf-8")
            updated += 1
            print(f"  已更新: {f.name} ({len(new_urls)} 条 URL)")
        else:
            skipped += 1

    print(f"\n完成: 更新 {updated} 个文件，跳过 {skipped} 个文件")


def cmd_raw(args):
    """原始 JSON 输出（用于调试）"""
    body = {"query": args.query}
    if args.extra:
        try:
            extra = json.loads(args.extra)
            body.update(extra)
        except json.JSONDecodeError:
            print("错误：--extra 参数不是有效的 JSON", file=sys.stderr)
            sys.exit(1)
    endpoint = args.endpoint
    use_cache = not args.no_cache
    if args.get:
        params = body
        result, cached = api_get(endpoint, params, use_cache=use_cache)
    else:
        result, cached = api_post(endpoint, body, use_cache=use_cache)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    _print_footer()


def cmd_strategy(args):
    """显示当前检索策略"""
    labels = {"balanced": "均衡", "economical": "省钱", "aggressive": "激进"}
    s = load_strategy()
    print(f"当前策略：{labels.get(s, s)}（{s}）")


def cmd_hall_detect(args):
    """法规/法条/案例幻觉检测"""
    body = {"text": args.text}
    use_cache = not args.no_cache
    result, cached = api_post("/open/hall_detect", body, use_cache=use_cache)
    data = result.get("data", result)
    print(format_hall_detect_results(data))
    cost = 50
    print(f"\n--- 本次调用消耗 {cost} 积分 ---")


def cmd_enterprise_search(args):
    """企业检索（轻量候选列表）"""
    params = {"name": args.name}
    if args.top_k:
        params["top_k"] = args.top_k
    use_cache = not args.no_cache
    result, cached = api_get("/open/rh_enterpriseSearch", params, use_cache=use_cache)
    data = result.get("data", [])
    if isinstance(data, dict):
        data = [data]
    print(format_enterprise_results(data))
    print(f"\n--- 本次调用消耗 1 积分 ---")


def cmd_enterprise_base(args):
    """企业基本信息"""
    params = {}
    if args.id:
        params["id"] = args.id
    if args.uscc:
        params["uscc"] = args.uscc
    if not params:
        print("错误：请提供 --id 或 --uscc 参数", file=sys.stderr)
        sys.exit(1)
    use_cache = not args.no_cache
    result, cached = api_get("/open/rh_enterpriseBaseInfo", params, use_cache=use_cache)
    data = result.get("data", {})
    print(json.dumps(data, ensure_ascii=False, indent=2))
    print(f"\n--- 本次调用消耗 10 积分 ---")


def cmd_enterprise_summary(args):
    """企业聚合总览"""
    body = {}
    if args.id:
        body["id"] = args.id
    if args.uscc:
        body["uscc"] = args.uscc
    if not body:
        print("错误：请提供 --id 或 --uscc 参数", file=sys.stderr)
        sys.exit(1)
    use_cache = not args.no_cache
    result, cached = api_post("/open/rh_enterpriseAggregationSummary", body, use_cache=use_cache)
    data = result.get("data", {})
    print(json.dumps(data, ensure_ascii=False, indent=2))
    print(f"\n--- 本次调用消耗 10 积分 ---")


def cmd_enterprise_list(args):
    """企业分项列表查询"""
    if args.type not in ENTERPRISE_LIST_TYPES:
        print(f"未知类型: {args.type}", file=sys.stderr)
        print(f"可用类型: {', '.join(ENTERPRISE_LIST_TYPES.keys())}", file=sys.stderr)
        sys.exit(1)

    endpoint, label = ENTERPRISE_LIST_TYPES[args.type]
    params = {"page": args.page, "size": args.size}
    if args.id:
        params["id"] = args.id
    if args.uscc:
        params["uscc"] = args.uscc
    if not args.id and not args.uscc:
        print("错误：请提供 --id 或 --uscc 参数", file=sys.stderr)
        sys.exit(1)
    use_cache = not args.no_cache
    result, cached = api_get(endpoint, params, use_cache=use_cache)

    raw = result.get("data")
    if isinstance(raw, dict):
        items = raw.get("lst", raw.get("list", []))
        total = raw.get("total")
        if total is not None:
            print(f"共 {total} 条结果，当前第 {args.page} 页（每页 {args.size} 条）\n")
    elif isinstance(raw, list):
        items = raw
    else:
        items = []

    print(format_enterprise_list_results(items, label))
    cost = 10 if args.type in ("writ-agg", "writ-list") else 5
    print(f"\n--- 本次调用消耗 {cost} 积分 ---")


# ── 参数解析 ──────────────────────────────────────────────


def _add_law_filters(parser):
    """法条通用筛选参数"""
    parser.add_argument("--effect1", action="append", help="效力级别（可多次指定）")
    parser.add_argument("--sxx", action="append", help="时效性（可多次指定）")


def build_parser():
    _strategy = load_strategy()

    parser = argparse.ArgumentParser(
        description="元典法条检索命令行工具（开放平台版）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""示例：
  %(prog)s search "正当防卫的限度" --sxx 现行有效
  %(prog)s keyword "人工智能 监管" --effect1 法律 --effect1 行政法规
  %(prog)s detail "民法典" --ft-name "第十五条"
  %(prog)s case "买卖合同纠纷" --province 广西 --authority-only
  %(prog)s case-semantic "正当防卫的限度" --jarq-start 2020-01-01
  %(prog)s case-detail --ah "（2025）桂09民终192号"
  %(prog)s regulation "数据安全"
  %(prog)s enterprise "华为"
  %(prog)s hall-detect "根据《中华人民共和国数据保护法》第35条规定..."
  %(prog)s enterprise-search "华为" --top-k 5
  %(prog)s enterprise-base --uscc "9144030071526726XG"
  %(prog)s enterprise-summary --uscc "9144030071526726XG"
  %(prog)s enterprise-list --type writ-list --uscc "9144030071526726XG" --page 1 --size 10
"""
    )
    sub = parser.add_subparsers(dest="command")

    # ── search ──
    p = sub.add_parser("search", help="法条语义检索")
    p.add_argument("query", help="自然语言问题")
    _add_law_filters(p)
    p.add_argument("--rewrite-flag", action="store_true", default=True, help="是否改写查询（默认 true）")
    p.add_argument("--no-rewrite", action="store_false", dest="rewrite_flag", help="禁用查询改写")
    p.add_argument("--return-num", type=int, default=20 if _strategy == "economical" else 45, help="返回数量")
    p.add_argument("--law-start", help="法条生效起始日期 yyyy-MM-dd")
    p.add_argument("--law-end", help="法条生效结束日期 yyyy-MM-dd")
    p.set_defaults(func=cmd_search)

    # ── keyword ──
    p = sub.add_parser("keyword", help="法条关键词检索")
    p.add_argument("query", help="关键词，多个用空格分隔")
    p.add_argument("--expand", help="扩展关键词，逗号分隔（如 '知识产权管辖,级别管辖'），自动追加到原始查询")
    p.add_argument("--fgmc", help="法规名称过滤")
    p.add_argument("--effect1", action="append", help="效力级别（可多次指定）")
    p.add_argument("--sxx", action="append", help="时效性（可多次指定）")
    p.add_argument("--search-mode", choices=["and", "or"], default="and", help="多关键词逻辑")
    p.add_argument("--fbrq-start", help="发布日期起点 yyyy-MM-dd")
    p.add_argument("--fbrq-end", help="发布日期终点")
    p.add_argument("--ssrq-start", help="实施日期起点")
    p.add_argument("--ssrq-end", help="实施日期终点")
    p.add_argument("--top-k", type=int, default=20 if _strategy == "aggressive" else None, help="返回条数上限")
    p.set_defaults(func=cmd_keyword)

    # ── detail ──
    p = sub.add_parser("detail", help="法条详情检索")
    p.add_argument("query", help="法规名称")
    p.add_argument("--ft-name", required=True, help="法条编号，如 '第十五条'")
    p.add_argument("--reference-date", help="参考日期 yyyy-MM-dd")
    p.set_defaults(func=cmd_detail)

    # ── case ──
    p = sub.add_parser("case", help="案例关键词检索")
    p.add_argument("query", nargs="?", default="", help="全文关键词")
    p.add_argument("--expand", help="扩展关键词，逗号分隔（如 '质量纠纷,违约责任'），自动追加到原始查询")
    p.add_argument("--search-mode", choices=["and", "or"], default="and")
    p.add_argument("--authority-only", action="store_true", help="仅检索权威案例")
    p.add_argument("--ah", help="案号")
    p.add_argument("--title", help="标题")
    p.add_argument("--ay", action="append", help="案由/罪名（可多次指定）")
    p.add_argument("--jbdw", action="append", help="经办法院（可多次指定）")
    p.add_argument("--ajlb", help="案件类别")
    p.add_argument("--xzqh-p", "--province", action="append", help="省份")
    p.add_argument("--wszl", action="append", help="文书种类")
    p.add_argument("--jarq-start", help="结案日期起点 yyyy-MM-dd")
    p.add_argument("--jarq-end", help="结案日期终点 yyyy-MM-dd")
    p.add_argument("--top-k", type=int, default=20 if _strategy == "aggressive" else None, help="返回条数上限")
    p.add_argument("--fxgc", help="分析过程关键词")
    p.add_argument("--yyft", action="append", help="援引法条（可多次指定）")
    p.add_argument("--ft-search-mode", choices=["and", "or"], default="and", help="援引法条拼接模式")
    p.set_defaults(func=cmd_case)

    # ── case-semantic ──
    p = sub.add_parser("case-semantic", help="案例语义检索")
    p.add_argument("query", help="自然语言问题")
    p.add_argument("--authority-only", action="store_true", help="仅检索典型案例")
    p.add_argument("--xzqh-p", "--province", help="省份")
    p.add_argument("--fayuan", action="append", help="法院名称")
    p.add_argument("--wenshu-type", help="案件类型，如 民事案件")
    p.add_argument("--wszl", action="append", help="文书种类编码（1=判决书 2=裁定书 等）")
    p.add_argument("--cj", help="法院层级：最高/高级/中级/基层")
    p.add_argument("--rewrite-flag", action="store_true", default=True, help="是否改写查询")
    p.add_argument("--no-rewrite", action="store_false", dest="rewrite_flag", help="禁用查询改写")
    p.add_argument("--return-num", type=int, default=20 if _strategy == "economical" else 45, help="返回数量")
    p.add_argument("--jarq-start", help="结案日期起点 yyyy-MM-dd")
    p.add_argument("--jarq-end", help="结案日期终点 yyyy-MM-dd")
    p.set_defaults(func=cmd_case_semantic)

    # ── case-detail ──
    p = sub.add_parser("case-detail", help="案例详情")
    p.add_argument("--type", required=True, choices=["ptal", "qwal"], help="案例类型：ptal=普通案例 qwal=权威案例")
    p.add_argument("--id", help="案例 ID")
    p.add_argument("--ah", help="案号")
    p.set_defaults(func=cmd_case_detail)

    # ── regulation ──
    p = sub.add_parser("regulation", help="法规关键词检索")
    p.add_argument("query", help="关键词")
    p.add_argument("--expand", help="扩展关键词，逗号分隔，自动追加到原始查询")
    p.add_argument("--search-mode", choices=["and", "or"], default="and")
    p.add_argument("--fgmc", help="法规名称过滤")
    p.add_argument("--effect1", action="append", help="效力级别（可多次指定）")
    p.add_argument("--sxx", action="append", help="时效性（可多次指定）")
    p.add_argument("--fbrq-start", help="发布日期起点 yyyy-MM-dd")
    p.add_argument("--fbrq-end", help="发布日期终点")
    p.add_argument("--ssrq-start", help="实施日期起点")
    p.add_argument("--ssrq-end", help="实施日期终点")
    p.add_argument("--top-k", type=int, help="返回条数上限（默认10，最大50）")
    p.set_defaults(func=cmd_regulation)

    # ── regulation-detail ──
    p = sub.add_parser("regulation-detail", help="法规详情")
    p.add_argument("--fgid", help="法规 ID")
    p.add_argument("--name", help="法规名称")
    p.add_argument("--reference-date", help="参考日期 yyyy-MM-dd")
    p.set_defaults(func=cmd_regulation_detail)

    # ── enterprise ──
    p = sub.add_parser("enterprise", help="企业名称检索")
    p.add_argument("query", help="企业名称或股票简称")
    p.add_argument("--num", type=int, default=2, help="返回条数（默认2，最大50）")
    p.set_defaults(func=cmd_enterprise)

    # ── enterprise-detail ──
    p = sub.add_parser("enterprise-detail", help="企业详情")
    p.add_argument("--id", help="企业 ID")
    p.add_argument("--credit-code", help="统一社会信用代码")
    p.set_defaults(func=cmd_enterprise_detail)

    # ── raw ──
    p = sub.add_parser("raw", help="原始 JSON 输出（调试用）")
    p.add_argument("endpoint", help="API 路径，如 /open/law_vector_search")
    p.add_argument("query", help="查询内容")
    p.add_argument("--extra", help="额外 JSON 参数")
    p.add_argument("--get", action="store_true", help="使用 GET 方法")
    p.add_argument("--no-cache", action="store_true", help="跳过缓存，强制重新请求")
    p.set_defaults(func=cmd_raw)

    # ── check-update ──
    p = sub.add_parser("check-update", help="检查版本更新")
    p.set_defaults(func=cmd_check_update)

    # ── do-update ──
    p = sub.add_parser("do-update", help="下载更新本 skill 的文件（不影响其他目录）")
    p.set_defaults(func=cmd_do_update)

    # ── archive-list ──
    p = sub.add_parser("archive-list", help="列出历史检索记录")
    p.add_argument("--keyword", help="按关键词筛选（匹配查询内容或端点）")
    p.add_argument("--limit", type=int, default=20, help="显示条数（默认20）")
    p.set_defaults(func=cmd_archive_list)

    # ── backfill-urls ──
    p = sub.add_parser("backfill-urls", help="回填现有 archive 的 source_urls")
    p.set_defaults(func=cmd_backfill_urls)

    # ── strategy ──
    p = sub.add_parser("strategy", help="显示当前检索策略")
    p.set_defaults(func=cmd_strategy)

    # ── hall-detect ──
    p = sub.add_parser("hall-detect", help="法规/法条/案例幻觉检测")
    p.add_argument("text", help="待检测文本")
    p.add_argument("--no-cache", action="store_true", help="跳过缓存，强制重新请求")
    p.set_defaults(func=cmd_hall_detect)

    # ── enterprise-search ──
    p = sub.add_parser("enterprise-search", help="企业检索（轻量候选列表，1积分）")
    p.add_argument("name", help="企业名称检索词")
    p.add_argument("--top-k", type=int, help="返回条数上限（默认10，范围1-50）")
    p.add_argument("--no-cache", action="store_true", help="跳过缓存，强制重新请求")
    p.set_defaults(func=cmd_enterprise_search)

    # ── enterprise-base ──
    p = sub.add_parser("enterprise-base", help="企业基本信息")
    p.add_argument("--id", help="企业 ID")
    p.add_argument("--uscc", help="统一社会信用代码")
    p.add_argument("--no-cache", action="store_true", help="跳过缓存，强制重新请求")
    p.set_defaults(func=cmd_enterprise_base)

    # ── enterprise-summary ──
    p = sub.add_parser("enterprise-summary", help="企业聚合总览")
    p.add_argument("--id", help="企业 ID")
    p.add_argument("--uscc", help="统一社会信用代码")
    p.add_argument("--no-cache", action="store_true", help="跳过缓存，强制重新请求")
    p.set_defaults(func=cmd_enterprise_summary)

    # ── enterprise-list ──
    p = sub.add_parser("enterprise-list", help="企业分项列表查询")
    p.add_argument("--type", required=True,
                   choices=list(ENTERPRISE_LIST_TYPES.keys()),
                   help="查询类型")
    p.add_argument("--id", help="企业 ID")
    p.add_argument("--uscc", help="统一社会信用代码")
    p.add_argument("--page", type=int, default=1, help="页码（默认 1）")
    p.add_argument("--size", type=int, default={"economical": 10, "aggressive": 50}.get(_strategy, 30), help="每页条数（默认 30，economical 10，aggressive 50）")
    p.add_argument("--no-cache", action="store_true", help="跳过缓存，强制重新请求")
    p.set_defaults(func=cmd_enterprise_list)

    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        sys.exit(0)

    # 自动版本检测（check-update / do-update 子命令除外）
    if args.command not in ("check-update", "do-update", "archive-list", "backfill-urls", "strategy"):
        try:
            _updater.check_for_update()
        except Exception:
            pass

    args.func(args)


if __name__ == "__main__":
    main()
