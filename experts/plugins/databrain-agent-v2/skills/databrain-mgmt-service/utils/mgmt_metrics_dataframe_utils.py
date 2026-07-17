from __future__ import annotations

import csv
import io
import json

import numpy as np
import pandas as pd
from loguru import logger

from utils.df_analyzer import DataFrameAnalyzer
from utils.df_sampler import DataFrameSampler
from utils.mgmt_metrics_formatters import format_describe_data

# Do not split describe / head_tail groups by upsample provenance; same requested granularity aggregates together.
_DESCRIBE_GROUP_BY_IGNORE = frozenset({"original_granularity"})

# Aggregation functions that mgmt business never wants in describe output, regardless of caller intent.
# `mean` is dropped because mgmt metrics are typically gross/cumulative values where the average across
# a group has no meaningful business interpretation; only min/max/sum are surfaced.
_DESCRIBE_AGG_DENYLIST = frozenset({"mean"})

# Default aggregation set when caller doesn't specify; mirrors `DataFrameAnalyzer.describe`'s built-in
# default (mean/min/max/sum) minus anything in the denylist.
_DESCRIBE_AGG_DEFAULT: tuple[str, ...] = ("min", "max", "sum")


def _resolve_agg_functions(requested):
    """Filter out mgmt-disallowed aggregations (e.g. `mean`) regardless of who asked for them.

    - `requested is None` -> use `_DESCRIBE_AGG_DEFAULT` (already excludes denylisted ones).
    - `requested` is a list -> drop any entry whose lowercased name is in `_DESCRIBE_AGG_DENYLIST`.
    - If after filtering nothing remains, fall back to `_DESCRIBE_AGG_DEFAULT` so describe still runs.
    """
    if requested is None:
        return list(_DESCRIBE_AGG_DEFAULT)
    try:
        filtered = [f for f in requested if str(f).strip().lower() not in _DESCRIBE_AGG_DENYLIST]
    except TypeError:
        # Non-iterable -> treat as "no preference"
        return list(_DESCRIBE_AGG_DEFAULT)
    return filtered or list(_DESCRIBE_AGG_DEFAULT)


