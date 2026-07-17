"""
社招简历 - 规则化粗读打分（不调模型）

v6.1.2 变化（2026-04-26）：
- **top_rids.json 输出瘦身**：原 top_detail 一份约 17 KB（94% 占比是
  highLightOthers.allContent），30 份合计 ~275 KB / ~242k 字符，超出部分小模型
  read_file 的 100k 字符上限（如 Hunyuan3.0）。v6.1.2 分档瘦身：
  · 前 10 条：保留 highLightOthers（去 allContent，shortContent 截断 150 字符，
    取前 3 条）+ score_breakdown 的 hits 摘要
  · 11-30 条：只保留基础身份字段（rid/name/lastEmployerName/lastEmployerTitle/
    lastEduSchool/lastEduLevel/workYearsText/score/tier/evidence），不含
    highLightOthers 和 score_breakdown 明细
  · top_rids 数组（30 个 UUID）完整保留，精读 deep_read.py 正常运行
  · --dump rough_audit.json 仍输出完整原始 30 条数据，审计能力不丢
  · 预期 ~275 KB → ~10-15 KB，减小 96%

v6.1.1 变化（2026-04-26）：
- **删除 must.companies 硬过滤**：粗筛只能看 lastEmployerName（最近一家），会误杀
  早年待过目标公司但最近跳槽的候选人。公司硬约束改由搜索端 `mustCompanies`
  （social_search.py 自动下发到所有 route 的 allCompany）兜底。
- bonus.tier1_companies 加权逻辑不变（_score_company 权重 2.5 不变）

v6.1.0 变化（2026-04-26）：
- **方案 1 城市字段**：check_hard_constraints 新增 must.supportNoExpectCity 分支
  · 当用户允许 + 简历期望城市为空 → 通过（对齐搜索端双子请求语义）
- **方案 2 四维加权打分**：score_candidate 升级为 highlight + company + title + keyword 四维加权
  · 权重 1.0 / 2.5 / 2.0 / 1.5
  · 上限 None / 2 / 3 / 5（防止单维度刷分）
  · TIER 阈值 A=8 / B=3 / C=0（从旧的 3/1/0 升级）
  · entry 新增 score_breakdown 字段，便于审计
  · 若 profile.bonus 为空，仅 highlight 维度起作用 → 行为等同旧版（向后兼容）

v4.3 变化（2026-04-22）：
- 修复字段值清洗问题：搜索结果中带有 HTML 标签（如 <span style="color:red">硕士</span>），
  导致表格显示为空。新增 strip_html_tags() 函数清洗所有文本字段。
- top_detail 输出增加清洗后的干净字段，便于 Agent 生成表格

v4.2 变化（2026-04-22）：
- 主产物从 stdout 改为写入文件（默认 top_rids.json）
  * top_rids + top_detail + stats 写入 JSON 文件
  * stdout 只输出轻量摘要（status + output_file + top_count + stats）
  * Agent 通过 read_file 读取文件获取完整 UUID，避免上下文污染

⚠️ 字段名说明：
  输入 JSONL 由 social_search.py 的 slim_search_result() 生成，
  统一使用小写驼峰 key：rid, name, workPlace, highLightOthers, educationList 等。
  本脚本内部统一使用这些小写驼峰 key。

用法：
  python rough_screen.py \
      --input candidates.jsonl \
      --profile profile.json \
      --top-n 30

  # 可选：落盘审计
  python rough_screen.py \
      --input candidates.jsonl \
      --profile profile.json \
      --top-n 30 \
      --dump rough_audit.json

文件输出（主产物）：
  top_rids.json — {"top_rids": ["uuid1","uuid2",...], "top_detail": [...], "stats": {...}}
  Agent 通过 read_file 读取此文件获取完整 UUID，避免 stdout 中 rid 被上下文压缩截断。

stdout 输出（轻量摘要）：
  {"status": "ok", "output_file": "...", "top_count": N, "stats": {...}}
  不含完整 rid 列表。

stderr 输出（日志）：
  分档 stats + 被排除原因

profile.json 结构（由阶段 1 画像生成）：
{
  "must": {
    "locations": ["深圳"],
    "supportNoExpectCity": false,
    "workYears": {"min": 5, "max": 8},
    "minDegree": "本科",
    "schoolLevels": ["985","211"],
    "companies": []
  },
  "bonus": {
    "tier1_companies": ["字节跳动","阿里","美团"],
    "position_keywords": ["存储","后台"],
    "seniority_keywords": ["高级","专家","资深"],
    "skill_keywords": ["分布式存储","对象存储"],
    "domain_keywords": ["云存储","网盘"]
  }
}
"""
import sys, json, os, argparse, re

