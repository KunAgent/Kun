#!/usr/bin/env python3
"""novel-writing CLI: 小说创作辅助工具"""
import sys
import os
import json
import re
import argparse
from pathlib import Path
from datetime import datetime

NOVEL_DIR = Path("novel")

def safe_name(name):
    """校验项目名，防止路径穿越"""
    if not name:
        return None
    if '..' in name:
        return None
    # 允许字母、数字、下划线、中划线、汉字
    if not re.match(r'^[\w\-\u4e00-\u9fff]+$', name):
        return None
    return name

def resolve_novel(name):
    """解析项目路径"""
    if not name:
        return None
    return NOVEL_DIR / name

def cmd_init(name):
    """初始化新书项目: novel init <书名>"""
    if not safe_name(name):
        print("❌ 项目名只能包含字母、数字、下划线、中划线")
        return
    novel = NOVEL_DIR / name
    if novel.exists():
        print(f"❌ 项目 {name} 已存在")
        return
    novel.mkdir(parents=True, exist_ok=True)
    (novel / "settings").mkdir(exist_ok=True)
    (novel / "chapters").mkdir(exist_ok=True)
    (novel / "tracker").mkdir(exist_ok=True)
    (novel / "references").mkdir(exist_ok=True)
    state = {
        "name": name,
        "current_arc": 1,
        "current_chapter": 1,
        "word_count_today": 0,
        "last_updated": ""
    }
    with open(novel / "state.json", "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)
    (novel / "settings" / "world.md").write_text("# 世界观设定\n\n", encoding="utf-8")
    (novel / "settings" / "characters.md").write_text("# 角色设定\n\n", encoding="utf-8")
    (novel / "settings" / "rules.md").write_text("# 世界规则\n\n", encoding="utf-8")
    (novel / "chapters" / "outline.md").write_text("# 大纲\n\n", encoding="utf-8")
    (novel / "tracker" / "foreshadowing.md").write_text("# 伏笔追踪\n\n", encoding="utf-8")
    (novel / "tracker" / "conflicts.md").write_text("# 冲突记录\n\n", encoding="utf-8")
    (novel / "tracker" / "feedback.md").write_text("# 读者反馈\n\n", encoding="utf-8")
    (novel / "references" / "style-guide.md").write_text("# 文风指南\n\n## 叙事语气\n- 简洁利落\n- 华丽铺陈\n- 悬疑紧张\n- 热血激昂\n\n## 句式偏好\n长句/短句比例：\n段落平均长度：\n\n## 角色声线卡模板\n## 角色：\n性格关键词：\n语气：开心/愤怒/悲伤/冷静\n口头禅：\n\n## 禁忌词表\n", encoding="utf-8")
    print(f"✅ 项目 {name} 创建成功")
    print(f"   目录：novel/{name}/")

def cmd_write(novel_name, chapter, content):
    """撰写章节: novel write <书名> <章节号> <正文>"""
    if not safe_name(novel_name):
        print("❌ 项目名只能包含字母、数字、下划线、中划线")
        return
    novel = resolve_novel(novel_name)
    if not novel.exists():
        print(f"❌ 项目 {novel_name} 不存在，请先运行: novel init {novel_name}")
        return
    try:
        chapter = int(chapter)
    except ValueError:
        print("❌ 章节号必须是数字")
        return
    arc = (chapter - 1) // 30 + 1
    arc_dir = novel / "chapters" / f"arc-{arc}"
    arc_dir.mkdir(exist_ok=True)
    chapter_file = arc_dir / f"chapter-{chapter:03d}.txt"
    chapter_file.write_text(content, encoding="utf-8")
    state_file = novel / "state.json"
    state = json.loads(state_file.read_text(encoding="utf-8"))
    state["current_chapter"] = chapter
    state["current_arc"] = arc
    state["word_count_today"] = state.get("word_count_today", 0) + len(content)
    state["last_updated"] = datetime.now().strftime("%Y-%m-%d %H:%M")
    state_file.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✅ 第{chapter}章已保存（字数：{len(content)}）")

def cmd_outline(novel_name, outline_text):
    """追加大纲内容: novel outline <书名> <大纲内容>"""
    if not safe_name(novel_name):
        print("❌ 项目名只能包含字母、数字、下划线、中划线")
        return
    novel = resolve_novel(novel_name)
    if not novel.exists():
        print(f"❌ 项目 {novel_name} 不存在")
        return
    outline_file = novel / "chapters" / "outline.md"
    entry = f"\n## 第{_next_outline_num(outline_file)+1}节\n\n{outline_text}\n"
    with open(outline_file, "a", encoding="utf-8") as f:
        f.write(entry)
    print(f"✅ 大纲已追加")

def _next_outline_num(outline_file):
    """计算下一个大纲编号"""
    if not outline_file.exists():
        return 0
    content = outline_file.read_text(encoding="utf-8")
    matches = re.findall(r'## 第(\d+)节', content)
    return max([int(m) for m in matches]) if matches else 0

def cmd_setting(novel_name, setting_type, content):
    """录入设定: novel setting <书名> <类型> <内容>
    类型: world/character/rule"""
    if not safe_name(novel_name):
        print("❌ 项目名只能包含字母、数字、下划线、中划线")
        return
    if setting_type not in ("world", "character", "rule"):
        print("❌ 类型必须是: world / character / rule")
        return
    novel = resolve_novel(novel_name)
    if not novel.exists():
        print(f"❌ 项目 {novel_name} 不存在")
        return
    type_map = {
        "world": "world.md",
        "character": "characters.md",
        "rule": "rules.md"
    }
    setting_file = novel / "settings" / type_map[setting_type]
    entry = f"\n## {setting_type.capitalize()}设定\n\n{content}\n"
    with open(setting_file, "a", encoding="utf-8") as f:
        f.write(entry)
    print(f"✅ {setting_type} 设定已录入")

def cmd_check(novel_name, chapter=None):
    """伏笔检测: novel check <书名> [章节号]"""
    if not safe_name(novel_name):
        print("❌ 项目名只能包含字母、数字、下划线、中划线")
        return
    novel = resolve_novel(novel_name)
    if not novel.exists():
        print(f"❌ 项目 {novel_name} 不存在")
        return
    fs_file = novel / "tracker" / "foreshadowing.md"
    if not fs_file.exists():
        print("⚠️ 无伏笔记录")
        return
    content = fs_file.read_text(encoding="utf-8")
    pending = []
    for line in content.split("\n"):
        if "[章" in line and "→" in line and line.strip() and not line.strip().startswith("#"):
            pending.append(line.strip())
    if pending:
        print(f"⚠️ 当前有 {len(pending)} 条伏笔待回收：")
        for p in pending: print(f"   {p}")
    else:
        print("✅ 无待回收伏笔")
    if chapter:
        try:
            ch = int(chapter)
        except ValueError:
            print("❌ 章节号必须是数字")
            return
        in_chapter = [p for p in pending if f"章{ch}" in p]
        print(f"\n📖 第{ch}章相关伏笔：{len(in_chapter)} 条")
        for p in in_chapter: print(f"   {p}")

def cmd_feedback(novel_name, chapter, feedback):
    """读者反馈入库: novel feedback <书名> <章节号> <反馈内容>"""
    if not safe_name(novel_name):
        print("❌ 项目名只能包含字母、数字、下划线、中划线")
        return
    novel = resolve_novel(novel_name)
    if not novel.exists():
        print(f"❌ 项目 {novel_name} 不存在")
        return
    fb_file = novel / "tracker" / "feedback.md"
    try:
        ch = int(chapter)
    except ValueError:
        print("❌ 章节号必须是数字")
        return
    entry = f"- [章{ch}] {feedback} ({datetime.now().strftime('%Y-%m-%d')})\n"
    with open(fb_file, "a", encoding="utf-8") as f:
        f.write(entry)
    print(f"✅ 反馈已入库（第{ch}章）")

def cmd_conflict(novel_name, new_content):
    """冲突检测: novel conflict <书名> <待检测内容>"""
    if not safe_name(novel_name):
        print("❌ 项目名只能包含字母、数字、下划线、中划线")
        return
    novel = resolve_novel(novel_name)
    if not novel.exists():
        print(f"❌ 项目 {novel_name} 不存在")
        return
    # 读取所有设定文件
    settings = {}
    for md in (novel / "settings").iterdir():
        if md.suffix == ".md":
            settings[md.name] = md.read_text(encoding="utf-8")
    # 读取已有章节
    for arc_dir in (novel / "chapters").iterdir():
        if arc_dir.is_dir():
            for ch_file in arc_dir.glob("chapter-*.txt"):
                key = f"chapters/{arc_dir.name}/{ch_file.name}"
                settings[key] = ch_file.read_text(encoding="utf-8")
    conflicts = []
    words = re.findall(r'[\w\u4e00-\u9fff]{2,}', new_content)
    for word in words[:30]:
        for fname, text in settings.items():
            if word in text:
                conflicts.append(f"⚠️ 冲突：'{word}' 已在 {fname} 中出现")
    if conflicts:
        print(f"⚠️ 发现 {len(conflicts)} 处潜在冲突：")
        for c in conflicts[:10]: print(f"   {c}")
    else:
        print("✅ 未检测到明显冲突")
    return conflicts

def cmd_status(novel_name):
    """查看状态: novel status <书名>"""
    if not safe_name(novel_name):
        print("❌ 项目名只能包含字母、数字、下划线、中划线")
        return
    novel = resolve_novel(novel_name)
    if not novel.exists():
        print(f"❌ 项目 {novel_name} 不存在")
        return
    state_file = novel / "state.json"
    if state_file.exists():
        state = json.loads(state_file.read_text(encoding="utf-8"))
        print(f"📖 {novel_name} 当前状态：")
        print(f"   当前章节：第{state.get('current_chapter',1)}章 / 第{state.get('current_arc',1)}卷")
        print(f"   今日字数：{state.get('word_count_today',0)}")
        print(f"   最后更新：{state.get('last_updated','')}")
    fs_file = novel / "tracker" / "foreshadowing.md"
    if fs_file.exists():
        pending = [l for l in fs_file.read_text(encoding="utf-8").split("\n") if "[章" in l and "→" in l and not l.startswith("#")]
        print(f"   待回收伏笔：{len(pending)} 条")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="novel-writing 小说创作辅助CLI", prog="novel")
    sub = parser.add_subparsers(dest="command", help="可用命令")

    p_init = sub.add_parser("init", help="初始化新书: novel init <书名>")
    p_init.add_argument("name", help="书名（字母/数字/下划线/中划线）")

    p_write = sub.add_parser("write", help="写章节: novel write <书名> <章节号> <正文>")
    p_write.add_argument("name", help="书名")
    p_write.add_argument("chapter", type=int, help="章节号")
    p_write.add_argument("content", nargs="*", default=[], help="章节正文")
    p_write.add_argument("--file", dest="from_file", help="从文件读取正文")

    p_outline = sub.add_parser("outline", help="追加大纲: novel outline <书名> <大纲内容>")
    p_outline.add_argument("name", help="书名")
    p_outline.add_argument("text", nargs="*", default=[], help="大纲内容")

    p_set = sub.add_parser("setting", help="录入设定: novel setting <书名> <world|character|rule> <内容>")
    p_set.add_argument("name", help="书名")
    p_set.add_argument("type", choices=["world","character","rule"], help="设定类型")
    p_set.add_argument("content", nargs="*", default=[], help="设定内容")

    p_check = sub.add_parser("check", help="伏笔检测: novel check <书名> [章节号]")
    p_check.add_argument("name", help="书名")
    p_check.add_argument("chapter", nargs="?", default=None, help="章节号")

    p_fb = sub.add_parser("feedback", help="读者反馈: novel feedback <书名> <章节号> <反馈内容>")
    p_fb.add_argument("name", help="书名")
    p_fb.add_argument("chapter", type=int, help="章节号")
    p_fb.add_argument("content", nargs="*", default=[], help="反馈内容")

    p_conf = sub.add_parser("conflict", help="冲突检测: novel conflict <书名> <待检测内容>")
    p_conf.add_argument("name", help="书名")
    p_conf.add_argument("content", nargs="*", default=[], help="待检测内容")

    p_stat = sub.add_parser("status", help="查看状态: novel status <书名>")
    p_stat.add_argument("name", help="书名")

    args = parser.parse_args()

    if args.command is None:
        parser.print_help()
        sys.exit(0)

    if args.command == "init":
        cmd_init(args.name)
    elif args.command == "write":
        content = ""
        if args.from_file:
            try:
                content = Path(args.from_file).read_text(encoding="utf-8")
            except Exception as e:
                print(f"❌ 无法读取文件: {e}")
                sys.exit(1)
        else:
            content = " ".join(args.content)
        cmd_write(args.name, args.chapter, content)
    elif args.command == "outline":
        cmd_outline(args.name, " ".join(args.text))
    elif args.command == "setting":
        cmd_setting(args.name, args.type, " ".join(args.content))
    elif args.command == "check":
        cmd_check(args.name, args.chapter)
    elif args.command == "feedback":
        cmd_feedback(args.name, args.chapter, " ".join(args.content))
    elif args.command == "conflict":
        cmd_conflict(args.name, " ".join(args.content))
    elif args.command == "status":
        cmd_status(args.name)