def process_dataframe(df, metrics, max_length=2000, **kwargs):
    """
    处理DataFrame：生成描述性统计，如果数据过长则进行采样

    monthly和yearly都不按date分组，所有数据会聚合在一起进行统计分析。
    这样可以对数据中所有的metric列（包括用户查询的metric及其相关的衍生指标）分别做聚合分析。
    """
    try:
        # Filter out rows where all metric columns are NaN (similar to DataFrameSampler)
        if metrics:
            metric_cols = [col for col in metrics if col in df.columns]
            if metric_cols:
                original_len = len(df)
                df = df.dropna(subset=metric_cols, how="all")
                if len(df) < original_len:
                    logger.info(f"(process_dataframe) 删除了 {original_len - len(df)} 行所有指标都为空的数据")

        # 识别需要排除的列：所有数值列（metrics）和时间相关列
        # monthly和yearly都不按date分组，让所有数据聚合在一起
        numeric_cols = set(df.select_dtypes(include=[np.number]).columns)
        time_cols = {col for col in df.columns if any(keyword in col.lower() for keyword in ["date", "time"])}
        exclude_cols = numeric_cols | time_cols

        def _is_nullish_series(s: pd.Series) -> pd.Series:
            try:
                if s is None:
                    return pd.Series([True] * len(df), index=df.index)
                if pd.api.types.is_numeric_dtype(s):
                    return s.isna()
                # Treat empty/"null"/"none" strings as nullish for object columns
                ss = s.astype(str).str.strip()
                return s.isna() | (ss == "") | (ss.str.lower() == "null") | (ss.str.lower() == "none")
            except Exception:
                try:
                    return s.isna()
                except Exception:
                    return pd.Series([False] * len(df), index=df.index)

        def _compute_actual_time_range(
            df_part: pd.DataFrame,
            *,
            time_col: str,
            metric_cols: list[str],
        ) -> tuple[str, str]:
            """
            Compute "actual" [start, end] after trimming head/tail consecutive nulls.
            Internal nulls are ignored.
            """
            if df_part is None or len(df_part) == 0:
                return "", ""
            if not time_col or time_col not in df_part.columns:
                return "", ""
            if not metric_cols:
                return "", ""

            try:
                dfx = df_part.copy()
                # Keep stable order by time column
                dfx["_time_key__"] = dfx[time_col].astype(str)
                dfx = dfx.sort_values("_time_key__", kind="mergesort")
                has_value = pd.Series([False] * len(dfx), index=dfx.index)
                for c in metric_cols:
                    if c not in dfx.columns:
                        continue
                    nullish = _is_nullish_series(dfx[c])
                    has_value = has_value | (~nullish)
                if not has_value.any():
                    return "", ""
                idx = has_value[has_value].index
                start_idx = idx[0]
                end_idx = idx[-1]
                start = str(dfx.loc[start_idx, "_time_key__"] or "").strip()
                end = str(dfx.loc[end_idx, "_time_key__"] or "").strip()
                return start, end
            except Exception:
                return "", ""

        def _strip_min_max_when_resampled_from_coarser_granularity(grouped_json: str) -> str:
            """
            When rows were upsampled (e.g. yearly -> monthly), original_granularity is set.
            Min/max across synthetic sub-periods are misleading; drop those stats (and at-time keys).
            """
            if not grouped_json or not isinstance(grouped_json, str):
                return grouped_json or ""
            try:
                payload = json.loads(grouped_json)
            except Exception:
                return grouped_json
            if not isinstance(payload, list) or not payload:
                return grouped_json
            for item in payload:
                if not isinstance(item, dict):
                    continue
                orig = str(item.get("original_granularity") or "").strip()
                if not orig:
                    continue
                drop_keys: list[str] = []
                for k in list(item.keys()):
                    if not isinstance(k, str):
                        continue
                    if k.endswith("_min_at_time") or k.endswith("_max_at_time"):
                        drop_keys.append(k)
                    elif k.endswith("_min"):
                        drop_keys.append(k)
                    elif k.endswith("_max"):
                        drop_keys.append(k)
                for k in drop_keys:
                    item.pop(k, None)
            try:
                return json.dumps(payload, ensure_ascii=False)
            except Exception:
                return grouped_json

        def _decorate_describe_with_time_range(grouped_json: str, *, time_col: str, group_by_fields: list[str]) -> str:
            """
            Add `actual_start_time` / `actual_end_time` / `actual_time_range` and `granularity_key`
            into each describe dict item, where time range trims head/tail nulls.
            """
            if not grouped_json or not isinstance(grouped_json, str):
                return grouped_json or ""
            try:
                payload = json.loads(grouped_json)
            except Exception:
                return grouped_json
            if not isinstance(payload, list) or not payload:
                return grouped_json

            metric_cols = [col for col in (metrics or []) if col in df.columns]
            if not time_col or time_col not in df.columns or not metric_cols:
                return grouped_json

            def _normalize_time_label(granularity: str, t: str) -> str:
                """
                Normalize time label for display based on effective granularity.
                - yearly: prefer 'YYYY' if backend returns 'YYYY-12'
                - monthly: keep 'YYYY-MM'
                """
                tt = str(t or "").strip()
                if not tt:
                    return ""
                g = str(granularity or "").strip().lower()
                if g == "yearly":
                    # common backend encoding: year-end month
                    if len(tt) == 7 and tt[4] == "-" and tt.endswith("-12"):
                        y = tt[:4]
                        if y.isdigit():
                            return y
                return tt

            for item in payload:
                if not isinstance(item, dict):
                    continue

                # Filter df by group_by_fields values in this describe item
                dfg = df
                try:
                    for f in group_by_fields or []:
                        if f not in dfg.columns:
                            continue
                        v = item.get(f)
                        if v is None or (isinstance(v, float) and np.isnan(v)):
                            dfg = dfg[dfg[f].isna()]
                        else:
                            dfg = dfg[dfg[f] == v]
                except Exception:
                    dfg = df

                start, end = _compute_actual_time_range(dfg, time_col=time_col, metric_cols=metric_cols)
                try:
                    requested_gran = str(item.get("granularity") or "").strip() or "unknown"
                    # Description / time labels follow requested granularity only (not original_granularity).
                    if start and end:
                        ns = _normalize_time_label(requested_gran, start)
                        ne = _normalize_time_label(requested_gran, end)
                    else:
                        ns, ne = "", ""

                    if ns and ne:
                        item["actual_start_time"] = ns
                        item["actual_end_time"] = ne
                        item["actual_time_range"] = f"{ns}~{ne}"

                    item["effective_granularity"] = requested_gran

                    base = requested_gran
                    if ns and ne:
                        base = f"{base}|{ns}~{ne}"
                    # Include other group-by dimensions to avoid accidental de-dup drops
                    for f in group_by_fields or []:
                        if f in ["granularity", "original_granularity", "effective_granularity"]:
                            continue
                        if f in item:
                            base = f"{base}|{f}={str(item.get(f))}"
                    item["granularity_key"] = base
                except Exception:
                    pass

            try:
                return json.dumps(payload, ensure_ascii=False)
            except Exception:
                return grouped_json

        # 检查是否只有一个时间点的数据：只有一个唯一时间值时，跳过describe data
        grouped_str = ""
        metric_by_code = kwargs.get("metric_by_code") or {}
        unsupported_by_name = kwargs.get("unsupported_aggregation_by_name") or {}
        if not isinstance(unsupported_by_name, dict) or not unsupported_by_name:
            unsupported_by_name = {}
            if isinstance(metric_by_code, dict) and metric_by_code:
                for k, v in metric_by_code.items():
                    if not isinstance(v, dict):
                        continue
                    unsupported = v.get("unsupported_aggregation")
                    if not (isinstance(unsupported, list) and unsupported):
                        continue
                    s = set(unsupported)
                    unsupported_by_name[str(k)] = s
                    metric_name = v.get("metric_name")
                    if isinstance(metric_name, str) and metric_name.strip():
                        unsupported_by_name[metric_name.strip()] = s
        requested_granularity = str(kwargs.get("granularity") or "").strip().lower()
        if time_cols and len(df) > 0:
            time_col = list(time_cols)[0]
            try:
                unique_time_values = df[time_col].nunique()
            except Exception:
                unique_time_values = None
            if unique_time_values is not None and unique_time_values <= 1 and requested_granularity != "yearly":
                logger.info("(process_dataframe) 只有一个时间点的数据，跳过describe data")
            else:
                # group_by_fields: 排除所有metric列和时间列；忽略 original_granularity（与 granularity 一起聚合）
                group_by_fields = [
                    col for col in df.columns if col not in exclude_cols and col not in _DESCRIBE_GROUP_BY_IGNORE
                ]
                grouped = DataFrameAnalyzer(df)
                grouped_str = grouped.describe(
                    group_by_fields=group_by_fields,
                    agg_functions=_resolve_agg_functions(kwargs.get("agg_functions")),
                    system="mgmt",
                    unsupported_aggregation_by_name=unsupported_by_name,
                )
                grouped_str = _strip_min_max_when_resampled_from_coarser_granularity(grouped_str)
                grouped_str = _decorate_describe_with_time_range(grouped_str, time_col=time_col, group_by_fields=group_by_fields)
        else:
            # 无时间列，正常describe
            group_by_fields = [
                col for col in df.columns if col not in exclude_cols and col not in _DESCRIBE_GROUP_BY_IGNORE
            ]
            grouped = DataFrameAnalyzer(df)
            grouped_str = grouped.describe(
                group_by_fields=group_by_fields,
                agg_functions=_resolve_agg_functions(kwargs.get("agg_functions")),
                system="mgmt",
                unsupported_aggregation_by_name=unsupported_by_name,
            )
            grouped_str = _strip_min_max_when_resampled_from_coarser_granularity(grouped_str)

        # Format describe output numbers: percent -> 'xx.xx%', numerical -> integer,
        # float/unknown -> 2 decimals (万/亿 or K/M/G), based on language and value_type.
        if grouped_str:
            grouped_str = format_describe_data(
                grouped_str,
                language=kwargs.get("language"),
                percent_metrics=kwargs.get("percent_metrics"),
                digits=2,
                metric_by_code=metric_by_code,
            )

        if len(df) <= max_length:
            return df, grouped_str

        sampler = DataFrameSampler(df)
        sampled_df = sampler.head_tail(
            group_by_fields=group_by_fields,
            keep_count=max_length,
            head_tail_count=7,
            peak_valley_count=3,
            metrics=None,
            auto_plot=False,
        )
        return sampled_df, grouped_str
    except Exception as e:
        logger.warning(f"(process_dataframe)处理df失败, 使用原始数据: {e}")
        return df, ""