def strip_html_tags(text):
    """移除字符串中的 HTML 标签，如 <span style="color:red">硕士</span> → 硕士"""
    if not text or not isinstance(text, str):
        return text or ""
    return re.sub(r'<[^>]+>', '', text).strip()


DEGREE_RANK = {"高中": 1, "大专": 2, "本科": 3, "硕士": 4, "硕士研究生": 4, "博士": 5}

# v6.1.0：四维加权打分
# 权重设计说明：
#   - highlight 权重低（1.0）但无上限：保留原搜索相关性
#   - company 权重最高（2.5）上限 2：最近雇主是强信号，但防止多家大厂经历刷分
#   - title 权重中等（2.0）上限 3：职位名匹配是次强信号
#   - keyword 权重最低（1.5）但上限 5：高亮内容的技能/领域关键词匹配
SCORE_WEIGHTS = {
    "highlight": 1.0,
    "company":   2.5,
    "title":     2.0,
    "keyword":   1.5,
}
SCORE_CAPS = {
    "highlight": None,   # 不设上限
    "company":   2,
    "title":     3,
    "keyword":   5,
}

# 分档阈值（基于加权总分）：A≥8 / B≥3 / C≥0
TIER_THRESHOLDS = {"A": 8, "B": 3, "C": 0}


def load_jsonl(path):
    meta = None
    items = []
    with open(path, "r", encoding="utf-8") as f:
        for i, line in enumerate(f):
            line = line.strip()
            if not line:
                continue
            obj = json.loads(line)
            if i == 0 and isinstance(obj, dict) and "_meta" in obj:
                meta = obj["_meta"]
            else:
                items.append(obj)
    return meta, items


def check_hard_constraints(resume, must):
    """
    检查硬约束，返回 (passed, reason_if_failed)
    JSONL 中 key 都是小写驼峰
    """

    # 1. 城市
    #   v6.1.0：新增 supportNoExpectCity 分支
    #   规则：workPlace 或 expectWorkCitys 命中 → 通过；
    #        若 must.supportNoExpectCity=true 且简历 expectWorkCitys 为空 → 也通过。
    if must.get("locations"):
        locs = must["locations"]
        work_place = (resume.get("workPlace", "") or "").strip()
        expect_raw = resume.get("expectWorkCitys") or []
        if isinstance(expect_raw, list):
            expect = expect_raw
        else:
            expect = [expect_raw] if expect_raw else []

        hit_work = any(loc in work_place for loc in locs)
        hit_expect = any(any(loc in ec for loc in locs) for ec in expect)

        if hit_work or hit_expect:
            pass  # 通过（当前或期望命中）
        elif must.get("supportNoExpectCity") and not expect:
            pass  # 期望为空 + 用户允许 → 通过
        else:
            return False, f"城市不符: workPlace={work_place or '空'}, expect={expect or '空'}"

    # 2. 工作年限（v6.1.6: null 容错 — null 视为无约束，不触发 TypeError）
    wy_range = must.get("workYears") or {}
    wy_min = wy_range.get("min")
    wy_max = wy_range.get("max")
    if wy_min is not None or wy_max is not None:
        wy = resume.get("workYearsNumber")
        if wy is None:
            return False, "工作年限缺失"
        if wy_min is not None and wy < wy_min:
            return False, f"工作年限 {wy} < 下限 {wy_min}"
        if wy_max is not None and wy > wy_max:
            return False, f"工作年限 {wy} > 上限 {wy_max}"

    # 3. 学历
    if must.get("minDegree"):
        cand_deg_raw = (resume.get("lastEduLevel", "") or "").strip()
        cand_deg = strip_html_tags(cand_deg_raw)  # 清洗 HTML 标签
        cand_rank = DEGREE_RANK.get(cand_deg, 0)
        min_rank = DEGREE_RANK.get(must["minDegree"], 0)
        if cand_rank and min_rank and cand_rank < min_rank:
            return False, f"学历 {cand_deg} 低于要求 {must['minDegree']}"

    # 4. 学校层次（可选）
    if must.get("schoolLevels"):
        levels = must["schoolLevels"]
        edu_list = resume.get("educationList") or []
        matched = False
        for e in edu_list:
            tags = []
            if e.get("is985"): tags.append("985")
            if e.get("is211"): tags.append("211")
            if e.get("isC9"): tags.append("C9")
            if e.get("overSea"): tags.append("海外高校")
            if e.get("isDouble"): tags.append("双一流")
            if any(lv in tags for lv in levels):
                matched = True
                break
        if not matched:
            return False, f"学校层次不符: 不满足 {levels} 中任一"

    # v6.1.1：删除 must.companies 硬过滤
    # 原因：粗筛只能看 lastEmployerName（最近一家公司），会误杀早年待过目标公司但最近
    # 跳槽的候选人。公司硬约束改由搜索端 mustCompanies → allCompany 兜底。
    # bonus.tier1_companies 的加权逻辑保持不变。

    return True, None


