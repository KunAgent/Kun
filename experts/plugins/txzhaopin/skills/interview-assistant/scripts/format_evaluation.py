#!/usr/bin/env python3
"""
面评格式化工具 v2.0

功能：
1. 字数统计和控制（系统提交版 ≤400 字，IM 速递版 / 微信转发版 ≤200 字）
2. 去除重复语句
3. 格式规范检查
4. 三档评价体系格式验证

支持两种输出格式：
- system：系统提交版（结构化格式，≤400 字）
- wechat：IM 速递版 / 微信转发版（连贯叙述，≤200 字）

用法：
  python format_evaluation.py <file_path> <doc_type>
  python format_evaluation.py <file_path> all        # 同时检查两种格式（文件需用 --- 分隔）

示例：
  python format_evaluation.py evaluation_system.txt system
  python format_evaluation.py evaluation_wechat.txt wechat
  python format_evaluation.py evaluation_both.txt all
"""

import re
import sys
from difflib import SequenceMatcher


def count_chinese_chars(text):
    """统计中文字符数（不含标点和空格）"""
    punctuation_pattern = r"""[，。！？；：、‘’“”"'()（）【】\s\n\-—·.,!?;:\[\]]"""
    text_clean = re.sub(punctuation_pattern, '', text)
    return len(text_clean)


def remove_duplicates(text, similarity_threshold=0.8):
    """
    检测并标记重复或高度相似的句子
    
    Args:
        text: 输入文本
        similarity_threshold: 相似度阈值（0-1），超过此值视为重复
    
    Returns:
        duplicates: 重复句子列表
    """
    sentences = re.split(r'[。！？\n]', text)
    sentences = [s.strip() for s in sentences if s.strip() and len(s.strip()) > 5]
    
    duplicates = []
    seen = []
    
    for sent in sentences:
        is_duplicate = False
        for prev_sent in seen:
            similarity = SequenceMatcher(None, sent, prev_sent).ratio()
            if similarity > similarity_threshold:
                duplicates.append({
                    'sentence': sent,
                    'similar_to': prev_sent,
                    'similarity': round(similarity, 2)
                })
                is_duplicate = True
                break
        
        if not is_duplicate:
            seen.append(sent)
    
    return duplicates


def check_empty_phrases(text):
    """检查空话和套话"""
    empty_phrases = [
        '沟通能力强', '综合素质高', '表现优秀', '能力突出',
        '学习能力强', '工作认真负责', '积极主动', '具有团队精神',
        '抗压能力强', '执行力强', '有责任心', '善于沟通',
        '综合能力较强', '整体表现良好', '各方面表现均衡'
    ]
    found = []
    for phrase in empty_phrases:
        if phrase in text:
            found.append(phrase)
    return found


def check_format(text, doc_type):
    """
    检查格式规范
    
    Args:
        text: 评价文本
        doc_type: 'system' (系统提交版) or 'wechat' (微信版)
    
    Returns:
        list of issues
    """
    issues = []
    
    # 字数检查
    char_count = count_chinese_chars(text)
    
    if doc_type == 'system':
        if char_count > 400:
            issues.append(f"⚠️ 字数超标：当前 {char_count} 字，系统提交版要求 ≤400 字")
        if char_count < 150:
            issues.append(f"⚠️ 字数偏少：当前 {char_count} 字，建议至少 150 字以确保信息充分")
    elif doc_type == 'wechat':
        if char_count > 200:
            issues.append(f"⚠️ 字数超标：当前 {char_count} 字，微信版要求 ≤200 字")
        if char_count < 80:
            issues.append(f"⚠️ 字数偏少：当前 {char_count} 字，建议至少 80 字")
    
    # 检查 Markdown 加粗标记（微信版不应有）
    if doc_type == 'wechat' and ('**' in text or '__' in text):
        issues.append("⚠️ 微信版不应包含 Markdown 格式标记（** 或 __）")
    
    # 空话检测
    empty_phrases = check_empty_phrases(text)
    if empty_phrases:
        for phrase in empty_phrases:
            issues.append(f"⚠️ 检测到空话：「{phrase}」，需要具体行为事例支撑")
    
    # 微信版特殊检查
    if doc_type == 'wechat':
        if text.startswith('尊敬的') or '您好' in text[:20]:
            issues.append("⚠️ 微信版不需要称谓，直接正文开始")
        
        if re.search(r'^#+\s', text, re.MULTILINE):
            issues.append("⚠️ 微信版不需要 Markdown 标题")
        
        if re.search(r'^\d+\.\s', text, re.MULTILINE):
            issues.append("⚠️ 微信版建议使用连贯叙述，避免分点罗列")
        
        # 检查是否有表格
        if '|' in text and re.search(r'\|.*\|.*\|', text):
            issues.append("⚠️ 微信版不应包含表格，使用纯文本叙述")
    
    # 系统提交版检查
    if doc_type == 'system':
        # 检查是否有结论
        conclusion_keywords = ['建议录用', '不建议录用', '待定', '推荐', '不推荐']
        has_conclusion = any(kw in text for kw in conclusion_keywords)
        if not has_conclusion:
            issues.append("⚠️ 系统提交版应包含明确的录用结论")
    
    # 通用检查：三档标签是否使用正确
    if doc_type == 'system':
        score_pattern = re.findall(r'(\d)\s*分', text)
        for score in score_pattern:
            s = int(score)
            if s < 1 or s > 5:
                issues.append(f"⚠️ 检测到无效评分：{s} 分，有效范围为 1-5 分")
    
    return issues


