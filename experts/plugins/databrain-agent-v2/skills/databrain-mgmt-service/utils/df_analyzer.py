from __future__ import annotations
import pandas as pd
import numpy as np
import traceback
import json
from loguru import logger
from typing import Any, Dict, List, Optional, Union, Tuple, Set
DASHBOARD_METRIC_AGGREGATION_BY_NAME = {}
from utils.metric_aggregation_config import get_aggregation_functions_for_metric
from utils.databrain_api import DASHBOARD_METRIC_API, async_send_request_with_token
class DataFrameAnalyzer:
    def __init__(self, df: pd.DataFrame):
        self.df = df


    def describe(
        self,
        group_by_fields: Optional[Union[str, List[str]]] = None,
        agg_functions: Optional[List[str]] = None,
        system: str = "",
        cal_max_at_time: bool = True,
        sort_by_metric_value: Optional[str] = None,
        unsupported_aggregation_by_name: Optional[Dict[str, Set[str]]] = None,
    ) -> str:
        """
        获取DataFrame的描述性统计数据
        """
        # TODO: 重构 describe 方法，使其更清晰、更易于维护
        import time
        start_time = time.time()

        df = self.df
        if agg_functions is None:
            agg_functions = ['mean', 'min', 'max', 'sum']
        if not isinstance(df, pd.DataFrame):
            logger.error(f"输入参数df不是DataFrame，实际类型: {type(df)}")
            return "[]"  # 返回空JSON数组，保持返回类型一致

        # 预处理：将空字符串替换为NA，并尝试类型自动转换（不会把非数值列强转成数字）
        df = df.replace("", np.nan)
        df = df.apply(pd.to_numeric, errors='ignore')
        if df.empty:
            logger.warning("输入的DataFrame为空")
            return "[]"  # 返回空JSON数组，保持返回类型一致

        # 解析分组字段
        if group_by_fields is None:
            group_by_fields: List[str] = []
        elif isinstance(group_by_fields, str):
            group_by_fields = [group_by_fields]
        elif isinstance(group_by_fields, tuple):
            group_by_fields = list(group_by_fields)
        else:
            group_by_fields = list(group_by_fields)

        # 校验分组字段是否存在
        if group_by_fields:
            missing_cols = [
                col for col in group_by_fields if col not in df.columns and col != df.index.name]
            if missing_cols:
                logger.warning(
                    f"分组字段不存在: {missing_cols}，DataFrame列: {df.columns.tolist()}，index: {df.index.name}")
                group_by_fields = [
                    col for col in group_by_fields if col not in missing_cols]
                if not group_by_fields:
                    logger.warning(f"所有分组字段都不存在，返回空结果")
                    return "[]"  # 返回空JSON数组，保持返回类型一致
            logger.info(f"按字段 {group_by_fields} 分组进行描述性统计")

        # 防御性预处理：将分组字段中不可 hash 的值（list/dict）转为字符串，避免 groupby 时 unhashable type 错误
        # 注意：排序后再 join，确保 ["iOS","Android"] 和 ["Android","iOS"] 归入同一组
        if group_by_fields:
            for col in group_by_fields:
                if col in df.columns:
                    has_unhashable = df[col].apply(lambda x: isinstance(x, (list, dict))).any()
                    if has_unhashable:
                        logger.info(f"分组字段 {col} 包含不可hash类型值(list/dict)，转换为字符串")
                        df[col] = df[col].apply(
                            lambda x: " | ".join(str(i) for i in sorted(x, key=str)) if isinstance(x, list)
                            else json.dumps(x, ensure_ascii=False, sort_keys=True) if isinstance(x, dict)
                            else x
                        )

        # 取数值列
        numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
        if not numeric_cols:
            logger.warning("无数值列可聚合")
            return "[]"  # 返回空JSON数组，保持返回类型一致
        
        # 记录每列的原始数据类型，用于聚合后恢复类型
        original_dtypes = {col: df[col].dtype for col in numeric_cols}

        # 时间列
        time_like_cols = ["date"] if "date" in df.columns else [] if "time" in df.columns else []

        round_digits = 2
        disallow_sum_metrics = ["ampere_new_mau", "ampere_new_dau", "dau_daily", "dau_weekly", "dau_monthly", "ampere_mau", "ampere_dau"]
        force_max_metrics = ["pcu", "est_cumulative_revenue", "est_cumulative_units", "cumulative_revenue", "cumulative_units"]

        # 把百分位请求标准化为 [('25%', 0.25), ...]
        def parse_agg_functions(funcs: List[str]) -> Tuple[List[str], List[Tuple[str, float]]]:
            """解析聚合函数列表，分离常规函数和百分位函数"""
            pct_funcs = []
            base_aggs = []
            for f in funcs:
                if isinstance(f, str) and f.endswith('%') and f[:-1].isdigit():
                    pct = float(f[:-1]) / 100.0
                    pct_funcs.append((f, pct))
                else:
                    base_aggs.append(f)
            return base_aggs, pct_funcs

        # 默认的聚合函数
        default_base_aggs, default_pct_funcs = parse_agg_functions(agg_functions)

        try:
            # 构建每列的聚合函数列表（按规则过滤/覆盖）
            agg_dict: Dict[str, List[Any]] = {}
            # 记录哪些列真的请求了 min/max，用于后面回填时间
            needs_min_at = set()
            needs_max_at = set()

            for col in numeric_cols:
                col_funcs: List[Any] = []

                # 检查是否有配置的聚合函数
                configured_functions = get_aggregation_functions_for_metric(col, agg_functions)
                
                # 如果配置的聚合函数为空列表，跳过该指标的聚合
                if configured_functions == []:
                    logger.info(f"列 {col} 配置的聚合函数为空，跳过聚合")
                    continue
                
                # 如果配置了，使用配置的；否则使用默认的
                if configured_functions != agg_functions:
                    logger.info(f"列 {col} 使用配置的聚合函数: {configured_functions}")
                    base_aggs, pct_funcs = parse_agg_functions(configured_functions)
                else:
                    base_aggs = default_base_aggs.copy()
                    pct_funcs = default_pct_funcs.copy()

                if system == "dashboard" or system == "mgmt":
                    if col == "date" or col == "time":
                        continue
                    if system == "dashboard":
                        unsupported = DASHBOARD_METRIC_AGGREGATION_BY_NAME.get(col, set())
                    else:
                        unsupported = set((unsupported_aggregation_by_name or {}).get(col, set()) or [])
                    for f in base_aggs:
                        f_norm = str(f).strip().lower()
                        if f_norm not in ['count', 'mean', 'std', 'min', 'max', 'sum']:
                            logger.warning(f"不支持的聚合函数(全局): {f}")
                            continue
                        if f_norm in unsupported:
                            logger.info(f"列 {col} 不支持聚合 {f_norm}，已跳过")
                            continue
                        col_funcs.append(f_norm)
                else:
                    # 如果配置了聚合函数，优先使用配置的（配置会覆盖 force_max_metrics）
                    # 如果没有配置但属于 force_max_metrics，则只保留 max
                    if configured_functions == agg_functions and col in force_max_metrics:
                        # 只在没有配置且属于 force_max_metrics 时才强制使用 max
                        col_funcs = ['max']
                    else:
                        # 先放入常规函数，并根据 disallow_sum_metrics 决定是否移除 sum
                        for f in base_aggs:
                            if f == 'sum' and col in disallow_sum_metrics:
                                continue
                            if f in ['count', 'mean', 'std', 'min', 'max', 'sum']:
                                col_funcs.append(f)
                            else:
                                logger.warning(f"不支持的聚合函数: {f}")

                        # 再追加百分位函数
                        for name, p in pct_funcs:
                            def _q(x, p=p):  # bind p
                                return x.quantile(p)
                            _q.__name__ = name
                            col_funcs.append((name, _q))

                if col_funcs:
                    agg_dict[col] = col_funcs
                    # 记录该列是否包含 min/max
                    if any(str(f).lower() == 'min' for f in col_funcs if isinstance(f, str)):
                        needs_min_at.add(col)
                    if any(str(f).lower() == 'max' for f in col_funcs if isinstance(f, str)):
                        needs_max_at.add(col)

            # 如果没有需要聚合的指标，直接返回空列表
            if not agg_dict:
                logger.info("没有需要聚合的指标，返回空结果")
                return "[]"

            def agg_factory(funcs):
                agg_list = []
                for f in funcs:
                    agg_list.append(f)
                return agg_list

            agg_dict = {k: agg_factory(v) for k, v in agg_dict.items()}
            print(f"agg_dict: {agg_dict}")

            # 执行聚合：无分组也走统一逻辑
            if group_by_fields:
                g = df.groupby(group_by_fields, dropna=False)
                result = g.agg(agg_dict)
            else:
                g = None  # 无分组
                result = (
                    df.assign(__all__=0)
                    .groupby('__all__', dropna=False)
                    .agg(agg_dict)
                    .reset_index(drop=True)
                )

            # 扁平化列名
            if isinstance(result.columns, pd.MultiIndex):
                result.columns = [
                    f"{c[0]}_{c[1] if isinstance(c[1], str) else getattr(c[1], '__name__', 'func')}" for c in result.columns
                ]
            if not isinstance(result, pd.DataFrame):
                result = result.to_frame().T
            
            # 恢复原始数据类型：对于整数类型列，如果聚合函数是sum/max/min/count，保持整数类型
            integer_agg_functions = {'sum', 'max', 'min', 'count'}
            for col in numeric_cols:
                original_dtype = original_dtypes[col]
                # 如果是整数类型
                if pd.api.types.is_integer_dtype(original_dtype):
                    for result_col in result.columns:
                        # 检查是否是该列的聚合结果列（格式：列名_聚合函数）
                        if result_col.startswith(f"{col}_"):
                            # 提取聚合函数名（最后一个下划线后的部分）
                            suffix = result_col[len(col)+1:]  # 去掉 "col_"
                            agg_func = suffix.split('_')[-1].lower() if suffix else ''
                            # 如果是整数友好的聚合函数，尝试转换为整数
                            if agg_func in integer_agg_functions:
                                try:
                                    result[result_col] = result[result_col].fillna(0).astype(original_dtype)
                                except (ValueError, OverflowError):
                                    # 如果转换失败（如有小数），保持浮点数类型
                                    pass

            # 在 min/max 的基础上，补充其发生时刻对应的时间列值
            # 规则：
            # - 只生成 "{col}_min_at_date" 和 "{col}_max_at_date"
            # - 优先使用第一个包含 "date" 或 "time" 的列作为时间来源
            # - 若无匹配列，则字段值为 None
            if cal_max_at_time:
                # 找到第一个含 "date" 或 "time" 的列
                time_cols = [
                    c for c in df.columns if 'date' in c.lower() or 'time' in c.lower()]
                time_col = time_cols[0] if time_cols else None

                def _fill_grouped_min_max_date():
                    for col in numeric_cols:
                        if col in needs_min_at:
                            try:
                                idxmin = df.groupby(group_by_fields, dropna=False)[
                                    col].idxmin()
                            except Exception:
                                idxmin = pd.Series(dtype='float64')
                            s_min = pd.Series(index=idxmin.index, dtype=object)
                            for key, pos in idxmin.items():
                                if pd.isna(pos) or time_col is None:
                                    s_min.loc[key] = None
                                else:
                                    try:
                                        s_min.loc[key] = df.at[pos, time_col] if pos in df.index else None
                                    except Exception:
                                        s_min.loc[key] = None
                            result[f"{col}_min_at_time"] = s_min.values

                        if col in needs_max_at:
                            try:
                                idxmax = df.groupby(group_by_fields, dropna=False)[
                                    col].idxmax()
                            except Exception:
                                idxmax = pd.Series(dtype='float64')
                            s_max = pd.Series(index=idxmax.index, dtype=object)
                            for key, pos in idxmax.items():
                                if pd.isna(pos) or time_col is None:
                                    s_max.loc[key] = None
                                else:
                                    try:
                                        s_max.loc[key] = df.at[pos, time_col] if pos in df.index else None
                                    except Exception:
                                        s_max.loc[key] = None
                            result[f"{col}_max_at_time"] = s_max.values

                def _fill_nongrouped_min_max_date():
                    for col in numeric_cols:
                        if col in needs_min_at:
                            try:
                                i = df[col].idxmin()
                            except Exception:
                                i = None
                            if pd.notna(i) and time_col is not None and i in df.index:
                                result.loc[0, f"{col}_min_at_time"] = df.at[i, time_col]
                            else:
                                result.loc[0, f"{col}_min_at_time"] = None

                        if col in needs_max_at:
                            try:
                                i = df[col].idxmax()
                            except Exception:
                                i = None
                            if pd.notna(i) and time_col is not None and i in df.index:
                                result.loc[0, f"{col}_max_at_time"] = df.at[i, time_col]
                            else:
                                result.loc[0, f"{col}_max_at_time"] = None

                if group_by_fields:
                    _fill_grouped_min_max_date()
                else:
                    _fill_nongrouped_min_max_date()
                    

            logger.debug(f"分组描述性统计结果预览 to frame:\n{result}")

            # 四舍五入（只 round 浮点数，不动时间列）
            float_cols = result.select_dtypes(
                include=['float32', 'float64']).columns
            if round_digits is not None and len(float_cols) > 0:
                result[float_cols] = result[float_cols].round(round_digits)

            # 保证分组键在列里
            if group_by_fields:
                # 给索引命名，避免 reset 后出现默认的 index 列名
                if isinstance(result.index, pd.MultiIndex):
                    # 逐个补齐 MultiIndex 的名字
                    names = list(result.index.names)
                    for i, n in enumerate(names):
                        if n is None:
                            names[i] = group_by_fields[i] if i < len(
                                group_by_fields) else f"group_{i}"
                    result.index.names = names
                else:
                    # 单分组键
                    if result.index.name is None:
                        result.index.name = group_by_fields[0]
                result = result.reset_index()

            elapsed = (time.time() - start_time) * 1000
            logger.info(f"[describe] 完成，耗时 {elapsed:.2f}ms，shape={result.shape}")

            # 当 product==['255'] 且单 metric 且 game_name=='dying light' 时，按 metric 的 sum/mean 排序
            if sort_by_metric_value and group_by_fields:
                sort_col = None
                if f"{sort_by_metric_value}_sum" in result.columns:
                    sort_col = f"{sort_by_metric_value}_sum"
                elif f"{sort_by_metric_value}_mean" in result.columns:
                    sort_col = f"{sort_by_metric_value}_mean"
                if sort_col is not None:
                    try:
                        result = result.sort_values(by=sort_col, ascending=False)
                        logger.info(f"[describe] 按 {sort_col} 降序排序完成")
                    except Exception as sort_e:
                        logger.warning(f"[describe] 排序失败，跳过: {sort_e}")

            # 处理数据类型和精度问题：转换为字典后格式化，保持整数类型，处理浮点数精度
            result_dict = result.to_dict(orient="records")
            if round_digits is not None:
                for record in result_dict:
                    for key, value in list(record.items()):
                        key_lower = str(key).lower()
                        is_at_time_key = key_lower.endswith("_at_time")

                        if pd.isna(value):
                            record[key] = None
                        elif isinstance(value, (float, np.floating)):
                            if is_at_time_key:
                                # *_at_time 是时间刻度（如 202301），展示必须为整数
                                record[key] = int(round(float(value)))
                            elif system == "mgmt":
                                record[key] = round(float(value), 6)
                            else:
                                record[key] = round(float(value), round_digits)
                        elif isinstance(value, (int, np.integer)):
                            # 保持整数类型，转换为Python int（避免numpy类型）
                            record[key] = int(value)
            # filter out keys with value is None
            clean_result_dict = [{k: v for k, v in d.items() if v is not None} for d in result_dict]
            return json.dumps(clean_result_dict, ensure_ascii=False)
        except Exception as e:
            elapsed = (time.time() - start_time) * 1000
            logger.error(
                f"[describe] 数据分析失败，耗时 {elapsed:.2f}ms，错误: {str(e)}，参数: df.shape={getattr(df, 'shape', None)}, group_by_fields={group_by_fields}, agg_functions={agg_functions}")
            logger.error(f"Traceback: {traceback.format_exc()}")
            return ''


