#!/usr/bin/env python3
"""
ArtStation -> org-knowledge-base 知识库转换器

把 search_artstation.py 输出的 JSON 转换为 org-knowledge-base 兼容格式,
并写入 {workspace}/knowledge-base/org-mapping/{company_id}.json

用法:
    python3 to_mapping_kb.py \
      --input ./artstation_results.json \
      --workspace /path/to/workspace \
      [--default-studio mihoyo] \
      [--no-html]

依赖: 仅 Python 3 标准库
"""
from __future__ import annotations
import argparse, json, os, re, sys
from datetime import datetime
from typing import Any


# ============= 工作室识别 =============

STUDIO_ALIASES = {
    "mihoyo": ["mihoyo", "miHoYo", "米哈游", "hoyoverse", "HoYoverse"],
    "tencent-tianmei": ["tencent tianmei", "天美工作室", "tianmei", "天美"],
    "tencent-timi": ["timi", "timi studios", "天美", "TiMi"],
    "tencent-lightspeed": ["lightspeed", "光子工作室", "光子"],
    "tencent-morefun": ["morefun", "魔方"],
    "tencent-photon": ["photon", "光子"],
    "tencent": ["tencent", "腾讯", "Tencent Games"],
    "netease": ["netease", "网易", "网易游戏", "netease games"],
    "netease-leihuo": ["leihuo", "雷火", "网易雷火"],
    "miha-aurora": ["aurora studios", "极光工作室"],
    "lilithgames": ["lilith", "莉莉丝"],
    "yostar": ["yostar", "悠星"],
    "papergames": ["papergames", "叠纸"],
    "blizzard": ["blizzard", "暴雪"],
    "blizzard-shanghai": ["blizzard shanghai", "暴雪上海"],
    "ubisoft": ["ubisoft", "育碧"],
    "ubisoft-shanghai": ["ubisoft shanghai", "育碧上海"],
    "naughty-dog": ["naughty dog"],
    "rockstar": ["rockstar", "rockstar games", "r star"],
    "ea": ["electronic arts", "ea games"],
    "activision": ["activision"],
    "epic-games": ["epic games", "epic"],
    "riot-games": ["riot games", "riot", "拳头"],
    "ccp-games": ["ccp games"],
    "from-software": ["fromsoftware", "from software"],
    "capcom": ["capcom", "卡普空"],
    "square-enix": ["square enix", "se", "史克威尔"],
    "konami": ["konami"],
    "sega": ["sega"],
    "nexon": ["nexon"],
    "ncsoft": ["ncsoft", "nc soft"],
    "smilegate": ["smilegate"],
    "krafton": ["krafton", "pubg"],
}

# 反向映射: alias -> studio_id
ALIAS_TO_STUDIO = {}
for sid, aliases in STUDIO_ALIASES.items():
    for a in aliases:
        ALIAS_TO_STUDIO[a.lower()] = sid


def detect_studio(headline: str, about: str) -> tuple[str, str]:
    """从 headline + about 识别工作室, 返回 (studio_id, studio_display_name)"""
    text = f"{headline or ''} {about or ''}".lower()
    # 优先匹配最长的别名
    sorted_aliases = sorted(ALIAS_TO_STUDIO.keys(), key=lambda x: -len(x))
    for alias in sorted_aliases:
        if alias in text:
            sid = ALIAS_TO_STUDIO[alias]
            # 取该 studio 的第一个别名作为 display name
            display = STUDIO_ALIASES[sid][0]
            return sid, display
    return "freelance-artists", "Freelance Artists"


# ============= 工种识别 =============

