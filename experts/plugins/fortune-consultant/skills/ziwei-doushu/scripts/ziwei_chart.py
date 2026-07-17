#!/usr/bin/env python3
from __future__ import annotations

import argparse
import io
import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape

from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

BRANCHES = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"]
MUTAGEN_KEY_TO_CN = {
    "taiyinMaj": "太阴",
    "tiantongMaj": "天同",
    "tianjiMaj": "天机",
    "jumenMaj": "巨门",
    "wuquMaj": "武曲",
    "tanlangMaj": "贪狼",
    "tianliangMaj": "天梁",
    "wenquMin": "文曲",
    "pojunMaj": "破军",
    "wenchangMin": "文昌",
    "lianzhenMaj": "廉贞",
    "ziweiMaj": "紫微",
    "taiyangMaj": "太阳",
}
PALACE_ALIAS_MAP = {
    "仆役宫": "交友宫",
    "奴仆宫": "交友宫",
    "事业宫": "官禄宫",
}
ZH_FONT_STACK = '"WenQuanYi Zen Hei", "WenQuanYi Micro Hei", "Noto Sans CJK SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei", "SimHei", "Arial Unicode MS", sans-serif'
PALACE_COLOR_MAP = {
    "命宫": ("#8f4b38", "#f8ebe5"),
    "兄弟宫": ("#8f5f2f", "#f8efe4"),
    "夫妻宫": ("#8b3f5d", "#f9e9f1"),
    "子女宫": ("#86521d", "#f7eddc"),
    "财帛宫": ("#83611f", "#f8f2df"),
    "疾厄宫": ("#6b4c2d", "#f4ebdf"),
    "迁移宫": ("#2f6a6e", "#e5f4f5"),
    "交友宫": ("#365d8b", "#e7eef8"),
    "官禄宫": ("#325874", "#e5f0f7"),
    "田宅宫": ("#5a6a2f", "#edf4e2"),
    "福德宫": ("#4c5f5c", "#e8f3f1"),
    "父母宫": ("#6f546c", "#f1e8f4"),
}

STAR_CLASSIC = {
    "紫微": {
        "temperament": "主统摄与中枢，重格局与秩序。",
        "risk": "过度求全时，易形成高压运作。",
        "domain": "常见于管理、统筹、资源整合主题。",
    },
    "天机": {
        "temperament": "主机变与思辨，重策略与节奏。",
        "risk": "机心过密时，易反复权衡。",
        "domain": "常见于策略、研究、产品与分析议题。",
    },
    "太阳": {
        "temperament": "主外显与发用，重表达与担当。",
        "risk": "外耗偏高时，易出现精力透支。",
        "domain": "常见于外部拓展、品牌与公众角色。",
    },
    "太阴": {
        "temperament": "主内敛与蓄积，重细节与长线。",
        "risk": "内耗增大时，易出现过度保守。",
        "domain": "常见于研究、财务、后台规划议题。",
    },
    "武曲": {
        "temperament": "主执行与纪律，重效率与结果。",
        "risk": "节奏过满时，恢复与缓冲不足。",
        "domain": "常见于经营、运营、财务控制议题。",
    },
    "廉贞": {
        "temperament": "主原则与边界，重规则与立场。",
        "risk": "表达过硬时，摩擦成本上升。",
        "domain": "常见于规则密集与博弈环境。",
    },
    "贪狼": {
        "temperament": "主开拓与连接，重机会与资源。",
        "risk": "机会过多时，主线易分散。",
        "domain": "常见于商务、创新、外部资源主题。",
    },
    "巨门": {
        "temperament": "主辨析与质询，重问题识别。",
        "risk": "锋芒过露时，沟通阻力增大。",
        "domain": "常见于法务、审计、咨询与评审议题。",
    },
    "天相": {
        "temperament": "主协同与秩序，重平衡与分寸。",
        "risk": "顾全过度时，决断节奏下降。",
        "domain": "常见于组织协同与中后台治理议题。",
    },
    "天梁": {
        "temperament": "主承载与守护，重责任与稳态。",
        "risk": "承担过多时，个体负荷偏高。",
        "domain": "常见于顾问、管理、支持性角色。",
    },
    "天府": {
        "temperament": "主积聚与保全，重稳健与储备。",
        "risk": "守成过重时，窗口期响应偏慢。",
        "domain": "常见于资产管理与平台运营主题。",
    },
    "天同": {
        "temperament": "主和缓与协调，重关系与氛围。",
        "risk": "舒适区惯性时，突破动力不足。",
        "domain": "常见于协同、服务、关系经营议题。",
    },
    "七杀": {
        "temperament": "主攻坚与突进，重效率与临场。",
        "risk": "突进过猛时，波动与风险放大。",
        "domain": "常见于高压、高变化场景。",
    },
    "破军": {
        "temperament": "主变革与重构，重破旧立新。",
        "risk": "频繁重构时，沉没成本增大。",
        "domain": "常见于转型、创业与系统重建议题。",
    },
}