def _apply_cap(raw, cap):
    """应用上限。cap 为 None 表示不设上限。"""
    if cap is None:
        return raw
    return min(raw, cap)


def _score_highlight(resume):
    """维度 1：搜索高亮条数（保留原逻辑）"""
    highlights = resume.get("highLightOthers") or []
    raw = len(highlights)
    return raw, []  # highlight 不记具体 hits，太冗长


def _score_company(resume, bonus):
    """
    维度 2：最近雇主命中 bonus.tier1_companies
    子串匹配（如"腾讯"可命中"腾讯科技（深圳）有限公司"），每个不同 tier1 公司计 1 分，
    同一候选通常只命中 1 个（偶尔 2 个因为公司名相互包含）。
    """
    tier1 = bonus.get("tier1_companies") or []
    if not tier1:
        return 0, []
    last_emp = strip_html_tags(resume.get("lastEmployerName", "") or "")
    if not last_emp:
        return 0, []
    hits = []
    for company in tier1:
        if company and company in last_emp and company not in hits:
            hits.append(company)
    return len(hits), hits


def _score_title(resume, bonus):
    """
    维度 3：lastEmployerTitle 命中 position_keywords（+1/个）+ seniority_keywords（+0.5/个）
    每个关键词只记 1 次。
    """
    position_kws = bonus.get("position_keywords") or []
    seniority_kws = bonus.get("seniority_keywords") or []
    if not position_kws and not seniority_kws:
        return 0, []
    title = strip_html_tags(resume.get("lastEmployerTitle", "") or "")
    if not title:
        return 0, []
    raw = 0.0
    hits = []
    for kw in position_kws:
        if kw and kw in title and kw not in hits:
            raw += 1.0
            hits.append(kw)
    for kw in seniority_kws:
        if kw and kw in title and kw not in hits:
            raw += 0.5
            hits.append(kw)
    return raw, hits


def _score_keyword(resume, bonus):
    """
    维度 4：高亮内容聚合后命中 skill_keywords + domain_keywords
    每个不同关键词只记 1 次，大小写不敏感。
    """
    skill_kws = bonus.get("skill_keywords") or []
    domain_kws = bonus.get("domain_keywords") or []
    all_kws = list(dict.fromkeys(skill_kws + domain_kws))  # 去重保序
    if not all_kws:
        return 0, []
    highlights = resume.get("highLightOthers") or []
    if not highlights:
        return 0, []
    texts = []
    for h in highlights:
        if isinstance(h, dict):
            texts.append(strip_html_tags(h.get("shortContent", "") or ""))
            texts.append(strip_html_tags(h.get("allContent", "") or ""))
        elif isinstance(h, str):
            texts.append(strip_html_tags(h))
    blob = " ".join(t for t in texts if t).lower()
    if not blob:
        return 0, []
    hits = []
    for kw in all_kws:
        if kw and kw.lower() in blob and kw not in hits:
            hits.append(kw)
    return len(hits), hits