DEPT_TEAM_RULES = [
    # (关键词正则, dept_id, dept_name, team_id, team_name)
    (r"character\s+concept|角色原画|character\s+designer", "dept-concept-art", "Concept Art", "team-character-concept", "Character Concept"),
    (r"environment\s+concept|场景原画|level\s+concept", "dept-concept-art", "Concept Art", "team-environment-concept", "Environment Concept"),
    (r"prop\s+concept|vehicle\s+concept|weapon\s+concept|道具设计", "dept-concept-art", "Concept Art", "team-prop-concept", "Prop / Vehicle / Weapon Concept"),
    (r"\bconcept\s+art|concept\s+artist|概念设计", "dept-concept-art", "Concept Art", "team-character-concept", "Character Concept"),
    (r"character\s+model|3d\s+character|角色建模", "dept-3d-art", "3D Art", "team-character-modeling", "Character Modeling"),
    (r"environment\s+art|场景艺术", "dept-3d-art", "3D Art", "team-environment-art", "Environment Art"),
    (r"hard\s+surface", "dept-3d-art", "3D Art", "team-hard-surface", "Hard Surface"),
    (r"texture|material|substance", "dept-3d-art", "3D Art", "team-texture", "Texture / Material"),
    (r"3d\s+art", "dept-3d-art", "3D Art", "team-3d-general", "3D General"),
    (r"animation|animator|动画", "dept-animation", "Animation", "team-animation-general", "Animation"),
    (r"vfx|visual\s+effects|特效", "dept-vfx", "VFX", "team-vfx-general", "VFX"),
    (r"lighting|灯光", "dept-lighting", "Lighting", "team-lighting-general", "Lighting"),
    (r"\bui\b|\bux\b|interface", "dept-ui-ux", "UI/UX", "team-ui-general", "UI/UX"),
    (r"illustration|插画", "dept-2d-illustration", "2D Illustration", "team-original-painting", "Original Painting"),
    (r"matte\s+paint", "dept-2d-illustration", "2D Illustration", "team-matte-painting", "Matte Painting"),
    (r"motion\s+design", "dept-animation", "Animation", "team-motion", "Motion Design"),
]


def detect_dept_team(headline: str, about: str, skills: list) -> tuple[str, str, str, str]:
    """识别部门/团队, 返回 (dept_id, dept_name, team_id, team_name)"""
    skills_str = " ".join([s if isinstance(s, str) else s.get("name", "") for s in (skills or [])])
    text = f"{headline or ''} {about or ''} {skills_str}".lower()
    for pattern, dept_id, dept_name, team_id, team_name in DEPT_TEAM_RULES:
        if re.search(pattern, text):
            return dept_id, dept_name, team_id, team_name
    return "dept-other", "Other", "team-other", "Other"


# ============= 职级识别 =============

def detect_level(headline: str) -> str:
    h = (headline or "").lower()
    if re.search(r"\bart\s+director\b|\bcreative\s+director\b", h): return "Director"
    if re.search(r"\bprincipal\b", h): return "Principal"
    if re.search(r"\block?\b|\blead\b|主美|首席", h): return "Lead"
    if re.search(r"\bsenior\b|资深", h): return "Senior"
    if re.search(r"\bjunior\b|初级", h): return "Junior"
    if re.search(r"\bintern\b|实习", h): return "Intern"
    return "IC"


# ============= 中文联系方式提取 =============

def extract_chinese_contacts(text: str) -> str:
    parts = []
    qq = re.search(r"[Qq][Qq]\D{0,4}(\d{6,12})", text or "")
    wx = re.search(r"[微v][信V]\D{0,3}([\w-]{6,20})", text or "")
    weibo = re.search(r"微博\D{0,3}[@:：]?([\w\-]+)", text or "")
    if qq: parts.append(f"QQ:{qq.group(1)}")
    if wx: parts.append(f"WX:{wx.group(1)}")
    if weibo: parts.append(f"Weibo:@{weibo.group(1)}")
    return " / ".join(parts)


# ============= 单人转换 =============

