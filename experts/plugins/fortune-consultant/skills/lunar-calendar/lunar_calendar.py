#!/usr/bin/env python3
"""
农历日历工具
提供基本的农历日期查询功能
"""

import sys
import datetime
from typing import Optional

class LunarCalendar:
    """简单的农历日历类"""
    
    # 简单的农历数据（示例，实际需要完整数据）
    LUNAR_MONTHS = ["正月", "二月", "三月", "四月", "五月", "六月", 
                   "七月", "八月", "九月", "十月", "冬月", "腊月"]
    
    LUNAR_DAYS = ["初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十",
                 "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十",
                 "廿一", "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十"]
    
    SOLAR_TERMS = {
        "立春": "02-03", "雨水": "02-18", "惊蛰": "03-05", "春分": "03-20",
        "清明": "04-04", "谷雨": "04-19", "立夏": "05-05", "小满": "05-20",
        "芒种": "06-05", "夏至": "06-21", "小暑": "07-07", "大暑": "07-22",
        "立秋": "08-07", "处暑": "08-23", "白露": "09-07", "秋分": "09-22",
        "寒露": "10-08", "霜降": "10-23", "立冬": "11-07", "小雪": "11-22",
        "大雪": "12-07", "冬至": "12-21", "小寒": "01-05", "大寒": "01-20"
    }
    
    def get_current_lunar(self) -> str:
        """获取当前农历日期（简化版）"""
        today = datetime.date.today()
        # 简化计算：实际需要复杂的农历算法
        lunar_month = self.LUNAR_MONTHS[(today.month - 1) % 12]
        lunar_day = self.LUNAR_DAYS[(today.day - 1) % 30]
        
        # 生肖计算（简化）
        zodiacs = ["鼠", "牛", "虎", "兔", "龙", "蛇", "马", "羊", "猴", "鸡", "狗", "猪"]
        zodiac = zodiacs[(today.year - 1900) % 12]
        
        return f"公历: {today}\n农历: {lunar_month}{lunar_day}\n生肖: {zodiac}"
    
    def get_solar_term(self, date_str: Optional[str] = None) -> str:
        """获取节气信息"""
        if date_str:
            try:
                date = datetime.datetime.strptime(date_str, "%Y-%m-%d").date()
            except ValueError:
                return "日期格式错误，请使用 YYYY-MM-DD 格式"
        else:
            date = datetime.date.today()
        
        month_day = date.strftime("%m-%d")
        for term, term_date in self.SOLAR_TERMS.items():
            if term_date == month_day:
                return f"{date} 是节气: {term}"
        
        return f"{date} 不是节气日"
    
    def help(self) -> str:
        """显示帮助信息"""
        return """农历日历工具使用方法:
        
1. 查询当前农历: python3 lunar_calendar.py current
2. 查询节气: python3 lunar_calendar.py term [日期]
3. 显示帮助: python3 lunar_calendar.py help

示例:
  python3 lunar_calendar.py current
  python3 lunar_calendar.py term 2026-02-18
"""

def main():
    if len(sys.argv) < 2:
        print("请提供命令参数，使用 'help' 查看帮助")
        sys.exit(1)
    
    command = sys.argv[1]
    lunar = LunarCalendar()
    
    if command == "current":
        print(lunar.get_current_lunar())
    elif command == "term":
        date_str = sys.argv[2] if len(sys.argv) > 2 else None
        print(lunar.get_solar_term(date_str))
    elif command == "help":
        print(lunar.help())
    else:
        print(f"未知命令: {command}")
        print("使用 'help' 查看可用命令")

if __name__ == "__main__":
    main()