#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_askable_metrics.py — 从指标倒排索引生成「能查什么数 · 可问话术清单」

读取 knowledge/_audit/metrics-search-index.json，把每个（非废弃）指标
渲染成一句「用户可以直接问的话术」，按业务环节分组，输出 Markdown。

用途：
  - 生成 references/askable-metrics.md（"能查什么数"建议问法权威清单）
  - 指标增减后重跑即可同步，无需手动维护话术

用法：
  python3 scripts/gen_askable_metrics.py            # 打印到 stdout
  python3 scripts/gen_askable_metrics.py --write     # 写入 references/askable-metrics.md
"""
import json
import sys
from pathlib import Path

SKILL_ROOT = Path(__file__).resolve().parent.parent
INDEX_FILE = SKILL_ROOT / "knowledge" / "_audit" / "metrics-search-index.json"
OUT_FILE = SKILL_ROOT / "references" / "askable-metrics.md"

# ─────────────────────────────────────────────────────────────
# 固定头部：五种典型场景·推荐问法 + 实用小 tips
# （来源：业务方「怎么问数」用户引导卡。作为常量内联，随脚本每次生成自动带上，
#  不会被覆盖；要改场景话术改这里。下方指标分组表仍由索引自动生成。）
# ─────────────────────────────────────────────────────────────
SCENARIO_HEADER = """\
## 🎯 五种典型场景 · 推荐问法（先按"你想要什么"对号入座）

不知道怎么开口时，先看你属于下面哪种场景，照着「推荐问法」问即可。

| 典型场景 | 什么时候用 | 推荐问法（照着改组织/时间就行） | 你会拿到 |
|---|---|---|---|
| **A「我就要一个数」** | 单点问数、对外汇报取数 | • "今年 5 月集团本部社招入职多少人"<br>• "Q1 我的部门发了多少 offer"<br>• "上周运营管理部的简历评估通过了多少" | 一个数字 + 一句口径（时间/主体/国家/流程范围/时效）|
| **B「对比给我看」** | 跨 BG / 跨部门 / 跨时段对比 | • "对比 CSIG / IEG / WXG 今年入职数"<br>• "我的部门今年 vs 去年同期入职数"<br>• "对比 5 月和 6 月的社招漏斗通过率" | Markdown 表格 + 一句业务结论 |
| **C「漏斗给我看」** | 分析转化率、定位卡点 | • "今年部门内面试通过率多少"<br>• "今年部门社招漏斗通过率怎么样"<br>• "我的部门 Q1 漏斗" | 表格 + ASCII 漏斗图（一眼看出哪环掉得多）|
| **D「整体进展给我看看」** | 周会/月会前自查、业务汇报准备 | • "运营管理部最近招得怎么样"<br>• "我们部门的招聘进展"<br>• "集团社招整体情况" | A 卡 4 块全套（需求总览 / 漏斗概览 / 通过率 / 辅助指标）—— 问性价比最高的形态 |
| **E「为什么」** | 异常归因、业务复盘 | • "offer 接受率为啥降了"<br>• "我们部门入职数为什么连续两个月下降"<br>• "通道面变通过率为什么这么低" | 2-3 个候选假设 + 数据支撑（同环比 / 按部门拆 / 按招聘经理拆）|

### 💡 问数实用小 tips

**黄金问数公式**——把脑里的问题拆成 4 件事说出来即可：
> 【时间窗】 + 【组织 / 管理主体】 + 【指标】 + 【对比 / 拆分维度（可选）】
> 例："今年 5 月（时间）· 集团本部 CSIG（组织）· 入职人数（指标）· 按部门拆（维度）"

**拿到结果后怎么读**：每条回答末尾都带 **5 行口径**，对外引用前先对一眼——
> 时间 / 管理主体 / 国家 / 流程范围（仅社招 flow_id=3 还是含活水 flow_id IN (3,5)）/ 数据时效
> 其中任一项与你的汇报口径不符，**直接追问"改成 XX 再查一下"**，不用重写整句。

**省时 3 技巧**：
1. 用 **"我的部门"** —— 系统按你的数据权限自动圈范围，不用报部门全名。
2. 固定句式、**存几个"模板问法"** —— 下次套用只改时间/组织。
3. **追问而非重写** —— 拿到一次回答后直接接着追问（"那再按 BG 拆一下""换成上个月"）。

---

