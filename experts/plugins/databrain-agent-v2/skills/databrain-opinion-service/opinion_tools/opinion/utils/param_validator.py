#!/usr/bin/env python3
"""
通用参数验证类
支持不同类型的参数验证，包括字符串、列表、时间等
"""

from typing import Any, List, Set, Union, Optional, Callable
from datetime import datetime, timedelta, timezone
from loguru import logger
import re
from dateutil import parser as dt_parser


class ParamValidationError(Exception):
    """参数验证错误，用于触发websearch fallback"""
    pass


class ParamValidator:
    """
    通用参数验证类
    
    支持的验证类型：
    - 字符串参数（单值）
    - 字符串列表参数
    - 时间参数（日期/时间格式）
    - 数值参数
    - 布尔参数
    - 映射函数验证（使用自定义映射函数进行验证和规范化）
    """
    
    @staticmethod
    def _normalize_string(value: str) -> str:
        """
        标准化字符串：只保留字母并转小写
        - "Middle East" / "MiddleEast" / "middle_east" → "middleeast"
        - "China(HK,MO,TW)" / "China HK MO TW" / "ChinaHKMOTW" → "chinahkmotw"
        - "North America" / "NorthAmerica" / "north_america" → "northamerica"
        
        Args:
            value: 待标准化的字符串
            
        Returns:
            标准化后的字符串（只包含小写字母）
        """
        # 只保留字母，全部转小写
        return re.sub(r'[^a-zA-Z]', '', value).lower()
    
    @staticmethod
    def validate_string(
        param_value: Any,
        allowed_values: Optional[Set[str]],
        default_value: Any,
        param_name: str,
        validation_messages: List[str],
        case_sensitive: bool = False
    ) -> Any:
        """
        验证字符串参数
        1. 参数未提供或传入 "all"（通配符，表示不过滤）-> 使用默认值
        2. 参数格式不规范（大小写、空格等）-> 自动纠正为正确格式
        3. 参数值不支持 -> 抛出ParamValidationError异常
        
        Args:
            param_value: 待验证的参数值
            allowed_values: 允许的值集合，None表示不限制
            default_value: 默认值
            param_name: 参数名称
            validation_messages: 消息收集列表
            case_sensitive: 是否区分大小写
            
        Returns:
            验证后的参数值
            
        Raises:
            ParamValidationError: 当参数值不在允许范围内且无法纠正时
        """
        # 情况1: 参数未提供，使用默认值
        # 注意："all" 仅在 default_value 为 None（即该参数是可选过滤项）时视为"不过滤"；
        # 对有具体默认值的必填参数（如 platform="steam"），"all" 不应静默 fallback，应保留报错让 LLM 重试
        if param_value is None or (
            default_value is None
            and isinstance(param_value, str)
            and param_value.strip().lower() == "all"
        ):
            if default_value is not None:
                validation_messages.append(f"参数 {param_name} 未提供，使用默认值: {default_value}")
            return default_value
        
        # 类型检查
        if not isinstance(param_value, str):
            warning_msg = f"参数 {param_name} 应为字符串类型，但收到 {type(param_value)}"
            logger.warning(warning_msg)
            raise ParamValidationError(warning_msg)
        
        # 如果没有限制允许值，直接返回
        if allowed_values is None:
            return param_value
        
        # 情况2: 尝试智能纠错
        # 先尝试直接匹配（不区分大小写）
        normalized_input = ParamValidator._normalize_string(param_value)
        
        # 建立标准化映射表：normalized_value -> original_value
        normalize_map = {}
        for allowed_val in allowed_values:
            normalized_allowed = ParamValidator._normalize_string(allowed_val)
            normalize_map[normalized_allowed] = allowed_val
        
        # 检查是否能够通过标准化匹配到
        if normalized_input in normalize_map:
            correct_value = normalize_map[normalized_input]
            if param_value != correct_value:
                validation_messages.append(
                    f"参数 {param_name} 的值 '{param_value}' 已自动纠正为: '{correct_value}'"
                )
            return correct_value
        
        # 情况3: 无法纠正，抛出错误
        warning_msg = (
            f"参数 {param_name} 的值 '{param_value}' 不受支持。"
            f"允许的值为: {', '.join(sorted(allowed_values))}"
        )
        logger.warning(warning_msg)
        raise ParamValidationError(warning_msg)
    
    @staticmethod
    def validate_string_list(
        param_value: Any,
        allowed_values: Optional[Set[str]],
        default_value: List[str],
        param_name: str,
        validation_messages: List[str],
        case_sensitive: bool = False,
        transform_func: Optional[Callable[[str], str]] = None
    ) -> List[str]:
        """
        验证字符串列表参数
        1. 参数未提供 -> 使用默认值
        2. 列表中的值格式不规范（大小写、空格等）-> 自动纠正为正确格式
        3. 列表中的值不支持 -> 从列表中移除并记录警告；若所有值都不支持则抛出异常
        
        Args:
            param_value: 待验证的参数值
            allowed_values: 允许的值集合，None表示不限制
            default_value: 默认值
            param_name: 参数名称
            validation_messages: 消息收集列表
            case_sensitive: 是否区分大小写
            transform_func: 转换函数（如str.lower, str.upper），在智能纠错之后应用
            
        Returns:
            验证后的字符串列表
            
        Raises:
            ParamValidationError: 当所有参数值都不在允许范围内且无法纠正时
        """
        # 情况1: 参数未提供，使用默认值
        if param_value is None:
            if default_value:
                validation_messages.append(f"参数 {param_name} 未提供，使用默认值: {default_value}")
            return default_value
        
        # 类型检查
        if not isinstance(param_value, list):
            error_msg = f"参数 {param_name} 应为列表类型，但收到 {type(param_value)}"
            logger.warning(error_msg)
            raise ParamValidationError(error_msg)
        
        validated_list = []
        corrected_items = []  # 记录被纠正的项
        invalid_items = []    # 记录无法纠正的无效项
        
        # 如果有allowed_values，建立标准化映射表
        normalize_map = None
        if allowed_values is not None:
            normalize_map = {}
            for allowed_val in allowed_values:
                normalized_allowed = ParamValidator._normalize_string(allowed_val)
                normalize_map[normalized_allowed] = allowed_val
        
        for item in param_value:
            # 基础验证：必须是非空字符串
            if not isinstance(item, str) or not item.strip():
                invalid_items.append(str(item))
                logger.warning(f"参数 {param_name} 中的值 '{item}' 类型无效或为空，已忽略")
                continue
            
            item_stripped = item.strip()
            
            # 如果没有限制允许值，直接添加（应用transform_func）
            if allowed_values is None:
                processed_item = transform_func(item_stripped) if transform_func else item_stripped
                validated_list.append(processed_item)
                continue
            
            # 情况2: 尝试智能纠错
            normalized_input = ParamValidator._normalize_string(item_stripped)
            
            if normalized_input in normalize_map:
                correct_value = normalize_map[normalized_input]
                # 应用transform_func（如果提供）
                final_value = transform_func(correct_value) if transform_func else correct_value
                validated_list.append(final_value)
                
                # 记录纠正信息
                if item != correct_value:
                    corrected_items.append(f"'{item}' -> '{correct_value}'")
            else:
                # 情况3: 无法纠正，记录为无效项
                invalid_items.append(str(item))
                logger.warning(f"参数 {param_name} 中的值 '{item}' 不在允许范围内，已忽略")
        
        # 记录纠正和无效信息
        if corrected_items:
            validation_messages.append(
                f"参数 {param_name} 中的值已自动纠正: {', '.join(corrected_items)}"
            )
        
        if invalid_items:
            validation_messages.append(
                f"参数 {param_name} 中的无效值 [{', '.join(invalid_items)}] 已被忽略"
            )
        
        # 如果所有值都被过滤掉了
        if not validated_list and param_value:
            # 如果原始列表不为空但所有值都无效，抛出错误
            error_msg = (
                f"参数 {param_name} 的所有值都不受支持。"
                f"允许的值为: {', '.join(sorted(allowed_values)) if allowed_values else '无限制'}"
            )
            logger.warning(error_msg)
            raise ParamValidationError(error_msg)
        
        return validated_list if validated_list else default_value
    
    @staticmethod
    def validate_datetime(
        param_value: Any,
        default_value: Any,
        param_name: str,
        validation_messages: List[str],
        required_format: Optional[str] = None,
        timezone_info: Optional[timezone] = None,
        allow_date_only: bool = True
    ) -> Any:
        """
        验证时间参数
        
        Args:
            param_value: 待验证的参数值
            default_value: 默认值
            param_name: 参数名称
            validation_messages: 消息收集列表
            required_format: 要求的时间格式 ('%Y-%m-%d' 或 '%Y-%m-%d %H:%M:%S')
            timezone_info: 时区信息
            allow_date_only: 是否允许仅日期格式
            
        Returns:
            验证后的时间字符串
        """
        if param_value is None:
            if default_value is not None:
                validation_messages.append(f"参数 {param_name} 未提供，使用默认值: {default_value}")
            return default_value
        
        if not isinstance(param_value, str):
            logger.warning(f"参数 {param_name} 应为字符串类型，但收到 {type(param_value)}，使用默认值: {default_value}")
            validation_messages.append(f"参数 {param_name} 类型错误，已使用默认值: {default_value}")
            return default_value
        
        try:
            # 尝试解析时间
            if len(param_value) == 10:  # YYYY-MM-DD 格式
                dt = datetime.fromisoformat(param_value + " 00:00:00")
                if required_format == '%Y-%m-%d %H:%M:%S':
                    # 需要小时格式但提供了日期格式，自动转换
                    validation_messages.append(f"参数 {param_name} 时间格式已从日期格式转换为小时格式")
                    return dt.strftime("%Y-%m-%d %H:%M:%S")
                elif required_format == '%Y-%m-%d':
                    return dt.strftime("%Y-%m-%d")
                else:
                    return param_value
            
            elif len(param_value) == 19:  # YYYY-MM-DD HH:MM:SS 格式
                dt = datetime.fromisoformat(param_value)
                if required_format == '%Y-%m-%d':
                    # 需要日期格式但提供了时间格式，截取日期部分
                    validation_messages.append(f"参数 {param_name} 时间格式已从小时格式转换为日期格式")
                    return dt.strftime("%Y-%m-%d")
                elif required_format == '%Y-%m-%d %H:%M:%S':
                    return dt.strftime("%Y-%m-%d %H:%M:%S")
                else:
                    return param_value
            
            else:
                # 尝试其他格式解析
                dt = datetime.fromisoformat(param_value)
                if required_format:
                    return dt.strftime(required_format)
                else:
                    return param_value
                    
        except ValueError:
            logger.warning(f"参数 {param_name} 时间格式无效: {param_value}，使用默认值: {default_value}")
            validation_messages.append(f"参数 {param_name} 时间格式无效: {param_value}，已使用默认值: {default_value}")
            return default_value
    
    @staticmethod
    def validate_number(
        param_value: Any,
        default_value: Union[int, float],
        param_name: str,
        validation_messages: List[str],
        min_value: Optional[Union[int, float]] = None,
        max_value: Optional[Union[int, float]] = None,
        is_integer: bool = False
    ) -> Union[int, float]:
        """
        验证数值参数
        
        Args:
            param_value: 待验证的参数值
            default_value: 默认值
            param_name: 参数名称
            validation_messages: 消息收集列表
            min_value: 最小值限制
            max_value: 最大值限制
            is_integer: 是否要求整数
            
        Returns:
            验证后的数值
        """
        if param_value is None:
            validation_messages.append(f"参数 {param_name} 未提供，使用默认值: {default_value}")
            return default_value
        
        try:
            # 尝试转换为数值
            if is_integer:
                value = int(param_value)
            else:
                value = float(param_value)
            
            # 检查范围
            if min_value is not None and value < min_value:
                validation_messages.append(f"参数 {param_name} 值 {value} 小于最小值 {min_value}，已使用默认值: {default_value}")
                return default_value
            
            if max_value is not None and value > max_value:
                validation_messages.append(f"参数 {param_name} 值 {value} 大于最大值 {max_value}，已使用默认值: {default_value}")
                return default_value
            
            return value
            
        except (ValueError, TypeError):
            logger.warning(f"参数 {param_name} 无法转换为数值: {param_value}，使用默认值: {default_value}")
            validation_messages.append(f"参数 {param_name} 数值格式无效: {param_value}，已使用默认值: {default_value}")
            return default_value
    
    @staticmethod
    def validate_boolean(
        param_value: Any,
        default_value: bool,
        param_name: str,
        validation_messages: List[str]
    ) -> bool:
        """
        验证布尔参数
        
        Args:
            param_value: 待验证的参数值
            default_value: 默认值
            param_name: 参数名称
            validation_messages: 消息收集列表
            
        Returns:
            验证后的布尔值
        """
        if param_value is None:
            validation_messages.append(f"参数 {param_name} 未提供，使用默认值: {default_value}")
            return default_value
        
        if isinstance(param_value, bool):
            return param_value
        
        if isinstance(param_value, str):
            lower_value = param_value.lower()
            if lower_value in ['true', '1', 'yes', 'on']:
                return True
            elif lower_value in ['false', '0', 'no', 'off']:
                return False
        
        logger.warning(f"参数 {param_name} 无法转换为布尔值: {param_value}，使用默认值: {default_value}")
        validation_messages.append(f"参数 {param_name} 布尔格式无效: {param_value}，已使用默认值: {default_value}")
        return default_value
    
    @staticmethod
    def validate_with_mapper(
        param_value: Optional[List[str]],
        mapper_func: Callable[[List[str]], List[str]],
        default_value: Optional[List[str]],
        param_name: str,
        validation_messages: List[str]
    ) -> Optional[List[str]]:
        """
        使用映射函数验证和规范化参数列表
        适用于需要复杂映射逻辑的场景（如 language_code）
        
        Args:
            param_value: 待验证的参数值（列表）
            mapper_func: 映射函数，接受 List[str] 返回 List[str]
            default_value: 默认值
            param_name: 参数名称
            validation_messages: 消息收集列表
            
        Returns:
            验证并映射后的参数值
            
        Example:
            >>> from opinion_tools.opinion.data.language_map import map_languages_to_iso
            >>> validated = ParamValidator.validate_with_mapper(
            ...     ["Chinese", "EN", "invalid"],
            ...     map_languages_to_iso,
            ...     None,
            ...     "language_code",
            ...     messages
            ... )
            >>> # 返回: ["en", "zh"]，并记录验证信息
        """
        # 情况1: 参数未提供，使用默认值
        if param_value is None:
            if default_value is not None:
                validation_messages.append(f"参数 {param_name} 未提供，使用默认值: {default_value}")
            return default_value
        
        # 情况2: 参数为空列表
        if not param_value:
            validation_messages.append(f"参数 {param_name} 为空列表，已忽略")
            return default_value
        
        # 情况3: 使用映射函数进行验证和规范化
        try:
            original_count = len(param_value)
            mapped_value = mapper_func(param_value)
            
            if not mapped_value:
                # 所有值都无效
                error_msg = f"参数 {param_name}: 所有值都无效 {param_value}，已忽略"
                validation_messages.append(error_msg)
                logger.warning(f"{param_name} 所有值都无效: {param_value}")
                return default_value
            
            elif len(mapped_value) < original_count:
                # 部分值被过滤
                info_msg = f"参数 {param_name}: 部分值无效已过滤，原始={param_value}, 规范化后={mapped_value}"
                validation_messages.append(info_msg)
                logger.info(f"{param_name} 部分值被过滤: {param_value} -> {mapped_value}")
                return mapped_value
            
            else:
                # 所有值都有效（可能被规范化）
                if param_value != mapped_value:
                    info_msg = f"参数 {param_name}: 已规范化 {param_value} -> {mapped_value}"
                    validation_messages.append(info_msg)
                return mapped_value
        
        except Exception as e:
            error_msg = f"参数 {param_name} 映射失败: {str(e)}，已忽略"
            validation_messages.append(error_msg)
            logger.error(f"{param_name} 映射失败: {param_value}, 错误: {str(e)}")
            return default_value
    
    @staticmethod
    def generate_time_range(
        start_date: Optional[str],
        end_date: Optional[str],
        granularity: str,
        param_name: str,
        validation_messages: List[str],
        timezone_info: timezone,
        default_days_for_hour: int = 7,
        default_days_for_day: int = 30
    ) -> List[str]:
        """
        生成时间范围，根据granularity自动选择格式和默认值
        
        Args:
            start_date: 开始日期
            end_date: 结束日期
            granularity: 时间粒度列表
            param_name: 参数名称
            validation_messages: 消息收集列表
            timezone_info: 时区信息
            default_days_for_hour: 小时级别的默认天数
            default_days_for_day: 日期级别的默认天数
            
        Returns:
            [start_time, end_time] 格式的时间范围
        """
        now = datetime.now(timezone_info)
        needs_hour_precision = granularity == "hour"
        
        if start_date and end_date:
            # 用户提供了时间范围，验证格式
            if needs_hour_precision:
                start_validated = ParamValidator.validate_datetime(
                    start_date, None, f"{param_name}_start", validation_messages,
                    required_format='%Y-%m-%d %H:%M:%S'
                )
                end_validated = ParamValidator.validate_datetime(
                    end_date, None, f"{param_name}_end", validation_messages,
                    required_format='%Y-%m-%d %H:%M:%S'
                )
                if start_validated and end_validated:
                    return [start_validated, end_validated]
            else:
                start_validated = ParamValidator.validate_datetime(
                    start_date, None, f"{param_name}_start", validation_messages,
                    required_format='%Y-%m-%d'
                )
                end_validated = ParamValidator.validate_datetime(
                    end_date, None, f"{param_name}_end", validation_messages,
                    required_format='%Y-%m-%d'
                )
                if start_validated and end_validated:
                    return [start_validated, end_validated]
        
        # 使用默认时间范围
        if needs_hour_precision:
            # 小时级别：默认指定天数
            end_dt = now
            start_dt = end_dt - timedelta(days=default_days_for_hour - 1)
            validation_messages.append(f"参数 {param_name} 未提供有效时间范围，使用默认值：最近{default_days_for_hour}天（小时级别）")
            return [
                start_dt.strftime("%Y-%m-%d %H:%M:%S"),
                end_dt.strftime("%Y-%m-%d %H:%M:%S")
            ]
        else:
            # 日期级别：默认指定天数
            end_d = now.date()
            start_d = end_d - timedelta(days=default_days_for_day - 1)
            validation_messages.append(f"参数 {param_name} 未提供有效时间范围，使用默认值：最近{default_days_for_day}天（日期级别）")
            return [
                start_d.strftime("%Y-%m-%d"),
                end_d.strftime("%Y-%m-%d")
            ]