def convert_artist(item: dict, default_studio: str = None) -> tuple[str, str, dict]:
    """
    将单条 ArtStation 数据转换为 personnel 字典
    返回: (studio_id, studio_display_name, personnel_dict)
    """
    headline = item.get("headline", "") or ""
    about = item.get("about", "") or ""
    full_name = item.get("full_name") or item.get("username", "Unknown")
    username = item.get("username", "")

    # 工作室识别
    if default_studio:
        studio_id = default_studio
        studio_display = STUDIO_ALIASES.get(default_studio, [default_studio])[0]
    else:
        studio_id, studio_display = detect_studio(headline, about)

    dept_id, dept_name, team_id, team_name = detect_dept_team(headline, about, item.get("skills", []))
    level = detect_level(headline)

    # 联系方式
    email = item.get("email") or ""
    contact_chinese = extract_chinese_contacts(headline + " " + about)

    # 技能
    skills_raw = item.get("skills", []) or []
    software_raw = item.get("software", []) or []
    all_skills = []
    for s in skills_raw + software_raw:
        if isinstance(s, dict):
            all_skills.append(s.get("name", ""))
        elif isinstance(s, str):
            all_skills.append(s)
    all_skills = [s for s in all_skills if s]

    # 社交资料
    socials = item.get("social_profiles", []) or []
    social_profiles = []
    for sp in socials:
        if isinstance(sp, dict):
            social_profiles.append({
                "type": sp.get("social_profile_type", "unknown"),
                "url": sp.get("url", "")
            })

    base_city = ""
    city = item.get("city", "") or ""
    country = item.get("country", "") or ""
    if city and country:
        base_city = f"{city}, {country}"
    elif city or country:
        base_city = city or country

    bg_brief = (headline or "").strip()
    if about:
        bg_brief = (bg_brief + " · " + about[:80]).strip(" ·")
    bg_brief = bg_brief[:200]

    personnel = {
        "id": f"artist-{username}",
        "name": full_name,
        "username": username,
        "title": headline,
        "title_abbr": level,
        "department_id": dept_id,
        "team_id": team_id,
        "base_city": base_city,
        "background_brief": bg_brief,
        "skills": all_skills,
        "followers_count": item.get("followers_count", 0),
        "contact_email": email,
        "contact_chinese": contact_chinese,
        "social_profiles": social_profiles,
        "source": "artstation-talent-finder v1.0",
        "source_urls": [item.get("permalink", f"https://www.artstation.com/{username}")],
        "confidence": "high",
        "added_at": datetime.now().isoformat(timespec="seconds"),
        "updated_at": datetime.now().isoformat(timespec="seconds"),
    }
    return studio_id, studio_display, personnel


# ============= 组装公司 JSON =============

def build_org_structure(personnel_list: list) -> dict:
    """根据已分类的 personnel, 动态生成 org_structure 树"""
    # 收集出现过的 (dept_id, dept_name, team_id, team_name)
    dept_map = {}  # dept_id -> {name, teams: {team_id: team_name}}
    for p in personnel_list:
        did = p["department_id"]
        tid = p["team_id"]
        if did not in dept_map:
            dept_map[did] = {"name": "", "teams": {}}
        if not dept_map[did]["name"]:
            # 反查 dept name
            for pat, d_id, d_name, t_id, t_name in DEPT_TEAM_RULES:
                if d_id == did:
                    dept_map[did]["name"] = d_name
                    break
            if not dept_map[did]["name"]:
                dept_map[did]["name"] = "Other"
        if tid not in dept_map[did]["teams"]:
            for pat, d_id, d_name, t_id, t_name in DEPT_TEAM_RULES:
                if t_id == tid:
                    dept_map[did]["teams"][tid] = t_name
                    break
            if tid not in dept_map[did]["teams"]:
                dept_map[did]["teams"][tid] = "Other"

    children = []
    for did, info in dept_map.items():
        teams = [{"id": tid, "name": tname, "type": "team", "children": []}
                 for tid, tname in info["teams"].items()]
        children.append({
            "id": did,
            "name": info["name"],
            "type": "department",
            "children": teams,
        })

    return {"id": "root", "name": "Studio", "type": "company", "children": children}


def merge_into_company_file(workspace: str, studio_id: str, studio_display: str,
                             personnel_list: list, source_note: str) -> str:
    kb_dir = os.path.join(workspace, "knowledge-base", "org-mapping")
    os.makedirs(kb_dir, exist_ok=True)
    fpath = os.path.join(kb_dir, f"{studio_id}.json")
    now = datetime.now().isoformat(timespec="seconds")

    if os.path.exists(fpath):
        with open(fpath, "r", encoding="utf-8") as f:
            company = json.load(f)
    else:
        company = {
            "company_id": studio_id,
            "name": studio_display,
            "name_en": studio_display,
            "aliases": STUDIO_ALIASES.get(studio_id, [studio_display]),
            "industry": "Game",
            "description": f"游戏/影视/CG 工作室 ({studio_display})",
            "created_at": now,
            "updated_at": now,
            "update_history": [],
            "org_structure": {"id": "root", "name": studio_display, "type": "company", "children": []},
            "personnel": [],
            "notes": [],
        }

    # 去重合并 personnel
    existing_usernames = {p.get("username"): i for i, p in enumerate(company.get("personnel", []))
                           if p.get("username")}
    new_count = 0
    update_count = 0
    for new_p in personnel_list:
        un = new_p["username"]
        if un in existing_usernames:
            idx = existing_usernames[un]
            old = company["personnel"][idx]
            # 仅在新数据更新的字段进行覆盖（保留 source 多源）
            for key in ["followers_count", "skills", "contact_email", "contact_chinese",
                        "social_profiles", "title", "background_brief"]:
                if new_p.get(key):
                    old[key] = new_p[key]
            old["updated_at"] = now
            update_count += 1
        else:
            company["personnel"].append(new_p)
            new_count += 1

    # 重建 org_structure（基于全量人员）
    structure = build_org_structure(company["personnel"])
    structure["name"] = studio_display
    company["org_structure"] = structure

    # 追加 update_history
    company["update_history"].append({
        "timestamp": now,
        "source": "artstation-talent-finder v1.0",
        "changes": f"{source_note} | 新增 {new_count} 人 / 更新 {update_count} 人 / 总计 {len(company['personnel'])} 人"
    })
    company["updated_at"] = now

    with open(fpath, "w", encoding="utf-8") as f:
        json.dump(company, f, ensure_ascii=False, indent=2)
    return fpath