if __name__ == "__main__":
    def make_game_market_sample(n=100):
        np.random.seed(42)
        game_names = ['Path of Exile 2', 'Lost Ark', 'Diablo IV', 'Genshin Impact']
        game_types = ['pc/console', 'mobile', 'console']
        sources = ['vginsights', 'mscience', 'ampere']
        market_names = ['全球', '北美', '欧洲', '亚洲']
        granularity = ['daily', 'weekly', 'monthly']
        data = []
        for i in range(n):
            item = {
                "acu": np.random.randint(5000, 15000),
                "date": (pd.Timestamp('2025-07-01') + pd.Timedelta(days=np.random.randint(0, 30))).strftime('%Y-%m-%d'),
                "est_cumulative_revenue": np.random.randint(1e7, 2e8),
                "est_cumulative_units": np.random.randint(1e5, 1e7),
                "est_price": round(np.random.uniform(9.99, 59.99), 2),
                "est_revenue": np.random.randint(10000, 100000),
                "est_units": np.random.randint(100, 5000),
                "game_name": np.random.choice(game_names),
                "game_type": np.random.choice(game_types),
                "granularity": np.random.choice(granularity),
                "lifetime_weighted_price": round(np.random.uniform(9.99, 59.99), 2),
                "market_name": np.random.choice(market_names),
                "pcu": np.random.randint(5000, 20000),
                "playtime": np.random.randint(1000, 10000),
                "source": np.random.choice(sources),
                "weighted_price": round(np.random.uniform(9.99, 59.99), 2),
                "wishlists": np.random.randint(-20000, 20000),
                "wishlists_total": np.random.randint(1e5, 2e6)
            }
            data.append(item)
        df = pd.DataFrame(data)
        return df

    df = make_game_market_sample(100)
    analyzer = DataFrameAnalyzer(df)
    print("\n--- describe ---") # TODO: add group_by_fields as key in the result
    print(analyzer.describe(group_by_fields=['source', 'game_name', 'game_type', 'market_name', 'granularity'])) 