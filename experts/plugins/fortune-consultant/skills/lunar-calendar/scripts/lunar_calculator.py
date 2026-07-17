#!/usr/bin/env python3
"""
农历计算器 - 供Claude Skill调用的命令行接口

Usage:
  lunar_calculator.py --solar YYYY-MM-DD [--with-fortune]
  lunar_calculator.py --lunar "YYYY-MM-DD" [--leap BOOL] [--with-fortune]
  lunar_calculator.py --term YEAR

Dependencies:
  pip install lunardate cnlunar
"""

import argparse
import json
import sys
from datetime import datetime, timedelta
from typing import Dict, Any, Optional

try:
    from lunardate import LunarDate
    from cnlunar import Lunar
except ImportError:
    print("错误：请先安装依赖库：pip install lunardate cnlunar")
    sys.exit(1)

# 干支纪年
TIAN_GAN = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"]
DI_ZHI = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"]
ZODIAC = ["鼠", "牛", "虎", "兔", "龙", "蛇", "马", "羊", "猴", "鸡", "狗", "猪"]

# 农历月份名称
LUNAR_MONTHS = ["正月", "二月", "三月", "四月", "五月", "六月", 
                "七月", "八月", "九月", "十月", "冬月", "腊月"]

# 农历日名称
LUNAR_DAYS = ["初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十",
              "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十",
              "廿一", "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十"]

# 节气数据由 cnlunar 库提供（基于香港天文台200年数据），无需硬编码

class LunarCalculator:
    """农历计算器核心类"""
    
    def __init__(self):
        pass
    
    def get_ganzhi_year(self, year: int) -> str:
        """获取干支纪年"""
        # 计算干支索引（以4年为基准，实际算法更复杂）
        gan_index = (year - 4) % 10
        zhi_index = (year - 4) % 12
        return f"{TIAN_GAN[gan_index]}{DI_ZHI[zhi_index]}"
    
    def get_zodiac(self, year: int) -> str:
        """获取生肖"""
        return ZODIAC[(year - 1900) % 12]
    
    def get_lunar_month_name(self, month: int, is_leap: bool = False) -> str:
        """获取农历月份名称"""
        if 1 <= month <= 12:
            name = LUNAR_MONTHS[month - 1]
            return f"闰{name}" if is_leap else name
        return f"{month}月"
    
    def get_lunar_day_name(self, day: int) -> str:
        """获取农历日名称"""
        if 1 <= day <= 30:
            return LUNAR_DAYS[day - 1]
        return f"{day}日"
    
    def get_festival(self, lunar_month: int, lunar_day: int) -> Optional[str]:
        """获取传统节日"""
        festivals = {
            (1, 1): "春节",
            (1, 15): "元宵节",
            (5, 5): "端午节",
            (7, 7): "七夕节",
            (7, 15): "中元节",
            (8, 15): "中秋节",
            (9, 9): "重阳节",
            (12, 8): "腊八节",
            (12, 23): "小年",
            (12, 30): "除夕"
        }
        return festivals.get((lunar_month, lunar_day))
    
    def get_solar_term(self, date_str: str) -> Optional[Dict[str, str]]:
        """获取节气信息（基于 cnlunar 香港天文台数据）"""
        try:
            date = datetime.strptime(date_str, "%Y-%m-%d")
            lunar = Lunar(date_str.replace("-", ""))
            term_name = lunar.todaySolarTerms
            if term_name and term_name != "无":
                return {
                    "name": term_name,
                    "date": date_str,
                    "source": "香港天文台数据（cnlunar）"
                }
        except Exception:
            pass
        return None
    
    def get_fortune(self, date_str: str) -> Dict[str, Any]:
        """获取黄历宜忌（基于 cnlunar 钦定协纪辨方书算法）"""
        try:
            lunar = Lunar(date_str.replace("-", ""))
            result = {
                "suitable": list(lunar.goodThing) if lunar.goodThing else [],
                "avoid": list(lunar.badThing) if lunar.badThing else [],
            }
            # 附加信息
            extras = {}
            if hasattr(lunar, 'goodGodName') and lunar.goodGodName:
                extras["吉神"] = list(lunar.goodGodName)
            if hasattr(lunar, 'badGodName') and lunar.badGodName:
                extras["凶煞"] = list(lunar.badGodName)
            if hasattr(lunar, 'today12DayOfficer') and lunar.today12DayOfficer:
                extras["十二值日"] = lunar.today12DayOfficer
            if hasattr(lunar, 'today28Star') and lunar.today28Star:
                extras["二十八宿"] = lunar.today28Star
            if hasattr(lunar, 'get_pengTaboo'):
                peng = lunar.get_pengTaboo()
                if peng:
                    extras["彭祖百忌"] = peng
            if extras:
                result["extras"] = extras
            return result
        except Exception:
            return {"suitable": [], "avoid": [], "error": "宜忌查询失败"}
    
    def solar_to_lunar(self, solar_date: str, with_fortune: bool = False) -> Dict[str, Any]:
        """公历转农历"""
        try:
            year, month, day = map(int, solar_date.split('-'))
            
            # 使用lunardate库进行转换
            lunar_date = LunarDate.fromSolarDate(year, month, day)
            
            # 使用cnlunar获取更详细信息
            lunar_info = Lunar(f"{year}{month:02d}{day:02d}")
            
            result = {
                "solar_date": solar_date,
                "lunar_year": lunar_date.year,
                "lunar_month": lunar_date.month,
                "lunar_day": lunar_date.day,
                "is_leap": lunar_date.isLeap,
                "lunar_month_name": self.get_lunar_month_name(lunar_date.month, lunar_date.isLeap),
                "lunar_day_name": self.get_lunar_day_name(lunar_date.day),
                "ganzhi_year": self.get_ganzhi_year(lunar_date.year),
                "zodiac": self.get_zodiac(lunar_date.year),
                "festival": self.get_festival(lunar_date.month, lunar_date.day),
                "solar_term": self.get_solar_term(solar_date),
                "lunar_full": lunar_info.lunarFull()
            }
            
            if with_fortune:
                result["fortune"] = self.get_fortune(solar_date)
            
            return result
            
        except Exception as e:
            return {"error": f"日期转换失败: {str(e)}"}
    
    def lunar_to_solar(self, lunar_year: int, lunar_month: int, lunar_day: int, 
                      is_leap: bool = False, with_fortune: bool = False) -> Dict[str, Any]:
        """农历转公历"""
        try:
            # 使用lunardate库进行转换
            lunar_date = LunarDate(lunar_year, lunar_month, lunar_day, is_leap)
            solar_date = lunar_date.toSolarDate()
            
            solar_str = solar_date.strftime("%Y-%m-%d")
            
            result = {
                "lunar_date": f"{lunar_year}年{self.get_lunar_month_name(lunar_month, is_leap)}{self.get_lunar_day_name(lunar_day)}",
                "solar_date": solar_str,
                "ganzhi_year": self.get_ganzhi_year(lunar_year),
                "zodiac": self.get_zodiac(lunar_year),
                "festival": self.get_festival(lunar_month, lunar_day),
                "solar_term": self.get_solar_term(solar_str)
            }
            
            if with_fortune:
                result["fortune"] = self.get_fortune(solar_str)
            
            return result
            
        except Exception as e:
            return {"error": f"农历转换失败: {str(e)}"}
    
    def get_solar_terms(self, year: int) -> Dict[str, Any]:
        """获取一年的24节气（基于 cnlunar 香港天文台数据）"""
        try:
            # 用该年任意日期创建 Lunar 对象以获取全年节气
            lunar = Lunar(f"{year}0115")
            terms_dict = lunar.thisYearSolarTermsDic
            terms = {}
            if terms_dict:
                for term_name, (month, day) in terms_dict.items():
                    terms[term_name] = f"{year}-{month:02d}-{day:02d}"
            return {
                "year": year,
                "solar_terms": terms,
                "source": "香港天文台数据（cnlunar）"
            }
        except Exception as e:
            return {"year": year, "solar_terms": {}, "error": str(e)}

