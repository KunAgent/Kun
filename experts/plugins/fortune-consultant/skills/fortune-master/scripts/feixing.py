#!/usr/bin/env python3
"""
九宫飞星理气风水系统
根据流年/流月/流日推算九星位置，判断方位吉凶
"""

import sys
from datetime import datetime, timedelta

# 九星定义
JIUXING = {
    1: {"name": "贪狼", "wuxing": "水", "color": "白", "nature": "吉"},
    2: {"name": "巨门", "wuxing": "土", "color": "黑", "nature": "凶"},
    3: {"name": "禄存", "wuxing": "木", "color": "碧", "nature": "凶"},
    4: {"name": "文曲", "wuxing": "木", "color": "绿", "nature": "吉"},
    5: {"name": "廉贞", "wuxing": "土", "color": "黄", "nature": "凶"},
    6: {"name": "武曲", "wuxing": "金", "color": "白", "nature": "吉"},
    7: {"name": "破军", "wuxing": "金", "color": "赤", "nature": "凶"},
    8: {"name": "左辅", "wuxing": "土", "color": "白", "nature": "吉"},
    9: {"name": "右弼", "wuxing": "火", "color": "紫", "nature": "吉"},
}

# 九宫方位
GONGFU = {
    0: {"name": "中宫", "direction": "中", "bz": "中央"},
    1: {"name": "坎宫", "direction": "北", "bz": "正北"},
    2: {"name": "坤宫", "direction": "西南", "bz": "西南"},
    3: {"name": "震宫", "direction": "东", "bz": "正东"},
    4: {"name": "巽宫", "direction": "东南", "bz": "东南"},
    5: {"name": "中宫", "direction": "中", "bz": "中央"},
    6: {"name": "乾宫", "direction": "西北", "bz": "西北"},
    7: {"name": "兑宫", "direction": "西", "bz": "正西"},
    8: {"name": "艮宫", "direction": "东北", "bz": "东北"},
    9: {"name": "离宫", "direction": "南", "bz": "正南"},
}

# 入中宫星（2004-2043年）
# 2004-2023: 八白左辅
# 2024-2043: 九紫右弼
def get_ruzong_star(year: int) -> int:
    """获取当年入中宫的星"""
    if 2004 <= year <= 2023:
        return 8
    elif 2024 <= year <= 2043:
        return 9
    elif 1984 <= year <= 2003:
        return 7  # 七赤破军
    elif 1964 <= year <= 1983:
        return 6  # 六白武曲
    elif 1944 <= year <= 1963:
        return 5  # 五黄廉贞
    else:
        return 9  # 默认九紫


def fly_star(ruzong: int, days: int = 0) -> dict:
    """
    计算飞星位置
    ruzong: 入中宫的星（1-9）
    days: 偏移天数（0=年飞星，1-30=月飞星，1-365=日飞星）
    """
    # 基础偏移
    offset = days % 9
    
    # 飞星位置（九宫飞布）
    result = {}
    for pos in range(9):
        # 飞星计算公式
        star = (ruzong + offset - pos - 1) % 9 + 1
        result[pos] = star
    
    return result


def get_year_feixing(year: int) -> dict:
    """流年飞星"""
    ruzong = get_ruzong_star(year)
    return fly_star(ruzong, 0)


def get_month_feixing(year: int, month: int) -> dict:
    """流月飞星"""
    # 流年星
    year_ruzong = get_ruzong_star(year)
    # 流月星：年星+月数-2（简化）
    month_star = (year_ruzong + month - 2) % 9 + 1
    return fly_star(month_star, 0)


def get_day_feixing(date: datetime) -> dict:
    """流日飞星"""
    base_date = datetime(2024, 1, 1)
    days = (date - base_date).days
    ruzong = get_ruzong_star(date.year)
    return fly_star(ruzong, days % 360)


def get_star_nature(star: int) -> str:
    """获取星曜性质"""
    return JIUXING[star]["nature"]


