#!/usr/bin/env python3
"""
数据画像生成脚本
快速对 CSV/Excel 数据集生成全面的数据画像统计
"""

import json
import sys
from pathlib import Path

def generate_profile(file_path: str, output_format: str = "json") -> dict:
    """
    生成数据画像报告
    
    Args:
        file_path: 数据文件路径（支持 CSV/Excel）
        output_format: 输出格式（json/markdown）
    
    Returns:
        数据画像字典
    """
    import pandas as pd
    import numpy as np
    
    # 加载数据
    path = Path(file_path)
    if path.suffix.lower() in ['.csv', '.tsv']:
        df = pd.read_csv(file_path)
    elif path.suffix.lower() in ['.xlsx', '.xls']:
        df = pd.read_excel(file_path)
    else:
        raise ValueError(f"不支持的文件格式: {path.suffix}")
    
    # 基本信息
    profile = {
        "overview": {
            "file_name": path.name,
            "rows": len(df),
            "columns": len(df.columns),
            "memory_usage_mb": round(df.memory_usage(deep=True).sum() / 1024 / 1024, 2),
            "duplicated_rows": int(df.duplicated().sum()),
            "total_missing": int(df.isnull().sum().sum()),
            "missing_pct": round(df.isnull().sum().sum() / (len(df) * len(df.columns)) * 100, 2),
        },
        "columns": [],
        "data_types": {
            "numeric": len(df.select_dtypes(include=[np.number]).columns),
            "categorical": len(df.select_dtypes(include=['object', 'category']).columns),
            "datetime": len(df.select_dtypes(include=['datetime64']).columns),
            "boolean": len(df.select_dtypes(include=['bool']).columns),
        }
    }
    
    # 逐列分析
    for col in df.columns:
        col_info = {
            "name": col,
            "dtype": str(df[col].dtype),
            "missing_count": int(df[col].isnull().sum()),
            "missing_pct": round(df[col].isnull().sum() / len(df) * 100, 2),
            "unique_count": int(df[col].nunique()),
            "unique_pct": round(df[col].nunique() / len(df) * 100, 2),
        }
        
        # 数值列统计
        if pd.api.types.is_numeric_dtype(df[col]):
            col_info["stats"] = {
                "mean": round(float(df[col].mean()), 4) if not df[col].isnull().all() else None,
                "std": round(float(df[col].std()), 4) if not df[col].isnull().all() else None,
                "min": float(df[col].min()) if not df[col].isnull().all() else None,
                "max": float(df[col].max()) if not df[col].isnull().all() else None,
                "median": float(df[col].median()) if not df[col].isnull().all() else None,
                "q25": float(df[col].quantile(0.25)) if not df[col].isnull().all() else None,
                "q75": float(df[col].quantile(0.75)) if not df[col].isnull().all() else None,
                "skewness": round(float(df[col].skew()), 4) if not df[col].isnull().all() else None,
                "kurtosis": round(float(df[col].kurtosis()), 4) if not df[col].isnull().all() else None,
                "zeros_pct": round((df[col] == 0).sum() / len(df) * 100, 2),
            }
            # 异常值检测（IQR方法）
            Q1 = df[col].quantile(0.25)
            Q3 = df[col].quantile(0.75)
            IQR = Q3 - Q1
            outliers = ((df[col] < Q1 - 1.5 * IQR) | (df[col] > Q3 + 1.5 * IQR)).sum()
            col_info["outliers_count"] = int(outliers)
            col_info["outliers_pct"] = round(outliers / len(df) * 100, 2)
            
        # 分类列统计
        elif pd.api.types.is_object_dtype(df[col]) or pd.api.types.is_categorical_dtype(df[col]):
            value_counts = df[col].value_counts()
            col_info["top_values"] = {
                str(k): int(v) for k, v in value_counts.head(10).items()
            }
            col_info["avg_length"] = round(df[col].dropna().astype(str).str.len().mean(), 1)
            
        profile["columns"].append(col_info)
    
    # 数值列相关性
    numeric_cols = df.select_dtypes(include=[np.number]).columns
    if len(numeric_cols) >= 2:
        corr = df[numeric_cols].corr()
        # 找出高相关性对
        high_corr_pairs = []
        for i in range(len(corr.columns)):
            for j in range(i+1, len(corr.columns)):
                val = corr.iloc[i, j]
                if abs(val) > 0.7:
                    high_corr_pairs.append({
                        "col_a": corr.columns[i],
                        "col_b": corr.columns[j],
                        "correlation": round(float(val), 4)
                    })
        profile["high_correlations"] = high_corr_pairs
    
    # 数据质量评分
    quality_factors = [
        1 - profile["overview"]["missing_pct"] / 100,  # 完整性
        1 - profile["overview"]["duplicated_rows"] / max(len(df), 1),  # 唯一性
    ]
    profile["quality_score"] = round(sum(quality_factors) / len(quality_factors), 3)
    
    return profile


