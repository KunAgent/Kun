#!/usr/bin/env python3
"""
梅花易数起卦系统
基于先天八卦数序：乾1 兑2 离3 震4 巽5 坎6 艮7 坤8
"""

import sys
import random
from datetime import datetime
from typing import Tuple, List

try:
    from lunardate import LunarDate
    HAS_LUNARDATE = True
except ImportError:
    HAS_LUNARDATE = False

# 先天八卦
BAGUA = {
    1: {"name": "乾", "symbol": "☰", "nature": "天", "wuxing": "金", "direction": "西北", "palace": "西北"},
    2: {"name": "兑", "symbol": "☱", "nature": "泽", "wuxing": "金", "direction": "西", "palace": "西"},
    3: {"name": "离", "symbol": "☲", "nature": "火", "wuxing": "火", "direction": "南", "palace": "南"},
    4: {"name": "震", "symbol": "☳", "nature": "雷", "wuxing": "木", "direction": "东", "palace": "东"},
    5: {"name": "巽", "symbol": "☴", "nature": "风", "wuxing": "木", "direction": "东南", "palace": "东南"},
    6: {"name": "坎", "symbol": "☵", "nature": "水", "wuxing": "水", "direction": "北", "palace": "北"},
    7: {"name": "艮", "symbol": "☶", "nature": "山", "wuxing": "土", "direction": "东北", "palace": "东北"},
    8: {"name": "坤", "symbol": "☷", "nature": "地", "wuxing": "土", "direction": "西南", "palace": "西南"},
}

# 八卦万物类象
BAGUA_XIANG = {
    1: {  # 乾
        "family": ["父亲", "长辈", "丈夫", "君主"],
        "body": ["头", "脑", "骨骼", "大肠"],
        "nature": ["天", "宇宙", "天体", "太空"],
        "animal": ["马", "大象", "狮子", "鲸鱼"],
        "object": ["金玉", "珠宝", "首饰", "货币", "钟表", "电脑"],
        "place": ["首都", "政府", "银行", "高楼", "西北"],
        "food": ["马肉", "乾果", "高脂肪食物"],
        "color": ["金色", "白色", "深色"],
    },
    2: {  # 兑
        "family": ["少女", "妾", "口舌"],
        "body": ["口", "舌", "牙齿", "咽喉", "肺"],
        "nature": ["泽", "湖泊", "沼泽", "雨水"],
        "animal": ["羊", "鸡", "泽鸟", "兔子"],
        "object": ["金属", "乐器", "口琴", "刀剑", "剪刀"],
        "place": ["池塘", "湖泊", "演艺场所", "西部"],
        "food": ["羊肉", "辣味食物"],
        "color": ["白色", "金色", "银色"],
    },
    3: {  # 离
        "family": ["中女", "文员", "会计"],
        "body": ["眼睛", "心脏", "小肠", "血液", "神经"],
        "nature": ["火", "太阳", "闪电", "霓虹"],
        "animal": ["龟", "蛇", "雉鸡", "萤火虫"],
        "object": ["电器", "电视", "电脑", "火炮", "旗帜"],
        "place": ["南方", "学校", "图书馆", "剧院", "医院"],
        "food": ["辛辣食物", "烧烤", "野生动物"],
        "color": ["红色", "紫色", "粉色"],
    },
    4: {  # 震
        "family": ["长子", "男孩", "驾驶员"],
        "body": ["脚", "肝脏", "神经", "毛发"],
        "nature": ["雷", "地震", "雷声", "鼓声"],
        "animal": ["龙", "蛇", "马", "鹿"],
        "object": ["汽车", "火车", "乐器", "鼓", "电话"],
        "place": ["东方", "山林", "公安机关", "机场"],
        "food": ["鸡肉", "酸味食物", "竹笋"],
        "color": ["绿色", "青色", "蓝色"],
    },
    5: {  # 巽
        "family": ["长女", "学者", "文人"],
        "body": ["股", "胆", "呼吸系统", "头发"],
        "nature": ["风", "气流", "菜味", "兰花"],
        "animal": ["鸡", "蛇", "毛虫", "蜈蚣"],
        "object": ["木制品", "桌椅", "床", "书籍", "绳子"],
        "place": ["东南方", "花园", "寺庙", "邮局", "商店"],
        "food": ["鸡肉", "蔬菜", "素食"],
        "color": ["绿色", "蓝色", "白色"],
    },
    6: {  # 坎
        "family": ["中男", "盗贼", "渔夫"],
        "body": ["肾", "膀胱", "耳", "血液", "腰"],
        "nature": ["水", "雨", "河", "海", "月亮"],
        "animal": ["猪", "鼠", "鱼", "水獭"],
        "object": ["酒", "醋", "饮料", "液体", "药品"],
        "place": ["北方", "江河", "湖泊", "酒店", "浴室"],
        "food": ["猪肉", "海鲜", "汤类", "酒类"],
        "color": ["黑色", "蓝色", "白色"],
    },
    7: {  # 艮
        "family": ["少男", "儿童", "学者"],
        "body": ["手", "胃", "鼻子", "背", "皮肤"],
        "nature": ["山", "石", "丘陵", "坟墓"],
        "animal": ["虎", "狗", "熊", "猫"],
        "object": ["桌椅", "床", "柜子", "陶器", "瓷器"],
        "place": ["东北方", "山地", "寺庙", "仓库", "银行"],
        "food": ["牛肉", "羊肉", "山珍", "甜食"],
        "color": ["黄色", "棕色", "橙色"],
    },
    8: {  # 坤
        "family": ["母亲", "长辈", "孕妇", "农民"],
        "body": ["腹", "脾", "胃", "肉", "子宫"],
        "nature": ["地", "田野", "平原", "地球"],
        "animal": ["牛", "羊", "蚂蚁", "蜗牛"],
        "object": ["土地", "布匹", "陶器", "车辆", "箱子"],
        "place": ["西南方", "田野", "农村", "仓库", "商场"],
        "food": ["牛肉", "羊肉", "糯米", "甜食"],
        "color": ["黄色", "棕色", "黑色"],
    },
}