# ============= HTML 生成（极简版） =============

HTML_TPL = """<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<title>{title} - ArtStation 美术架构</title>
<style>
* {{ box-sizing: border-box; }}
body {{ margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif; background: #f7f8fa; padding: 20px; }}
h1 {{ text-align: center; color: #2d3748; }}
.meta {{ text-align: center; color: #718096; margin-bottom: 20px; font-size: 13px; }}
.tree {{ display: flex; justify-content: center; }}
.tree ul {{ padding: 0; position: relative; display: flex; justify-content: center; list-style: none; }}
.tree li {{ display: flex; flex-direction: column; align-items: center; position: relative; padding: 24px 6px 0; }}
.tree li::before {{ content: ''; position: absolute; top: 0; left: 50%; width: 0; height: 24px; border-left: 2px solid #cbd5e0; transform: translateX(-1px); }}
.tree li::after {{ content: ''; position: absolute; top: 0; left: 0; width: 100%; height: 0; border-top: 2px solid #cbd5e0; }}
.tree li:first-child::after {{ left: 50%; width: 50%; }}
.tree li:last-child::after {{ left: 0; width: 50%; }}
.tree li:only-child::after {{ display: none; }}
.tree > ul > li {{ padding-top: 0; }}
.tree > ul > li::before, .tree > ul > li::after {{ display: none; }}
.vline {{ width: 0; border-left: 2px solid #cbd5e0; height: 24px; margin-left: -1px; }}
.node {{ display: inline-block; padding: 8px 12px; border-radius: 8px; text-align: center; min-width: 100px; max-width: 200px; box-shadow: 0 2px 6px rgba(0,0,0,0.08); position: relative; z-index: 1; font-size: 13px; }}
.node.company {{ background: #dbeafe; color: #1e40af; font-weight: 700; }}
.node.department {{ background: #c7d2fe; color: #3730a3; font-weight: 600; }}
.node.team {{ background: #ddd6fe; color: #5b21b6; }}
.node.artist {{ background: #e9d5ff; color: #581c87; font-size: 12px; padding: 6px 10px; }}
.node .badge {{ display: inline-block; font-size: 10px; padding: 1px 4px; border-radius: 3px; background: #fbbf24; color: #fff; margin-left: 4px; }}
.node .email {{ font-size: 10px; color: #6b21a8; margin-top: 2px; }}
.summary {{ max-width: 1200px; margin: 30px auto; background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 6px rgba(0,0,0,0.05); }}
.summary table {{ width: 100%; border-collapse: collapse; font-size: 13px; }}
.summary th, .summary td {{ padding: 8px 12px; border-bottom: 1px solid #e2e8f0; text-align: left; }}
.summary th {{ background: #f1f5f9; }}
</style></head>
<body>
<h1>{title}</h1>
<div class="meta">来源：artstation-talent-finder · 最后更新：{updated_at} · 已录入：<b>{count}</b> 人</div>
<div class="tree">{tree_html}</div>
<div class="summary"><h3>艺术家详情</h3>{table_html}</div>
</body></html>
"""


