from datetime import datetime
from functools import lru_cache
from typing import Any, Dict, List, Tuple, Optional
from dataclasses import dataclass
from loguru import logger
from collections import defaultdict

import pandas as pd


@dataclass
class ChartConfig:
    """图表配置类"""
    language: str = "English"
    chart_types: List[str] = None
    
    def __post_init__(self):
        if self.chart_types is None:
            self.chart_types = ['line', 'bar', 'table']


@dataclass
class GranularityConfig:
    """时间粒度配置"""

    CHINESE_NAMES = {
        "hour": "时",
        "day": "日",
        "week": "周",
        "month": "月",
        "year": "年",
    }
    ENGLISH_NAMES = {
        "hour": "Hour",
        "day": "Day",
        "week": "Week",
        "month": "Month",
        "year": "Year",
    }
    
    @classmethod
    def get_display_name(cls, granularity: str, language: str) -> str:
        """获取时间粒度的显示名称"""
        names = cls.CHINESE_NAMES if language == "Chinese" else cls.ENGLISH_NAMES
        return names.get(granularity, "时间粒度" if language == "Chinese" else "Time Granularity")


class DataTransformer:
    """数据转换器基类 用于将Cube输出转换为前端可接收的格式"""
    
    # 常量定义
    TIME_COLUMNS = ["hour", "day", "week", "month", "year"]
    DEFAULT_CHART_TYPE = "bar"
    TREND_CHART_TYPE = "trend"
    MIN_DATES_FOR_TREND = 5
    MIN_DATES_FOR_XAXIS = 1
    
    @staticmethod
    @lru_cache(maxsize=100)
    def _get_value_type(values: tuple) -> str:
        """确定数值类型"""
        if not values:
            return "numerical"

        series = pd.Series(values)
        if series.dtype == "object":
            return "numerical"
        elif series.dtype == "int64":
            return "numerical"
        elif series.dtype == "float64":
            return "float"
        return "numerical"

    @staticmethod
    def _determine_chart_type(df: pd.DataFrame, xAxis: List[Dict[str, Any]]) -> str:
        """根据数据特征确定最合适的图表类型"""
        has_date = xAxis and len(xAxis) > 0 and xAxis[0].get("date_key") == "date"

        if has_date:
            unique_dates = df["date"].nunique()
            return DataTransformer.TREND_CHART_TYPE if unique_dates > DataTransformer.MIN_DATES_FOR_TREND else DataTransformer.DEFAULT_CHART_TYPE
        
        return DataTransformer.DEFAULT_CHART_TYPE

    #FIXME: 需要优化
    @staticmethod
    def _convert_nan_to_none(df: pd.DataFrame) -> List[Dict[str, Any]]:
        """将DataFrame中的NaN值转换为None，对字符串字段使用兜底策略"""
        records = df.to_dict("records")
        for record in records:
            for key, value in record.items():
                if pd.isna(value):
                    # 为特定字段设置默认值
                    if key == 'language_zh':
                        record[key] = "其他语言"
                    elif key == 'language_en':
                        record[key] = "other language"
                    # 对字符串类型的字段使用兜底策略，将null转换为空字符串
                    elif any(str_key in key.lower() for str_key in ['name', 'language', 'title', 'description', 'label', 'text', 'type', 'category']):
                        record[key] = ""
                    else:
                        record[key] = None
        return records

    @staticmethod
    def _clean_game_id(df: pd.DataFrame, dimension_info: List[Dict[str, Any]]) -> Tuple[pd.DataFrame, List[Dict[str, Any]]]:
        """清理数据中的game_id"""
        if "game_name" in df.columns and "game_id" in df.columns:
            df = df.drop("game_id", axis=1)
            dimension_info = [d for d in dimension_info if d["data_key"] != "game_id"]
        return df, dimension_info

    @staticmethod
    def _determine_xaxis(
        df: pd.DataFrame,
        chart_params: Dict[str, Any],
        dimension_info: List[Dict[str, Any]],
        granularity: Optional[str],
    ) -> List[Dict[str, Any]]:
        """确定最合适的xAxis"""
        # 优先使用日期列
        if "date" in df.columns and df["date"].nunique() > DataTransformer.MIN_DATES_FOR_XAXIS:
            # 根据时间粒度选择前端展示格式：
            #   hour/minute/second -> datetime（年月日 时分）
            #   month              -> yearMonth（如 2025-11，避免出现 11.01 这种误导性日标签）
            #   其他（day/week 等）-> date
            if granularity in ("hour", "minute", "second"):
                date_format = "datetime"
            elif granularity == "month":
                date_format = "yearMonth"
            else:
                date_format = "date"
            return [{"date_key": "date", "show_type": "normal", "format": date_format}]

        # 选择值最多的维度
        if dimension_info:
            dimension_counts = [
                (dim["data_key"], df[dim["data_key"]].nunique())
                for dim in dimension_info
                if dim["data_key"] in df.columns
            ]
            if dimension_counts:
                best_dimension = max(dimension_counts, key=lambda x: x[1])
                return [{"date_key": best_dimension[0], "show_type": "all_tilt"}]
        
        return []

    @staticmethod
    def _clean_empty_metrics(df: pd.DataFrame, metrics_info: List[Dict[str, Any]]) -> Tuple[pd.DataFrame, List[Dict[str, Any]]]:
        """清理全为空的指标列"""
        cleaned_metrics = []
        removed_metrics = []
        
        for metric in metrics_info:
            metric_key = metric["data_key"]
            if metric_key in df.columns and df[metric_key].isna().all():
                df = df.drop(metric_key, axis=1)
                removed_metrics.append(metric_key)
            else:
                cleaned_metrics.append(metric)
        
        if removed_metrics:
            logger.info(f"clean_empty_data: 移除了 {len(removed_metrics)} 个全空指标列: {removed_metrics}")
        
        return df, cleaned_metrics

    @staticmethod
    def _clean_null_metrics_from_data(
        data: List[Dict[str, Any]], 
        original_query_dict: Dict[str, Any]
    ) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
        """从data中删除全为null的指标，并更新original_query_dict中的相关信息"""
        if not data:
            return data, original_query_dict
        
        # 检查哪些指标在所有记录中都为null
        all_keys = set()
        for record in data:
            all_keys.update(record.keys())
        
        null_metrics = []
        measures_in_query = original_query_dict.get("measures", [])
        
        # 检查每个指标是否全为null
        for key in all_keys:
            # 判断是否为指标字段（通过检查是否在measures中）
            is_metric = any(measure.endswith(f".{key}") or measure == key for measure in measures_in_query)
            
            if is_metric:
                # 检查该指标在所有记录中是否都为null
                all_null = all(
                    record.get(key) is None or pd.isna(record.get(key))
                    for record in data
                )
                
                if all_null:
                    null_metrics.append(key)
        
        if null_metrics:
            logger.info(f"clean_null_metrics_from_data: 发现全为null的指标: {null_metrics}")
            
            # 从data中删除null指标
            cleaned_data = []
            for record in data:
                cleaned_record = {k: v for k, v in record.items() if k not in null_metrics}
                cleaned_data.append(cleaned_record)
            
            # 更新original_query_dict中的measures相关信息
            updated_query_dict = original_query_dict.copy()
            
            # 更新measures列表
            original_measures = updated_query_dict.get("measures", [])
            updated_measures = [
                measure for measure in original_measures
                if not any(measure.endswith(f".{null_metric}") or measure == null_metric 
                          for null_metric in null_metrics)
            ]
            updated_query_dict["measures"] = updated_measures
            
            # 更新measures_format
            measures_format = updated_query_dict.get("measures_format", {})
            updated_measures_format = {
                k: v for k, v in measures_format.items()
                if not any(k.endswith(f".{null_metric}") or k == null_metric 
                          for null_metric in null_metrics)
            }
            updated_query_dict["measures_format"] = updated_measures_format
            
            # 更新measures_meta
            measures_meta = updated_query_dict.get("measures_meta", {})
            updated_measures_meta = {
                k: v for k, v in measures_meta.items()
                if not any(k.endswith(f".{null_metric}") or k == null_metric 
                          for null_metric in null_metrics)
            }
            updated_query_dict["measures_meta"] = updated_measures_meta
            
            logger.info(f"clean_null_metrics_from_data: 移除了 {len(null_metrics)} 个全null指标: {null_metrics}")
            return cleaned_data, updated_query_dict
        
        return data, original_query_dict

    @staticmethod
    def _clean_string_null_values(df: pd.DataFrame) -> pd.DataFrame:
        """清理字符串字段中的null值，使用兜底策略"""
        # 常见的字符串字段标识
        string_field_indicators = ['name', 'language', 'title', 'description', 'label', 'text', 'type', 'category']
        
        for column in df.columns:
            # 检查列名是否包含字符串字段标识
            if any(indicator in column.lower() for indicator in string_field_indicators):
                # 为特定字段设置默认值
                if column == 'language_zh':
                    df[column] = df[column].fillna("其他语言")
                    df[column] = df[column].replace(['nan', 'None', 'null'], "其他语言", regex=False)
                elif column == 'language_en':
                    df[column] = df[column].fillna("other language")
                    df[column] = df[column].replace(['nan', 'None', 'null'], "other language", regex=False)
                else:
                    # 将null值替换为空字符串
                    df[column] = df[column].fillna("")
                    # 将"nan"字符串也替换为空字符串
                    df[column] = df[column].replace(['nan', 'None', 'null'], "", regex=False)
        
        return df

    @staticmethod
    def _format_key_name(key: str) -> str:
        """格式化键名为更易读的形式"""
        return ' '.join(word.capitalize() for word in key.split('_'))

    @staticmethod
    def _preprocess_dataframe(
        df: pd.DataFrame, granularity: Optional[str]
    ) -> pd.DataFrame:
        """预处理DataFrame"""
        # 确保列名是字符串类型并移除前缀
        df.columns = [str(col).split(".")[-1] if "." in str(col) else str(col) for col in df.columns]

        # 处理日期列
        if "date" in df.columns:
            time_format = (
                "%Y-%m-%d %H:%M:%S"
                if granularity in ("hour", "minute", "second")
                else "%Y-%m-%d"
            )
            df["date"] = pd.to_datetime(df["date"]).dt.strftime(time_format)
        
        # 移除时间粒度列
        for time_col in DataTransformer.TIME_COLUMNS:
            if time_col in df.columns:
                df = df.drop(time_col, axis=1)
        
        return df

    @staticmethod
    def _extract_legends(chart_params: Dict[str, Any]) -> List[str]:
        """提取图例信息"""
        legend = chart_params.get("legends")
        if not legend:
            return []
        
        raw_legend = legend.split(".")[-1] if "." in legend else legend
        return [raw_legend]

    @staticmethod
    def _build_dimension_info(
        df: pd.DataFrame,
        original_query_dict: Dict[str, Any],
        language: str,
        granularity: Optional[str],
    ) -> List[Dict[str, Any]]:
        """构建维度信息"""
        dimensions_in_query = original_query_dict.get("dimensions", [])
        time_dimensions_in_query = original_query_dict.get("timeDimensions", [])
        dimensions_meta = original_query_dict.get("dimensions_meta", {})

        # 收集所有维度键
        all_dimension_keys = {dim.split(".")[-1] for dim in dimensions_in_query}
        all_dimension_keys.update(
            td["dimension"].split(".")[-1]
            for td in time_dimensions_in_query
            if "dimension" in td
        )

        dimension_info = []
        for dim_key in all_dimension_keys:
            if dim_key in df.columns:
                # 过滤掉null值和"nan"字符串，避免前端出错
                unique_values = df[dim_key].dropna().astype(str).unique().tolist()
                unique_values = [v for v in unique_values if v.lower() not in ['nan', 'none', 'null']]
                
                # 对于语言字段，过滤掉默认值
                if dim_key == 'language_zh':
                    unique_values = [v for v in unique_values if v != "其他语言"]
                elif dim_key == 'language_en':
                    unique_values = [v for v in unique_values if v != "other language"]
                
                meta = next((v for k, v in dimensions_meta.items() if k.split('.')[-1] == dim_key), {})
                
                display_name = (
                    meta.get("name_zh") if language == "Chinese" else meta.get("name_en")
                ) or DataTransformer._format_key_name(dim_key)

                dimension_item = {
                    "name": display_name,
                    "data_key": dim_key,
                    "value": sorted(unique_values),
                }
                if dim_key == "date" and granularity in ("hour", "minute", "second"):
                    dimension_item["format"] = "datetime"
                dimension_info.append(dimension_item)

        return dimension_info

    @staticmethod
    def _process_legends(raw_legends: List[str], dimension_info: List[Dict[str, Any]], xaxis_date_key: Optional[str]) -> List[str]:
        """处理图例配置"""
        valid_legends = [
            dim["data_key"]
            for dim in dimension_info
            if dim["data_key"] != xaxis_date_key
        ]
        legends = [
            legend
            for legend in raw_legends
            if legend in valid_legends and legend != xaxis_date_key
        ]
        default_legend = valid_legends[0] if valid_legends else None
        if not legends and default_legend:
            return [default_legend]

        return legends

    @staticmethod
    def _simplify_legends_if_needed(
        df: pd.DataFrame, 
        final_legends: List[str], 
        data: List[Dict[str, Any]], 
        dimension_info: List[Dict[str, Any]],
        language: str = "English",
        original_query_dict: Dict[str, Any] = None
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        """
        当图例超过11个时，简化为Top 10 + Others的形式
        
        Args:
            df: 原始数据DataFrame
            final_legends: 图例列表
            data: 转换后的数据
            dimension_info: 维度信息
            language: 语言设置
            original_query_dict: 原始查询字典，用于获取stackable参数
            
        Returns:
            Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]: 简化后的数据和维度信息
        """
        if not final_legends:
            return data, dimension_info
            
        simplified_data = data.copy()
        simplified_dimension_info = dimension_info.copy()
        
        # 获取每个指标的stackable参数
        measures_stackable_info = {}
        if original_query_dict:
            measures_meta = original_query_dict.get("measures_meta", {})
            measures_in_query = original_query_dict.get("measures", [])
            for measure in measures_in_query:
                meta = measures_meta.get(measure, {})
                # 获取指标的短名称（去掉前缀）
                short_name = measure.split(".")[-1]
                measures_stackable_info[short_name] = meta.get('stackable', False)
        
        for legend in final_legends:
            if legend not in df.columns:
                continue
                
            # 获取该图例的唯一值数量
            unique_values = df[legend].dropna().unique()
            if len(unique_values) <= 11:
                continue
                
            logger.info(f"图例 {legend} 有 {len(unique_values)} 个值，超过11个，进行Top 10+Others简化")
            
            # 获取指标列（用于排序）
            metric_columns = [col for col in df.columns if col not in [legend, 'date', 'time'] and col in df.columns]
            
            if not metric_columns:
                # 如果没有指标列，按频次排序
                value_counts = df[legend].value_counts()
                top_10_values = value_counts.head(10).index.tolist()
            else:
                # 按第一个指标列的总和排序
                metric_col = metric_columns[0]
                legend_metric_sum = df.groupby(legend)[metric_col].sum().sort_values(ascending=False)
                top_10_values = legend_metric_sum.head(10).index.tolist()
            
            # 更新数据：将非Top 10的值聚合为"Others"
            others_label = "其他" if language == "Chinese" else "Others"
            
            # 创建新的聚合数据
            aggregated_data = []
            
            # 处理Top 10的数据
            for item in simplified_data:
                if legend in item and item[legend] in top_10_values:
                    aggregated_data.append(item)
            
            # 聚合Others数据 - 按时间维度分别聚合
            others_items = {}
            others_counts = {}  # 用于计算平均值
            
            for item in simplified_data:
                if legend in item and item[legend] not in top_10_values:
                    # 创建时间维度的key（用于区分不同时间点的Others数据）
                    time_key = None
                    if 'date' in item:
                        time_key = item['date']
                    elif 'time' in item:
                        time_key = item['time']
                    else:
                        # 如果没有时间字段，使用默认key
                        time_key = 'default'
                    
                    # 为每个时间点创建Others记录
                    if time_key not in others_items:
                        others_items[time_key] = {}
                        others_counts[time_key] = {}
                        # 复制第一个非Top 10记录的结构
                        for key, value in item.items():
                            if key != legend:
                                others_items[time_key][key] = 0
                                others_counts[time_key][key] = 0
                    
                    # 聚合指标值（按时间维度）
                    for key, value in item.items():
                        if key != legend and isinstance(value, (int, float)):
                            # 检查该指标是否为查询中的指标，并获取其stackable属性
                            is_stackable = measures_stackable_info.get(key, False)
                            if is_stackable:
                                # stackable=True时，直接相加
                                others_items[time_key][key] = others_items[time_key].get(key, 0) + value
                            else:
                                # stackable=False时，累加值和计数，用于计算平均值
                                others_items[time_key][key] = others_items[time_key].get(key, 0) + value
                                others_counts[time_key][key] = others_counts[time_key].get(key, 0) + 1
                        elif key != legend:
                            # 对于非数值字段，保留第一个非空值
                            if key not in others_items[time_key] or not others_items[time_key][key]:
                                others_items[time_key][key] = value
            
            # 处理平均值计算（只对非stackable的指标计算平均值）
            for time_key in others_items:
                for key in others_items[time_key]:
                    if key in others_counts[time_key] and others_counts[time_key][key] > 0:
                        # 只对非stackable的指标计算平均值
                        if not measures_stackable_info.get(key, False):
                            # 计算平均值
                            others_items[time_key][key] = others_items[time_key][key] / others_counts[time_key][key]
            
            # 添加Others记录（每个时间点一条记录）
            for time_key, others_record in others_items.items():
                others_record[legend] = others_label
                aggregated_data.append(others_record)
            
            simplified_data = aggregated_data
            
            # 更新维度信息
            for dim_info in simplified_dimension_info:
                if dim_info["data_key"] == legend:
                    # 更新value列表，保留Top 10 + Others
                    new_values = top_10_values + [others_label]
                    dim_info["value"] = new_values
                    break
        
        return simplified_data, simplified_dimension_info

    @staticmethod
    def _determine_chart_types_for_metric(
        df: pd.DataFrame, 
        final_legends: List[str], 
        original_query_dict: Dict[str, Any], 
        meta: Dict[str, Any]
    ) -> List[str]:
        """为指标确定可用的图表类型"""
        # 基础图表类型
        is_stackable = meta.get('stackable', False)
        chart_types = ['line', 'bar', 'table'] if is_stackable else ['line', 'table']
        
        # 检查图例情况
        legends_allow_all_types = (
            not final_legends or 
            any(df[legend].nunique() <= 1 for legend in final_legends if legend in df.columns)
        )
        
        if legends_allow_all_types:
            chart_types = ['line', 'bar', 'table']
        
        # 检查时间维度
        has_multi_day_time_dimension = DataTransformer._check_multi_day_time_dimension(df, original_query_dict)
        
        if not has_multi_day_time_dimension and "line" in chart_types:
            chart_types.remove("line")
        
        return chart_types

    @staticmethod
    def _check_multi_day_time_dimension(df: pd.DataFrame, original_query_dict: Dict[str, Any]) -> bool:
        """检查是否有多天时间维度"""
        # 从timeDimensions中检查
        time_dimensions = original_query_dict.get("timeDimensions", [])
        for time_dim in time_dimensions:
            date_range = time_dim.get("dateRange", [])
            if len(date_range) >= 2 and date_range[0] != date_range[1]:
                return True
        
        # 检查数据中的date列
        if "date" in df.columns:
            return df["date"].nunique() > 1
        
        return False

    @staticmethod
    def _build_metrics_info(
        df: pd.DataFrame, 
        original_query_dict: Dict[str, Any], 
        final_legends: List[str], 
        language: str
    ) -> List[Dict[str, Any]]:
        """构建指标信息"""
        measures_in_query = original_query_dict.get("measures", [])
        measures_format = original_query_dict.get("measures_format", {})
        measures_meta = original_query_dict.get("measures_meta", {})

        metrics_info = []
        for measure_key in measures_in_query:
            short_key = measure_key.split(".")[-1]
            if short_key not in df.columns:
                continue
                
            values = df[short_key].dropna().tolist()
            value_type = (
                "percent" if measures_format.get(measure_key) == "percent"
                else DataTransformer._get_value_type(tuple(values))
            )

            meta = measures_meta.get(measure_key, {})
            display_name = (
                meta.get("name_zh") if language == "Chinese" else meta.get("name_en")
            ) or DataTransformer._format_key_name(short_key)

            chart_types = DataTransformer._determine_chart_types_for_metric(
                df, final_legends, original_query_dict, meta
            )

            metrics_info.append({
                "name": display_name,
                "data_key": short_key,
                "type": value_type,
                "chat_type": chart_types
            })

        return metrics_info

    @staticmethod
    def _get_granularity(time_dimensions_in_query: List[Dict[str, Any]]) -> Optional[str]:
        """获取时间粒度信息"""
        for td in time_dimensions_in_query:
            if "granularity" in td:
                return td.get("granularity")
        return None

    @staticmethod
    def _build_filter_info(
        df: pd.DataFrame,
        dimension_info: List[Dict[str, Any]],
        metrics_info: List[Dict[str, Any]],
        final_legends: List[str],
        xaxis_date_key: Optional[str],
    ) -> List[Dict[str, Any]]:
        """构建过滤器信息"""
        filter_dimension_info = [
            d
            for d in dimension_info
            if d["data_key"] not in final_legends
            and d["data_key"] != xaxis_date_key
            and d["data_key"] != "game_id"
            and len(d["value"]) > 1  # TBC: 只有1个值的维度不作为filter
        ]
        if not filter_dimension_info:
            return []

        # 普通filter
        # return [
        #     {"name": d["name"], "data_key": d["data_key"], "filter_type": "normal"}
        #     for d in filter_dimension_info
        # ]

        # 级联filter
        # {"name":"Game Type","data_key":"game_type","filter_type":"cascade","has_metric":true,"value":["mobile"],"display_info":["game_type","source","granularity"],"display_value":{"mobile":{"sensortower":{"daily":["revenue","dau"]}}}}
        # 对filters排序，基数少的在前，基数多的在后
        filter_dimension_info = sorted(
            filter_dimension_info, key=lambda x: len(x["value"])
        )
        display_info = [d["data_key"] for d in filter_dimension_info]
        display_value = defaultdict(dict)
        DataTransformer._build_cascade_display_value(
            display_value, df, filter_dimension_info, metrics_info
        )
        return [
            {
                "name": "",
                "data_key": filter_dimension_info[0]["data_key"],
                "filter_type": "cascade",
                "has_metric": True,
                "value": filter_dimension_info[0]["value"],
                "display_info": display_info,
                "display_value": display_value,
            }
        ]

    @staticmethod
    def _build_cascade_display_value(
        display_value: Dict[str, Any],
        df: pd.DataFrame,
        filter_dimension_info: List[Dict[str, Any]],
        metrics_info: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """
        构建级联过滤器的显示值:
        使用迭代方式根据df中实际存在的维度组合，构建嵌套dict。
        最后一层为可用的metric data_key列表。

        优化点：
        1. 使用迭代替代递归，避免函数调用开销和栈溢出风险
        2. 预计算有效指标，减少重复计算
        3. 使用队列批量处理，提高内存效率
        """
        if not filter_dimension_info:
            return

        # 预计算有效的指标列（只包含有非空非零值的指标）
        valid_metric_keys = []
        for metric in metrics_info:
            metric_key = metric["data_key"]
            if (
                metric_key in df.columns
                and df[metric_key].notna().any()
                and (df[metric_key].fillna(0) != 0).any()
            ):
                valid_metric_keys.append(metric_key)

        # 如果没有有效指标，直接返回
        if not valid_metric_keys:
            return

        # 使用队列进行迭代处理
        # 队列元素格式: (current_dict_ref, remaining_dimensions, filter_conditions)
        from collections import deque

        # filter_conditions格式: [(dimension_key, dimension_value), ...]
        queue = deque([(display_value, filter_dimension_info, [])])

        while queue:
            current_dict, remaining_dims, filter_conditions = queue.popleft()

            if not remaining_dims:
                continue

            current_dimension = remaining_dims[0]
            current_key = current_dimension["data_key"]
            current_values = current_dimension["value"]
            next_dimensions = remaining_dims[1:]

            # 如果是最后一层，填充metrics
            if not next_dimensions:
                for val in current_values:
                    # 构建完整的过滤条件
                    full_conditions = filter_conditions + [(current_key, val)]

                    # 应用所有过滤条件
                    filtered_df = df
                    for dim_key, dim_val in full_conditions:
                        if dim_key in filtered_df.columns:
                            filtered_df = filtered_df[filtered_df[dim_key] == dim_val]

                    if filtered_df.empty:
                        continue

                    # 检查在此过滤条件下哪些指标有效
                    available_metrics = []
                    for metric_key in valid_metric_keys:
                        if (
                            metric_key in filtered_df.columns
                            and filtered_df[metric_key].notna().any()
                            and (filtered_df[metric_key].fillna(0) != 0).any()
                        ):
                            available_metrics.append(metric_key)

                    if available_metrics:
                        current_dict[val] = available_metrics
            else:
                # 不是最后一层，继续处理下一层
                for val in current_values:
                    # 构建完整的过滤条件用于验证数据是否存在
                    full_conditions = filter_conditions + [(current_key, val)]

                    # 检查在此条件下是否有数据
                    filtered_df = df
                    for dim_key, dim_val in full_conditions:
                        if dim_key in filtered_df.columns:
                            filtered_df = filtered_df[filtered_df[dim_key] == dim_val]

                    if filtered_df.empty:
                        continue

                    # 初始化下一层dict
                    if val not in current_dict:
                        current_dict[val] = {}

                    # 将下一层处理任务加入队列
                    queue.append((current_dict[val], next_dimensions, full_conditions))

    @staticmethod
    def _add_granularity_to_data_and_dimensions(
        data: List[Dict[str, Any]],
        dimension_info: List[Dict[str, Any]],
        granularity: Optional[str],
        language: str,
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        """向数据和维度信息中添加时间粒度"""
        if granularity:
            for item in data:
                item["granularity"] = granularity

            display_name = GranularityConfig.get_display_name(granularity, language)
            dimension_info.append(
                {
                    "name": display_name,
                    "data_key": "granularity",
                    "value": [granularity],
                }
            )

        return data, dimension_info

    @staticmethod
    def transform_read_data(
        raw_data: List[Dict[str, Any]],
        chart_params: Dict[str, Any],
        original_query_dict: Dict[str, Any],
    ) -> Dict[str, Any]:
        """转换指标数据为前端格式"""
        # 获取语言设置
        language = chart_params.get("language", "English")

        # 转换为DataFrame并验证
        df = pd.DataFrame(raw_data)
        if df.empty:
            return {"code": 1, "msg": "error", "data": {"error": "No data found"}}

        # 处理特殊情况
        if len(df) == 1 or original_query_dict.get("ungrouped"):
            # 清理字符串字段中的null值
            df = DataTransformer._clean_string_null_values(df)
            data = DataTransformer._convert_nan_to_none(df)
            # 清理全为null的指标
            data, _ = DataTransformer._clean_null_metrics_from_data(
                data, original_query_dict
            )
            return {"code": 2, "data": data}

        # 获取时间粒度
        time_dimensions_in_query = original_query_dict.get("timeDimensions", [])
        granularity = DataTransformer._get_granularity(time_dimensions_in_query)

        # 预处理DataFrame
        df = DataTransformer._preprocess_dataframe(df, granularity)

        # 清理字符串字段中的null值
        df = DataTransformer._clean_string_null_values(df)

        # 提取图例
        raw_legends = DataTransformer._extract_legends(chart_params)

        # 构建维度信息
        dimension_info = DataTransformer._build_dimension_info(
            df, original_query_dict, language, granularity
        )

        # 清理数据
        df, dimension_info = DataTransformer._clean_game_id(df, dimension_info)
        df, metrics_info = DataTransformer._clean_empty_metrics(
            df, []
        )  # 先传空列表，后面重新构建

        # 确定X轴
        xAxis = DataTransformer._determine_xaxis(
            df, chart_params, dimension_info, granularity
        )
        xaxis_date_key = xAxis[0].get("date_key") if xAxis else None

        # 处理图例
        final_legends = DataTransformer._process_legends(
            raw_legends, dimension_info, xaxis_date_key
        )

        # 确定图表类型
        recommended_chart_type = DataTransformer._determine_chart_type(df, xAxis)
        
        # 转换数据并添加时间粒度
        data = DataTransformer._convert_nan_to_none(df)
        # data, dimension_info = DataTransformer._add_granularity_to_data_and_dimensions(
        #     data, dimension_info, granularity, language
        # )
        
        # 清理全为null的指标
        data, original_query_dict = DataTransformer._clean_null_metrics_from_data(data, original_query_dict)
        
        # 重新构建指标信息（因为可能删除了一些指标）
        metrics_info = DataTransformer._build_metrics_info(df, original_query_dict, final_legends, language)
        if not metrics_info:
            return {"code": 1, "msg": "error", "data": {"error": "所有指标数据都为空，无法生成图表"}}

        # 构建过滤器信息
        filter_info = DataTransformer._build_filter_info(
            df, dimension_info, metrics_info, final_legends, xaxis_date_key
        )

        # 简化图例（如果需要）
        # data, dimension_info = DataTransformer._simplify_legends_if_needed(df, final_legends, data, dimension_info, language, original_query_dict)

        # 构建响应数据
        response_data = {
            "version": "2.0",
            "xAxis": xAxis,
            "yAxis": ["value"],
            "legends": final_legends,
            "chat_type": recommended_chart_type,
            "metrics_info": metrics_info,
            "dimension_info": dimension_info,
            "filter_info": filter_info,
            "data": data
        }

        return {"code": 0, "msg": "ok", "data": response_data}

    @staticmethod
    def transform_error(error_message: str, original_query: Any = None) -> Dict[str, Any]:
        """转换错误信息为前端格式"""
        error_details = {
            "message": error_message,
            "timestamp": datetime.now().isoformat() + "Z",
        }
        if original_query:
            error_details["original_query"] = original_query
        
        #错误码为-1
        return {"code": -1, "msg": "error", "data": {"error": error_details}}