def score_candidate(resume, profile):
    """
    v6.1.0 四维加权打分：
      total = highlight*1.0 + company*2.5 + title*2.0 + keyword*1.5
    各维度都有上限（防刷分）：company≤2, title≤3, keyword≤5, highlight 不设。
    """
    bonus = (profile or {}).get("bonus") or {}

    # 原始分 + hits
    hl_raw, hl_hits         = _score_highlight(resume)
    cmp_raw, cmp_hits       = _score_company(resume, bonus)
    title_raw, title_hits   = _score_title(resume, bonus)
    kw_raw, kw_hits         = _score_keyword(resume, bonus)

    # 应用上限
    hl_capped    = _apply_cap(hl_raw, SCORE_CAPS["highlight"])
    cmp_capped   = _apply_cap(cmp_raw, SCORE_CAPS["company"])
    title_capped = _apply_cap(title_raw, SCORE_CAPS["title"])
    kw_capped    = _apply_cap(kw_raw, SCORE_CAPS["keyword"])

    # 加权
    hl_w    = hl_capped * SCORE_WEIGHTS["highlight"]
    cmp_w   = cmp_capped * SCORE_WEIGHTS["company"]
    title_w = title_capped * SCORE_WEIGHTS["title"]
    kw_w    = kw_capped * SCORE_WEIGHTS["keyword"]

    total = round(hl_w + cmp_w + title_w + kw_w, 2)

    breakdown = {
        "highlight": {"raw": hl_raw, "capped": hl_capped, "weighted": round(hl_w, 2)},
        "company":   {"raw": cmp_raw, "capped": cmp_capped, "weighted": round(cmp_w, 2), "hits": cmp_hits},
        "title":     {"raw": title_raw, "capped": title_capped, "weighted": round(title_w, 2), "hits": title_hits},
        "keyword":   {"raw": kw_raw, "capped": kw_capped, "weighted": round(kw_w, 2), "hits": kw_hits},
    }

    # evidence 人类可读摘要
    parts = []
    if cmp_hits:
        parts.append(f"{'/'.join(cmp_hits)}[tier1]")
    if title_hits:
        parts.append(f"title命中:{'/'.join(title_hits)}")
    if kw_hits:
        parts.append(f"关键词:{'/'.join(kw_hits[:5])}")
    if hl_raw:
        parts.append(f"高亮{hl_raw}处")
    evidence = " + ".join(parts) if parts else "仅通过硬约束，无加分"

    return total, evidence, breakdown


def screen_pool(candidates, profile):
    """对候选池做粗读筛选，返回分档结果。"""
    must = profile.get("must") or {}

    tier_A, tier_B, tier_C, excluded = [], [], [], []

    for resume in candidates:
        passed, reason = check_hard_constraints(resume, must)
        if not passed:
            excluded.append({
                "rid": resume.get("rid", ""),
                "name": resume.get("name", ""),
                "lastEmployerName": resume.get("lastEmployerName", ""),
                "reason": reason,
            })
            continue

        score, reason, breakdown = score_candidate(resume, profile)
        entry = {
            "rid": resume.get("rid", ""),
            "extId": resume.get("extId", ""),
            "name": strip_html_tags(resume.get("name", "")),
            "age": resume.get("age", 0),
            "workPlace": strip_html_tags(resume.get("workPlace", "")),
            "lastEmployerName": strip_html_tags(resume.get("lastEmployerName", "")),
            "lastEmployerTitle": strip_html_tags(resume.get("lastEmployerTitle", "")),
            "lastEduSchool": strip_html_tags(resume.get("lastEduSchool", "")),
            "lastEduLevel": strip_html_tags(resume.get("lastEduLevel", "")),
            "workYearsText": strip_html_tags(resume.get("workYearsText", "")),
            "highLightOthers": resume.get("highLightOthers") or [],
            "score": score,
            "score_breakdown": breakdown,
            "evidence": reason,
        }
        if score >= TIER_THRESHOLDS["A"]:
            entry["tier"] = "A"; tier_A.append(entry)
        elif score >= TIER_THRESHOLDS["B"]:
            entry["tier"] = "B"; tier_B.append(entry)
        else:
            entry["tier"] = "C"; tier_C.append(entry)

    for t in (tier_A, tier_B, tier_C):
        t.sort(key=lambda x: x["score"], reverse=True)

    return {
        "tier_A": tier_A,
        "tier_B": tier_B,
        "tier_C": tier_C,
        "excluded": excluded,
    }