def render_node(node: dict, personnel: list, depth=0) -> str:
    """递归渲染节点"""
    ntype = node.get("type", "")
    name = node.get("name", "")
    nid = node.get("id", "")
    children = node.get("children", [])

    # 该节点的人员
    if ntype == "team":
        people = [p for p in personnel if p.get("team_id") == nid]
    else:
        people = []

    inner = f'<div class="node {ntype}">{name}</div>'

    sub = ""
    if children or people:
        sub_items = []
        for c in children:
            sub_items.append(f"<li>{render_node(c, personnel, depth+1)}</li>")
        # 人员节点
        for p in people:
            badge = " ⭐" if p.get("followers_count", 0) > 10000 else ""
            email_html = f'<div class="email">✉ {p["contact_email"]}</div>' if p.get("contact_email") else ""
            artist_node = (f'<div class="node artist">{p["name"]}{badge}'
                           f'<div style="font-size:10px;opacity:.7">{p["title_abbr"]}</div>{email_html}</div>')
            sub_items.append(f"<li>{artist_node}</li>")
        sub = f'<div class="vline"></div><ul>{"".join(sub_items)}</ul>'

    return inner + sub


def generate_html(company: dict, output_path: str):
    structure = company.get("org_structure", {})
    personnel = company.get("personnel", [])

    tree_html = f'<ul><li>{render_node(structure, personnel)}</li></ul>'

    # 人员详情表
    rows = []
    for p in sorted(personnel, key=lambda x: -x.get("followers_count", 0)):
        contact = p.get("contact_email", "")
        if p.get("contact_chinese"):
            contact = (contact + " / " + p["contact_chinese"]).strip(" /")
        rows.append(f"<tr><td>{p['name']}</td><td>{p['title_abbr']}</td>"
                    f"<td>{p.get('base_city','')}</td><td>{p.get('followers_count',0):,}</td>"
                    f"<td>{contact}</td>"
                    f"<td><a href='{p['source_urls'][0]}' target='_blank'>主页</a></td></tr>")
    table_html = ("<table><thead><tr><th>姓名</th><th>职级</th><th>城市</th>"
                  "<th>粉丝</th><th>联系方式</th><th>主页</th></tr></thead>"
                  f"<tbody>{''.join(rows)}</tbody></table>")

    html = HTML_TPL.format(
        title=company.get("name", "工作室"),
        updated_at=company.get("updated_at", ""),
        count=len(personnel),
        tree_html=tree_html,
        table_html=table_html,
    )

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(html)


# ============= 主程序 =============

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", "-i", required=True, help="ArtStation 搜索结果 JSON 文件路径")
    parser.add_argument("--workspace", "-w", required=True, help="工作区根目录(放置 knowledge-base/)")
    parser.add_argument("--default-studio", default=None, help="所有结果统一归到指定 studio_id")
    parser.add_argument("--no-html", action="store_true", help="不生成 HTML")
    parser.add_argument("--source-note", default="ArtStation 搜索", help="本次执行的描述")
    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(f"[ERR] Input not found: {args.input}", file=sys.stderr)
        sys.exit(1)

    with open(args.input, "r", encoding="utf-8") as f:
        data = json.load(f)

    if isinstance(data, dict) and "data" in data:
        items = data["data"]
    elif isinstance(data, list):
        items = data
    else:
        print("[ERR] 输入 JSON 格式不识别(应为列表 或 含 data 字段的 dict)", file=sys.stderr)
        sys.exit(1)

    # 按工作室分组
    by_studio = {}  # studio_id -> (display_name, [personnel,...])
    for item in items:
        sid, sname, p = convert_artist(item, args.default_studio)
        if sid not in by_studio:
            by_studio[sid] = (sname, [])
        by_studio[sid][1].append(p)

    print(f"[INFO] 共 {len(items)} 条 → 分到 {len(by_studio)} 个工作室")

    charts_dir = os.path.join(args.workspace, "knowledge-base", "org-mapping", "charts")
    os.makedirs(charts_dir, exist_ok=True)

    for sid, (sname, plist) in by_studio.items():
        fpath = merge_into_company_file(args.workspace, sid, sname, plist, args.source_note)
        print(f"[OK] {sid} ({sname}): {len(plist)} 人 → {fpath}")

        if not args.no_html:
            with open(fpath, "r", encoding="utf-8") as f:
                company = json.load(f)
            html_path = os.path.join(charts_dir, f"{sid}.html")
            generate_html(company, html_path)
            print(f"     HTML → {html_path}")

    print("\n[DONE] 所有工作室已入库 org-knowledge-base")


if __name__ == "__main__":
    main()