# 64卦表（上卦*8 + 下卦）
GUA_64 = {
    (1,1): ("乾", "乾为天", "大吉"),
    (1,2): ("履", "天泽履", "平"),
    (1,3): ("同人", "天火同人", "吉"),
    (1,4): ("无妄", "天雷无妄", "凶"),
    (1,5): ("姤", "天风姤", "平"),
    (1,6): ("讼", "天水讼", "凶"),
    (1,7): ("遁", "天山遁", "平"),
    (1,8): ("否", "天地否", "凶"),
    (2,1): ("夬", "泽天夬", "凶"),
    (2,2): ("兑", "兑为泽", "吉"),
    (2,3): ("革", "泽火革", "平"),
    (2,4): ("随", "泽雷随", "吉"),
    (2,5): ("大过", "泽风大过", "凶"),
    (2,6): ("困", "泽水困", "凶"),
    (2,7): ("咸", "泽山咸", "吉"),
    (2,8): ("萃", "泽地萃", "平"),
    (3,1): ("大有", "火天大有", "吉"),
    (3,2): ("睽", "火泽睽", "平"),
    (3,3): ("离", "离为火", "吉"),
    (3,4): ("噬嗑", "火雷噬嗑", "平"),
    (3,5): ("鼎", "火风鼎", "吉"),
    (3,6): ("未济", "火水未济", "平"),
    (3,7): ("旅", "火山旅", "平"),
    (3,8): ("晋", "火地晋", "吉"),
    (4,1): ("大壮", "雷天大壮", "平"),
    (4,2): ("归妹", "雷泽归妹", "凶"),
    (4,3): ("丰", "雷火丰", "平"),
    (4,4): ("震", "震为雷", "平"),
    (4,5): ("恒", "雷风恒", "平"),
    (4,6): ("解", "雷水解", "平"),
    (4,7): ("小过", "雷山小过", "平"),
    (4,8): ("豫", "雷地豫", "平"),
    (5,1): ("小畜", "风天小畜", "平"),
    (5,2): ("中孚", "风泽中孚", "吉"),
    (5,3): ("家人", "风火家人", "吉"),
    (5,4): ("益", "风雷益", "吉"),
    (5,5): ("巽", "巽为风", "平"),
    (5,6): ("涣", "风水涣", "平"),
    (5,7): ("渐", "风山渐", "吉"),
    (5,8): ("观", "风地观", "平"),
    (6,1): ("需", "水天需", "吉"),
    (6,2): ("节", "水泽节", "平"),
    (6,3): ("既济", "水火既济", "吉"),
    (6,4): ("屯", "水雷屯", "凶"),
    (6,5): ("井", "水风井", "平"),
    (6,6): ("坎", "坎为水", "凶"),
    (6,7): ("蹇", "水山蹇", "凶"),
    (6,8): ("比", "水地比", "吉"),
    (7,1): ("大畜", "山天大畜", "吉"),
    (7,2): ("损", "山泽损", "平"),
    (7,3): ("贲", "山火贲", "平"),
    (7,4): ("颐", "山雷颐", "凶"),
    (7,5): ("蛊", "山风蛊", "凶"),
    (7,6): ("蒙", "山水蒙", "凶"),
    (7,7): ("艮", "艮为山", "平"),
    (7,8): ("剥", "山地剥", "凶"),
    (8,1): ("泰", "地天泰", "吉"),
    (8,2): ("临", "地泽临", "平"),
    (8,3): ("明夷", "地火明夷", "凶"),
    (8,4): ("复", "地雷复", "吉"),
    (8,5): ("升", "地风升", "吉"),
    (8,6): ("师", "地水师", "凶"),
    (8,7): ("谦", "地山谦", "吉"),
    (8,8): ("坤", "坤为地", "大吉"),
}

