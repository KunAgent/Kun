#!/usr/bin/env python3
"""校验 myteam 目录结构的完整性"""

import os
import json
from pathlib import Path

MYTEAM_DIR = Path(__file__).parent.parent

REQUIRED_ENTRIES = [
    ".workbuddy-plugin/plugin.json",
    ".workbuddy/output",
    "delivery",
    "settings.json",
    "README.md",
]

REQUIRED_AGENTS = [
    "aicoding-architecture-expert-team-lead",
    "business-architect",
    "system-architect",
    "platform-architect",
    "security-architect",
    "product-story-designer",
    "knowledge-ingest-engineer",
    "research-analyst",
]

REQUIRED_SKILLS = [
    "aicoding-team-bootstrap",
    "CloudQ",
    "tcloud-arch-diagram",
    "diagrams-generator",
    "tech-research-advisor",
    "docx",
    "pdf",
    "pptx",
    "xlsx",
]

SKILL_REQUIRED_FILES = {
    "aicoding-team-bootstrap": [
        "SKILL.md",
        "references/team-runtime.json",
        "templates/高层架构设计.md",
        "templates/系统设计.md",
        "templates/部署设计.md",
        "templates/安全设计.md",
        "templates/UserStory.md",
    ]
}

errors = []
warnings = []

print("=" * 60)
print("AICoding 架构 Team 结构校验（图表能力已内嵌）")
print("=" * 60)

# 1. 检查根目录必需入口
print("\n[1/5] 检查根目录必需入口...")
for entry in REQUIRED_ENTRIES:
    path = MYTEAM_DIR / entry
    if path.exists():
        print(f"  ✅ {entry}")
    else:
        print(f"  ❌ {entry} — 缺失")
        errors.append(f"缺失: {entry}")

# 2. 检查 Agent 定义
print("\n[2/5] 检查 Agent 定义...")
agents_dir = MYTEAM_DIR / "agents"
if not agents_dir.exists():
    errors.append("缺失: agents/ 目录")
else:
    for agent in REQUIRED_AGENTS:
        agent_file = agents_dir / f"{agent}.md"
        if agent_file.exists():
            print(f"  ✅ agents/{agent}.md")
        else:
            print(f"  ❌ agents/{agent}.md — 缺失")
            errors.append(f"缺失: agents/{agent}.md")

# 3. 检查 Skills 定义
print("\n[3/5] 检查 Skill 定义...")
skills_dir = MYTEAM_DIR / "skills"
if not skills_dir.exists():
    errors.append("缺失: skills/ 目录")
else:
    for skill in REQUIRED_SKILLS:
        skill_file = skills_dir / skill / "SKILL.md"
        if skill_file.exists():
            print(f"  ✅ skills/{skill}/SKILL.md")
        else:
            print(f"  ❌ skills/{skill}/SKILL.md — 缺失")
            errors.append(f"缺失: skills/{skill}/SKILL.md")

        # 检查特定 Skill 的必需文件
        if skill in SKILL_REQUIRED_FILES:
            for extra in SKILL_REQUIRED_FILES[skill]:
                extra_path = skills_dir / skill / extra
                if extra_path.exists():
                    print(f"    ✅ skills/{skill}/{extra}")
                else:
                    print(f"    ❌ skills/{skill}/{extra} — 缺失")
                    errors.append(f"缺失: skills/{skill}/{extra}")

# 4. 校验 plugin.json 与 agents/skills 一致性
print("\n[4/5] 校验 plugin.json 与 agents/skills 一致性...")
plugin_file = MYTEAM_DIR / ".workbuddy-plugin/plugin.json"
if plugin_file.exists():
    try:
        with open(plugin_file, "r", encoding="utf-8") as f:
            plugin = json.load(f)
        plugin_agents = set(plugin.get("agents", []))
        plugin_skills = set(plugin.get("skills", []))
        required_agents_set = set(REQUIRED_AGENTS)
        required_skills_set = set(REQUIRED_SKILLS)

        if plugin_agents == required_agents_set:
            print("  ✅ plugin.json agents 与要求一致")
        else:
            missing_in_plugin = required_agents_set - plugin_agents
            extra_in_plugin = plugin_agents - required_agents_set
            if missing_in_plugin:
                print(f"  ⚠️ plugin.json 缺少 agents: {missing_in_plugin}")
                warnings.append(f"plugin.json 缺少 agents: {missing_in_plugin}")
            if extra_in_plugin:
                print(f"  ⚠️ plugin.json 多余 agents: {extra_in_plugin}")
                warnings.append(f"plugin.json 多余 agents: {extra_in_plugin}")

        if plugin_skills == required_skills_set:
            print("  ✅ plugin.json skills 与要求一致")
        else:
            missing_in_plugin = required_skills_set - plugin_skills
            extra_in_plugin = plugin_skills - required_skills_set
            if missing_in_plugin:
                print(f"  ⚠️ plugin.json 缺少 skills: {missing_in_plugin}")
                warnings.append(f"plugin.json 缺少 skills: {missing_in_plugin}")
            if extra_in_plugin:
                print(f"  ⚠️ plugin.json 多余 skills: {extra_in_plugin}")
                warnings.append(f"plugin.json 多余 skills: {extra_in_plugin}")
    except json.JSONDecodeError as e:
        print(f"  ❌ plugin.json 格式错误: {e}")
        errors.append("plugin.json 格式错误")
else:
    errors.append("缺失: .workbuddy-plugin/plugin.json")

# 5. 检查 bin/ 目录
print("\n[5/5] 检查 bin/ 目录...")
bin_dir = MYTEAM_DIR / "bin"
if bin_dir.exists():
    scripts = list(bin_dir.glob("*.py"))
    for script in scripts:
        print(f"  ✅ bin/{script.name}")
    if not scripts:
        print("  ⚠️ bin/ 目录为空")
else:
    print("  ⚠️ bin/ 目录不存在")
    warnings.append("bin/ 目录不存在")

# 汇总
print("\n" + "=" * 60)
print("校验结果汇总")
print("=" * 60)
print(f"错误: {len(errors)}")
for e in errors:
    print(f"  ❌ {e}")
print(f"警告: {len(warnings)}")
for w in warnings:
    print(f"  ⚠️ {w}")

if errors:
    print("\n🔴 校验未通过！请修复上述错误。")
    exit(1)
else:
    print("\n🟢 校验通过！myteam/ 结构完整。")
    exit(0)