def build_stats(result, total):
    return {
        "total_candidates": total,
        "tier_A_count": len(result["tier_A"]),
        "tier_B_count": len(result["tier_B"]),
        "tier_C_count": len(result["tier_C"]),
        "excluded_count": len(result["excluded"]),
    }


def pick_top_n(result, n):
    """从 A→B→C 顺序拼出 Top N，返回 rid 列表和详情列表。"""
    pool = result["tier_A"] + result["tier_B"] + result["tier_C"]
    top = pool[:n]
    return [c["rid"] for c in top if c.get("rid")], top


# v6.1.2：top_rids.json 输出瘦身
# 背景：原 top_detail 一份约 17 KB（94% 占比是 highLightOthers.allContent），
#      30 份合计 ~275 KB / ~242k 字符，超出部分小模型 read_file 的 100k 字符上限。
# 方案：
#   - 前 10 条（阶段 4 表格 + 粗筛说明要用）→ 保留 highLightOthers（去 allContent，
#     shortContent 截断 150 字符，取前 3 条）+ score_breakdown 的 hits 摘要
#   - 11-30 条（精读 deep_read 候选池，模型不会直接看）→ 只保留基础身份字段
# 预期：~275 KB → ~10-15 KB，减小 96%
SHORT_CONTENT_TRUNCATE = 150    # 每条 shortContent 截断长度
HIGHLIGHT_KEEP_COUNT = 3        # 每人保留的高亮条数
TOP_DETAIL_WITH_HIGHLIGHTS = 10 # 前 N 条保留 highLightOthers/score_breakdown


def slim_top_detail_entry(entry: dict, include_highlights: bool = True) -> dict:
    """
    生成精简版 top_detail 条目，用于 top_rids.json 瘦身。

    include_highlights=True（前 10 条用）：
      - 基础字段全保留
      - highLightOthers：只取前 3 条，每条只留 shortContent 截断 150 字符
      - score_breakdown：只留 company_hits/title_hits/keyword_hits（keyword 取前 5）

    include_highlights=False（11-30 条用）：
      - 只保留基础身份字段，去掉 highLightOthers 和 score_breakdown 明细
    """
    slim = {
        "rid": entry.get("rid", ""),
        "name": entry.get("name", ""),
        "lastEmployerName": entry.get("lastEmployerName", ""),
        "lastEmployerTitle": entry.get("lastEmployerTitle", ""),
        "lastEduSchool": entry.get("lastEduSchool", ""),
        "lastEduLevel": entry.get("lastEduLevel", ""),
        "workYearsText": entry.get("workYearsText", ""),
        "score": entry.get("score", 0),
        "tier": entry.get("tier", ""),
        "evidence": entry.get("evidence", ""),
    }

    if include_highlights:
        # highLightOthers：只保留前 3 条，每条只留 shortContent 截断 150 字符（已经 strip HTML）
        raw_hls = entry.get("highLightOthers") or []
        slim_hls = []
        for h in raw_hls[:HIGHLIGHT_KEEP_COUNT]:
            if isinstance(h, dict):
                sc = strip_html_tags(h.get("shortContent", "") or "")[:SHORT_CONTENT_TRUNCATE]
                if sc:
                    slim_hls.append({"shortContent": sc})
            elif isinstance(h, str):
                sc = strip_html_tags(h)[:SHORT_CONTENT_TRUNCATE]
                if sc:
                    slim_hls.append({"shortContent": sc})
        slim["highLightOthers"] = slim_hls

        # score_breakdown：只保留 hits 摘要（帮模型解释排序），不保留 raw/capped/weighted 数值
        bd = entry.get("score_breakdown") or {}
        slim["score_breakdown"] = {
            "company_hits": (bd.get("company") or {}).get("hits", []) or [],
            "title_hits":   (bd.get("title")   or {}).get("hits", []) or [],
            "keyword_hits": ((bd.get("keyword") or {}).get("hits", []) or [])[:5],
        }

    return slim