def json_to_csv_string(json_data, metrics=None, **kwargs):
    """
    将 JSON 列表转换为 CSV 格式的字符串，并处理DataFrame（采样和描述性统计）
    :return: (CSV 内容字符串, 描述性统计字符串)
    """
    if not json_data or not isinstance(json_data, list):
        return "", ""

    try:
        df = pd.DataFrame(json_data)
        if metrics:
            df, description_str = process_dataframe(df, metrics, **kwargs)
        else:
            description_str = ""
        csv_string = df.to_csv(index=False)
        return csv_string, description_str
    except Exception as e:
        logger.warning(f"(json_to_csv_string)转换失败: {e}")
        output = io.StringIO()
        try:
            headers = list(json_data[0].keys())
            writer = csv.DictWriter(output, fieldnames=headers, lineterminator="\n")
            writer.writeheader()
            writer.writerows(json_data)
            csv_string = output.getvalue()
            return csv_string, ""
        except Exception as e2:
            return f"Error: {str(e2)}", ""
        finally:
            output.close()


def rename_csv_headers_robust(csv_string: str, rename_dict: dict) -> str:
    """使用 csv 模块安全地替换 CSV 字符串的列名"""
    if not csv_string:
        return csv_string

    f_in = io.StringIO(csv_string.strip())
    reader = csv.reader(f_in)
    rows = list(reader)
    if not rows:
        return csv_string

    headers = rows[0]
    rows[0] = [rename_dict.get(header, header) for header in headers]

    f_out = io.StringIO()
    writer = csv.writer(f_out)
    writer.writerows(rows)
    return f_out.getvalue().strip()