# 五行生克
WUXING_RELATIONS = {
    "金": {"sheng": "水", "ke": "火"},
    "木": {"sheng": "火", "ke": "金"},
    "水": {"sheng": "木", "ke": "土"},
    "火": {"sheng": "土", "ke": "水"},
    "土": {"sheng": "金", "ke": "木"},
}

# 地支方位
DIRECTION_MAP = {
    "东": 4, "东南": 5, "南": 3, "西南": 8,
    "西": 2, "西北": 1, "北": 6, "东北": 7,
}

# 先天八卦爻 patterns [bottom, middle, top] (1=阳yang, 0=阴yin)
# 乾(1)=111, 兑(2)=110, 离(3)=101, 震(4)=100, 巽(5)=011, 坎(6)=010, 艮(7)=001, 坤(8)=000
TRIGRAM_YAO = {
    1: [1, 1, 1],  # 乾: 三阳
    2: [1, 1, 0],  # 兑: 上阴下二阳
    3: [1, 0, 1],  # 离: 中阴上下阳
    4: [1, 0, 0],  # 震: 下阳上二阴
    5: [0, 1, 1],  # 巽: 下阴上二阳
    6: [0, 1, 0],  # 坎: 中阳上下阴
    7: [0, 0, 1],  # 艮: 上阳下二阴
    8: [0, 0, 0],  # 坤: 三阴
}

# Reverse lookup: yao tuple -> trigram number
YAO_TO_TRIGRAM = {tuple(v): k for k, v in TRIGRAM_YAO.items()}


def trigram_to_yao(num: int) -> List[int]:
    """Convert trigram number (1-8) to yao list [bottom, middle, top] (1-indexed positions)."""
    return list(TRIGRAM_YAO[num])


def yao_to_trigram(yao_list: List[int]) -> int:
    """Convert yao list [bottom, middle, top] to trigram number (1-8)."""
    return YAO_TO_TRIGRAM[tuple(yao_list)]


def calc_hu_gua(shang: int, xia: int) -> Tuple[int, int]:
    """Calculate 互卦 (mutual hexagram).

    互卦 takes lines 2,3,4 as lower trigram and lines 3,4,5 as upper trigram
    of the original hexagram.

    Original hexagram 6 yao (bottom to top):
      Line 1: xia[0] (初爻)
      Line 2: xia[1] (二爻)
      Line 3: xia[2] (三爻)
      Line 4: shang[0] (四爻)
      Line 5: shang[1] (五爻)
      Line 6: shang[2] (上爻)

    互卦下卦 = lines 2,3,4 = [xia[1], xia[2], shang[0]]
    互卦上卦 = lines 3,4,5 = [xia[2], shang[0], shang[1]]
    """
    xia_yao = trigram_to_yao(xia)
    shang_yao = trigram_to_yao(shang)

    # 互卦下卦: lines 2,3,4
    hu_xia = yao_to_trigram([xia_yao[1], xia_yao[2], shang_yao[0]])
    # 互卦上卦: lines 3,4,5
    hu_shang = yao_to_trigram([xia_yao[2], shang_yao[0], shang_yao[1]])

    return hu_shang, hu_xia