METHODOLOGY_SOURCES = [
    {
        "title": "紫微斗数基础",
        "source": "offline:ziwei-pro/basis",
        "focus": "本命盘/大限盘/流年盘与核心术语。",
    },
    {
        "title": "紫微斗数宫位系统",
        "source": "offline:ziwei-pro/palace",
        "focus": "十二宫结构与三方四正联动。",
    },
    {
        "title": "紫微斗数四化",
        "source": "offline:ziwei-pro/mutagen",
        "focus": "禄权科忌的动态落点与解释顺序。",
    },
    {
        "title": "十四主星",
        "source": "offline:ziwei-pro/major-star",
        "focus": "主星定调与宫位主题映射。",
    },
    {
        "title": "紫微斗数全书（目录）",
        "source": "offline:ziwei-pro/ancient-book",
        "focus": "古籍脉络：宫位、星曜、四化、运限。",
    },
    {
        "title": "iztro 文档 quick-start",
        "source": "offline:iztro/quick-start",
        "focus": "数据结构与 API 口径。",
    },
    {
        "title": "iztro 运限文档",
        "source": "offline:iztro/horoscope",
        "focus": "大限/流年对象与四化字段定义。",
    },
]


def normalize_gender(raw: str) -> str:
    token = str(raw).strip().lower()
    if token in {"male", "m", "1", "男"}:
        return "男"
    if token in {"female", "f", "0", "女"}:
        return "女"
    raise ValueError("gender 仅支持 male/female/男/女")


def parse_local_datetime(date_text: str, time_text: str, timezone_name: str) -> datetime:
    try:
        naive = datetime.strptime(f"{date_text} {time_text}", "%Y-%m-%d %H:%M")
    except ValueError as exc:
        raise ValueError("date/time 格式错误，需要 YYYY-MM-DD + HH:MM") from exc

    try:
        tz = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError as exc:
        raise ValueError(f"无效时区: {timezone_name}") from exc

    return naive.replace(tzinfo=tz)


def apply_longitude(local_dt: datetime, longitude: float) -> tuple[datetime, int]:
    offset_min = int(round((longitude - 120.0) * 4))
    return local_dt + timedelta(minutes=offset_min), offset_min