def main():
    parser = argparse.ArgumentParser(description='农历查询引擎（生产级稳定版）')
    parser.add_argument('--solar', type=str, help='公历日期: 2026-02-13')
    parser.add_argument('--lunar', type=str, help='农历日期: 2026-07-23 表示农历二零二六年七月廿三')
    parser.add_argument('--leap', type=bool, default=False, help='是否为闰月')
    parser.add_argument('--with-fortune', action='store_true', help='是否输出黄历信息')
    parser.add_argument('--term', type=int, help='查询某年的24节气表')
    parser.add_argument('--validate', type=str, help='验证模式：输入"solar_date,lunar_date"进行验证')
    
    args = parser.parse_args()
    
    calculator = LunarCalculator()
    
    if args.solar:
        result = calculator.solar_to_lunar(args.solar, args.with_fortune)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    
    elif args.lunar:
        # 解析农历日期字符串
        try:
            lunar_year, lunar_month, lunar_day = map(int, args.lunar.split('-'))
            result = calculator.lunar_to_solar(lunar_year, lunar_month, lunar_day, 
                                             args.leap, args.with_fortune)
            print(json.dumps(result, ensure_ascii=False, indent=2))
        except ValueError:
            print(json.dumps({"error": "农历日期格式错误，请使用YYYY-MM-DD格式"}, ensure_ascii=False))
    
    elif args.term:
        result = calculator.get_solar_terms(args.term)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    
    elif args.validate:
        # 验证模式
        try:
            solar_date, expected_lunar = args.validate.split(',')
            result = calculator.solar_to_lunar(solar_date.strip())
            
            if "error" in result:
                print(json.dumps({"validation": "failed", "error": result["error"]}, ensure_ascii=False))
            else:
                actual_lunar = f"{result['lunar_month_name']}{result['lunar_day_name']}"
                passed = expected_lunar.strip() in actual_lunar or actual_lunar in expected_lunar.strip()
                
                validation_result = {
                    "validation": "passed" if passed else "failed",
                    "solar_date": solar_date.strip(),
                    "expected_lunar": expected_lunar.strip(),
                    "actual_lunar": actual_lunar,
                    "details": result
                }
                print(json.dumps(validation_result, ensure_ascii=False, indent=2))
        except ValueError:
            print(json.dumps({"error": "验证格式错误，请使用'solar_date,lunar_date'格式"}, ensure_ascii=False))
    
    else:
        # 显示帮助信息
        parser.print_help()

if __name__ == '__main__':
    main()