def calc_bian_gua(shang: int, xia: int, dong_yao: int) -> Tuple[int, int]:
    """Calculate 变卦 (changed hexagram) by flipping the moving line.

    dong_yao is 1-indexed from bottom (1=初爻, 6=上爻).
    """
    xia_yao = trigram_to_yao(xia)
    shang_yao = trigram_to_yao(shang)

    # Full 6 yao bottom to top
    yao6 = xia_yao + shang_yao  # [line1, line2, line3, line4, line5, line6]

    # Flip the moving line (1-indexed -> 0-indexed)
    idx = dong_yao - 1
    yao6[idx] = 1 - yao6[idx]  # 0->1, 1->0

    # Split back into lower and upper trigrams
    new_xia = yao_to_trigram(yao6[0:3])
    new_shang = yao_to_trigram(yao6[3:6])

    return new_shang, new_xia


def get_gua_name(shang: int, xia: int) -> Tuple[str, str, str]:
    """获取卦名、卦辞、吉凶"""
    if (shang, xia) in GUA_64:
        name, desc, jixiong = GUA_64[(shang, xia)]
    else:
        # 查表没有的用默认
        name = f"{BAGUA[shang]['name']}{BAGUA[xia]['name']}"
        desc = f"{BAGUA[shang]['nature']}{BAGUA[xia]['nature']}"
        jixiong = "平"
    return name, desc, jixiong


def get_wanwu_xiang(shang: int, xia: int) -> dict:
    """获取万物类象"""
    shang_xiang = BAGUA_XIANG.get(shang, {})
    xia_xiang = BAGUA_XIANG.get(xia, {})
    
    # 综合类象（上下卦的组合）
    combined = {
        "family": shang_xiang.get("family", []) + xia_xiang.get("family", []),
        "body": shang_xiang.get("body", []) + xia_xiang.get("body", []),
        "nature": shang_xiang.get("nature", []) + xia_xiang.get("nature", []),
        "animal": shang_xiang.get("animal", []) + xia_xiang.get("animal", []),
        "object": shang_xiang.get("object", []) + xia_xiang.get("object", []),
        "place": shang_xiang.get("place", []) + xia_xiang.get("place", []),
        "food": shang_xiang.get("food", []) + xia_xiang.get("food", []),
        "color": list(set(shang_xiang.get("color", []) + xia_xiang.get("color", []))),
    }
    
    return {
        "shang": shang_xiang,
        "xia": xia_xiang,
        "combined": combined,
    }


def time_gua(year: int, month: int, day: int, hour: int) -> Tuple[int, int, int]:
    """时间起卦（使用农历日期）"""
    total = year + month + day

    # 上卦：(年+月+日) 除8余数
    shang = total % 8
    if shang == 0:
        shang = 8

    # 下卦：(年+月+日+时) 除8余数
    xia = (total + hour) % 8
    if xia == 0:
        xia = 8

    # 动爻：(年+月+日+时) 除6余数
    dong_yao = (total + hour) % 6
    if dong_yao == 0:
        dong_yao = 6

    return shang, xia, dong_yao


def number_gua(n1: int, n2: int, n3: int) -> Tuple[int, int, int]:
    """数字起卦（传统方法：第一数上卦，第二数下卦，第三数动爻）"""
    # 上卦：第1个数 除8余数
    shang = n1 % 8
    if shang == 0:
        shang = 8

    # 下卦：第2个数 除8余数
    xia = n2 % 8
    if xia == 0:
        xia = 8

    # 动爻：第3个数 除6余数
    dong_yao = n3 % 6
    if dong_yao == 0:
        dong_yao = 6

    return shang, xia, dong_yao


def direction_gua(direction: str, number: int) -> Tuple[int, int, int]:
    """方位起卦"""
    # 上卦：方位对应先天八卦数
    shang = DIRECTION_MAP.get(direction, 4)  # 默认震卦

    # 下卦：数字 除8余数
    xia = number % 8
    if xia == 0:
        xia = 8

    # 动爻：数字 除6余数
    dong_yao = number % 6
    if dong_yao == 0:
        dong_yao = 6

    return shang, xia, dong_yao