def main():
    p = argparse.ArgumentParser(description="v6.1.0 粗筛：四维加权打分（高亮 + 公司 + 职位 + 关键词）+ 城市 supportNoExpectCity 分支")
    p.add_argument("--input", required=True, help="搜索结果 JSONL 文件")
    p.add_argument("--profile", required=True, help="画像 JSON（must + bonus）")
    p.add_argument("--top-n", type=int, default=30, help="输出 Top N（默认 30）")
    p.add_argument("--output", default="top_rids.json",
                   help="Top N rid 列表输出文件（默认: top_rids.json）")
    p.add_argument("--dump", help="可选：落盘审计 JSON")
    args = p.parse_args()

    meta, candidates = load_jsonl(args.input)
    with open(args.profile, "r", encoding="utf-8") as f:
        profile = json.load(f)

    result = screen_pool(candidates, profile)
    stats = build_stats(result, len(candidates))
    top_rids, top_detail = pick_top_n(result, args.top_n)

    # stderr：审计日志
    print(f"[rough_screen] 候选池={stats['total_candidates']} | "
          f"A={stats['tier_A_count']} B={stats['tier_B_count']} C={stats['tier_C_count']} "
          f"excluded={stats['excluded_count']} | Top {args.top_n} picked={len(top_rids)}",
          file=sys.stderr)

    # 排除原因日志（前 10 条）
    for ex in result["excluded"][:10]:
        print(f"  [excluded] {ex.get('name','?')} @ {ex.get('lastEmployerName','?')}: {ex.get('reason','?')}",
              file=sys.stderr)

    # 主产物：top_rids 写入文件（Agent 通过 read_file 读取完整 UUID）
    output_path = os.path.abspath(args.output)
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

    # v6.1.2：top_detail 分档瘦身（前 10 保留高亮+hits，11-N 只留基础身份）
    slim_detail = [
        slim_top_detail_entry(entry, include_highlights=(i < TOP_DETAIL_WITH_HIGHLIGHTS))
        for i, entry in enumerate(top_detail)
    ]

    output_data = {
        "top_rids": top_rids,        # 完整 30 个 UUID（精读 deep_read.py 用）
        "top_detail": slim_detail,    # 前 10 完整精简 + 后 20 极简
        "stats": stats,
    }
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)
    print(f"[rough_screen] top_rids 已写入: {output_path}", file=sys.stderr)

    # 可选：落盘审计版
    if args.dump:
        audit = {
            "search_meta": meta,
            "stats": stats,
            "tier_thresholds": TIER_THRESHOLDS,
            "top": top_detail,
            "excluded_sample": result["excluded"][:30],
        }
        os.makedirs(os.path.dirname(os.path.abspath(args.dump)) or ".", exist_ok=True)
        with open(args.dump, "w", encoding="utf-8") as f:
            json.dump(audit, f, ensure_ascii=False, indent=2)
        print(f"[rough_screen] 审计文件已写入: {args.dump}", file=sys.stderr)

    # stdout：轻量摘要（不含完整 rid 列表，避免污染上下文）
    print(json.dumps({
        "status": "ok",
        "output_file": output_path,
        "top_count": len(top_rids),
        "stats": stats,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
