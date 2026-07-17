"""
Utilities to format numeric values for tool outputs.

- Chinese: convert to 万/亿 with 2 decimals
- English: convert to K/M/G with 2 decimals

These are intended for *display* in tool return strings (LLM-facing),
not for storage/analytics.
"""

from __future__ import annotations

import math
import numbers
from typing import Any

from utils.util import is_chinese_language


def format_chinese_unit(value, digits: int = 2, return_str: bool = True):
    """
    将数值自动转换为 万 / 亿 单位
    :param value: 数值（支持正负）
    :param digits: 保留小数位
    :param return_str: 是否返回带单位字符串
    :return: 转换结果
    """
    if value is None:
        return None

    # Keep NaN as-is (avoid "nan亿")
    if isinstance(value, float) and math.isnan(value):
        return value

    abs_value = abs(value)

    if abs_value >= 1e8:
        converted = value / 1e8
        unit = "亿"
    elif abs_value >= 1e4:
        converted = value / 1e4
        unit = "万"
    else:
        converted = value
        unit = ""

    if return_str:
        return f"{converted:.{digits}f}{unit}"
    return round(converted, digits), unit


def format_kmg(value, digits: int = 2, return_str: bool = True):
    """
    自动转换为 K / M / G 单位
    :param value: 数值（支持正负）
    :param digits: 保留小数位
    :param return_str: 是否返回带单位字符串
    :return: 转换结果
    """
    if value is None:
        return None

    # Keep NaN as-is
    if isinstance(value, float) and math.isnan(value):
        return value

    abs_value = abs(value)

    if abs_value >= 1e9:
        converted = value / 1e9
        unit = "G"
    elif abs_value >= 1e6:
        converted = value / 1e6
        unit = "M"
    elif abs_value >= 1e3:
        converted = value / 1e3
        unit = "K"
    else:
        converted = value
        unit = ""

    if return_str:
        return f"{converted:.{digits}f}{unit}"
    return round(converted, digits), unit


def _is_number(v: Any) -> bool:
    # bool is subclass of int; exclude it
    return isinstance(v, numbers.Number) and not isinstance(v, bool)


def format_number_by_language(value: Any, language: str | None, digits: int = 2):
    if not _is_number(value):
        return value
    if is_chinese_language(language):
        return format_chinese_unit(value, digits=digits, return_str=True)
    return format_kmg(value, digits=digits, return_str=True)


def format_numbers_in_obj(obj: Any, language: str | None, digits: int = 2):
    """
    Recursively traverse lists/dicts and format numeric values into human readable units.
    Skips formatting for keys that look like IDs (e.g. *_id).
    """
    if _is_number(obj):
        return format_number_by_language(obj, language=language, digits=digits)

    if isinstance(obj, list):
        return [format_numbers_in_obj(x, language=language, digits=digits) for x in obj]

    if isinstance(obj, tuple):
        return tuple(format_numbers_in_obj(x, language=language, digits=digits) for x in obj)

    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            key_str = str(k).lower()
            # Avoid touching ID-like numeric fields (rare but possible)
            if _is_number(v) and (key_str == "id" or key_str.endswith("_id") or "id" == key_str[-2:]):
                out[k] = v
            else:
                out[k] = format_numbers_in_obj(v, language=language, digits=digits)
        return out

    return obj