"""

# 业务环节分组（business_node 关键词 → 大组）。None 的按 name_zh 关键词兜底归类。
GROUP_ORDER = [
    ("需求与岗位", "📋 需求与岗位"),
    ("简历评估", "📑 简历评估"),
    ("面试", "🧑‍💼 面试"),
    ("薪资谈判", "💰 薪资谈判"),
    ("Offer", "📨 Offer"),
    ("入职", "🎯 入职"),
    ("放弃", "🚪 放弃 / 拒绝"),
    ("流程状态", "📊 流程状态快照"),
    ("转化率", "📈 转化率 / 漏斗率"),
    ("其他", "🗂 其他"),
]


def classify(meta: dict) -> str:
    """把一个指标归到某个大组（返回大组 key）。"""
    name = meta.get("name_zh") or ""
    node = meta.get("business_node") or ""
    blob = f"{name} {node}"
    t = meta.get("type", "")
    # 率类优先（type 含比率 / name 含率）
    if "比率" in t or name.endswith("率") or "率" in name.split(".")[-1][:6]:
        if "率" in name:
            return "转化率"
    if "需求" in blob or "岗位" in blob or "post" in blob.lower() or "时长" in blob or "天数" in name:
        return "需求与岗位"
    if "简历评估" in blob or "评估" in blob:
        return "简历评估"
    if "面试" in blob:
        return "面试"
    if "薪资谈判" in blob or "薪谈" in blob:
        return "薪资谈判"
    if "offer" in blob.lower() or "Offer" in blob:
        return "Offer"
    if "入职" in blob:
        return "入职"
    if "放弃" in blob or "拒绝" in blob or "turndown" in blob.lower() or "giveup" in blob.lower():
        return "放弃"
    if "流程状态" in blob or "快照" in blob or meta.get("type", "").startswith("derived"):
        return "流程状态"
    return "其他"


def clean_name(name: str) -> str:
    """去掉指标名前缀编号（如 "9. 入职率" → "入职率"）。"""
    s = name.strip()
    # 去掉 "数字. " 前缀
    import re
    s = re.sub(r"^\d+\.\s*", "", s)
    return s


def is_snapshot(meta: dict) -> bool:
    """判断是否'流程状态时点快照'类指标（评估中/面试中/offer中/入职中/流程中总人数）。
    这类是'某时点卡在该环节的人数'，问法不该带'今年5月'这类时间窗。"""
    name = meta.get("name_zh") or ""
    node = meta.get("business_node") or ""
    t = meta.get("type", "")
    blob = f"{name} {node}"
    if "流程状态" in node or "快照" in blob:
        return True
    # 形如 "评估中 / 面试中 / offer 中 / 入职中" 且属 derived
    if t.startswith("derived") and ("中" in name and name.strip().endswith("中") is False) is False:
        # name 以"中"或"中/…中"结尾的状态词
        n = clean_name(name)
        if n.endswith("中") or "中/" in n or "流程中" in n:
            return True
    return False


def _squeeze(s: str) -> str:
    """把连续空格压成 1 个，并去掉中文标点前的空格。"""
    import re
    s = re.sub(r"\s{2,}", " ", s)
    s = re.sub(r"\s+([，。？！、）])", r"\1", s)
    s = re.sub(r"([（])\s+", r"\1", s)
    return s.strip()


def make_question(meta: dict) -> str:
    """根据指标类型生成一句可问话术（按类型分别措辞，避免'数有多少'啰嗦/前缀粘连）。"""
    name = clean_name(meta.get("name_zh") or "")
    t = meta.get("type", "")

    # 1) 率类 → "今年集团本部的 XX 是多少？"
    if "率" in name or "比率" in t:
        return _squeeze(f"今年集团本部的 {name} 是多少？")

    # 2) 平均时长（社招平均招聘天数）→ 直接问指标本身
    if "时长" in name or "天数" in name or "周期" in name or "avg" in (meta.get("name_zh") or "").lower():
        return _squeeze(f"今年集团本部的 {name} 是多少？")

    # 3) 需求/岗位类 → "我负责的部门 XX 是多少？"（在招/已完成等带'数'的去掉'数'更顺）
    if "需求" in name or "岗位" in name or "职位" in name:
        q_name = name[:-1] if name.endswith("数") else name
        return _squeeze(f"我负责的部门现在的 {q_name} 是多少？")

    # 4) 流程状态时点快照（评估中/面试中/offer中/入职中/流程中总人数）→ 不带时间窗，问"现在…有多少人"
    if is_snapshot(meta):
        n = name
        # 去掉"总人数/人数"，避免"…人数有多少人"（括号前的也处理）
        n = n.replace("总人数（", "（").replace("总人数(", "(")
        for suf in ("总人数", "人数"):
            if n.endswith(suf):
                n = n[: -len(suf)]
                break
        # 指标名已含"社招"时，前缀不再重复加"社招"
        prefix = "现在 CSIG 的" if n.startswith("社招") else "现在 CSIG 社招"
        return _squeeze(f"{prefix}{n}有多少人？")

    # 5) 计数类（各种面试/offer/薪谈"数"）→ 去掉末尾"数"避免"数有多少"；
    #    但去掉后若以"人"结尾（如"…审批人"）则保留"人数"更通顺
    n = name
    if n.endswith("数") and not n[:-1].endswith("人"):
        n = n[:-1]
    return _squeeze(f"今年 5 月 CSIG 的 {n} 有多少？")


def main():
    if not INDEX_FILE.exists():
        print(f"❌ 找不到索引: {INDEX_FILE}", file=sys.stderr)
        sys.exit(1)

    idx = json.loads(INDEX_FILE.read_text(encoding="utf-8"))

    # 分组收集（排除废弃）
    groups: dict[str, list] = {k: [] for k, _ in GROUP_ORDER}
    skipped = []
    for key, meta in idx.items():
        if "废弃" in meta.get("type", ""):
            skipped.append((key, meta.get("name_zh")))
            continue
        g = classify(meta)
        if g not in groups:
            g = "其他"
        groups[g].append((key, meta))

    # 渲染 Markdown
    lines = []
    lines.append("# 能查什么数 · 可问话术清单（recruit-data-dashboard）")
    lines.append("")
    lines.append("> 🤖 **本文件由 `scripts/gen_askable_metrics.py` 从指标索引自动生成，请勿手改**——指标增减后重跑脚本同步。")
    lines.append("> ")
    lines.append("> **用途**：当用户问「能查什么数 / 你能查哪些招聘指标 / 有什么数据可以看」时，"
                 "agent 读本文件，把下面的话术按需挑几组给用户参考，让用户照着问。")
    lines.append("> ")
    valid = sum(len(v) for v in groups.values())
    lines.append(f"> **当前覆盖**：社招域 {valid} 个已治理指标（口径精准，对外汇报/KPI 引用首选）。"
                 "校招 / 编制 / 员工 / 组织等暂未纳入本指标库——这类问题可查，但会走数仓通用查询（口径需现场确认），不在下表。")
    lines.append("")
    lines.append("---")
    lines.append("")
    # 固定头部：五种典型场景·推荐问法（来自业务方引导卡，内联常量，不会被覆盖）
    lines.append(SCENARIO_HEADER.rstrip("\n"))
    lines.append("")
    lines.append("## 📚 按指标逐个看 · 可问话术清单")
    lines.append("")
    lines.append("> 上面是「按你想要什么」分场景；下面是「按指标逐个列」，想精确点某个指标时查这里。")
    lines.append("")

    for gkey, gtitle in GROUP_ORDER:
        items = groups.get(gkey, [])
        if not items:
            continue
        lines.append(f"## {gtitle}（{len(items)} 项）")
        lines.append("")
        lines.append("| 指标 | 可以这样问 | 别名 |")
        lines.append("|---|---|---|")
        for key, meta in items:
            name = clean_name(meta.get("name_zh") or key)
            q = make_question(meta)
            aliases = meta.get("aliases") or []
            alias_str = " / ".join(a for a in aliases if a)[:60] or "—"
            lines.append(f"| {name} | “{q}” | {alias_str} |")
        lines.append("")

    lines.append("---")
    lines.append("")
    lines.append("## 通用筛选维度（任意指标都能叠加）")
    lines.append("")
    lines.append("上面每句话都可以叠加这些条件，组合出你要的口径：")
    lines.append("")
    lines.append("- **时间**：今年 / 今年 5 月 / 上半年 / 某个季度（默认今年 1 月 1 日 至昨天）")
    lines.append("- **管理主体**：集团本部（默认）/ 含子公司 / 某子公司")
    lines.append("- **BG / 部门**：CSIG / IEG / TEG / 某个具体部门（用全称匹配）")
    lines.append("- **国家**：国内（默认）/ 海外 / 亚太")
    lines.append("- **职位类 / 招聘经理**：某职位类 / 某招聘经理名下")
    lines.append("")
    lines.append("> 💡 用户不给条件时，agent 按默认口径查（今年 · 集团本部 · 国内），"
                 "并在回答里明确披露口径，方便对外引用。")
    lines.append("")

    if skipped:
        lines.append("---")
        lines.append("")
        lines.append("## 已废弃（不再对外提供，仅记录）")
        lines.append("")
        for key, name in skipped:
            lines.append(f"- ~~{name}~~ (`{key}`)")
        lines.append("")

    out = "\n".join(lines)

    if "--write" in sys.argv:
        OUT_FILE.write_text(out, encoding="utf-8")
        print(f"✅ 已写入 {OUT_FILE}（{valid} 个指标，跳过废弃 {len(skipped)} 个）")
    else:
        print(out)


if __name__ == "__main__":
    main()