def format_evaluation(text, doc_type):
    """
    格式化评价文本并输出诊断信息
    
    Args:
        text: 评价文本
        doc_type: 'system' or 'wechat'
    
    Returns:
        bool: 是否通过所有检查
    """
    type_name = '系统提交版' if doc_type == 'system' else 'IM 速递版 / 微信转发版'
    char_limit = 400 if doc_type == 'system' else 200
    
    print(f"\n{'='*50}")
    print(f" {type_name} 格式检查")
    print(f"{'='*50}\n")
    
    # 字数统计
    char_count = count_chinese_chars(text)
    print(f"📊 字数统计：{char_count} / {char_limit} 字")
    
    if char_count > char_limit:
        over = char_count - char_limit
        print(f"   ❌ 超出限制 {over} 字，需要精简")
        if doc_type == 'wechat':
            print(f"   💡 建议：IM 速递版只需结论+核心理由+1-2个关键证据")
        else:
            print(f"   💡 建议：精简证据描述，每个维度只保留最关键的1个证据")
    else:
        remaining = char_limit - char_count
        print(f"   ✅ 符合要求（还剩 {remaining} 字空间）")
    print()
    
    # 重复检查
    duplicates = remove_duplicates(text)
    if duplicates:
        print(f"🔁 重复内容检测：发现 {len(duplicates)} 处疑似重复")
        for dup in duplicates:
            print(f"   - \"{dup['sentence'][:30]}...\"")
            print(f"     与 \"{dup['similar_to'][:30]}...\" 相似度 {dup['similarity']}")
        print()
    else:
        print("🔁 重复内容检测：✅ 无重复\n")
    
    # 格式检查
    issues = check_format(text, doc_type)
    if issues:
        print("📋 格式规范检查：")
        for issue in issues:
            print(f"   {issue}")
        print()
    else:
        print("📋 格式规范检查：✅ 符合规范\n")
    
    # 总结
    all_pass = char_count <= char_limit and not duplicates and not issues
    print(f"{'='*50}")
    if all_pass:
        print(f" ✅ {type_name}通过所有检查")
    else:
        print(f" ⚠️ {type_name}存在需要优化的项，请根据上述提示修改")
    print(f"{'='*50}\n")
    
    return all_pass


def main():
    if len(sys.argv) < 3:
        print("面评格式化工具 v2.0")
        print()
        print("用法：")
        print("  python format_evaluation.py <file_path> <doc_type>")
        print()
        print("  doc_type 选项：")
        print("    system  — 系统提交版（≤400 字，结构化格式）")
        print("    wechat  — IM 速递版 / 微信转发版（≤200 字，连贯叙述）")
        print("    all     — 同时检查两种格式（文件用 --- 分隔，第一段为系统版，第二段为微信版）")
        print()
        print("示例：")
        print("  python format_evaluation.py evaluation.txt system")
        print("  python format_evaluation.py evaluation.txt wechat")
        print("  python format_evaluation.py evaluation_both.txt all")
        sys.exit(1)
    
    file_path = sys.argv[1]
    doc_type = sys.argv[2]
    
    if doc_type not in ['system', 'wechat', 'all']:
        print("错误：doc_type 必须是 'system'、'wechat' 或 'all'")
        sys.exit(1)
    
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            text = f.read()
    except FileNotFoundError:
        print(f"错误：文件 {file_path} 不存在")
        sys.exit(1)
    
    if doc_type == 'all':
        # 用 --- 分隔两个版本
        parts = re.split(r'\n---+\n', text, maxsplit=1)
        if len(parts) < 2:
            print("错误：使用 'all' 模式时，文件需用 '---' 分隔系统版和微信版")
            print("格式：")
            print("  [系统提交版内容]")
            print("  ---")
            print("  [微信版内容]")
            sys.exit(1)
        
        pass_system = format_evaluation(parts[0].strip(), 'system')
        pass_wechat = format_evaluation(parts[1].strip(), 'wechat')
        
        print("\n" + "=" * 50)
        print(" 综合结果")
        print("=" * 50)
        print(f"  系统提交版：{'✅ 通过' if pass_system else '⚠️ 需修改'}")
        print(f"  微信版：    {'✅ 通过' if pass_wechat else '⚠️ 需修改'}")
        print("=" * 50 + "\n")
        
        sys.exit(0 if (pass_system and pass_wechat) else 1)
    else:
        passed = format_evaluation(text, doc_type)
        sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
