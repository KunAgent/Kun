#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
腾讯云 RUM 全链路专家团 · L0 工程规范一致性校验脚本

使用方法（在专家包根目录运行）：
    cd "rum-fullstack-team v2"
    python3 tests/lint.py

校验项见 TEST_PLAN.md「二、L0」14 条。
退出码：0 全部通过；非 0 表示失败项数。
"""

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

OK = []
ERR = []


def check(label, cond, detail=""):
    (OK if cond else ERR).append((label, detail))


# ---- 1. 加载 plugin.json ----
plugin_path = ".workbuddy-plugin/plugin.json"
check("01 .workbuddy-plugin/plugin.json 存在", os.path.exists(plugin_path))
if not os.path.exists(plugin_path):
    print("plugin.json 不存在，停止")
    sys.exit(1)

try:
    plugin = json.load(open(plugin_path, encoding="utf-8"))
    plugin_ok = True
except Exception as e:
    plugin = {}
    plugin_ok = False
    ERR.append(("01 plugin.json JSON 合法", str(e)))

if plugin_ok:
    OK.append(("01 plugin.json JSON 合法", ""))

# ---- 2. agentName / settings.json / 主理人 MD / 文件名 四向一致 ----
agent_name = plugin.get("agentName", "")
settings = json.load(open("settings.json", encoding="utf-8"))
lead = plugin.get("teamInfo", {}).get("leadAgent", "")
lead_md_path = f"agents/{lead}.md"
lead_md = open(lead_md_path, encoding="utf-8").read() if os.path.exists(lead_md_path) else ""
m = re.search(r"^name:\s*(\S+)", lead_md, re.M)
md_name = m.group(1) if m else ""

check(
    "02 agentName ↔ settings.agent ↔ 主理人 MD name ↔ 文件名 四向一致",
    agent_name == settings.get("agent") == lead == md_name,
    f"agentName={agent_name} settings={settings.get('agent')} leadAgent={lead} md_name={md_name}",
)

# ---- 3. teamInfo.memberAgents 与 members[].id 对齐 ----
member_agents = plugin.get("teamInfo", {}).get("memberAgents", [])
member_ids = [m["id"] for m in plugin.get("members", []) if m.get("role") == "member"]
check(
    "03 teamInfo.memberAgents 与 members[].id 完全对齐",
    sorted(member_agents) == sorted(member_ids),
    f"memberAgents={member_agents}, member_ids={member_ids}",
)

# ---- 4. 头像路径真实存在 ----
all_avatars = [plugin.get("avatar", "")] + [m.get("avatar", "") for m in plugin.get("members", [])]
missing_avatars = [a for a in all_avatars if not os.path.exists(a)]
check("04 所有 avatar 路径真实存在", not missing_avatars, f"缺失: {missing_avatars}")

# ---- 5. skills 路径下 SKILL.md 真实存在 ----
missing_skills = [s for s in plugin.get("skills", []) if not os.path.exists(os.path.join(s, "SKILL.md"))]
check("05 所有 skills/*/SKILL.md 真实存在", not missing_skills, f"缺失: {missing_skills}")

# ---- 6. agents/*.md frontmatter 不含 tools 字段 ----
bad_tools = []
for ap in plugin.get("agents", []):
    txt = open(ap, encoding="utf-8").read()
    if re.search(r"^tools:", txt, re.M):
        bad_tools.append(ap)
check("06 agents/*.md frontmatter 不含 tools 字段", not bad_tools, f"违规: {bad_tools}")

# ---- 7. profession == displayName（中英都要） ----
check(
    "07 Team 型 profession == displayName（中英）",
    plugin.get("profession") == plugin.get("displayName"),
    f"profession={plugin.get('profession')}, displayName={plugin.get('displayName')}",
)

# ---- 8. displayDescription.zh 字符数 40-50 ----
zh = plugin.get("displayDescription", {}).get("zh", "")
n = len(zh)
check("08 displayDescription.zh 字符数 ∈ [40,50]", 40 <= n <= 50, f"实际 {n} 字符")

# ---- 9. tags=3 / quickPrompts=3 ----
check("09a tags 长度 = 3", len(plugin.get("tags", [])) == 3, f"实际 {len(plugin.get('tags', []))}")
check("09b quickPrompts 长度 = 3", len(plugin.get("quickPrompts", [])) == 3, f"实际 {len(plugin.get('quickPrompts', []))}")

# ---- 10. defaultInitPrompt == quickPrompts[0] ----
qp = plugin.get("quickPrompts", [{}])
check(
    "10 defaultInitPrompt == quickPrompts[0]",
    plugin.get("defaultInitPrompt") == qp[0] if qp else False,
)

# ---- 11. plugin == name；author.email 存在 ----
check("11a plugin 字段 == name 字段", plugin.get("plugin") == plugin.get("name"))
check("11b author.email 存在", "email" in plugin.get("author", {}))

# ---- 12. 主理人 MD 含「团队协作机制（铁律）」章节 ----
check("12 主理人 MD 含「团队协作机制（铁律）」章节", "团队协作机制（铁律）" in lead_md)

# ---- 13. 分析师 MD skills 已升级到 v2.1 ----
analyst_path = "agents/rum-performance-analyst.md"
analyst_md = open(analyst_path, encoding="utf-8").read() if os.path.exists(analyst_path) else ""
has_v21 = "tencent-cloud-rum-zh-2.1" in analyst_md
no_old = not re.search(r"skills:\s*\[\s*tencent-cloud-rum\s*\]", analyst_md)
check("13 分析师 skills 已升级到 tencent-cloud-rum-zh-2.1", has_v21 and no_old)

# ---- 14. 不存在 hooks/ / commands/ / .lsp.json ----
forbidden = ["hooks", "commands", ".lsp.json"]
exist_forbidden = [f for f in forbidden if os.path.exists(f)]
check("14 不存在 hooks/ / commands/ / .lsp.json", not exist_forbidden, f"存在: {exist_forbidden}")

# ---- 输出结果 ----
print("=" * 70)
print(f"L0 工程规范校验结果：PASS {len(OK)} / FAIL {len(ERR)}")
print("=" * 70)
for label, detail in OK:
    print(f"  ✅  {label}")
for label, detail in ERR:
    print(f"  ❌  {label}")
    if detail:
        print(f"      详情: {detail}")
print("=" * 70)
sys.exit(len(ERR))