def profile_to_markdown(profile: dict) -> str:
    """将画像结果转为Markdown格式"""
    md = []
    md.append(f"# 数据画像报告：{profile['overview']['file_name']}\n")
    
    # 概览
    md.append("## 数据概览\n")
    ov = profile['overview']
    md.append(f"| 指标 | 值 |")
    md.append(f"|------|-----|")
    md.append(f"| 行数 | {ov['rows']:,} |")
    md.append(f"| 列数 | {ov['columns']} |")
    md.append(f"| 内存占用 | {ov['memory_usage_mb']} MB |")
    md.append(f"| 重复行 | {ov['duplicated_rows']:,} |")
    md.append(f"| 缺失率 | {ov['missing_pct']}% |")
    md.append(f"| 质量评分 | {profile.get('quality_score', 'N/A')} |")
    md.append("")
    
    # 数据类型
    md.append("## 数据类型分布\n")
    dt = profile['data_types']
    md.append(f"| 类型 | 列数 |")
    md.append(f"|------|------|")
    md.append(f"| 数值型 | {dt['numeric']} |")
    md.append(f"| 分类型 | {dt['categorical']} |")
    md.append(f"| 日期型 | {dt['datetime']} |")
    md.append(f"| 布尔型 | {dt['boolean']} |")
    md.append("")
    
    # 字段详情
    md.append("## 字段详情\n")
    for col in profile['columns']:
        md.append(f"### {col['name']}")
        md.append(f"- 类型：{col['dtype']}")
        md.append(f"- 缺失：{col['missing_pct']}%（{col['missing_count']}条）")
        md.append(f"- 唯一值：{col['unique_count']}（{col['unique_pct']}%）")
        if 'stats' in col:
            s = col['stats']
            md.append(f"- 均值：{s['mean']} | 中位数：{s['median']} | 标准差：{s['std']}")
            md.append(f"- 范围：[{s['min']}, {s['max']}]")
            if col.get('outliers_count', 0) > 0:
                md.append(f"- ⚠️ 异常值：{col['outliers_count']}条（{col['outliers_pct']}%）")
        if 'top_values' in col:
            md.append(f"- Top值：{', '.join(f'{k}({v})' for k, v in list(col['top_values'].items())[:5])}")
        md.append("")
    
    # 高相关性
    if profile.get('high_correlations'):
        md.append("## 高相关性字段对（|r| > 0.7）\n")
        md.append("| 字段A | 字段B | 相关系数 |")
        md.append("|-------|-------|---------|")
        for pair in profile['high_correlations']:
            md.append(f"| {pair['col_a']} | {pair['col_b']} | {pair['correlation']} |")
    
    return "\n".join(md)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python data_profiler.py <file_path> [--format json|markdown]")
        sys.exit(1)
    
    file_path = sys.argv[1]
    fmt = "json"
    if "--format" in sys.argv:
        idx = sys.argv.index("--format")
        if idx + 1 < len(sys.argv):
            fmt = sys.argv[idx + 1]
    
    profile = generate_profile(file_path)
    
    if fmt == "markdown":
        print(profile_to_markdown(profile))
    else:
        print(json.dumps(profile, ensure_ascii=False, indent=2))
