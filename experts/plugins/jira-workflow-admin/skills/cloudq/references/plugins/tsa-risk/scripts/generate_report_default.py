#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
腾讯云智能顾问 — 架构风险巡检报告生成
读取 risk_fetch_data.sh 拉取的 JSON 数据，生成移动端友好的 HTML 可视化报告。
支持从 template/ 目录加载多套腾讯系风格主题模板，可随机选择或指定主题。
支持自定义模板：用户修改模板后保存到 template/<自定义名>/ 目录，后续可复用。

用法:
    python3 generate_report_default.py <data_json_path> [--theme random|ocean|sunset|forest|lavender|coral|slate] [--template default|<自定义模板名>] [--save-template <模板名>] [--summary <summary.txt>]

参数:
    --theme          选择主题颜色方案（默认 random 随机选择）
    --template       指定模板目录名，从 template/<名称>/ 加载主题（默认 default）
    --save-template  将当前主题配置保存为自定义模板到 template/<名称>/ 目录
    --summary        报告分析文本文件路径

输出:
    与输入文件同目录下的 report_<archId>.html
"""

import sys
import os
import json
import html as html_module
import base64
import random
import glob
import copy

# 兼容 Windows 中文环境（GBK 编码无法处理 Unicode 特殊字符）
if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

# ==================== 模板目录定义 ====================
# 脚本所在目录的上一级为 skill 根目录，模板存放在 template/ 下
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SKILL_ROOT = os.path.dirname(SCRIPT_DIR)
TEMPLATE_BASE_DIR = os.path.join(SKILL_ROOT, "template")

# 模板必须包含的基础颜色字段（用于兼容性校验）
REQUIRED_THEME_KEYS = [
    "name", "header_gradient", "primary", "primary_light", "bg",
    "card_bg", "card_title_bar", "high_risk", "medium_risk", "healthy",
    "text_primary", "text_secondary", "stat_bg", "border",
]


def get_template_dir(template_name="default"):
    """获取模板目录路径"""
    return os.path.join(TEMPLATE_BASE_DIR, template_name)


def load_themes_from_template(template_name="default"):
    """从 template/<template_name>/ 目录加载所有主题 JSON 文件

    返回: dict[theme_id] -> theme_config（与旧 THEMES 结构兼容）
    """
    template_dir = get_template_dir(template_name)
    themes = {}

    if not os.path.isdir(template_dir):
        print(f"⚠️  模板目录不存在: {template_dir}")
        return themes

    json_files = glob.glob(os.path.join(template_dir, "*.json"))
    for fpath in sorted(json_files):
        try:
            with open(fpath, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
            theme_id = cfg.get("id", os.path.splitext(os.path.basename(fpath))[0])
            # 校验必需字段
            missing = [k for k in REQUIRED_THEME_KEYS if k not in cfg]
            if missing:
                print(f"⚠️  模板文件 {os.path.basename(fpath)} 缺少字段: {', '.join(missing)}，跳过")
                continue
            themes[theme_id] = cfg
        except (json.JSONDecodeError, IOError) as e:
            print(f"⚠️  加载模板文件失败 {os.path.basename(fpath)}: {e}")
            continue

    return themes


def get_score_color_by_thresholds(score_val, theme):
    """根据模板中的阈值配置返回评分对应的颜色

    优先使用模板中的 score_thresholds + score_xxx 颜色，
    不存在则 fallback 到 healthy/medium_risk/high_risk。
    """
    thresholds = theme.get("score_thresholds", {})
    excellent_th = thresholds.get("excellent", 90)
    good_th = thresholds.get("good", 80)
    warning_th = thresholds.get("warning", 70)

    if score_val >= excellent_th:
        return theme.get("score_excellent", theme["healthy"])
    elif score_val >= good_th:
        return theme.get("score_good", theme["healthy"])
    elif score_val >= warning_th:
        return theme.get("score_warning", theme["medium_risk"])
    else:
        return theme.get("score_danger", theme["high_risk"])


def get_dimension_score_color(score_val, theme):
    """根据模板阈值为五大维度得分着色"""
    thresholds = theme.get("score_thresholds", {})
    excellent_th = thresholds.get("excellent", 90)
    warning_th = thresholds.get("warning", 70)

    if score_val >= excellent_th:
        return theme.get("score_excellent", theme["healthy"])
    elif score_val >= warning_th:
        return theme.get("score_warning", theme["medium_risk"])
    else:
        return theme.get("score_danger", theme["high_risk"])


def save_custom_template(theme_config, template_name, theme_id=None):
    """将主题配置保存为自定义模板

    保存到 template/<template_name>/<theme_id>.json
    如果 template_name == 'default'，会拒绝覆盖（保护默认模板）。
    """
    if template_name == "default":
        print("❌ 不允许覆盖默认模板目录 'default'，请指定其他模板名称")
        return False

    template_dir = get_template_dir(template_name)
    os.makedirs(template_dir, exist_ok=True)

    if theme_id is None:
        theme_id = theme_config.get("id", "custom")

    output_path = os.path.join(template_dir, f"{theme_id}.json")
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(theme_config, f, ensure_ascii=False, indent=4)

    print(f"✅ 自定义模板已保存: {output_path}")
    return True


def list_available_templates():
    """列出所有可用的模板目录及其包含的主题"""
    if not os.path.isdir(TEMPLATE_BASE_DIR):
        print("⚠️  模板根目录不存在")
        return

    print("\n📋 可用模板目录:")
    print("─" * 50)
    for entry in sorted(os.listdir(TEMPLATE_BASE_DIR)):
        entry_path = os.path.join(TEMPLATE_BASE_DIR, entry)
        if os.path.isdir(entry_path):
            json_files = glob.glob(os.path.join(entry_path, "*.json"))
            theme_names = []
            for jf in sorted(json_files):
                try:
                    with open(jf, 'r', encoding='utf-8') as f:
                        cfg = json.load(f)
                    theme_names.append(f"{cfg.get('name', '?')}({cfg.get('id', '?')})")
                except Exception:
                    theme_names.append(os.path.basename(jf))
            is_default = " [默认]" if entry == "default" else " [自定义]"
            print(f"  📁 {entry}{is_default}")
            for tn in theme_names:
                print(f"     └─ {tn}")
    print("─" * 50)


# ==================== 内置回退主题（当模板文件缺失时使用） ====================
FALLBACK_THEME = {
    "id": "ocean",
    "name": "海洋蓝",
    "header_gradient": "linear-gradient(135deg, #0052D9 0%, #0077FF 100%)",
    "primary": "#0052D9",
    "primary_light": "#D4E5FF",
    "bg": "#F5F7FA",
    "card_bg": "#FFFFFF",
    "card_title_bar": "#0052D9",
    "high_risk": "#E34D59",
    "medium_risk": "#ED7B2F",
    "healthy": "#0ABF5B",
    "text_primary": "#333333",
    "text_secondary": "#8C8C8C",
    "stat_bg": "#F9F9F9",
    "border": "#F0F0F0",
    "score_excellent": "#0ABF5B",
    "score_good": "#2BA471",
    "score_warning": "#ED7B2F",
    "score_danger": "#E34D59",
    "score_thresholds": {"excellent": 90, "good": 80, "warning": 70, "danger": 0},
    "risk_thresholds": {"high_risk_alert": 10, "medium_risk_alert": 30, "healthy_ratio_good": 80},
    "layout": {"width": 440, "card_radius": 12, "card_padding": 16, "card_gap": 12,
               "header_padding": "20px 16px", "font_size_title": 18, "font_size_body": 12,
               "font_size_small": 11, "font_size_score": 48},
    "chart": {"width": 380, "height": 180, "bar_radius": 2, "line_width": 2, "dot_radius": 3},
}


def safe(val, default="--"):
    """安全获取值，为空或None时返回默认值"""
    if val is None or val == "" or val == "--":
        return default
    return str(val)


def diff_str(current, last_week):
    """计算与上周的差异字符串"""
    try:
        c = int(current)
        l = int(last_week)
        diff = c - l
        if diff > 0:
            return f'<span style="color:#E34D59;">↑{diff}</span>'
        elif diff < 0:
            return f'<span style="color:#0ABF5B;">↓{abs(diff)}</span>'
        else:
            return '<span style="color:#8C8C8C;">-</span>'
    except (ValueError, TypeError):
        return '<span style="color:#8C8C8C;">--</span>'


def generate_svg_chart_risk_trend(chart_data, theme):
    """生成风险趋势 SVG 折线图"""
    high_data = []
    medium_data = []
    labels = []

    for ds in chart_data.get("ChartDataInfoSet", []):
        kvs = ds.get("KeyValueSet", [])
        data_name = ds.get("DataName", "")
        # 兼容中英文DataName匹配
        if data_name in ("HighRiskCount", "高风险数", "高风险", "高风险数量"):
            high_data = [kv["Value"] for kv in kvs]
            labels = [kv.get("KeyCNName") or kv.get("Key", "") for kv in kvs]
        elif data_name in ("MediumRiskCount", "中风险数", "中风险", "中风险数量"):
            medium_data = [kv["Value"] for kv in kvs]

    if not labels:
        return '<p style="color:#8C8C8C;text-align:center;">暂无数据</p>'

    w, h = 380, 180
    pad_l, pad_r, pad_t, pad_b = 40, 20, 20, 35
    chart_w = w - pad_l - pad_r
    chart_h = h - pad_t - pad_b

    all_vals = high_data + medium_data
    max_val = max(all_vals) if all_vals and max(all_vals) > 0 else 10
    # 向上取整到合适刻度
    max_val = max(max_val, 5)

    def x_pos(i):
        if len(labels) == 1:
            return pad_l + chart_w / 2
        return pad_l + i * chart_w / (len(labels) - 1)

    def y_pos(v):
        return pad_t + chart_h - (v / max_val * chart_h)

    high_color = theme["high_risk"]
    medium_color = theme["medium_risk"]

    svg_parts = [f'<svg width="{w}" height="{h}" xmlns="http://www.w3.org/2000/svg" style="font-family:system-ui,-apple-system,sans-serif;font-size:11px;">']

    # 网格线
    for i in range(5):
        y = pad_t + i * chart_h / 4
        val = int(max_val - i * max_val / 4)
        svg_parts.append(f'<line x1="{pad_l}" y1="{y}" x2="{w-pad_r}" y2="{y}" stroke="#E8E8E8" stroke-dasharray="3,3"/>')
        svg_parts.append(f'<text x="{pad_l-5}" y="{y+4}" text-anchor="end" fill="{theme["text_secondary"]}" font-size="10">{val}</text>')

    # x轴标签
    for i, label in enumerate(labels):
        svg_parts.append(f'<text x="{x_pos(i)}" y="{h-5}" text-anchor="middle" fill="{theme["text_secondary"]}" font-size="10">{label}</text>')

    # 高风险线
    if high_data:
        points = " ".join([f"{x_pos(i)},{y_pos(v)}" for i, v in enumerate(high_data)])
        svg_parts.append(f'<polyline points="{points}" fill="none" stroke="{high_color}" stroke-width="2"/>')
        for i, v in enumerate(high_data):
            svg_parts.append(f'<circle cx="{x_pos(i)}" cy="{y_pos(v)}" r="3" fill="{high_color}"/>')
            svg_parts.append(f'<text x="{x_pos(i)}" y="{y_pos(v)-6}" text-anchor="middle" fill="{high_color}" font-size="10">{v}</text>')

    # 中风险线
    if medium_data:
        points = " ".join([f"{x_pos(i)},{y_pos(v)}" for i, v in enumerate(medium_data)])
        svg_parts.append(f'<polyline points="{points}" fill="none" stroke="{medium_color}" stroke-width="2"/>')
        for i, v in enumerate(medium_data):
            svg_parts.append(f'<circle cx="{x_pos(i)}" cy="{y_pos(v)}" r="3" fill="{medium_color}"/>')
            svg_parts.append(f'<text x="{x_pos(i)}" y="{y_pos(v)-6}" text-anchor="middle" fill="{medium_color}" font-size="10">{v}</text>')

    # 图例
    svg_parts.append(f'<circle cx="{w-130}" cy="10" r="4" fill="{high_color}"/>')
    svg_parts.append(f'<text x="{w-123}" y="14" fill="{theme["text_secondary"]}" font-size="10">高风险</text>')
    svg_parts.append(f'<circle cx="{w-70}" cy="10" r="4" fill="{medium_color}"/>')
    svg_parts.append(f'<text x="{w-63}" y="14" fill="{theme["text_secondary"]}" font-size="10">中风险</text>')

    svg_parts.append('</svg>')
    return "\n".join(svg_parts)


def generate_svg_chart_score_trend(chart_data, theme):
    """生成得分趋势 SVG 折线图（双Y轴：资源数+评分）"""
    resource_data = []
    score_data = []
    labels = []

    for ds in chart_data.get("ChartDataInfoSet", []):
        kvs = ds.get("KeyValueSet", [])
        data_name = ds.get("DataName", "")
        # 兼容中英文DataName匹配
        if data_name in ("ResourceCount", "资源数", "资源数量"):
            resource_data = [kv["Value"] for kv in kvs]
            labels = [kv.get("KeyCNName") or kv.get("Key", "") for kv in kvs]
        elif data_name in ("InspectionScore", "巡检得分", "得分"):
            score_data = [kv["Value"] for kv in kvs]

    if not labels:
        return '<p style="color:#8C8C8C;text-align:center;">暂无数据</p>'

    w, h = 380, 180
    pad_l, pad_r, pad_t, pad_b = 40, 40, 20, 35
    chart_w = w - pad_l - pad_r
    chart_h = h - pad_t - pad_b

    max_res = max(resource_data) if resource_data else 10
    max_res = max(max_res, 5)

    def x_pos(i):
        if len(labels) == 1:
            return pad_l + chart_w / 2
        return pad_l + i * chart_w / (len(labels) - 1)

    def y_pos_score(v):
        return pad_t + chart_h - ((v - 80) / 20 * chart_h)

    def y_pos_res(v):
        return pad_t + chart_h - (v / max_res * chart_h)

    svg_parts = [f'<svg width="{w}" height="{h}" xmlns="http://www.w3.org/2000/svg" style="font-family:system-ui,-apple-system,sans-serif;font-size:11px;">']

    # 网格线
    for i in range(5):
        y = pad_t + i * chart_h / 4
        score_val = 100 - i * 5
        svg_parts.append(f'<line x1="{pad_l}" y1="{y}" x2="{w-pad_r}" y2="{y}" stroke="#E8E8E8" stroke-dasharray="3,3"/>')
        svg_parts.append(f'<text x="{pad_l-5}" y="{y+4}" text-anchor="end" fill="{theme["text_secondary"]}" font-size="10">{score_val}</text>')

    # x轴标签
    for i, label in enumerate(labels):
        svg_parts.append(f'<text x="{x_pos(i)}" y="{h-5}" text-anchor="middle" fill="{theme["text_secondary"]}" font-size="10">{label}</text>')

    # 资源数柱状图
    bar_width = max(chart_w / len(labels) * 0.4, 8)
    for i, v in enumerate(resource_data):
        bh = v / max_res * chart_h
        svg_parts.append(f'<rect x="{x_pos(i)-bar_width/2}" y="{pad_t+chart_h-bh}" width="{bar_width}" height="{bh}" fill="{theme["primary_light"]}" rx="2"/>')
        svg_parts.append(f'<text x="{x_pos(i)}" y="{pad_t+chart_h-bh-4}" text-anchor="middle" fill="{theme["text_secondary"]}" font-size="10">{v}</text>')

    # 评分线
    if score_data:
        points = " ".join([f"{x_pos(i)},{y_pos_score(v)}" for i, v in enumerate(score_data)])
        svg_parts.append(f'<polyline points="{points}" fill="none" stroke="{theme["primary"]}" stroke-width="2"/>')
        for i, v in enumerate(score_data):
            svg_parts.append(f'<circle cx="{x_pos(i)}" cy="{y_pos_score(v)}" r="3" fill="{theme["primary"]}"/>')
            svg_parts.append(f'<text x="{x_pos(i)}" y="{y_pos_score(v)-6}" text-anchor="middle" fill="{theme["primary"]}" font-size="10">{v}</text>')

    # 图例
    svg_parts.append(f'<rect x="{pad_l}" y="5" width="10" height="10" fill="{theme["primary_light"]}" rx="2"/>')
    svg_parts.append(f'<text x="{pad_l+14}" y="14" fill="{theme["text_secondary"]}" font-size="10">资源数</text>')
    svg_parts.append(f'<circle cx="{pad_l+75}" cy="10" r="4" fill="{theme["primary"]}"/>')
    svg_parts.append(f'<text x="{pad_l+82}" y="14" fill="{theme["text_secondary"]}" font-size="10">评分</text>')

    svg_parts.append('</svg>')
    return "\n".join(svg_parts)


def generate_svg_product_top(chart_data, theme):
    """生成产品风险 TOP 横向柱状图"""
    products = []
    for ds in chart_data.get("ChartDataInfoSet", []):
        name = ds.get("DataName", "")
        high = 0
        medium = 0
        healthy = 0
        for kv in ds.get("KeyValueSet", []):
            key = kv.get("Key", "")
            key_cn = kv.get("KeyCNName", "")
            val = kv.get("Value", 0)
            # 兼容Key(英文)和KeyCNName(中文)两种匹配方式
            if key_cn == "高风险项数量" or key == "高风险项数量" or key == "HighRiskCount" or key_cn == "高风险数":
                high = val
            elif key_cn == "中风险项数量" or key == "中风险项数量" or key == "MediumRiskCount" or key_cn == "中风险数":
                medium = val
            elif key_cn == "健康项数量" or key == "健康项数量" or key == "NoRiskCount" or key_cn == "健康数" or key_cn == "健康项":
                healthy = val
        total = high + medium + healthy
        products.append((name, high, medium, healthy, total))

    # 按总风险数排序（高风险优先）
    products.sort(key=lambda x: (x[1], x[2]), reverse=True)
    products = products[:10]  # 最多显示10个

    if not products:
        return '<p style="color:#8C8C8C;text-align:center;">暂无数据</p>'

    row_h = 36
    h = len(products) * row_h + 10
    w = 380
    bar_start = 160
    bar_w = w - bar_start - 10
    max_total = max(p[4] for p in products) if products else 1
    max_total = max(max_total, 1)

    svg_parts = [f'<svg width="{w}" height="{h}" xmlns="http://www.w3.org/2000/svg" style="font-family:system-ui,-apple-system,sans-serif;font-size:11px;">']

    for i, (name, high, medium, healthy, total) in enumerate(products):
        y = i * row_h + 5
        # 产品名
        display_name = name if len(name) <= 12 else name[:11] + "…"
        svg_parts.append(f'<text x="5" y="{y+22}" fill="{theme["text_primary"]}" font-size="11">{html_module.escape(display_name)}</text>')

        # 堆叠横条
        bw_total = total / max_total * bar_w
        bx = bar_start
        if high > 0:
            bw = high / max_total * bar_w
            svg_parts.append(f'<rect x="{bx}" y="{y+10}" width="{bw}" height="16" fill="{theme["high_risk"]}" rx="2"/>')
            if bw > 15:
                svg_parts.append(f'<text x="{bx+bw/2}" y="{y+22}" text-anchor="middle" fill="#fff" font-size="10">{high}</text>')
            bx += bw
        if medium > 0:
            bw = medium / max_total * bar_w
            svg_parts.append(f'<rect x="{bx}" y="{y+10}" width="{bw}" height="16" fill="{theme["medium_risk"]}" rx="2"/>')
            if bw > 15:
                svg_parts.append(f'<text x="{bx+bw/2}" y="{y+22}" text-anchor="middle" fill="#fff" font-size="10">{medium}</text>')
            bx += bw
        if healthy > 0:
            bw = healthy / max_total * bar_w
            svg_parts.append(f'<rect x="{bx}" y="{y+10}" width="{bw}" height="16" fill="{theme["healthy"]}" rx="2"/>')
            if bw > 15:
                svg_parts.append(f'<text x="{bx+bw/2}" y="{y+22}" text-anchor="middle" fill="#fff" font-size="10">{healthy}</text>')
            bx += bw

        # 数量文字
        svg_parts.append(f'<text x="{bar_start + bw_total + 5}" y="{y+22}" fill="{theme["text_secondary"]}" font-size="10">{total}</text>')

    svg_parts.append('</svg>')
    return "\n".join(svg_parts)


def generate_five_dimensions(group_score_info, theme):
    """生成卓越架构五大维度得分（支持列表块和雷达图）"""
    kv_set = []
    for chart in group_score_info.get("ChartInfoSet", []):
        for ds in chart.get("ChartDataInfoSet", []):
            kv_set = ds.get("KeyValueSet", [])

    if not kv_set:
        return '<p style="color:#8C8C8C;text-align:center;">暂无数据</p>'

    style = theme.get("five_dimensions_style", "block")

    if style == "radar":
        import math
        w, h = 380, 240
        cx, cy = w / 2, h / 2
        r_max = 80
        
        svg_parts = [f'<svg width="{w}" height="{h}" xmlns="http://www.w3.org/2000/svg" style="font-family:system-ui,-apple-system,sans-serif;font-size:11px;">']
        
        # 绘制雷达图背景网格
        levels = 5
        for level in range(1, levels + 1):
            r = r_max * level / levels
            points = []
            for i in range(5):
                angle = math.pi / 2 + i * 2 * math.pi / 5
                x = cx - r * math.cos(angle)
                y = cy - r * math.sin(angle)
                points.append(f"{x},{y}")
            svg_parts.append(f'<polygon points="{" ".join(points)}" fill="none" stroke="{theme["border"]}" stroke-width="1"/>')
            
        # 绘制轴线
        for i in range(5):
            angle = math.pi / 2 + i * 2 * math.pi / 5
            x = cx - r_max * math.cos(angle)
            y = cy - r_max * math.sin(angle)
            svg_parts.append(f'<line x1="{cx}" y1="{cy}" x2="{x}" y2="{y}" stroke="{theme["border"]}" stroke-width="1"/>')
            
        # 绘制数据多边形
        data_points = []
        for i, kv in enumerate(kv_set):
            score = kv["Value"]
            angle = math.pi / 2 + i * 2 * math.pi / 5
            r = r_max * (score / 100)
            x = cx - r * math.cos(angle)
            y = cy - r * math.sin(angle)
            data_points.append(f"{x},{y}")
            
        svg_parts.append(f'<polygon points="{" ".join(data_points)}" fill="{theme["primary"]}33" stroke="{theme["primary"]}" stroke-width="2"/>')
        
        # 绘制数据点和标签
        for i, kv in enumerate(kv_set):
            name = kv["Key"]
            score = kv["Value"]
            angle = math.pi / 2 + i * 2 * math.pi / 5
            r = r_max * (score / 100)
            x = cx - r * math.cos(angle)
            y = cy - r * math.sin(angle)
            
            score_color = get_dimension_score_color(score, theme)
            svg_parts.append(f'<circle cx="{x}" cy="{y}" r="4" fill="{score_color}"/>')
            
            # 标签位置
            label_r = r_max + 20
            lx = cx - label_r * math.cos(angle)
            ly = cy - label_r * math.sin(angle)
            
            text_anchor = "middle"
            if math.cos(angle) > 0.1:
                text_anchor = "end"
            elif math.cos(angle) < -0.1:
                text_anchor = "start"
                
            svg_parts.append(f'<text x="{lx}" y="{ly}" text-anchor="{text_anchor}" fill="{theme["text_primary"]}" font-size="12" font-weight="bold">{html_module.escape(name)}</text>')
            svg_parts.append(f'<text x="{lx}" y="{ly+14}" text-anchor="{text_anchor}" fill="{score_color}" font-size="12">{score}</text>')
            
        svg_parts.append('</svg>')
        return "\n".join(svg_parts)

    # 默认列表块样式
    dim_icons = {
        "安全": "🛡️",
        "可靠": "🔄",
        "性能": "⚡",
        "成本": "💰",
        "服务限制": "📋"
    }

    html_parts = [f'<div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:space-between;">']
    for kv in kv_set:
        name = kv["Key"]
        score = kv["Value"]
        icon = dim_icons.get(name, "📊")

        # 使用模板阈值配置着色
        score_color = get_dimension_score_color(score, theme)

        html_parts.append(f'''
        <div style="flex:1;min-width:70px;background:{theme["stat_bg"]};border-radius:8px;padding:10px 6px;text-align:center;">
            <div style="font-size:18px;">{icon}</div>
            <div style="font-size:22px;font-weight:700;color:{score_color};margin:4px 0;">{score}</div>
            <div style="font-size:11px;color:{theme["text_secondary"]};">{html_module.escape(name)}</div>
        </div>''')
    html_parts.append('</div>')
    return "\n".join(html_parts)


def generate_risk_table(risk_items, theme, max_items=10):
    """生成风险明细表格"""
    if not risk_items:
        return '<p style="color:#8C8C8C;text-align:center;">暂无风险数据</p>'

    items = risk_items[:max_items]

    rows = []
    for item in items:
        risk_level = item.get("RiskLevel", "")
        if "高" in risk_level:
            badge_style = f"background:{theme['high_risk']}20;color:{theme['high_risk']};"
        elif "中" in risk_level:
            badge_style = f"background:{theme['medium_risk']}20;color:{theme['medium_risk']};"
        else:
            badge_style = f"background:{theme['healthy']}20;color:{theme['healthy']};"

        status = item.get("InstanceStatus", "")
        if status == "未解决":
            status_style = f"color:{theme['high_risk']};"
        elif status == "已解决":
            status_style = f"color:{theme['healthy']};"
        else:
            status_style = f"color:{theme['text_secondary']};"

        instance_id = item.get("InstanceId", "--")
        # 截断过长的实例ID
        if len(instance_id) > 18:
            instance_id = instance_id[:16] + "…"

        rows.append(f'''
        <div style="padding:10px 0;border-bottom:1px solid {theme["border"]};">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
                <span style="font-size:12px;font-weight:500;color:{theme["text_primary"]};flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{html_module.escape(item.get("StrategyName","--"))}</span>
                <span style="font-size:11px;padding:2px 6px;border-radius:4px;{badge_style}white-space:nowrap;margin-left:8px;">{html_module.escape(risk_level)}</span>
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;">
                <span style="font-size:11px;color:{theme["text_secondary"]};">{html_module.escape(instance_id)}</span>
                <div style="display:flex;align-items:center;gap:8px;">
                    <span style="font-size:11px;color:{theme["text_secondary"]};">{html_module.escape(item.get("GroupType",""))}</span>
                    <span style="font-size:11px;{status_style}">{html_module.escape(status)}</span>
                </div>
            </div>
        </div>''')

    return "\n".join(rows)


def generate_ai_summary_html(ai_summary, theme):
    """生成报告分析模块的 HTML"""
    if not ai_summary or not ai_summary.strip():
        return ""

    # 按行解析总结内容，支持简单的 Markdown 格式
    lines = ai_summary.strip().split("\n")
    content_parts = []
    for line in lines:
        line = line.strip()
        if not line:
            content_parts.append('<div style="height:8px;"></div>')
        elif line.startswith("### "):
            text = html_module.escape(line[4:])
            content_parts.append(f'<div style="font-size:13px;font-weight:600;color:{theme["text_primary"]};margin:10px 0 4px 0;">{text}</div>')
        elif line.startswith("## "):
            text = html_module.escape(line[3:])
            content_parts.append(f'<div style="font-size:14px;font-weight:600;color:{theme["primary"]};margin:12px 0 6px 0;">{text}</div>')
        elif line.startswith("- ") or line.startswith("* "):
            text = html_module.escape(line[2:])
            content_parts.append(f'<div style="font-size:12px;color:{theme["text_primary"]};padding:2px 0 2px 12px;line-height:1.6;">• {text}</div>')
        elif line.startswith("**") and line.endswith("**"):
            text = html_module.escape(line[2:-2])
            content_parts.append(f'<div style="font-size:12px;font-weight:600;color:{theme["text_primary"]};padding:2px 0;">{text}</div>')
        else:
            text = html_module.escape(line)
            content_parts.append(f'<div style="font-size:12px;color:{theme["text_primary"]};line-height:1.7;padding:1px 0;">{text}</div>')

    inner_html = "\n".join(content_parts)

    return f'''
    <!-- 10. 报告分析 -->
    <div class="card">
        <div class="card-title">📊 报告分析</div>
        <div style="background:{theme["stat_bg"]};border-radius:8px;padding:12px;">
            {inner_html}
        </div>
        <div style="text-align:right;margin-top:8px;font-size:10px;color:{theme["text_secondary"]};font-style:italic;">— 由 AI 分析生成，仅供参考</div>
    </div>'''


def generate_html(data, theme, ai_summary=""):
    """生成完整 HTML 报告"""
    overview = data.get("overview", {})
    risk_trend = data.get("riskTrend", {})
    risk_list = data.get("riskList", {})

    arch_name = overview.get("ArchName", "未知架构图")
    finish_time = overview.get("FinishTime", "--")
    current_score = overview.get("CurrentScanScore", "--")
    report_date = overview.get("ReportDate", "--")
    app_id = overview.get("AppId", "--")
    customer_name = overview.get("CustomerName", "--")
    arch_id = overview.get("ArchId", "--")

    # 巡检资源信息
    source_info = overview.get("ArchScanSourceInfo", {})
    scan_product_count = source_info.get("ScanProductCount", "--")
    scan_resource_count = source_info.get("ScanResourceCount", "--")
    scan_resource_percent = source_info.get("ScanResourcePercent", "--")
    scan_strategy_count = source_info.get("ScanStrategyCount", "--")

    # 风险统计
    current_summary = overview.get("CurrentStrategySummaryInfo", {})
    last_week_summary = overview.get("LastWeekStrategySummaryInfo", {})
    high_risk = safe(current_summary.get("HighRiskCount"))
    medium_risk = safe(current_summary.get("MediumRiskCount"))
    no_risk = safe(current_summary.get("NoRiskCount"))
    scan_count = safe(current_summary.get("ScanCount"))

    high_diff = diff_str(current_summary.get("HighRiskCount"), last_week_summary.get("HighRiskCount"))
    medium_diff = diff_str(current_summary.get("MediumRiskCount"), last_week_summary.get("MediumRiskCount"))
    no_diff = diff_str(current_summary.get("NoRiskCount"), last_week_summary.get("NoRiskCount"))

    # 得分趋势图
    score_trend_info = overview.get("ArchScanScoreTrendInfo", {})
    score_trend_chart = ""
    for chart in score_trend_info.get("ChartInfoSet", []):
        score_trend_chart = generate_svg_chart_score_trend(chart, theme)

    # 五大维度得分
    group_score_info = overview.get("ArchScanGroupScoreInfo", {})
    five_dimensions_html = generate_five_dimensions(group_score_info, theme)

    # 架构图SVG (缩略图) — 直接渲染接口返回的SVG，使用自适应缩放
    arch_svg = risk_trend.get("Svg", "")
    arch_svg_html = ""
    if arch_svg:
        # 将SVG嵌入容器，通过CSS控制缩放，保证完整展示
        arch_svg_html = f'''<div style="background:{theme["stat_bg"]};border-radius:8px;padding:8px;overflow:hidden;">
            <div style="width:100%;overflow:auto;max-height:220px;">
                <div style="width:100%;min-height:120px;">{arch_svg}</div>
            </div>
        </div>'''
    else:
        arch_svg_html = f'<div style="background:{theme["stat_bg"]};border-radius:8px;padding:20px;text-align:center;color:{theme["text_secondary"]};">架构图预览不可用</div>'

    # 风险趋势图
    risk_trend_chart = ""
    risk_charts = risk_trend.get("ArchRiskChartInfos", [])
    product_top_chart = ""
    # 兼容中英文Name匹配
    risk_trend_names = {"ArchitectureRiskTrend", "架构图风险趋势", "风险趋势"}
    product_top_names = {"Top15ProductRisksInCurrentArchitecture", "当前架构图产品TOP15风险", "产品风险TOP", "产品TOP15风险", "当前架构图覆盖产品风险 Top15", "当前架构图覆盖产品风险 TOP15"}
    for chart_group in risk_charts:
        group_name = chart_group.get("Name", "")
        if group_name in risk_trend_names:
            for chart in chart_group.get("ChartInfoSet", []):
                risk_trend_chart = generate_svg_chart_risk_trend(chart, theme)
        elif group_name in product_top_names:
            for chart in chart_group.get("ChartInfoSet", []):
                product_top_chart = generate_svg_product_top(chart, theme)
        else:
            # 未识别名称时，通过ChartType推断：Line/折线图→风险趋势，Bar/长条图→产品TOP
            for chart in chart_group.get("ChartInfoSet", []):
                chart_type = chart.get("ChartType", "")
                if chart_type in ("Line", "折线图") and not risk_trend_chart:
                    risk_trend_chart = generate_svg_chart_risk_trend(chart, theme)
                elif chart_type in ("Bar", "长条图", "Pistogram", "柱形图") and not product_top_chart:
                    product_top_chart = generate_svg_product_top(chart, theme)

    # 风险明细
    risk_items = risk_list.get("RiskTrendInsInfoList", [])
    total_risk_count = risk_list.get("TotalCount", 0)
    risk_table_html = generate_risk_table(risk_items, theme, max_items=10)

    # 评分颜色（使用模板阈值配置）
    try:
        score_val = int(current_score)
        score_color = get_score_color_by_thresholds(score_val, theme)
    except (ValueError, TypeError):
        score_color = theme["text_primary"]

    # 模块映射
    modules_map = {
        "header": f'''
    <!-- 1. 头部信息 -->
    <div class="header">
        <div class="header-title">智能顾问-云巡检架构评估报告-{html_module.escape(str(report_date))}</div>
        <div class="header-info-grid" style="margin-top: 12px; display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; font-size: 12px; opacity: 0.9;">
            <div>AppId：{html_module.escape(str(app_id))}</div>
            <div>名称：{html_module.escape(str(customer_name))}</div>
            <div>架构图ID：{html_module.escape(str(arch_id))}</div>
            <div>架构名称：{html_module.escape(str(arch_name))}</div>
            <div style="grid-column: span 2;">巡检时间：{html_module.escape(str(finish_time))}</div>
        </div>
    </div>''',
        "arch_preview": f'''
    <!-- 2. 架构图缩略图 -->
    <div class="card">
        <div class="card-title">架构图预览</div>
        {arch_svg_html}
    </div>''',
        "score": f'''
    <!-- 3. 巡检评分 -->
    <div class="card">
        <div class="card-title">巡检评分</div>
        <div class="score-ring">
            <div>
                <div class="score-number">{current_score}<span class="score-unit">分</span></div>
            </div>
        </div>
        <div class="chart-container">
            {score_trend_chart}
        </div>
    </div>''',
        "resource_overview": f'''
    <!-- 4. 巡检资源概览 -->
    <div class="card">
        <div class="card-title">巡检资源概览</div>
        <div class="resource-grid">
            <div class="resource-item">
                <div>
                    <div class="resource-value">{scan_product_count}</div>
                    <div class="resource-label">巡检产品数</div>
                </div>
            </div>
            <div class="resource-item">
                <div>
                    <div class="resource-value">{scan_resource_count}</div>
                    <div class="resource-label">巡检资源数</div>
                </div>
            </div>
            <div class="resource-item">
                <div>
                    <div class="resource-value">{scan_resource_percent}%</div>
                    <div class="resource-label">资源覆盖率</div>
                </div>
            </div>
            <div class="resource-item">
                <div>
                    <div class="resource-value">{scan_strategy_count}</div>
                    <div class="resource-label">巡检策略数</div>
                </div>
            </div>
        </div>
    </div>''',
        "risk_stats": f'''
    <!-- 5. 风险项统计 -->
    <div class="card">
        <div class="card-title">风险项统计</div>
        <div class="stats-grid">
            <div class="stat-item">
                <div class="stat-value" style="color:{theme["high_risk"]};">{high_risk}</div>
                <div class="stat-label">高风险项</div>
                <div class="stat-diff">较上周 {high_diff}</div>
            </div>
            <div class="stat-item">
                <div class="stat-value" style="color:{theme["medium_risk"]};">{medium_risk}</div>
                <div class="stat-label">中风险项</div>
                <div class="stat-diff">较上周 {medium_diff}</div>
            </div>
            <div class="stat-item">
                <div class="stat-value" style="color:{theme["healthy"]};">{no_risk}</div>
                <div class="stat-label">健康项</div>
                <div class="stat-diff">较上周 {no_diff}</div>
            </div>
        </div>
    </div>''',
        "risk_trend": f'''
    <!-- 6. 架构图风险趋势 -->
    <div class="card">
        <div class="card-title">架构图风险趋势</div>
        <div class="chart-container">
            {risk_trend_chart}
        </div>
        <div class="risk-legend">
            <div class="risk-legend-item"><div class="risk-legend-dot" style="background:{theme["high_risk"]};"></div>高风险</div>
            <div class="risk-legend-item"><div class="risk-legend-dot" style="background:{theme["medium_risk"]};"></div>中风险</div>
        </div>
    </div>''',
        "product_top": f'''
    <!-- 7. 产品风险 TOP -->
    <div class="card">
        <div class="card-title">产品风险 TOP</div>
        <div class="chart-container">
            {product_top_chart}
        </div>
        <div class="risk-legend">
            <div class="risk-legend-item"><div class="risk-legend-dot" style="background:{theme["high_risk"]};"></div>高风险</div>
            <div class="risk-legend-item"><div class="risk-legend-dot" style="background:{theme["medium_risk"]};"></div>中风险</div>
            <div class="risk-legend-item"><div class="risk-legend-dot" style="background:{theme["healthy"]};"></div>健康</div>
        </div>
    </div>''',
        "five_dimensions": f'''
    <!-- 8. 卓越架构五大维度 -->
    <div class="card">
        <div class="card-title">卓越架构五大维度</div>
        {five_dimensions_html}
    </div>''',
        "risk_detail": f'''
    <!-- 9. 风险明细列表 -->
    <div class="card">
        <div class="card-title">风险明细（共 {total_risk_count} 项）</div>
        {risk_table_html}
        {"<div style='text-align:center;padding:10px;color:" + theme["text_secondary"] + ";font-size:11px;'>仅展示前10条，更多请查看控制台</div>" if total_risk_count > 10 else ""}
    </div>''',
        "ai_summary": generate_ai_summary_html(ai_summary, theme),
        "footer": f'''
    <!-- 页脚 -->
    <div class="footer">
        腾讯云智能顾问 · 架构风险巡检报告<br>
        报告日期：{html_module.escape(str(report_date))}
    </div>'''
    }

    # 默认模块顺序
    default_modules_order = [
        "header", "arch_preview", "score", "resource_overview",
        "risk_stats", "risk_trend", "product_top", "five_dimensions",
        "risk_detail", "ai_summary", "footer"
    ]
    
    modules_order = theme.get("modules_order", default_modules_order)
    
    # 组装模块
    modules_html = []
    for mod in modules_order:
        if mod in modules_map and modules_map[mod]:
            modules_html.append(modules_map[mod])

    html = f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>智能顾问-云巡检架构评估报告-{html_module.escape(str(report_date))}</title>
    <style>
        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif;
            background: {theme["bg"]};
            color: {theme["text_primary"]};
            line-height: 1.5;
            width: 440px;
            margin: 0 auto;
            padding: 0;
        }}
        .report-container {{
            padding: 16px;
        }}
        .header {{
            background: {theme["header_gradient"]};
            border-radius: 12px;
            padding: 20px 16px;
            color: white;
            margin-bottom: 12px;
        }}
        .header-title {{
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 4px;
        }}
        .header-subtitle {{
            font-size: 12px;
            opacity: 0.85;
        }}
        .card {{
            background: {theme["card_bg"]};
            border-radius: 12px;
            padding: 16px;
            margin-bottom: 12px;
            box-shadow: 0 1px 4px rgba(0,0,0,0.05);
        }}
        .card-title {{
            font-size: 14px;
            font-weight: 600;
            color: {theme["text_primary"]};
            margin-bottom: 12px;
            display: flex;
            align-items: center;
            gap: 6px;
        }}
        .card-title::before {{
            content: "";
            display: inline-block;
            width: 3px;
            height: 14px;
            background: {theme["card_title_bar"]};
            border-radius: 2px;
        }}
        .score-ring {{
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 20px;
            padding: 10px 0;
        }}
        .score-number {{
            font-size: 48px;
            font-weight: 700;
            color: {score_color};
        }}
        .score-unit {{
            font-size: 14px;
            color: {theme["text_secondary"]};
            font-weight: 400;
        }}
        .stats-grid {{
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 8px;
        }}
        .stat-item {{
            text-align: center;
            padding: 12px 4px;
            background: {theme["stat_bg"]};
            border-radius: 8px;
        }}
        .stat-value {{
            font-size: 24px;
            font-weight: 700;
        }}
        .stat-label {{
            font-size: 11px;
            color: {theme["text_secondary"]};
            margin-top: 2px;
        }}
        .stat-diff {{
            font-size: 10px;
            margin-top: 2px;
        }}
        .resource-grid {{
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 8px;
        }}
        .resource-item {{
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 10px;
            background: {theme["stat_bg"]};
            border-radius: 8px;
        }}
        .resource-value {{
            font-size: 18px;
            font-weight: 600;
            color: {theme["primary"]};
        }}
        .resource-label {{
            font-size: 11px;
            color: {theme["text_secondary"]};
        }}
        .chart-container {{
            overflow-x: auto;
            padding: 4px 0;
        }}
        .risk-legend {{
            display: flex;
            gap: 12px;
            justify-content: center;
            margin-top: 8px;
        }}
        .risk-legend-item {{
            display: flex;
            align-items: center;
            gap: 4px;
            font-size: 11px;
            color: {theme["text_secondary"]};
        }}
        .risk-legend-dot {{
            width: 8px;
            height: 8px;
            border-radius: 50%;
        }}
        .footer {{
            text-align: center;
            padding: 16px;
            color: {theme["text_secondary"]};
            font-size: 11px;
        }}
        svg {{
            max-width: 100%;
            height: auto;
        }}
    </style>
</head>
<body>
<div class="report-container">
    {"".join(modules_html)}
</div>
</body>
</html>'''

    return html


def main():
    if len(sys.argv) < 2:
        print("用法: python3 generate_report_default.py <data_json_path> [选项]")
        print("")
        print("选项:")
        print("  --theme <名称>          选择主题 (random|ocean|sunset|forest|lavender|coral|slate)，默认 random")
        print("  --template <目录名>     指定模板目录 (default|<自定义名>)，默认 default")
        print("  --save-template <名称>  将当前主题保存为自定义模板")
        print("  --summary <文件路径>    报告分析文本文件")
        print("  --list-templates        列出所有可用模板")
        sys.exit(1)

    # 处理 --list-templates 特殊命令
    if "--list-templates" in sys.argv:
        list_available_templates()
        sys.exit(0)

    json_path = sys.argv[1]

    # 解析参数
    theme_name = "random"
    template_name = "default"
    save_template_name = ""
    summary_path = ""
    for i, arg in enumerate(sys.argv):
        if arg == "--theme" and i + 1 < len(sys.argv):
            theme_name = sys.argv[i + 1]
        elif arg == "--template" and i + 1 < len(sys.argv):
            template_name = sys.argv[i + 1]
        elif arg == "--save-template" and i + 1 < len(sys.argv):
            save_template_name = sys.argv[i + 1]
        elif arg == "--summary" and i + 1 < len(sys.argv):
            summary_path = sys.argv[i + 1]

    # 从模板目录加载主题
    print(f"▶ 加载模板目录: {template_name}")
    THEMES = load_themes_from_template(template_name)

    # 如果指定的模板目录为空或不存在，尝试回退到 default
    if not THEMES and template_name != "default":
        print(f"⚠️  模板 '{template_name}' 为空，尝试回退到 default")
        THEMES = load_themes_from_template("default")
        template_name = "default"

    # 如果 default 也没有，使用内置回退主题
    if not THEMES:
        print("⚠️  未找到任何模板文件，使用内置回退主题")
        THEMES = {"ocean": copy.deepcopy(FALLBACK_THEME)}

    print(f"   已加载 {len(THEMES)} 套主题: {', '.join(t.get('name', k) for k, t in THEMES.items())}")

    # 选择主题
    if theme_name == "random":
        theme_name = random.choice(list(THEMES.keys()))
        print(f"▶ 随机选择主题: {THEMES[theme_name]['name']} ({theme_name})")
    elif theme_name not in THEMES:
        print(f"⚠️  未知主题 '{theme_name}'，可用主题: {', '.join(THEMES.keys())}")
        theme_name = list(THEMES.keys())[0]
        print(f"   使用主题: {THEMES[theme_name]['name']}")
    else:
        print(f"▶ 使用主题: {THEMES[theme_name]['name']} ({theme_name})")

    theme = THEMES[theme_name]

    # 保存自定义模板
    if save_template_name:
        save_custom_template(theme, save_template_name, theme_id=theme_name)

    if not os.path.exists(json_path):
        print(f"❌ 数据文件不存在: {json_path}")
        sys.exit(1)

    print(f"▶ 读取数据文件: {json_path}")

    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    arch_id = data.get("archId", "unknown")

    print(f"▶ 架构图ID: {arch_id}")
    print(f"▶ 架构图名称: {data.get('overview', {}).get('ArchName', '未知')}")
    # 读取报告分析内容
    ai_summary = ""
    if summary_path:
        if os.path.exists(summary_path):
            with open(summary_path, 'r', encoding='utf-8') as f:
                ai_summary = f.read()
            print(f"▶ 已加载报告分析: {summary_path} ({len(ai_summary)} 字符)")
        else:
            print(f"⚠️  报告分析文件不存在: {summary_path}，跳过")

    print(f"▶ 生成 HTML 报告...")

    html_content = generate_html(data, theme, ai_summary=ai_summary)

    # 输出路径
    output_dir = os.path.dirname(json_path)
    if not output_dir:
        output_dir = "."
    output_path = os.path.join(output_dir, f"report_{arch_id}.html")

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(html_content)

    file_size = os.path.getsize(output_path)
    print(f"✅ HTML 报告已生成: {output_path}")
    print(f"   文件大小: {file_size / 1024:.1f} KB")
    print(f"   使用模板: {template_name}")
    print(f"   使用主题: {theme['name']} ({theme_name})")
    if save_template_name:
        print(f"   已保存自定义模板到: template/{save_template_name}/")


if __name__ == '__main__':
    main()