def count_valid_res(raw_data):
    try:
        # 1. 解析 JSON
        metrics_info = raw_data.get("metrics_info", [])
        data_list = raw_data.get("data", [])

        if not metrics_info or not data_list:
            return 0

        # 2. 提取指标 key，并初始化每个指标的有效计数器
        metric_keys = [item["data_key"] for item in metrics_info]
        # metric_counts 格式: {"gross_revenue_kpi": 0, "gross_revenue_actual": 0, ...}
        metric_counts = {key: 0 for key in metric_keys}

        # 3. 遍历数据行
        valid_count = 0
        for entry in data_list:
            is_valid = False
            for key in metric_keys:
                value = entry.get(key, 0)
                # 判断逻辑：值不为 None，且不等于 0 (包括 0 和 0.0)
                if value is not None and value != 0:
                    is_valid = True
                    metric_counts[key] += 1

            # 如果这一行中至少有一个指标是非0的，则计入有效行数
            if is_valid:
                valid_count += 1

        # 4. 核心逻辑优化：检查是否每一个指标的有效结果数量都 >= 2
        for key in metric_keys:
            if metric_counts[key] < 2:
                # 只要有一个指标的有效数据少于2条，整体判定为无效
                logger.info(f"指标 [{key}] 有效值数量仅为 {metric_counts[key]}，未达标。")
                return 0

        # 5. 如果所有指标都通过了检查，返回有效行数
        return valid_count
    except Exception as e:
        logger.warning(f"(count_valid_res) 解析错误: {e}")
        return 0


def merge_csv_data(a: str, b: str) -> str:
    a = (a or "").strip()
    b = (b or "").strip()
    if not a:
        return b
    if not b:
        return a
    try:
        df_a = pd.read_csv(io.StringIO(a))
        df_b = pd.read_csv(io.StringIO(b))
        cols = list(df_a.columns)
        for c in df_b.columns:
            if c not in cols:
                cols.append(c)
        df_a = df_a.reindex(columns=cols)
        df_b = df_b.reindex(columns=cols)
        df = pd.concat([df_a, df_b], ignore_index=True)
        return df.to_csv(index=False).strip()
    except Exception:
        return f"{a}\n{b}"

