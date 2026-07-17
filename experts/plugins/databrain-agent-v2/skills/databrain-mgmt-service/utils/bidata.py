from __future__ import annotations
from datetime import datetime
import re
from loguru import logger
from typing import Dict, List

from utils.context import GameContext

import copy


MGMT_SYSTEM_NAME = "mgmt"

def merge_bidatas(dict_list):
    if not dict_list:
        return {}
    
    # 1. 以第一份数据作为基础模板进行深拷贝，避免修改原始数据
    base_data = copy.deepcopy(dict_list[0])
    
    # 获取基准的日期序列，用于后续所有数据集的 X 轴对齐
    base_dates = [item['date'] for item in base_data['data']['data']]
    
    # 2. 修改基础配置
    base_data['data']['legends'] = ["compare_date"]
    
    # 3. 准备收集所有的 compare_date 值
    all_compare_dates = []
    merged_records = []
    
    # 4. 遍历所有 dict 进行数据合并
    for i, d in enumerate(dict_list):
        current_records = d['data']['data']
        current_dates = [r['date'] for r in current_records]
        
        # 收集当前数据集的所有日期到 compare_date 列表中
        all_compare_dates.extend(current_dates)
        
        # 处理每一行数据
        for idx, record in enumerate(current_records):
            new_record = copy.deepcopy(record)
            
            # 核心逻辑：
            # compare_date 存放该条数据真实的日期
            new_record['compare_date'] = record['date']
            
            # date 字段统一修改为基准日期，以便在图表的 X 轴上对齐显示
            # 如果当前索引超出了基准日期的长度，则保留原样（容错处理）
            if idx < len(base_dates):
                new_record['date'] = base_dates[idx]
            
            merged_records.append(new_record)

    # 5. 更新 dimension_info
    # 保留原有的 Date 维度信息（通常取最新一份的范围）
    # 增加 compare_date 维度信息
    compare_dimension = {
        "name": "compare_date",
        "data_key": "compare_date",
        "value": all_compare_dates
    }
    
    # 检查是否已经存在 compare_date，不存在则添加
    dim_info = base_data['data']['dimension_info']
    # 更新第一个维度（Date）的 value 为基准数据集的范围（可选，根据需求）
    
    # 添加新的维度信息
    dim_info.append(compare_dimension)
    
    # 6. 替换最终的数据集
    base_data['data']['data'] = merged_records
    
    return base_data


def if_need_merge_bidata(game_context: GameContext):
    num = 0  # 统计适合merge的结果个数
    metrics = []  # 判断各个结果的指标信息是否一致  

    for i, dic in enumerate(game_context.data):
        # 检查system是否为mgmt
        sys = dic.get("system", "")
        if sys != MGMT_SYSTEM_NAME:
            continue

        # 检查bidata_id是否不为空
        data_id = dic.get("data_id", "")
        if data_id == "":
            continue

        # 检查指标是否一致
        new_metrics = []
        metrics_info = dic["data"].get("metrics_info", [])   
        if len(metrics_info) == 0:
            continue

        for mdict in metrics_info:
            new_metrics.append(mdict.get("data_key"))
            
            if i == 0:
                metrics.append(mdict.get("data_key"))

        if metrics != new_metrics:
            continue
        
        # 适合merge的结果个数加1
        num += 1
    
    # 如果适合merge的结果个数大于1，返回true            
    if num > 1:
        return True

    return False

def check_and_merge_mgmt_bidata(game_context: GameContext):
    if_need = if_need_merge_bidata(game_context)
    if not if_need:
        return
    
    # 合并bidata，先删除旧的，再保存merge后的
    before_merge_data = [dic for dic in game_context.data if dic.get("system", "") == MGMT_SYSTEM_NAME]
    game_context.data = [dic for dic in game_context.data if dic.get("system", "") != MGMT_SYSTEM_NAME]

    after_merge_data = merge_bidatas(before_merge_data)
    game_context.data.append(after_merge_data)