def shichen_index(hour: int, minute: int) -> int:
    total = hour * 60 + minute
    if total >= 23 * 60 or total < 60:
        return 0
    return ((total - 60) // 120) + 1


def safe_anchor_date(year: int, birth_mm_dd: str) -> tuple[str, str | None]:
    month, day = map(int, birth_mm_dd.split("-"))
    try:
        dt = datetime(year, month, day)
        return dt.strftime("%Y-%m-%d"), None
    except ValueError:
        fallback = datetime(year, month, 28)
        note = f"生日锚点 {year}-{birth_mm_dd} 不存在，自动回退到 {fallback:%Y-%m-%d}"
        return fallback.strftime("%Y-%m-%d"), note


def unique_keep_order(items: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for x in items:
        if x in seen:
            continue
        seen.add(x)
        out.append(x)
    return out


def normalize_palace_name(name: str) -> str:
    token = name if name.endswith("宫") else f"{name}宫"
    return PALACE_ALIAS_MAP.get(token, token)


def normalize_mutagen(mutagen: list[str]) -> list[str]:
    return unique_keep_order([MUTAGEN_KEY_TO_CN.get(x, x) for x in (mutagen or [])])


def _ensure_iztro_py() -> Any:
    try:
        from iztro_py import astro
    except ModuleNotFoundError as exc:
        raise RuntimeError("未安装 iztro-py，请先安装：pip install iztro-py") from exc
    return astro


def _safe_names(stars: Any) -> list[str]:
    out: list[str] = []
    for s in stars or []:
        try:
            out.append(s.translate_name())
        except Exception:
            try:
                out.append(s.name)
            except Exception:
                out.append(str(s))
    return out


def _palace_item(p: Any, idx: int) -> dict[str, Any]:
    return {
        "index": idx,
        "name": normalize_palace_name(p.translate_name()),
        "stem": p.translate_heavenly_stem(),
        "branch": p.translate_earthly_branch(),
        "major": _safe_names(getattr(p, "major_stars", [])),
        "minor": _safe_names(getattr(p, "minor_stars", [])),
        "adj": _safe_names(getattr(p, "adjective_stars", [])),
        "decadal_range": [p.decadal.range[0], p.decadal.range[1]],
        "ages": list(p.ages),
    }


def _ming_context(palaces: list[dict[str, Any]], ming_index: int) -> dict[str, Any]:
    idxs = [ming_index, (ming_index + 4) % 12, (ming_index + 8) % 12, (ming_index + 6) % 12]
    tags = ["本宫", "三方一", "三方二", "对宫"]
    related: list[dict[str, Any]] = []
    for tag, idx in zip(tags, idxs):
        p = palaces[idx]
        related.append(
            {
                "tag": tag,
                "palace": p["name"],
                "stem_branch": f"{p['stem']}{p['branch']}",
                "major": p["major"],
            }
        )
    return {"indices": idxs, "related": related}


def ziwei_block_py(calc_date: str, calc_time: str, gender_cn: str, year: int | None, birth_mm_dd: str) -> dict[str, Any]:
    astro = _ensure_iztro_py()
    h, m = map(int, calc_time.split(":"))
    idx = shichen_index(h, m)

    chart = astro.by_solar(calc_date, idx, gender_cn)

    palaces: list[dict[str, Any]] = []
    decadals: list[dict[str, Any]] = []
    for i in range(12):
        p = chart.palace(i)
        item = _palace_item(p, i)
        palaces.append(item)
        decadals.append(
            {
                "index": i,
                "palace": item["name"],
                "stem_branch": f"{item['stem']}{item['branch']}",
                "start_age": item["decadal_range"][0],
                "end_age": item["decadal_range"][1],
                "major": item["major"],
            }
        )
    decadals.sort(key=lambda x: x["start_age"])

    ming = palaces[0]
    body_name = normalize_palace_name(chart.get_body_palace().translate_name())
    body = next((x for x in palaces if x["name"] == body_name), None)

    context = _ming_context(palaces, ming["index"])

    horoscope = None
    anchor_note = None
    if year:
        anchor_date, anchor_note = safe_anchor_date(year, birth_mm_dd)
        hs = chart.horoscope(anchor_date)
        d = chart.palace(hs.decadal.index)
        y = chart.palace(hs.yearly.index)
        a = chart.palace(hs.age.index)
        mutagen_keys = list(hs.yearly.mutagen or [])
        horoscope = {
            "year": year,
            "anchor_date": anchor_date,
            "decadal": {
                "palace": normalize_palace_name(d.translate_name()),
                "stem_branch": f"{d.translate_heavenly_stem()}{d.translate_earthly_branch()}",
                "major": _safe_names(getattr(d, "major_stars", [])),
            },
            "yearly": {
                "palace": normalize_palace_name(y.translate_name()),
                "stem_branch": f"{y.translate_heavenly_stem()}{y.translate_earthly_branch()}",
                "major": _safe_names(getattr(y, "major_stars", [])),
                "mutagen": normalize_mutagen(mutagen_keys),
            },
            "age": {
                "name": hs.age.name,
                "palace": normalize_palace_name(a.translate_name()),
                "stem_branch": f"{a.translate_heavenly_stem()}{a.translate_earthly_branch()}",
            },
        }

    return {
        "engine": "py",
        "hour_index": idx,
        "hour_branch": BRANCHES[idx],
        "five_elements_class": chart.five_elements_class,
        "ming": ming,
        "body": body,
        "ming_context": context,
        "horoscope": horoscope,
        "palaces": palaces,
        "decadals": decadals,
        "anchor_note": anchor_note,
    }


def ziwei_block_js(calc_date: str, calc_time: str, gender_cn: str, year: int | None, birth_mm_dd: str) -> dict[str, Any]:
    h, m = map(int, calc_time.split(":"))
    idx = shichen_index(h, m)

    script = Path(__file__).with_name("ziwei_engine_js.mjs")
    if not script.exists():
        raise RuntimeError(f"缺少 JS 引擎脚本: {script}")

    args = [
        "node",
        str(script),
        "--date",
        calc_date,
        "--time-index",
        str(idx),
        "--gender",
        gender_cn,
    ]
    if year:
        anchor_date, _ = safe_anchor_date(year, birth_mm_dd)
        args.extend(["--year", str(year), "--anchor-date", anchor_date])

    try:
        out = subprocess.check_output(args, text=True)
    except FileNotFoundError as exc:
        raise RuntimeError("当前环境缺少 node，无法启用 JS 备用引擎") from exc
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(f"JS 备用引擎执行失败: {exc}") from exc

    data = json.loads(out)
    for p in data.get("palaces", []):
        p["name"] = normalize_palace_name(p["name"])
    if data.get("ming"):
        data["ming"]["name"] = normalize_palace_name(data["ming"]["name"])
    if data.get("body"):
        data["body"]["name"] = normalize_palace_name(data["body"]["name"])
    if data.get("horoscope"):
        data["horoscope"]["decadal"]["palace"] = normalize_palace_name(data["horoscope"]["decadal"]["palace"])
        data["horoscope"]["yearly"]["palace"] = normalize_palace_name(data["horoscope"]["yearly"]["palace"])
        data["horoscope"]["age"]["palace"] = normalize_palace_name(data["horoscope"]["age"]["palace"])
        data["horoscope"]["yearly"]["mutagen"] = normalize_mutagen(data["horoscope"]["yearly"].get("mutagen", []))

    data["engine"] = "js"
    data["hour_index"] = idx
    data["hour_branch"] = BRANCHES[idx]
    return data


def _core(ziwei: dict[str, Any]) -> dict[str, Any]:
    base = {
        "five_elements_class": ziwei["five_elements_class"],
        "hour_index": ziwei["hour_index"],
        "ming_stem_branch": f"{ziwei['ming']['stem']}{ziwei['ming']['branch']}",
        "ming_major": ziwei["ming"]["major"],
        "body_palace": ziwei["body"]["name"] if ziwei.get("body") else None,
        "palace_signature": [
            f"{p['name']}|{p['stem']}{p['branch']}|{','.join(p['major'])}" for p in ziwei.get("palaces", [])
        ],
    }
    if ziwei.get("horoscope"):
        base["yearly_palace"] = ziwei["horoscope"]["yearly"]["palace"]
        base["yearly_mutagen"] = ziwei["horoscope"]["yearly"]["mutagen"]
        base["decadal_palace"] = ziwei["horoscope"]["decadal"]["palace"]
    return base


def _core_diff(a: dict[str, Any], b: dict[str, Any]) -> dict[str, dict[str, Any]]:
    diff: dict[str, dict[str, Any]] = {}
    for k in sorted(set(a.keys()) | set(b.keys())):
        if a.get(k) != b.get(k):
            diff[k] = {"py": a.get(k), "js": b.get(k)}
    return diff


def palace_of(ziwei: dict[str, Any], name: str) -> dict[str, Any] | None:
    for p in ziwei.get("palaces", []):
        if p.get("name") == name:
            return p
    return None


def star_classic(stars: list[str], key: str, default: str) -> str:
    for s in stars:
        item = STAR_CLASSIC.get(s)
        if item and item.get(key):
            return item[key]
    return default


def section(conclusion: str, signals: list[str], classics: list[str]) -> dict[str, Any]:
    return {"结论": conclusion, "盘面": signals, "经验": classics}


def interpretation_framework(ziwei: dict[str, Any], target_year: int | None) -> dict[str, Any]:
    ming_major = ziwei["ming"].get("major", [])
    ming_text = "、".join(ming_major) if ming_major else "无主星（空宫）"
    body = ziwei["body"]["name"] if ziwei.get("body") else "未知"

    career = palace_of(ziwei, "官禄宫") or {}
    relation = palace_of(ziwei, "夫妻宫") or {}
    wealth = palace_of(ziwei, "财帛宫") or {}
    health = palace_of(ziwei, "疾厄宫") or {}

    career_major = career.get("major", [])
    relation_major = relation.get("major", [])
    wealth_major = wealth.get("major", [])
    health_major = health.get("major", [])

    h = ziwei.get("horoscope") or {}
    yearly = h.get("yearly", {})
    decadal = h.get("decadal", {})
    muta = yearly.get("mutagen", [])

    year_text = str(target_year) if target_year else "目标年"

    frame = {
        "positioning": section(
            f"命盘主轴以{ming_text}定调，身宫落{body}，整体呈现“主线先行、节奏优先”的结构特征。",
            [
                f"命宫：{ziwei['ming']['stem']}{ziwei['ming']['branch']}｜主星：{ming_text}",
                f"身宫：{body}",
                f"五行局：{ziwei['five_elements_class']}",
            ],
            [
                star_classic(ming_major, "temperament", "空宫借对宫与三方四正，不以单宫孤断。"),
                star_classic(ming_major, "risk", "传统断法重“先定主轴，再看流转”，忌多头并论。"),
            ],
        ),
        "career": section(
            "事业研判宜先看官禄宫星曜，再与运限宫位交叉比对。",
            [
                f"官禄宫主星：{'、'.join(career_major) if career_major else '无主星'}",
                f"{year_text}流年宫：{yearly.get('palace', '未知')}",
                f"{year_text}四化：{'、'.join(muta) if muta else '无'}",
            ],
            [
                star_classic(career_major, "domain", "官禄宫主“职责-角色-权责边界”的演进轨迹。"),
                "大限宫与流年宫同向时，结构变化通常更明显。",
            ],
        ),
        "relationship": section(
            "关系议题先看夫妻宫定性，再看流年触发与沟通节奏。",
            [
                f"夫妻宫主星：{'、'.join(relation_major) if relation_major else '无主星'}",
                f"对宫与三方宫位需与夫妻宫联看，不可孤宫断情。",
            ],
            [
                star_classic(relation_major, "temperament", "夫妻宫重“互动结构”，非单点情绪判断。"),
                star_classic(relation_major, "risk", "传统经验重“节律与边界先行”。"),
            ],
        ),
        "wealth": section(
            "财务议题先辨财帛宫风格，再结合运限与四化看节奏。",
            [
                f"财帛宫主星：{'、'.join(wealth_major) if wealth_major else '无主星'}",
                f"大限宫：{decadal.get('palace', '未知')}｜流年宫：{yearly.get('palace', '未知')}",
            ],
            [
                star_classic(wealth_major, "domain", "财帛宫多主资金风格与资源运作方式。"),
                star_classic(wealth_major, "risk", "传统断法重“先守后攻，先纪后势”。"),
            ],
        ),
        "health": section(
            "健康位研判重“长期负荷与恢复能力”，宜看疾厄宫与运限触发。",
            [
                f"疾厄宫主星：{'、'.join(health_major) if health_major else '无主星'}",
                f"流年触发宫：{yearly.get('palace', '未知')}",
            ],
            [
                star_classic(health_major, "risk", "传统经验强调“先稳节律，再看强弱”。"),
                "疾厄宫与命宫、福德宫联看时，更能反映状态变化路径。",
            ],
        ),
        "risk": section(
            "命理研判首先受输入精度约束，时空口径必须先校准。",
            [
                "时辰跨界会改变命身宫及运限落点。",
                "默认口径：Asia/Shanghai + 120.0E。",
                "边界时刻建议做多档分钟复盘。",
            ],
            [
                "传统断盘次序：校口径 → 定宫位 → 看四化 → 交叉运限。",
                "排盘结论为研究与咨询辅助，不替代医疗、法律、投资等专业判断。",
            ],
        ),
    }

    if h:
        frame["year_focus"] = section(
            f"{h['year']} 年重点在“大限宫-流年宫-四化”三层联动。",
            [
                f"大限宫：{h['decadal']['palace']}（{h['decadal']['stem_branch']}）",
                f"流年宫：{h['yearly']['palace']}（{h['yearly']['stem_branch']}）",
                f"四化：{'、'.join(h['yearly']['mutagen']) if h['yearly']['mutagen'] else '无'}",
                f"岁位：{h['age']['name']} @ {h['age']['palace']}",
            ],
            [
                "流年解读先看宫位主题，再看四化触发对象，最后回归本命结构校验。",
            ],
        )

    return frame


def _format_items(items: list[str], empty: str = "无") -> str:
    return "、".join(items) if items else empty


def render_markdown(payload: dict[str, Any], template: str) -> str:
    z = payload["ziwei"]
    meta = payload["meta"]
    f = payload["framework"]

    lines = [
        "# Ziwei Doushu 专业排盘报告",
        "",
        "> 紫微斗数（框架化解读版）",
        "",
        "## 0) 排盘口径",
        f"- 输入：{meta['input']['date']} {meta['input']['time']} / {meta['input']['gender_raw']}",
        f"- 时区：{meta['timezone']}（默认东八区）",
        f"- 经度：{meta['longitude']}°E（120.0 为北京基准）",
        f"- 统一计算时间：{meta['calc']['date']} {meta['calc']['time']}（经度修正 {meta['calc']['offset_min']} 分钟）",
        f"- 引擎：{payload['engine']['used']}（请求：{payload['engine']['requested']}）",
    ]

    if payload["engine"].get("fallback"):
        lines.append(f"- 回退：{payload['engine']['fallback']}")
    for item in payload["engine"].get("warnings", []):
        lines.append(f"- 注意：{item}")

    lines.extend(
        [
            "",
            "## 1) 排盘事实",
            f"- 五行局：{z['five_elements_class']}",
            f"- 时辰：{z['hour_index']}（{z['hour_branch']}时）",
            f"- 命宫：{z['ming']['name']} {z['ming']['stem']}{z['ming']['branch']}（主星：{_format_items(z['ming']['major'], '无主星')}）",
            f"- 身宫：{z['body']['name'] if z.get('body') else '未知'}",
        ]
    )

    if z.get("horoscope"):
        h = z["horoscope"]
        lines.extend(
            [
                f"- 年度锚点：{h['year']} / {h['anchor_date']}",
                f"- 大限宫：{h['decadal']['palace']}（{h['decadal']['stem_branch']}）",
                f"- 流年宫：{h['yearly']['palace']}（{h['yearly']['stem_branch']}）",
                f"- 岁位：{h['age']['name']} @ {h['age']['palace']}",
                f"- 四化：{_format_items(h['yearly']['mutagen'])}",
            ]
        )

    lines.extend(["", "## 2) 命宫三方四正"])
    for item in z["ming_context"]["related"]:
        lines.append(
            f"- {item['tag']}：{item['palace']}（{item['stem_branch']}）｜主星：{_format_items(item['major'], '无主星')}"
        )

    lines.extend(["", "## 3) 大限阶段"])
    limit = 6 if template == "lite" else 12
    for d in z["decadals"][:limit]:
        lines.append(
            f"- {d['start_age']}-{d['end_age']}岁：{d['palace']}（{d['stem_branch']}）｜主星：{_format_items(d['major'], '无主星')}"
        )

    lines.extend(["", "## 4) 传统研判框架（供二次解读）"])
    order = ["positioning", "career", "relationship", "wealth", "health", "risk", "year_focus"]
    title_map = {
        "positioning": "总定位",
        "career": "事业",
        "relationship": "关系",
        "wealth": "财务",
        "health": "健康",
        "risk": "风险边界",
        "year_focus": "年度焦点",
    }
    for key in order:
        if key not in f:
            continue
        sec = f[key]
        lines.append(f"### {title_map[key]}")
        lines.append(f"- 结论：{sec['结论']}")
        if template != "lite":
            for i, sig in enumerate(sec.get("盘面", []), 1):
                lines.append(f"- 盘面{i}：{sig}")
        for i, exp in enumerate(sec.get("经验", []), 1):
            lines.append(f"- 经验{i}：{exp}")

    lines.extend(["", "## 5) 十二宫明细"])
    for p in z["palaces"]:
        lines.append(
            f"- {p['name']}（{p['stem']}{p['branch']}）｜主星：{_format_items(p['major'], '无主星')}｜辅星：{_format_items(p['minor'])}｜杂曜：{_format_items(p['adj'])}"
        )

    if payload.get("chart"):
        chart_type = str(payload["chart"].get("type", "svg")).upper()
        lines.extend(["", "## 排盘图", f"- {chart_type}：{payload['chart']['path']}"])
        if payload["chart"].get("backend"):
            lines.append(f"- 生成引擎：{payload['chart']['backend']}")
        for warning in payload["chart"].get("warnings", []):
            lines.append(f"- 注意：{warning}")

    if payload["engine"].get("diff"):
        lines.extend(["", "## 双引擎差异"])
        for k, v in payload["engine"]["diff"].items():
            lines.append(f"- {k}: py={v['py']} | js={v['js']}")

    lines.extend(
        [
            "",
            "## 方法论依据",
            "- 框架：命宫定调 + 三方四正 + 四化触发 + 大限流年交叉验证。",
            "- 参考来源见 JSON 的 methodology.sources。",
            "",
            "## 免责声明",
            "- 本输出属于传统命理研究与咨询辅助，不构成医疗、法律、投资建议。",
        ]
    )
    return "\n".join(lines)


def _chunks(text: str, n: int) -> list[str]:
    if len(text) <= n:
        return [text]
    out = []
    i = 0
    while i < len(text):
        out.append(text[i : i + n])
        i += n
    return out


def _clip_items(items: list[str], limit: int) -> list[str]:
    if len(items) <= limit:
        return items
    return items[:limit] + ["…"]


def _palace_palette(name: str) -> tuple[str, str]:
    return PALACE_COLOR_MAP.get(name, ("#6c5a44", "#efe7dd"))


def _compact_error(text: str, limit: int = 180) -> str:
    clean = " ".join(str(text or "").strip().split())
    if len(clean) <= limit:
        return clean
    return clean[:limit] + "..."


def _render_backend_once(
    backend: str,
    svg: str,
    out: Path,
    chart_quality: int,
) -> dict[str, Any]:
    if backend == "cairosvg":
        out.write_bytes(render_jpg_cairosvg(svg, quality=chart_quality))
        return {"path": str(out), "type": "jpg", "backend": "cairosvg", "warnings": []}
    raise RuntimeError(f"不支持的 chart backend: {backend}")


def render_svg(payload: dict[str, Any]) -> str:
    z = payload["ziwei"]
    meta = payload["meta"]

    box_w, box_h, gap = 240, 168, 16
    cols, rows = 4, 4
    top_offset = 132
    grid_h = rows * box_h + (rows + 1) * gap
    width = cols * box_w + (cols + 1) * gap
    height = top_offset + grid_h + 12

    positions = [
        (1, 0),
        (2, 0),
        (3, 0),
        (3, 1),
        (3, 2),
        (3, 3),
        (2, 3),
        (1, 3),
        (0, 3),
        (0, 2),
        (0, 1),
        (0, 0),
    ]

    lines = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
        "<defs>",
        '<linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#f7f1e7"/><stop offset="55%" stop-color="#f2e8dc"/><stop offset="100%" stop-color="#eadcc9"/></linearGradient>',
        '<linearGradient id="headGrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#3f3326"/><stop offset="100%" stop-color="#624b33"/></linearGradient>',
        '<linearGradient id="coreGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#fffefb"/><stop offset="100%" stop-color="#f7efe0"/></linearGradient>',
        '<pattern id="dotPattern" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="#d9c8b4" fill-opacity="0.24"/></pattern>',
        '<filter id="cardShadow" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="2" stdDeviation="2.4" flood-color="#2f2418" flood-opacity="0.16"/></filter>',
        '<style><![CDATA[',
        f'.bg{{fill:url(#bgGrad)}}.pat{{fill:url(#dotPattern)}}.head{{fill:url(#headGrad)}}.title{{font:700 30px {ZH_FONT_STACK};fill:#f8f1e8;letter-spacing:1px}}.meta{{font:500 13px {ZH_FONT_STACK};fill:#f0e4d6}}.sub{{font:500 12px {ZH_FONT_STACK};fill:#6a5743}}.card{{fill:#fffdfa;stroke:#3f3326;stroke-width:1.05}}.tag{{font:700 16px {ZH_FONT_STACK};fill:#fffdfa}}.tagmeta{{font:600 12px {ZH_FONT_STACK};fill:#fff3e8}}.major{{font:700 13px {ZH_FONT_STACK};fill:#2f251c}}.minor{{font:500 12px {ZH_FONT_STACK};fill:#4a3c30}}.adj{{font:500 11.5px {ZH_FONT_STACK};fill:#615244}}.core{{fill:url(#coreGrad);stroke:#3f3326;stroke-width:1.25}}.coretitle{{font:700 20px {ZH_FONT_STACK};fill:#2d241a}}.coreline{{font:500 13px {ZH_FONT_STACK};fill:#45372b}}.mutagen{{font:700 13px {ZH_FONT_STACK};fill:#7a3f1f}}.footer{{font:500 11px {ZH_FONT_STACK};fill:#76614c}}',
        ']]></style>',
        "</defs>",
        f'<rect class="bg" x="0" y="0" width="{width}" height="{height}"/>',
        f'<rect class="pat" x="0" y="0" width="{width}" height="{height}"/>',
        f'<rect class="head" x="{gap}" y="{gap}" width="{width - gap * 2}" height="96" rx="18"/>',
        f'<text class="title" x="{gap + 22}" y="{gap + 40}">Ziwei Doushu 紫微斗数排盘</text>',
        f'<text class="meta" x="{gap + 22}" y="{gap + 64}">{escape(meta["input"]["date"])} {escape(meta["input"]["time"])} / {escape(meta["input"]["gender"])} | 时区 {escape(meta["timezone"])} | 经度 {meta["longitude"]}E</text>',
        f'<text class="meta" x="{gap + 22}" y="{gap + 84}">统一计算时间 {escape(meta["calc"]["date"])} {escape(meta["calc"]["time"])}（经度修正 {meta["calc"]["offset_min"]} 分钟） | 引擎 {escape(payload["engine"]["used"])}</text>',
    ]

    for p, (col, row) in zip(z["palaces"], positions):
        x = gap + col * (box_w + gap)
        y = top_offset + gap + row * (box_h + gap)
        accent, soft = _palace_palette(p["name"])
        lines.append(
            f'<rect class="card" filter="url(#cardShadow)" x="{x}" y="{y}" width="{box_w}" height="{box_h}" rx="14"/>'
        )
        lines.append(f'<rect x="{x}" y="{y}" width="{box_w}" height="36" rx="14" fill="{accent}"/>')
        lines.append(f'<rect x="{x}" y="{y + 24}" width="{box_w}" height="{box_h - 24}" rx="0" fill="{soft}" fill-opacity="0.45"/>')
        lines.append(f'<text class="tag" x="{x + 12}" y="{y + 24}">{escape(p["name"])}</text>')
        lines.append(
            f'<text class="tagmeta" x="{x + box_w - 12}" y="{y + 24}" text-anchor="end">{escape(p["stem"] + p["branch"])}</text>'
        )

        major_text = f"主星：{_format_items(_clip_items(p['major'], 4), '无主星')}"
        minor_text = f"辅星：{_format_items(_clip_items(p['minor'], 5), '无')}"
        adj_text = f"杂曜：{_format_items(_clip_items(p['adj'], 5), '无')}"
        rows: list[tuple[str, str]] = []
        for seg in _chunks(major_text, 16):
            rows.append(("major", seg))
        for seg in _chunks(minor_text, 16):
            rows.append(("minor", seg))
        for seg in _chunks(adj_text, 16):
            rows.append(("adj", seg))

        max_rows = 6
        if len(rows) > max_rows:
            rows = rows[: max_rows - 1] + [("adj", "…")]

        yy = y + 56
        for klass, text in rows:
            lines.append(f'<text class="{klass}" x="{x + 12}" y="{yy}">{escape(text)}</text>')
            yy += 18

        lines.append(
            f'<text class="sub" x="{x + 12}" y="{y + box_h - 12}">大限 {p["decadal_range"][0]}-{p["decadal_range"][1]} 岁</text>'
        )

    cx = gap + (box_w + gap)
    cy = top_offset + gap + (box_h + gap)
    cw = box_w * 2 + gap
    ch = box_h * 2 + gap
    lines.append(f'<rect class="core" filter="url(#cardShadow)" x="{cx}" y="{cy}" width="{cw}" height="{ch}" rx="16"/>')
    lines.append(f'<text class="coretitle" x="{cx + 18}" y="{cy + 30}">中宫总览</text>')

    center = [
        f"命宫：{z['ming']['stem']}{z['ming']['branch']}  主星 {_format_items(_clip_items(z['ming']['major'], 4), '无主星')}",
        f"身宫：{z['body']['name'] if z.get('body') else '未知'}",
        f"五行局：{z['five_elements_class']}",
    ]
    if z.get("horoscope"):
        center.append(f"{z['horoscope']['year']} 流年宫：{z['horoscope']['yearly']['palace']}")
        center.append(f"大限宫：{z['horoscope']['decadal']['palace']}  岁位：{z['horoscope']['age']['name']}")
        center.append(f"四化：{_format_items(_clip_items(z['horoscope']['yearly']['mutagen'], 6), '无')}")

    yy = cy + 56
    for idx, item in enumerate(center):
        klass = "mutagen" if item.startswith("四化") else "coreline"
        for seg in _chunks(item, 28):
            lines.append(f'<text class="{klass}" x="{cx + 18}" y="{yy}">{escape(seg)}</text>')
            yy += 22
        if idx == 2:
            lines.append(f'<line x1="{cx + 18}" y1="{yy - 10}" x2="{cx + cw - 18}" y2="{yy - 10}" stroke="#c9b8a2" stroke-width="1"/>')

    lines.append(
        f'<text class="footer" x="{width - gap - 8}" y="{height - 14}" text-anchor="end">offline renderer • local svg/cairosvg</text>'
    )

    lines.append("</svg>")
    return "\n".join(lines)


def render_jpg_cairosvg(svg: str, quality: int = 92) -> bytes:
    try:
        import cairosvg
    except ModuleNotFoundError as exc:
        raise RuntimeError("生成 JPG 需要 cairosvg，请先安装：pip install cairosvg") from exc

    try:
        from PIL import Image
    except ModuleNotFoundError as exc:
        raise RuntimeError("生成 JPG 需要 pillow，请先安装：pip install pillow") from exc

    quality = max(1, min(100, int(quality)))
    png_bytes = cairosvg.svg2png(bytestring=svg.encode("utf-8"), scale=2.2)
    with Image.open(io.BytesIO(png_bytes)) as img:
        rgb = img.convert("RGB")
        out = io.BytesIO()
        rgb.save(out, format="JPEG", quality=quality, optimize=True)
        return out.getvalue()


def maybe_generate_chart(
    payload: dict[str, Any],
    chart: str,
    chart_out: str | None,
    chart_quality: int,
    chart_backend: str,
) -> dict[str, Any] | None:
    if chart == "none":
        return None
    svg = render_svg(payload)
    if chart_out:
        out = Path(chart_out).expanduser().resolve()
    else:
        stamp = payload["meta"]["calc"]["date"].replace("-", "") + "_" + payload["meta"]["calc"]["time"].replace(":", "")
        ext = "svg" if chart == "svg" else "jpg"
        out = Path.cwd() / f"ziwei_chart_{stamp}.{ext}"
    out.parent.mkdir(parents=True, exist_ok=True)
    if chart == "svg":
        out.write_text(svg, encoding="utf-8")
        return {"path": str(out), "type": "svg"}
    backend = str(chart_backend or "auto").lower()
    warnings: list[str] = []
    allowed = {"auto", "cairosvg"}
    if backend not in allowed:
        backend = "auto"
        warnings.append("chart-backend 参数无效，已自动使用 auto")

    if backend == "auto":
        attempts = [("cairosvg", "cairosvg")]
        for key, label in attempts:
            try:
                result = _render_backend_once(key, svg, out, chart_quality)
                result["warnings"] = warnings
                return result
            except Exception as exc:
                warnings.append(f"{label} 渲染失败：{_compact_error(exc)}")
        raise RuntimeError("JPG 渲染失败（已跳过）")

    result = _render_backend_once(backend, svg, out, chart_quality)
    result["warnings"] = warnings
    return result


def build_payload(args: argparse.Namespace) -> dict[str, Any]:
    gender_cn = normalize_gender(args.gender)

    input_local = parse_local_datetime(args.date, args.time, args.timezone)
    calc_local, offset_min = apply_longitude(input_local, args.longitude)
    calc_date = calc_local.strftime("%Y-%m-%d")
    calc_time = calc_local.strftime("%H:%M")
    birth_mm_dd = args.date[5:]

    ziwei_py = None
    ziwei_js = None
    engine_info: dict[str, Any] = {
        "requested": args.engine,
        "used": args.engine,
        "warnings": [],
    }

    if args.engine in {"py", "dual"}:
        try:
            ziwei_py = ziwei_block_py(calc_date, calc_time, gender_cn, args.year, birth_mm_dd)
        except Exception as exc:
            engine_info["warnings"].append(f"py 引擎失败：{exc}")

    if args.engine in {"js", "dual"}:
        try:
            ziwei_js = ziwei_block_js(calc_date, calc_time, gender_cn, args.year, birth_mm_dd)
        except Exception as exc:
            engine_info["warnings"].append(f"js 引擎失败：{exc}")

    if args.engine == "py":
        if ziwei_py is None and ziwei_js is None:
            raise RuntimeError("py/js 引擎都失败，无法生成紫微盘")
        if ziwei_py is None:
            ziwei = ziwei_js
            engine_info["used"] = "js"
            engine_info["fallback"] = "py->js"
        else:
            ziwei = ziwei_py
            engine_info["used"] = "py"
    elif args.engine == "js":
        if ziwei_py is None and ziwei_js is None:
            raise RuntimeError("js/py 引擎都失败，无法生成紫微盘")
        if ziwei_js is None:
            ziwei = ziwei_py
            engine_info["used"] = "py"
            engine_info["fallback"] = "js->py"
        else:
            ziwei = ziwei_js
            engine_info["used"] = "js"
    else:
        if ziwei_py is None and ziwei_js is None:
            raise RuntimeError("dual 模式下 py/js 全部失败")
        ziwei = ziwei_py or ziwei_js
        engine_info["used"] = "py" if ziwei_py else "js"
        if ziwei_py and ziwei_js:
            engine_info["diff"] = _core_diff(_core(ziwei_py), _core(ziwei_js))

    if ziwei.get("anchor_note"):
        engine_info["warnings"].append(ziwei["anchor_note"])

    payload: dict[str, Any] = {
        "meta": {
            "input": {
                "date": args.date,
                "time": args.time,
                "gender": gender_cn,
                "gender_raw": args.gender,
            },
            "timezone": args.timezone,
            "longitude": args.longitude,
            "calc": {
                "date": calc_date,
                "time": calc_time,
                "offset_min": offset_min,
            },
            "target_year": args.year,
        },
        "version_requirements": {
            "iztro-py": ">=0.3.4",
            "iztro": ">=2.5.7 (js engine)",
        },
        "engine": engine_info,
        "ziwei": ziwei,
        "framework": interpretation_framework(ziwei, args.year),
        "methodology": {
            "summary": "命宫定调 + 三方四正联动 + 四化动态 + 运限交叉验证",
            "sources": METHODOLOGY_SOURCES,
        },
    }

    try:
        chart = maybe_generate_chart(payload, args.chart, args.chart_out, args.chart_quality, args.chart_backend)
        if chart:
            payload["chart"] = chart
    except Exception as exc:
        payload["engine"]["warnings"].append(f"排盘图生成失败，已跳过：{_compact_error(exc)}")

    return payload


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", required=True, help="YYYY-MM-DD")
    ap.add_argument("--time", required=True, help="HH:MM")
    ap.add_argument("--gender", required=True, help="male/female/男/女")
    ap.add_argument("--timezone", default="Asia/Shanghai", help="IANA 时区，默认 Asia/Shanghai")
    ap.add_argument("--longitude", type=float, default=120.0, help="出生地经度，默认 120.0（北京基准）")
    ap.add_argument("--year", type=int, default=None, help="年度锚点年份")
    ap.add_argument("--engine", choices=["py", "js", "dual"], default="py")
    ap.add_argument("--template", choices=["lite", "pro", "executive"], default="pro")
    ap.add_argument("--chart", choices=["none", "svg", "jpg"], default="jpg")
    ap.add_argument("--chart-out", default=None)
    ap.add_argument("--chart-quality", type=int, default=92, help="JPG 质量（1-100），默认 92")
    ap.add_argument("--chart-backend", choices=["auto", "cairosvg"], default="auto")
    ap.add_argument("--format", choices=["markdown", "json"], default="markdown")
    args = ap.parse_args()

    payload = build_payload(args)
    payload["template"] = args.template

    if args.format == "json":
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(render_markdown(payload, args.template))


if __name__ == "__main__":
    main()