def analyze(ti_gua: int, yong_gua: int) -> dict:
    """体用分析"""
    ti = BAGUA[ti_gua]
    yong = BAGUA[yong_gua]
    
    ti_wuxing = ti["wuxing"]
    yong_wuxing = yong["wuxing"]
    
    # 判断生克关系
    if ti_wuxing == yong_wuxing:
        relation = "比和"
        jixiong = "吉"
        advice = "体用比和，诸事皆吉。"
    elif WUXING_RELATIONS[yong_wuxing]["sheng"] == ti_wuxing:
        relation = "用生体"
        jixiong = "大吉"
        advice = "用卦生体卦，事半功倍，有贵人相助。"
    elif WUXING_RELATIONS[ti_wuxing]["ke"] == yong_wuxing:
        relation = "体克用"
        jixiong = "平"
        advice = "体卦克用卦，虽有阻力但终可成。"
    elif WUXING_RELATIONS[yong_wuxing]["ke"] == ti_wuxing:
        relation = "用克体"
        jixiong = "凶"
        advice = "用卦克体卦，阻力较大，需谨慎行事。"
    else:  # 体生用泄
        relation = "体生用"
        jixiong = "平"
        advice = "体卦生用卦，付出较多，需防破耗。"
    
    # 获取万物类象
    # 上卦为用，下卦为体
    wanwu_xiang = get_wanwu_xiang(yong_gua, ti_gua)
    
    return {
        "ti_gua": ti,
        "yong_gua": yong,
        "relation": relation,
        "jixiong": jixiong,
        "advice": advice,
        "wanwu_xiang": wanwu_xiang,
    }


def format_output(method: str, info: str, shang: int, xia: int, analysis: dict, dong_yao: int = 1) -> str:
    """格式化输出"""
    ti = analysis["ti_gua"]
    yong = analysis["yong_gua"]

    name, desc, gua_jixiong = get_gua_name(shang, xia)
    xiang = analysis.get("wanwu_xiang", {})

    # 计算互卦和变卦
    hu_shang, hu_xia = calc_hu_gua(shang, xia)
    hu_name, hu_desc, hu_jixiong = get_gua_name(hu_shang, hu_xia)

    bian_shang, bian_xia = calc_bian_gua(shang, xia, dong_yao)
    bian_name, bian_desc, bian_jixiong = get_gua_name(bian_shang, bian_xia)

    # 动爻名称
    dong_yao_names = {1: "初爻", 2: "二爻", 3: "三爻", 4: "四爻", 5: "五爻", 6: "上爻"}
    dong_yao_name = dong_yao_names.get(dong_yao, f"第{dong_yao}爻")

    # 判断动爻在上卦还是下卦
    if dong_yao <= 3:
        dong_position = f"下卦{BAGUA[xia]['name']}的{dong_yao_name}"
    else:
        dong_position = f"上卦{BAGUA[shang]['name']}的{dong_yao_name}"

    output = f"""🎲 梅花易数占卜

【起卦方式】：{method}
【起卦信息】：{info}
【本卦】：{BAGUA[shang]['symbol']} {BAGUA[shang]['name']}（上） + {BAGUA[xia]['symbol']} {BAGUA[xia]['name']}（下） = {name}
【动爻】：{dong_yao_name}（{dong_position}）

【互卦】：{BAGUA[hu_shang]['symbol']} {BAGUA[hu_shang]['name']}（上） + {BAGUA[hu_xia]['symbol']} {BAGUA[hu_xia]['name']}（下） = {hu_name}
【变卦】：{BAGUA[bian_shang]['symbol']} {BAGUA[bian_shang]['name']}（上） + {BAGUA[bian_xia]['symbol']} {BAGUA[bian_xia]['name']}（下） = {bian_name}

【体用分析】（本卦）
• 体卦：{ti['name']}（{ti['nature']}，属{ti['palace']}，{ti['wuxing']}）
• 用卦：{yong['name']}（{yong['nature']}，属{yong['palace']}，{yong['wuxing']}）
• 关系：{analysis['relation']}

【吉凶判断】：{analysis['jixiong']}（{gua_jixiong}）

【建议】：{analysis['advice']}
"""
    
    # 添加万物类象
    if xiang and xiang.get("combined"):
        combined = xiang["combined"]
        output += """
【万物类象】
"""
        if combined.get("family"):
            output += f"• 人物：{', '.join(combined['family'][:4])}\n"
        if combined.get("body"):
            output += f"• 身体：{', '.join(combined['body'][:4])}\n"
        if combined.get("nature"):
            output += f"• 自然：{', '.join(combined['nature'][:4])}\n"
        if combined.get("animal"):
            output += f"• 动物：{', '.join(combined['animal'][:4])}\n"
        if combined.get("object"):
            output += f"• 物品：{', '.join(combined['object'][:4])}\n"
        if combined.get("place"):
            output += f"• 方位：{', '.join(combined['place'][:4])}\n"
        if combined.get("food"):
            output += f"• 饮食：{', '.join(combined['food'][:4])}\n"
        if combined.get("color"):
            output += f"• 颜色：{', '.join(combined['color'])}\n"
    
    output += """
---
※ 占卜仅供参考娱乐，请理性对待 ※"""
    
    return output


