"""
查询优化工具模块

提供两个核心优化功能：
1. TimeRangeExpander: 扩展时间范围以确保足够的数据点
2. DataQualityChecker: 检查数据质量，决定是否分配data_id给BI工具
"""

from typing import List, Tuple, Optional, Dict, Any
from datetime import datetime, timedelta
from dateutil import parser
from loguru import logger


class TimeRangeExpander:
    """时间范围扩展器
    
    当检测到查询时间范围会产生过少的数据点时，自动扩展时间范围以改善图表展示效果
    """
    
    # 扩展规则配置：{granularity: (目标数据点数, 扩展单位, 扩展量)}
    EXPANSION_RULES = {
        "hour": (24, "hours", 23),       # 扩展到24小时
        "day": (7, "days", 6),           # 扩展到7天
        "week": (8, "weeks", 7),         # 扩展到8周
        "month": (6, "days", 150),       # 扩展到6个月（约150天）
    }
    
    @staticmethod
    def calculate_expected_points(start: datetime, end: datetime, granularity: str) -> int:
        """计算预期数据点数量
        
        Args:
            start: 开始时间
            end: 结束时间
            granularity: 时间粒度（hour/day/week/month）
            
        Returns:
            预期的数据点数量
        """
        delta = end - start
        
        if granularity == "hour":
            return int(delta.total_seconds() / 3600) + 1
        elif granularity == "day":
            return delta.days + 1
        elif granularity == "week":
            return int(delta.days / 7) + 1
        elif granularity == "month":
            return (end.year - start.year) * 12 + (end.month - start.month) + 1
        
        return 0
    
    @classmethod
    def expand_if_needed(
        cls,
        date_range: List[str],
        granularity: str,
        min_points: int = 3,
        validation_messages: Optional[List[str]] = None
    ) -> Tuple[List[str], bool]:
        """如果数据点不足，扩展时间范围
        
        Args:
            date_range: 时间范围 [start, end]
            granularity: 时间粒度（hour/day/week/month/aggregate）
            min_points: 最小数据点数量阈值（默认3个）
            validation_messages: 用于收集调整信息的列表
            
        Returns:
            (扩展后的时间范围, 是否进行了扩展)
        """
        # 不处理aggregate或无效输入
        if granularity == "aggregate" or not isinstance(date_range, list) or len(date_range) != 2:
            return date_range, False
        
        # 不支持的粒度
        if granularity not in cls.EXPANSION_RULES:
            return date_range, False
        
        try:
            start_dt = parser.parse(date_range[0])
            end_dt = parser.parse(date_range[1])
            
            # 计算预期数据点数量
            expected_points = cls.calculate_expected_points(start_dt, end_dt, granularity)
            
            # 如果数据点足够，无需扩展
            if expected_points >= min_points:
                return date_range, False
            
            # 获取扩展规则
            target_points, unit, amount = cls.EXPANSION_RULES[granularity]
            
            # 计算新的起始时间
            if unit == "hours":
                new_start_dt = end_dt - timedelta(hours=amount)
                date_format = '%Y-%m-%d %H:%M:%S'
            elif unit == "days":
                new_start_dt = end_dt - timedelta(days=amount)
                date_format = '%Y-%m-%d'
            elif unit == "weeks":
                new_start_dt = end_dt - timedelta(weeks=amount)
                date_format = '%Y-%m-%d'
            else:
                return date_range, False
            
            # 生成新的时间范围
            new_date_range = [
                new_start_dt.strftime(date_format),
                date_range[1]  # 保持原结束时间
            ]
            
            # 记录扩展信息
            msg = f"时间范围过短（预计{expected_points}个数据点），已扩展为{target_points}个{unit}"
            if validation_messages is not None:
                validation_messages.append(msg)
            
            logger.info(f"【TimeRangeExpander】{date_range[0]} ~ {date_range[1]} -> {new_date_range[0]} ~ {new_date_range[1]}")
            
            return new_date_range, True
            
        except Exception as e:
            logger.debug(f"【TimeRangeExpander】扩展失败，保持原值: {e}")
            return date_range, False


