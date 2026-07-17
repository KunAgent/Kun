"""
DataFrameSampler 采样方式说明：

1. head_tail（首尾+均匀采样）
   - 原理：保留前 head_tail_count 行和后 head_tail_count 行，其余部分在中间均匀采样，最终总行数为 keep_count。
   - 适用场景：需要兼顾数据的头部、尾部和整体分布时，数据有明显顺序（如时间序列、日志等）。
   - 优点：能看到数据的“首”“尾”极端情况，中间部分均匀采样，代表性较好，适合展示和摘要。
   - 缺点：如果数据有分组/类别，可能导致小类丢失，均匀采样不保证分布与原数据完全一致。
"""

import pandas as pd
import numpy as np
import os
import warnings
from loguru import logger
import matplotlib
# 设置matplotlib支持中文
matplotlib.rcParams['font.sans-serif'] = ['SimHei', 'Arial Unicode MS', 'DejaVu Sans']
matplotlib.rcParams['axes.unicode_minus'] = False
# 忽略字体缺失相关warning
warnings.filterwarnings("ignore", message="Glyph.*missing from font")

class DataFrameSampler:
    def __init__(self, df: pd.DataFrame):
        # 自动将空字符串设置为NA，并推断类型
        self.df = df.replace("", np.nan)
        self.df = self.df.infer_objects(copy=False)
        numeric_cols = self.df.select_dtypes(include='number').columns.tolist()
        orig_len = len(self.df)
        if numeric_cols:
            self.df = self.df.dropna(subset=numeric_cols, how='all')
        # 保留float类型最多4位小数
        float_cols = self.df.select_dtypes(include='float').columns.tolist()
        if float_cols:
            self.df[float_cols] = self.df[float_cols].round(4)
        logger.info(f"[init] 删除所有数值都为空的行: {orig_len} -> {len(self.df)}")

    def _exclude_peak_valley_idx(self, df, peak_valley_cols, peak_count, valley_count):
        # 统一处理peak_valley_cols为list，None时默认所有数值列
        if peak_valley_cols is None:
            peak_valley_cols = df.select_dtypes(include='number').columns.tolist()
        if isinstance(peak_valley_cols, str):
            peak_valley_cols = [peak_valley_cols]
        exclude_idx = set()
        for col in peak_valley_cols:
            if peak_count > 0:
                exclude_idx |= set(df.nlargest(peak_count, col).index)
            if valley_count > 0:
                exclude_idx |= set(df.nsmallest(valley_count, col).index)
        return exclude_idx, peak_valley_cols

    def _add_peak_valley(self, df, sampled, peak_valley_cols=None, peak_count=0, valley_count=0, expected_count=None):
        exclude_idx, peak_valley_cols = self._exclude_peak_valley_idx(df, peak_valley_cols, peak_count, valley_count)
        if not peak_valley_cols or (peak_count == 0 and valley_count == 0):
            # 保证顺序
            if not sampled.empty:
                result = sampled.loc[df.index.intersection(sampled.index)]
                if expected_count is not None:
                    result = result.iloc[:expected_count]
                return result
            return sampled
        peaks_valleys = df.loc[list(exclude_idx)] if exclude_idx else pd.DataFrame(columns=df.columns)
        result = pd.concat([peaks_valleys, sampled])
        result = result.drop_duplicates()
        # 保证顺序
        result = result.loc[df.index.intersection(result.index)]
        # 截断，保证采样数量不超过expected_count
        if expected_count is not None:
            result = result.iloc[:expected_count]
        return result

    def _auto_plot(self, sampled, cols=None, output_dir="output_sampling", show_in_notebook=None, method_name="head_tail"):
        try:
            import matplotlib.pyplot as plt
            import seaborn as sns
            from plot_sampling_compare import plot_sampling_compare
        except Exception:
            return  # 没有可视化库则跳过
        # 检测是否在notebook环境
        def _in_notebook():
            try:
                from IPython import get_ipython
                shell = get_ipython().__class__.__name__
                if shell in ('ZMQInteractiveShell', 'Shell'):  # Jupyter notebook or qtconsole
                    return True
            except Exception:
                pass
            return False
        if show_in_notebook is None:
            show_in_notebook = _in_notebook()
        df = self.df
        if cols is None:
            cols = df.select_dtypes(include='number').columns.tolist()
        output_dir = os.path.join(output_dir, method_name)
        os.makedirs(output_dir, exist_ok=True)
        img_paths = []
        for col in cols:
            for kind in ['line', 'hist']:
                plt.figure(figsize=(12, 5))
                plot_sampling_compare(df, sampled, col, kind=kind)
                img_path = os.path.join(output_dir, f"{col}_{kind}_compare.png")
                plt.savefig(img_path)
                img_paths.append(img_path)
                if show_in_notebook:
                    try:
                        from IPython.display import display, Image
                        display(Image(filename=img_path))
                    except Exception:
                        pass
                plt.close()
        if img_paths:
            print(f"采样可视化图片已保存（{method_name}）：")
            for p in img_paths:
                print(p)

    def head_tail(self, group_by_fields, keep_count=2000, head_tail_count=7, peak_valley_count=3, metrics=None, auto_plot=False):
        """
        支持分组和多指标的首尾+波峰波谷+均匀采样，最终全局最多keep_count行
        group_by_fields: 分组字段（str或list），必填
        metrics: 需要采样的数值列（str或list），可为None则自动检测所有数值列
        head_tail_count: 首部和尾部分别保留多少行（每组每指标）
        peak_valley_count: 波峰和波谷各保留多少行（每组每指标）
        keep_count: 返回的总采样行数上限
        """
        import time
        start_time = time.time()
        
        if not group_by_fields:
            raise ValueError("group_by_fields 不能为空，必须指定分组字段！")
        df = self.df
        # 如果keep_count大于df长度，直接返回全量数据
        if keep_count >= len(df):
            result = df.copy()
            orig_cols = list(df.columns)
            result = result[orig_cols]
            end_time = time.time()
            elapsed_time = (end_time - start_time) * 1000  # 转换为毫秒
            logger.info(f"[head_tail] 采样完成（返回全量数据），耗时: {elapsed_time:.2f}ms，数据量: {len(df)} -> {len(result)}")
            return result.reset_index(drop=True)
        from scipy.signal import find_peaks
        if not metrics:
            metrics = df.select_dtypes(include='number').columns.tolist()
        if isinstance(metrics, str):
            metrics = [metrics]
        if isinstance(group_by_fields, str):
            group_by_fields = [group_by_fields]
        # 检查分组字段是否都存在
        missing_fields = [f for f in group_by_fields if f not in df.columns]
        if missing_fields:
            logger.warning(f"group_by_fields中以下字段不存在，将被自动忽略: {missing_fields}")
            group_by_fields = [f for f in group_by_fields if f in df.columns]
        if not group_by_fields:
            raise ValueError("group_by_fields 经过过滤后为空，无法分组采样！")
        # 采样index及类型收集
        sample_records = []  # (index, type, group_key, metric)
        grouped = df.groupby(group_by_fields)
        for group_key, group_df in grouped:
            for metric in metrics:
                col_df = group_df[[metric]].dropna()
                if col_df.empty:
                    continue
                metric_count = len(col_df)
                n = head_tail_count
                m = peak_valley_count
                # 首
                head_idx = col_df.iloc[:n].index.tolist()
                for idx in head_idx:
                    sample_records.append((idx, 'head', group_key, metric))
                # 尾
                tail_idx = col_df.iloc[-n:].index.tolist()
                for idx in tail_idx:
                    sample_records.append((idx, 'tail', group_key, metric))
                # 波峰
                peaks, _ = find_peaks(col_df[metric].values)
                peak_idx = col_df.iloc[peaks].nlargest(m, metric).index.tolist() if len(peaks) > 0 else []
                for idx in peak_idx:
                    sample_records.append((idx, 'peak', group_key, metric))
                # 波谷
                valleys, _ = find_peaks(-col_df[metric].values)
                valley_idx = col_df.iloc[valleys].nsmallest(m, metric).index.tolist() if len(valleys) > 0 else []
                for idx in valley_idx:
                    sample_records.append((idx, 'valley', group_key, metric))
                # 均匀采样
                priority_idx = set(head_idx + tail_idx + peak_idx + valley_idx)
                rest_keep = metric_count - len(priority_idx)
                if rest_keep > 0:
                    mid_df = col_df.drop(index=priority_idx)
                    if not mid_df.empty:
                        # 均匀采样数量按剩余未采样数量
                        sample_n = min(rest_keep, max(0, keep_count - len(priority_idx)))
                        if sample_n > 0:
                            step = len(mid_df) / sample_n
                            sampled_idx = [int(i * step) for i in range(sample_n)]
                            even_idx = mid_df.iloc[sampled_idx].index.tolist()
                            for idx in even_idx:
                                sample_records.append((idx, 'even', group_key, metric))
        # 合并所有采样，按优先级全局去重、排序、截断
        if not sample_records:
            return pd.DataFrame()
        sample_df = pd.DataFrame(sample_records, columns=['index', 'type', 'group_key', 'metric'])
        # 优先级排序
        type_priority = {'head': 0, 'tail': 1, 'peak': 2, 'valley': 3, 'even': 4}
        sample_df['priority'] = sample_df['type'].map(type_priority)
        # 保证原始顺序
        sample_df['orig_order'] = sample_df['index'].map(lambda x: df.index.get_loc(x) if x in df.index else -1)
        sample_df = sample_df.sort_values(['priority', 'orig_order'])
        # 全局去重
        sample_df = sample_df.drop_duplicates('index', keep='first')
        # 截断
        sample_df = sample_df.iloc[:keep_count]
        # 取最终数据
        final_idx = sample_df['index'].tolist()
        result = df.loc[final_idx]
        # 保证列顺序和原始df一致，采样标签列放最后
        orig_cols = list(df.columns)
        result = result[orig_cols]
        if auto_plot and not result.empty:
            # 只对每个metric画一次采样对比图，采样对比用原始df和全局采样结果
            for metric in metrics:
                if metric in result.columns:
                    self._auto_plot(result, cols=[metric], method_name=f"head_tail_{metric}")
        
        end_time = time.time()
        elapsed_time = (end_time - start_time) * 1000  # 转换为毫秒
        logger.info(f"[head_tail] 采样完成，耗时: {elapsed_time:.2f}ms，数据量: {len(df)} -> {len(result)}")
        return result.reset_index(drop=True)

    def sample(self, method="head_tail", auto_plot=True, **kwargs):
        """
        通用采样入口，仅支持head_tail
        其余参数传递给head_tail方法
        支持peak_valley_cols, peak_count, valley_count参数
        """
        kwargs['auto_plot'] = auto_plot
        if method == "head_tail":
            return self.head_tail(**kwargs)
        else:
            raise ValueError(f"不支持的采样方法: {method}")

if __name__ == "__main__":
    import pandas as pd
    import os
    base_dir = os.path.dirname(os.path.abspath(__file__))
    json_path = os.path.join(base_dir, '../tests/large_data_set.json')
    df = pd.read_json(json_path, orient='records', lines=False)
    sampler = DataFrameSampler(df)
    keep_count = 400
    print("\n--- head_tail ---")
    sampled_df = sampler.head_tail(keep_count=keep_count, head_tail_count=5, group_by_fields=["game_name", "market_name", "granularity", "source", "game_type"], auto_plot=False)
    print(sampled_df)
    # 保存采样结果
    output_path = os.path.join(base_dir, "output_sampling", "head_tail_sampled.csv")
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    sampled_df.to_csv(output_path, index=False)
    print(f"采样结果已保存到: {output_path}")
    print("\n--- 通用入口 ---")
    # print(sampler.sample(method='head_tail', keep_count=keep_count, head_tail_count=5,
    #                      group_by_fields=["game_name", "market_name", "granularity", "source", "game_type"]))