def cmd_time():
    """时间起卦（使用农历）"""
    now = datetime.now()
    if HAS_LUNARDATE:
        lunar = LunarDate.fromSolarDate(now.year, now.month, now.day)
        lunar_year, lunar_month, lunar_day = lunar.year, lunar.month, lunar.day
        info = f"公历{now.year}年{now.month}月{now.day}日 {now.hour}时 / 农历{lunar_year}年{lunar_month}月{lunar_day}日"
    else:
        lunar_year, lunar_month, lunar_day = now.year, now.month, now.day
        info = f"{now.year}年{now.month}月{now.day}日 {now.hour}时（未安装lunardate，使用公历）"

    shang, xia, dong_yao = time_gua(lunar_year, lunar_month, lunar_day, now.hour)
    analysis = analyze(xia, shang)  # 体卦为下卦，用卦为上卦
    print(format_output("时间起卦",
                       info,
                       shang, xia, analysis, dong_yao))


def cmd_numbers(*nums):
    """数字起卦"""
    if len(nums) < 3:
        print("请提供3个数字（1-9）")
        return

    n1, n2, n3 = int(nums[0]) % 10, int(nums[1]) % 10, int(nums[2]) % 10
    if n1 == 0:
        n1 = 1
    if n2 == 0:
        n2 = 1
    if n3 == 0:
        n3 = 1

    shang, xia, dong_yao = number_gua(n1, n2, n3)
    analysis = analyze(xia, shang)
    print(format_output("数字起卦", f"{n1}、{n2}、{n3}", shang, xia, analysis, dong_yao))


def cmd_direction(direction: str, number: int = None):
    """方位起卦"""
    if number is None:
        number = random.randint(1, 9)

    shang, xia, dong_yao = direction_gua(direction, number)
    analysis = analyze(xia, shang)
    print(format_output("方位起卦", f"{direction}（数字{number}）", shang, xia, analysis, dong_yao))


def cmd_random():
    """随机起卦（测试用）"""
    shang = random.randint(1, 8)
    xia = random.randint(1, 8)
    dong_yao = random.randint(1, 6)
    analysis = analyze(xia, shang)
    print(format_output("随机起卦", "测试模式", shang, xia, analysis, dong_yao))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        cmd_random()
    elif sys.argv[1] == "time":
        cmd_time()
    elif sys.argv[1] == "numbers" and len(sys.argv) >= 5:
        cmd_numbers(sys.argv[2], sys.argv[3], sys.argv[4])
    elif sys.argv[1] == "direction" and len(sys.argv) >= 3:
        num = int(sys.argv[3]) if len(sys.argv) > 3 else None
        cmd_direction(sys.argv[2], num)
    elif sys.argv[1] == "random":
        cmd_random()
    else:
        print("用法:")
        print("  python meihua.py time           # 时间起卦")
        print("  python meihua.py numbers 3 8 5   # 数字起卦")
        print("  python meihua.py direction 东   # 方位起卦（可选加数字）")
        print("  python meihua.py random         # 随机起卦测试")