class DataQualityChecker:
    """数据质量检查器
    
    检查查询结果的数据点数量，决定是否分配data_id给BI工具使用
    """
    
    @staticmethod
    def check_and_assign_data_id(
        data: Dict[str, Any],
        min_points: int = 3,
        data_id_prefix: str = "opinion_cube",
        system_name: str = "opinion",
        validation_messages: Optional[List[str]] = None
    ) -> Tuple[bool, int]:
        """检查数据点数量并决定是否分配data_id
        
        Args:
            data: 查询返回的数据字典
            min_points: 最小数据点数量阈值（默认3个）
            data_id_prefix: data_id前缀
            system_name: 系统名称
            validation_messages: 用于收集提示信息的列表
            
        Returns:
            (是否分配了data_id, 数据点数量)
        """
        import uuid
        
        # 检查数据是否成功返回
        if data.get("code") != 0:
            return False, 0
        
        try:
            # 获取数据点数量
            data_points = 0
            if data.get("data", {}).get("data"):
                data_points = len(data["data"]["data"])
            
            # 判断是否需要分配data_id
            should_assign = data_points >= min_points
            
            if should_assign:
                # 数据点足够，分配data_id
                data["data_id"] = f"{data_id_prefix}_{uuid.uuid4()}"
                logger.debug(f"【DataQualityChecker】数据点充足（{data_points}个），已分配data_id")
            else:
                # 数据点不足，不分配data_id
                msg = f"查询结果数据点较少，请直接解读数据"
                if validation_messages is not None:
                    validation_messages.append(msg)
                logger.info(f"【DataQualityChecker】数据点不足（{data_points}个），不分配data_id给BI工具")
            
            # 始终设置system字段
            data["system"] = system_name
            
            return should_assign, data_points
            
        except Exception as e:
            logger.debug(f"【DataQualityChecker】检查数据点数量失败: {e}")
            # 异常情况下，默认分配data_id
            data["data_id"] = f"{data_id_prefix}_{uuid.uuid4()}"
            data["system"] = system_name
            return True, 0


class QueryOptimizer:
    """查询优化器（整合类）
    
    整合时间范围扩展和数据质量检查功能，提供统一接口
    """
    
    def __init__(self, min_data_points: int = 3):
        """初始化查询优化器
        
        Args:
            min_data_points: 最小数据点数量阈值（默认3个）
        """
        self.min_data_points = min_data_points
        self.time_expander = TimeRangeExpander()
        self.quality_checker = DataQualityChecker()
    
    def optimize_time_range(
        self,
        date_range: List[str],
        granularity: str,
        validation_messages: Optional[List[str]] = None
    ) -> Tuple[List[str], bool]:
        """优化时间范围
        
        Args:
            date_range: 时间范围 [start, end]
            granularity: 时间粒度
            validation_messages: 用于收集调整信息的列表
            
        Returns:
            (优化后的时间范围, 是否进行了扩展)
        """
        return self.time_expander.expand_if_needed(
            date_range,
            granularity,
            min_points=self.min_data_points,
            validation_messages=validation_messages
        )
    
    def check_data_quality(
        self,
        data: Dict[str, Any],
        data_id_prefix: str = "opinion_cube",
        system_name: str = "opinion",
        validation_messages: Optional[List[str]] = None
    ) -> Tuple[bool, int]:
        """检查数据质量
        
        Args:
            data: 查询返回的数据字典
            data_id_prefix: data_id前缀
            system_name: 系统名称
            validation_messages: 用于收集提示信息的列表
            
        Returns:
            (是否分配了data_id, 数据点数量)
        """
        return self.quality_checker.check_and_assign_data_id(
            data,
            min_points=self.min_data_points,
            data_id_prefix=data_id_prefix,
            system_name=system_name,
            validation_messages=validation_messages
        )