def get_direction_luck(star: int, year: int) -> str:
    """根据星曜和年份判断方位吉凶"""
    ruzong = get_ruzong_star(year)
    
    # 当令星
    if star == ruzong:
        return "当令旺星"
    # 退运星（隔3位以上）
    elif (star - ruzong) % 9 > 4:
        return "退运衰星"
    # 生气星
    elif star in [1, 3, 4]:
        return "生气吉星"
    # 死气星
    elif star in [2, 5, 7]:
        return "死气凶星"
    else:
        return "平"


def format_output(feixing: dict, year: int, month: int = None, day: datetime = None) -> str:
    """格式化输出"""
    ruzong = get_ruzong_star(year)
    ruzong_info = JIUXING[ruzong]
    
    output = f"🧭 {year}年九宫飞星"
    if month:
        output = f"🧭 {year}年{month}月九宫飞星"
    if day:
        output = f"🧭 {day.strftime('%Y年%m月%d日')}九宫飞星"
    
    output += f"\n\n【年星入中】：{ruzong_info['name']}（{ruzong_info['wuxing']}）"
    
    # 特殊方位
    luck_positions = {
        1: "一白贪狼 - 桃花位/文昌位",
        4: "四绿文曲 - 文昌位",
        6: "六白武曲 - 偏财运",
        8: "八白左辅 - 正财运",
        9: "九紫右弼 - 喜庆位",
    }
    
    output += "\n\n【吉位】\n"
    for pos, star in feixing.items():
        if star in [1, 4, 6, 8, 9] and pos != 0:
            info = JIUXING[star]
            luck = luck_positions.get(star, "")
            output += f"🟢 {GONGFU[pos]['bz']}：{info['name']} - {info['nature']} {luck}\n"
    
    output += "\n【凶位】\n"
    for pos, star in feixing.items():
        if star in [2, 3, 5, 7] and pos != 0:
            info = JIUXING[star]
            nature = get_star_nature(star)
            output += f"🔴 {GONGFU[pos]['bz']}：{info['name']} - {nature}\n"
    
    output += "\n【方位详解】\n"
    for pos, star in feixing.items():
        if pos == 0:
            continue
        info = JIUXING[star]
        gong = GONGFU[pos]
        luck = get_direction_luck(star, year)
        
        emoji = "🟢" if info["nature"] == "吉" else "🔴" if info["nature"] == "凶" else "🟡"
        output += f"{emoji} {gong['bz']}（{gong['direction']}）：{info['name']}{info['color']}星 - {luck}\n"
    
    output += """
---
※ 风水仅供参考，阳宅风水还需综合考量 ※"""
    
    return output


def cmd_year(year: int = None):
    """流年飞星"""
    if year is None:
        year = datetime.now().year
    feixing = get_year_feixing(year)
    print(format_output(feixing, year))


def cmd_month(year: int, month: int):
    """流月飞星"""
    feixing = get_month_feixing(year, month)
    print(format_output(feixing, year, month))


def cmd_today():
    """今日飞星"""
    today = datetime.now()
    feixing = get_day_feixing(today)
    print(format_output(feixing, today.year, day=today))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        cmd_year()
    elif sys.argv[1] == "year":
        cmd_year()
    elif sys.argv[1] == "month":
        now = datetime.now()
        cmd_month(now.year, now.month)
    elif sys.argv[1] == "today":
        cmd_today()
    elif len(sys.argv) == 2:
        # 只传入年份
        try:
            year = int(sys.argv[1])
            cmd_year(year)
        except:
            print("用法: python feixing.py [year|month|today|<年份>] [<月份>]")
    elif len(sys.argv) == 3:
        try:
            year = int(sys.argv[1])
            month = int(sys.argv[2])
            cmd_month(year, month)
        except:
            print("用法: python feixing.py [year|month|today|<年份>] [<月份>]")
    else:
        print("用法: python feixing.py [year|month|today|<年份>] [<月份>]")
        print("例:")
        print("  python feixing.py year        # 流年飞星")
        print("  python feixing.py month       # 流月飞星")
        print("  python feixing.py today       # 今日飞星")
        print("  python feixing.py 2026        # 2026年流年飞星")
        print("  python feixing.py 2026 3      # 2026年3月飞星")
