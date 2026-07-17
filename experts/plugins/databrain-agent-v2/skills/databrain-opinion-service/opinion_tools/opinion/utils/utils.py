import json
import re
from typing import Dict, List, Any
from loguru import logger
from opinion_tools.cube.cube_model import Query
from opinion_tools.opinion.data.country_language_map import map_countries_to_iso_languages

from async_lru import alru_cache
import databrain.api
from run_context_wrapper import RunContextWrapper
from opinion_strategy.context import GameContext, ReferenceItem, GameType
from opinion_tools.opinion.utils.game_search import search_games_by_opinion
from datetime import datetime
from opinion_common.config import globalvar as gl

def truncate_output(result, max_length: int = 1000000):
    """暴力截断tool返回结果，统一转成字符串返回"""
    # 根据数据类型选择最佳的字符串转换方式
    if isinstance(result, (dict, list)):
        try:
            result_str = json.dumps(result, ensure_ascii=False, indent=None)
        except (TypeError, ValueError):
            result_str = str(result)
    else:
        result_str = str(result)
    
    # 检查长度并截断
    if len(result_str) <= max_length:
        return result_str
    
    logger.warning(f"Tool输出截断: {len(result_str)} -> {max_length} 字符")
    return result_str[:max_length] + "...由于数据过多，仅展示部分数据"

def is_valid_game_id(game_id_str):
    """
    检测game_id是否有效
    有效的game_id应该只包含小写字母和数字，不含大写字母、中文字符、空格等
    
    Args:
        game_id_str: 待检测的字符串
        
    Returns:
        bool: True表示有效的game_id，False表示可能是游戏名称
    """
    if not isinstance(game_id_str, str) or not game_id_str:
        return False
    
    # 检查是否包含大写字母、中文字符、空格等
    invalid_chars = []
    
    for char in game_id_str:
        if char.isupper():  # 大写字母
            invalid_chars.append(f"大写字母'{char}'")
        elif ord(char) > 127:  # 非ASCII字符（包括中文）
            invalid_chars.append(f"非ASCII字符'{char}'")
        elif char.isspace():  # 空格
            invalid_chars.append(f"空格")
        elif char in "!@#$%^&*()+=[]{}|\\:;\"'<>?,./":  # 特殊符号
            invalid_chars.append(f"特殊符号'{char}'")
    
    if invalid_chars:
        logger.info(f"【game_id检测】'{game_id_str}' 被识别为无效game_id，包含: {', '.join(invalid_chars[:3])}{'...' if len(invalid_chars) > 3 else ''}")
        return False
    
    return True


def resolve_fallback_dimension(meta_info, language="English"):
    """
    根据 meta_info 中的 fallback_dimensions 字段，
    在多语言环境下选择合适的 fallback 维度字段。
    """
    fallback_raw = meta_info.get("fallback_dimensions", "")

    #如果是字符串，直接返回
    if isinstance(fallback_raw, str):
        return fallback_raw

    #如果不是列表，返回空
    if not isinstance(fallback_raw, list):
        return ""

    #处理多语言场景
    lang = language.lower()
    if "chinese" in lang or "zh" in lang:
        for f in fallback_raw:
            if "_zh" in f:
                return f
    elif "english" in lang or "en" in lang:
        for f in fallback_raw:
            if "_en" in f:
                return f

    return fallback_raw[0] if fallback_raw else ""

async def convert_invalid_game_ids_to_valid(invalid_game_ids, token):
    """
    将无效的game_id（实际是游戏名称）转换为有效的game_id
    
    Args:
        invalid_game_ids: 无效的game_id列表（实际是游戏名称）
        token: 认证token
        
    Returns:
        dict: {游戏名称: game_id} 的映射，失败的返回None
    """
    if not invalid_game_ids or not token:
        return {}
    
    logger.info(f"【game_id转换】开始转换 {len(invalid_game_ids)} 个无效game_id: {invalid_game_ids}")
    
    try:
        # 调用search_games_by_opinion获取游戏信息
        game_ids, entity_names, game_info_dict = await search_games_by_opinion(invalid_game_ids, token)
        
        # 构建游戏名称到game_id的映射
        name_to_id_mapping = {}
        
        # 从返回结果中提取映射关系
        for game_name, game_info in game_info_dict.items():
            game_id = game_info.get("game_id")
            if game_id:
                name_to_id_mapping[game_name] = game_id
                logger.info(f"【game_id转换】成功: {game_name} -> {game_id}")
            else:
                name_to_id_mapping[game_name] = None
                logger.warning(f"【game_id转换】失败: {game_name} 未找到对应game_id")
        
        # 处理可能的模糊匹配
        for invalid_id in invalid_game_ids:
            if invalid_id not in name_to_id_mapping:
                # 尝试在game_info_dict中找到相似的匹配
                for game_name, game_info in game_info_dict.items():
                    if invalid_id.lower() in game_name.lower() or game_name.lower() in invalid_id.lower():
                        game_id = game_info.get("game_id")
                        if game_id:
                            name_to_id_mapping[invalid_id] = game_id
                            logger.info(f"【game_id转换】模糊匹配: {invalid_id} -> {game_name} -> {game_id}")
                            break
                else:
                    name_to_id_mapping[invalid_id] = None
                    logger.warning(f"【game_id转换】失败: {invalid_id} 未找到任何匹配")
        
        return name_to_id_mapping
        
    except Exception as e:
        logger.warning(f"【game_id转换】调用search_games_by_opinion失败: {e}")
        return {name: None for name in invalid_game_ids}


def smart_update_game_ids(current_game_ids, entity_ids):
    """
    智能更新game_id列表的逻辑：
    1. 检查entity_ids是否已存在于current_game_ids中
    2. 如果不存在，寻找相似度最高的ID进行替换
    3. 如果没有相似的，则添加entity_ids到列表中
    """
    if not current_game_ids or not entity_ids:
        return entity_ids if entity_ids else current_game_ids
    
    updated_ids = current_game_ids.copy()
    
    for entity_id in entity_ids:
        # 1. 检查entity_id是否已存在
        if entity_id in updated_ids:
            logger.debug(f"【smart_update】entity_id {entity_id} 已存在于game_id列表中")
            continue
        
        # 2. 寻找相似度最高的ID
        best_match = None
        max_similarity = 0
        
        for current_id in updated_ids:
            # 计算前缀相似度（前面多少位相同）
            similarity = _calculate_prefix_similarity(entity_id, current_id)
            if similarity > max_similarity and similarity >= 8:  # 至少前8位相同才认为相似
                max_similarity = similarity
                best_match = current_id
        
        # 3. 决定是替换还是添加
        if best_match:
            # 找到相似的ID，进行替换
            logger.info(f"【smart_update】找到相似ID，将 {best_match} 替换为 {entity_id} (相似度: {max_similarity}位)")
            updated_ids[updated_ids.index(best_match)] = entity_id
        else:
            # 没有找到相似的ID，添加到列表中
            logger.info(f"【smart_update】未找到相似ID，将 {entity_id} 添加到game_id列表中")
            updated_ids.append(entity_id)
    
    return updated_ids


def _calculate_prefix_similarity(id1, id2):
    """
    计算两个ID的前缀相似度（前面有多少位相同）
    """
    if not id1 or not id2:
        return 0
    
    min_len = min(len(id1), len(id2))
    similarity = 0
    
    for i in range(min_len):
        if id1[i] == id2[i]:
            similarity += 1
        else:
            break
    
    return similarity

async def match_game_names_to_ids(game_names_in_filter, context_entity_names, context_entity_ids, context):
    """
    智能匹配 game_name filter 中的游戏名称到对应的 game_id
    
    Args:
        game_names_in_filter: filter 中的 game_name 值列表
        context_entity_names: context 中的 entity_names 列表
        context_entity_ids: context 中的 entity_ids 列表
        context: RunContextWrapper，用于第三重兜底的API查询
    
    Returns:
        List[str]: 匹配到的 game_id 列表，如果无法匹配则返回空列表
    """
    if not game_names_in_filter or not context_entity_names or not context_entity_ids:
        return []
    
    if len(context_entity_names) != len(context_entity_ids):
        logger.warning(f"【_match_game_names_to_ids】entity_names 和 entity_ids 长度不匹配: {len(context_entity_names)} vs {len(context_entity_ids)}")
        return []
    
    matched_ids = []
    
    for game_name in game_names_in_filter:
        # 1. 精确匹配
        if game_name in context_entity_names:
            index = context_entity_names.index(game_name)
            matched_ids.append(context_entity_ids[index])
            logger.debug(f"【_match_game_names_to_ids】精确匹配: {game_name} -> {context_entity_ids[index]}")
            continue
        
        # 2. 模糊匹配（忽略大小写、去除空格）
        game_name_normalized = game_name.lower().replace(" ", "").replace("-", "").replace("_", "")
        found_match = False
        
        for i, context_name in enumerate(context_entity_names):
            context_name_normalized = context_name.lower().replace(" ", "").replace("-", "").replace("_", "")
            
            # 检查是否包含关系或相似度
            if (game_name_normalized in context_name_normalized or 
                context_name_normalized in game_name_normalized or
                _calculate_similarity(game_name_normalized, context_name_normalized) > 0.9):
                
                matched_ids.append(context_entity_ids[i])
                logger.debug(f"【_match_game_names_to_ids】模糊匹配: {game_name} -> {context_entity_names[i]} -> {context_entity_ids[i]}")
                found_match = True
                break
        # 3. 第三重兜底逻辑：API查询
        if not found_match:
            logger.warning(f"【_match_game_names_to_ids】无法匹配游戏名称 {game_name}，尝试API查询")
            try:
                # 只查询当前无法匹配的游戏名称
                token = getattr(context.context, "token", None)
                if token:

                    game_ids, entity_names, game_info_dict = await search_games_by_opinion(tuple([game_name]), token)
                    
                    if game_ids and len(game_ids) > 0:
                        # API查询成功，添加到匹配结果
                        matched_ids.append(game_ids[0])  # 取第一个结果
                        logger.info(f"【_match_game_names_to_ids】API查询成功: {game_name} -> {game_ids[0]}")
                        
                        # 更新context，避免重复查询
                        if hasattr(context.context, 'entity_names') and hasattr(context.context, 'entity_ids'):
                            context.context.entity_names.extend(entity_names)
                            context.context.entity_ids.extend(game_ids)
                            logger.debug(f"【_match_game_names_to_ids】已更新context: +{len(entity_names)}个游戏")
                    else:
                        logger.warning(f"【_match_game_names_to_ids】API查询无结果: {game_name}")
                else:
                    logger.warning(f"【_match_game_names_to_ids】缺少token，无法进行API查询")
            except Exception as e:
                logger.error(f"【_match_game_names_to_ids】API查询失败: {game_name}, 错误: {e}")
    
    # 去重
    matched_ids = list(dict.fromkeys(matched_ids))
    
    return matched_ids


def _calculate_similarity(str1, str2):
    """
    计算两个字符串的相似度
    
    Returns:
        float: 0-1 之间的相似度分数
    """
    if not str1 or not str2:
        return 0.0
    
    # 使用最长公共子序列的比例作为相似度
    min_len = min(len(str1), len(str2))
    max_len = max(len(str1), len(str2))
    
    if max_len == 0:
        return 1.0
    
    # 简单的字符匹配计数
    common_chars = 0
    for i in range(min_len):
        if i < len(str1) and i < len(str2) and str1[i] == str2[i]:
            common_chars += 1
    
    return common_chars / max_len


def validate_feeds_performance(query: Query):
    """
    验证feeds表是否满足性能要求，包括：
    1. 是否存在timeDimensions时间分区
    2. 是否存在game_id filters
    """
    # 只验证feeds表
    target_table = find_cube_table(query)
    if not target_table or target_table not in ["feeds", "feeds_topic"]:
        return {"success": True}

    if not query.timeDimensions:
        has_date_filter = False
        if hasattr(query, 'filters') and query.filters:
            for f in query.filters:
                try:
                    member = f.get('member') if isinstance(f, dict) else getattr(f, 'member', None)
                    if member and (member.endswith('.date') or member == 'date'):
                        has_date_filter = True
                        break
                except Exception:
                    continue
        if not has_date_filter:
            return {"error": "缺少时间范围", "code": -1}
    # if not find_cube_filter(query, "game_id"):
    #     return {"error": "未指定游戏，请告知用户指定游戏或者使用websearch_tool", "code": -1}
    return {"success": True}

def find_cube_filter(query: Query, column: str) -> bool:
    """
    从query中推断是否使用指定字段作为filters
    """
    if query.filters:
        for filter in query.filters:
            if hasattr(filter, "member") and filter.member.endswith(f".{column}"):
                return True
    return False

def find_cube_table(query: Query):
    """
    从query中推断使用的表名（每次查询只有一张表）
    """
    target_table = None
    all_fields = []
    if query.measures:
        all_fields.extend(query.measures)
    if query.dimensions:
        all_fields.extend(query.dimensions)
    # 获取第一个带前缀的字段的表名
    for field in all_fields:
        if '.' in field:
            target_table = field.split('.')[0]
            break
    return target_table

def _get_field_name_without_prefix(field_full_name: str) -> str:
    """提取字段名（去掉表前缀）
    
    例如：'hotness.mentions' -> 'mentions'
          'feeds.game_id' -> 'game_id'
          'no_prefix' -> 'no_prefix'
    """
    return field_full_name.split('.', 1)[1] if '.' in field_full_name else field_full_name


def _build_correct_field_name(table_name: str, field_name: str) -> str:
    """构建正确的字段全名
    
    Args:
        table_name: 表名，如 'hotness'
        field_name: 字段名（可能带前缀），如 'feeds.mentions' 或 'mentions'
    
    Returns:
        正确的字段全名，如 'hotness.mentions'
    """
    # 去掉可能存在的错误前缀
    pure_field_name = _get_field_name_without_prefix(field_name)
    return f"{table_name}.{pure_field_name}"


async def _build_field_metadata(cube_client, table_name: str, language: str = "English") -> dict:
    """构建指定表的字段元数据"""
    meta = await cube_client.describe()
    if error := meta.get("error"):
        raise Exception(f"获取schema失败: {error}")
    
    field_metadata = {}
    for cube in meta.get("cubes", []):
        if not cube.get("isVisible") or cube.get("name") != table_name:
            continue
        
        # 处理 measures 字段
        for field in cube.get("measures", []):
            if not field.get("isVisible"):
                continue
            field_name = field.get("name", "")
            if field_name:
                meta_info = field.get("meta", {})
                field_metadata[field_name] = {
                    "dimensions": False,
                    "measures": True,
                    "filters": True,  # 允许 measures 字段作为 filter 使用（如 views >= 1000000）
                    "fallback_dimensions": meta_info.get("fallback_dimensions")
                }
        
        # 处理 dimensions 字段
        for field in cube.get("dimensions", []):
            if not field.get("isVisible"):
                continue
            field_name = field.get("name", "")
            if field_name:
                meta_info = field.get("meta", {})
                fallback_result = resolve_fallback_dimension(meta_info, language)
                field_metadata[field_name] = {
                    "dimensions": not fallback_result,
                    "measures": False,
                    "filters": True,
                    "fallback_dimensions": fallback_result,
                }
        
        logger.debug(f"【字段验证】表 {table_name} 包含 {len(field_metadata)} 个字段")
        return field_metadata
    
    # 表不存在
    raise Exception(f"目标表 '{table_name}' 在schema中不存在")


async def validate_query_fields(cube_client, table_name: str, query, language="English"):
    """
    验证并修正query中的字段，包括：
    1. 验证 table_name 参数是否存在
    2. 自动修正字段前缀（如果字段在目标表中存在）
    3. 剔除无效字段（字段在目标表中不存在）
    4. 验证字段是否被正确使用（dimensions/measures/filters）
    5. 记录所有修改信息到 field_modifications
    """
    try:
        # 步骤1：验证 table_name 是否存在
        if not table_name:
            return {"error": "table_name 参数不能为空，请指定要查询的表名", "code": -1}
        
        # 步骤2：构建字段元数据（获取目标表的所有可用字段）
        try:
            field_metadata = await _build_field_metadata(cube_client, table_name, language)
        except Exception as e:
            return {"error": str(e), "code": -1}
        
        logger.debug(f"【字段验证】开始验证并修正字段，目标表: '{table_name}'")
        
        # 步骤3：验证并修正各类字段
        field_modifications = []
        
        # 3.1 修正和验证 measures 字段
        if query.measures:
            valid_measures = []
            dimensions_to_add = []
            
            for measure in query.measures:
                # 构建正确的字段名
                correct_field_name = _build_correct_field_name(table_name, measure)
                
                # 检查字段是否存在于目标表中
                if correct_field_name not in field_metadata:
                    field_modifications.append(f"field '{measure}' not found in table '{table_name}' and got removed")
                    continue
                
                # 检查字段类型是否适合作为 measure
                field_meta = field_metadata[correct_field_name]
                if not field_meta["measures"]:
                    if field_meta["dimensions"]:
                        field_modifications.append(f"field '{measure}' is a dimension field and got removed from measures and added to dimensions")
                        dimensions_to_add.append(correct_field_name)
                    else:
                        field_modifications.append(f"field '{measure}' is not supported as a measure and got removed")
                    continue
                
                # 字段有效，记录修正信息（如果前缀被修改）
                if correct_field_name != measure:
                    field_modifications.append(f"field '{measure}' prefix got corrected to '{correct_field_name}'")
                
                valid_measures.append(correct_field_name)
            
            query.measures = valid_measures
            
            # 将误用作measure的dimension字段添加到dimensions中
            if dimensions_to_add:
                if not query.dimensions:
                    query.dimensions = []
                for dim_field in dimensions_to_add:
                    if dim_field not in query.dimensions:
                        query.dimensions.append(dim_field)
        
        # 3.2 修正和验证 dimensions 字段
        if query.dimensions and not query.ungrouped:
            valid_dimensions = []
            
            for dimension in query.dimensions:
                original_dimension = dimension
                
                # 特殊映射：region -> language
                pure_field_name = _get_field_name_without_prefix(dimension)
                if pure_field_name == "region_zh":
                    pure_field_name = "language_zh"
                    field_modifications.append(f"dimension field '{dimension}' got mapped to 'language_zh'")
                elif pure_field_name == "region_en":
                    pure_field_name = "language_en"
                    field_modifications.append(f"dimension field '{dimension}' got mapped to 'language_en'")
                
                # 构建正确的字段名
                correct_field_name = f"{table_name}.{pure_field_name}"
                
                # 检查字段是否存在于目标表中
                if correct_field_name not in field_metadata:
                    field_modifications.append(f"dimension field '{original_dimension}' not found in table '{table_name}' and got removed")
                    continue
                
                field_meta = field_metadata[correct_field_name]
                
                # 检查字段类型是否适合作为 dimension
                if not field_meta["dimensions"]:
                    # 尝试使用 fallback_dimensions
                    fallback_field_name = field_meta.get("fallback_dimensions")
                    if fallback_field_name:
                        fallback_full_name = f"{table_name}.{fallback_field_name}"
                        if fallback_full_name in field_metadata and field_metadata[fallback_full_name]["dimensions"]:
                            field_modifications.append(f"dimension field '{original_dimension}' got replaced with fallback field '{fallback_full_name}'")
                            valid_dimensions.append(fallback_full_name)
                            continue
                        else:
                            logger.warning(f"【字段验证】fallback字段 '{fallback_full_name}' 不可用")
                    
                    field_modifications.append(f"field '{original_dimension}' is not supported as a dimension and got removed")
                    continue
                
                # 字段有效，记录修正信息（如果前缀被修改）
                if correct_field_name != original_dimension:
                    field_modifications.append(f"dimension field '{original_dimension}' prefix got corrected to '{correct_field_name}'")
                
                valid_dimensions.append(correct_field_name)
            
            query.dimensions = valid_dimensions
        
        # 3.3 修正和验证 filters 字段
        if query.filters:
            valid_filters = []
            
            for filter_obj in query.filters:
                if not hasattr(filter_obj, "member"):
                    logger.warning(f"【字段验证】过滤条件缺少member属性: {filter_obj}")
                    field_modifications.append("filter condition format is invalid and got removed")
                    continue
                
                filter_field = filter_obj.member

                if filter_field and (',' in filter_field or ':' in filter_field):
                    sanitized = re.split(r'[,:{}\[\]]', filter_field)[0].strip()
                    if sanitized and '.' in sanitized:
                        logger.warning(
                            f"【字段验证】filter member sanitized: '{filter_field}' -> '{sanitized}'"
                        )
                        filter_field = sanitized
                        filter_obj.member = sanitized
                
                # 构建正确的字段名
                correct_field_name = _build_correct_field_name(table_name, filter_field)
                
                # 检查字段是否存在于目标表中
                if correct_field_name not in field_metadata:
                    # 特殊处理：country_code → language_code 自动转换
                    pure_filter_field = _get_field_name_without_prefix(filter_field)
                    if pure_filter_field == 'country_code':
                        language_code_field = f"{table_name}.language_code"
                        if language_code_field in field_metadata:
                            country_values = list(filter_obj.values) if filter_obj.values else []
                            language_values = map_countries_to_iso_languages(country_values)
                            if language_values:
                                filter_obj.member = language_code_field
                                filter_obj.values = language_values
                                field_modifications.append(
                                    f"filter field '{filter_field}' (country_code) not found in table '{table_name}', "
                                    f"auto-converted to '{language_code_field}' with language codes {language_values}"
                                )
                                valid_filters.append(filter_obj)
                                logger.info(
                                    f"【字段验证】country_code filter 自动转换: {country_values} → language_code {language_values}"
                                )
                                continue
                    field_modifications.append(f"filter field '{filter_field}' not found in table '{table_name}' and got removed")
                    continue
                
                # 检查字段是否支持作为 filter / dimensions和measures都可以作为filter
                if not field_metadata[correct_field_name].get("filters", False):
                    field_modifications.append(f"filter field '{filter_field}' is not supported as a dimension and got removed")
                    continue
                
                # 修正 filter_obj 的 member 字段
                if correct_field_name != filter_field:
                    field_modifications.append(f"filter field '{filter_field}' prefix got corrected to '{correct_field_name}'")
                    filter_obj.member = correct_field_name
                
                valid_filters.append(filter_obj)
                logger.debug(f"【字段验证】过滤字段 '{correct_field_name}' 验证通过")
            
            query.filters = valid_filters
        
        # 3.4 修正和验证 timeDimensions 字段
        if hasattr(query, 'timeDimensions') and query.timeDimensions:
            for time_dim in query.timeDimensions:
                dimension = getattr(time_dim, 'dimension', None) if not isinstance(time_dim, dict) else time_dim.get('dimension')
                if dimension:
                    correct_field_name = _build_correct_field_name(table_name, dimension)
                    if correct_field_name not in field_metadata:
                        field_modifications.append(f"time dimension field '{dimension}' not found in table '{table_name}' and got removed")
                    elif correct_field_name != dimension:
                        field_modifications.append(f"time dimension field '{dimension}' prefix got corrected to '{correct_field_name}'")
                        if isinstance(time_dim, dict):
                            time_dim['dimension'] = correct_field_name
                        else:
                            time_dim.dimension = correct_field_name
        
        # 3.5 修正和验证 order 字段
        if hasattr(query, 'order') and query.order:
            new_order = {}
            for order_field, order_direction in query.order.items():
                correct_field_name = _build_correct_field_name(table_name, order_field)
                if correct_field_name not in field_metadata:
                    field_modifications.append(f"order field '{order_field}' not found in table '{table_name}' and got removed")
                else:
                    if correct_field_name != order_field:
                        field_modifications.append(f"order field '{order_field}' prefix got corrected to '{correct_field_name}'")
                    new_order[correct_field_name] = order_direction
            query.order = new_order
        
        # 3.6 修正和验证 legends 字段
        if hasattr(query, 'legends') and query.legends:
            correct_field_name = _build_correct_field_name(table_name, query.legends)
            if correct_field_name not in field_metadata:
                field_modifications.append(f"legend field '{query.legends}' not found in table '{table_name}' and got removed")
                query.legends = None
            elif correct_field_name != query.legends:
                field_modifications.append(f"legend field '{query.legends}' prefix got corrected to '{correct_field_name}'")
                query.legends = correct_field_name
        
        # 记录字段修改信息
        if field_modifications:
            modifications_msg = "; ".join(field_modifications)
            logger.info(f"【字段验证】字段修改: {modifications_msg}")
        else:
            logger.debug("【字段验证】所有字段验证通过，无需修改")
        
        # 返回验证结果，包含字段修改信息
        return {
            "success": True,
            "field_modifications": field_modifications if field_modifications else None
        }
    except Exception as e:
        logger.error(f"【字段验证】验证过程出错: {str(e)}")
        return {"error": f"字段验证过程出错: {str(e)}", "code": -1}

async def check_table_has_date_field(cube_client, table_name):
    """检查表是否包含date字段"""
    try:
        # 获取cube meta数据
        meta = await cube_client.describe()
        if error := meta.get("error"):
            logger.warning(f"【check_table_has_date_field】获取schema失败: {error}")
            return False
        
        # 查找目标表的字段信息
        for cube in meta.get("cubes", []):
            if not cube.get("isVisible"):
                continue
            if cube.get("name") == table_name:
                # 检查measures和dimensions中是否包含date字段
                measures = cube.get("measures", [])
                dimensions = cube.get("dimensions", [])
                
                # 合并所有字段进行检查
                all_fields = measures + dimensions
                for field in all_fields:
                    if not field.get("isVisible"):
                        continue
                    field_name = field.get("name", "")
                    if field_name == f"{table_name}.date":
                        logger.debug(f"【check_table_has_date_field】表 {table_name} 包含date字段")
                        return True
                logger.debug(f"【check_table_has_date_field】表 {table_name} 不包含date字段")
                return False
        
        logger.warning(f"【check_table_has_date_field】未找到表 {table_name} 的schema信息")
        return False
    except Exception as e:
        logger.error(f"【check_table_has_date_field】检查表字段时出错: {str(e)}")
        return False

@staticmethod
def handle_opinion_references(
    game_info_dict: Dict[str, Any],
    game_names: List[str],
    game_ids: List[str],
    reference_type: str = "KeyOpinions",
    context: RunContextWrapper[GameContext] = None,
) -> List[Dict[str, Any]]:
    """
    处理舆情引用链接生成，只有opinion=2的游戏才会生成链接
    
    Args:
        game_info_dict: 游戏信息字典（需要包含opinion字段）
        game_names: 游戏名称列表
        game_ids: 游戏ID列表
        reference_type: 引用类型
        context: 运行上下文
        
    Returns:
        List[Dict]: 引用链接列表（只包含opinion=2的游戏）
    """
    if not game_names or not game_ids:
        return []
        
    # 获取语言设置
    try:
        language = context.context.language if context else "Chinese"
    except Exception:
        language = "Chinese"
    
    # 页面类型映射（中英文）
    page_type_mapping = {
        "KeyMetrics": {
            "Chinese": "核心指标",
            "English": "Key Metrics"
        },
        "KeyOpinions": {
            "Chinese": "关键观点", 
            "English": "Key Opinions"
        },
        "Feeds": {
            "Chinese": "评论",
            "English": "Feeds"
        },
        "SteamRatings": {
            "Chinese": "Steam评分",
            "English": "Steam Ratings"
        },
        "GameStore": {
            "Chinese": "游戏商店",
            "English": "Game Store"
        }
    }
    
    # URL模式映射
    url_patterns = {
        "KeyMetrics": "v2/opinion/Overview/KeyMetrics?gameid={game_id}",
        "KeyOpinions": "v2/opinion/Overview/KeyOpinions?gameid={game_id}",
        "Feeds": "v2/opinion/Feeds/Feeds?gameid={game_id}",
        "SteamRatings": "v2/opinion/SteamPerformance/SteamRatings?gameid={game_id}",
        "GameStore": "v2/opinion/GameStore?gameid={game_id}",
    }
    
    reference_urls = []
    
    # 获取页面类型的本地化名称
    page_name = page_type_mapping.get(reference_type, {}).get(language, reference_type)
    url_pattern = url_patterns.get(reference_type, url_patterns["KeyOpinions"])
    
    url_map = gl.get_value("rb_url_map_json", expected_type=dict) or {}
    mobile_url_pattern = url_map.get(url_pattern, "")
    
    for game_name, game_id in zip(game_names, game_ids):
        # 直接从game_info_dict获取游戏信息
        game_info = game_info_dict.get(game_name, {})
        opinion = game_info.get("opinion", 0)
        
        # 只有opinion==2时才生成舆情链接
        if opinion != 2:
            continue
            
        image_url = game_info.get("image_url", "")
        
        # 生成标题
        if language == "Chinese":
            title = f"{game_name} - {page_name} - 舆情"
        else:
            title = f"{game_name} - {page_name} - Opinions"
            
        # 生成URL
        game_url = url_pattern.format(game_id=game_id)
        mobile_url = mobile_url_pattern.format(game_id=game_id)    
        
        reference_urls.append({
            "url": game_url,
            "type": GameType.DATABRAIN.value, 
            "key": f"Opinion_{reference_type}_{game_name}",
            "name": title,
            "title": title,
            "image_url": image_url,
            "favicon": image_url,
            "mobile_url": mobile_url,
        })
    
    return reference_urls

def calculate_dynamic_limit(query: Query, date_range_days: int = None) -> int:
    """
    根据filter的values数量和dateRange的时间粒度计算动态limit值
    
    Args:
        query: 查询对象
        date_range_days: 可选，已经计算好的时间范围天数
        
    Returns:
        int: 计算出的limit值
    """
    # 默认limit值
    default_limit = 1000
    
    # 如果没有filters，返回默认值
    if not hasattr(query, 'filters') or not query.filters:
        return default_limit
    
    # 计算所有filter的values总数（相乘关系）
    total_filter_values = 1  # 初始值为1，用于相乘
    for filter_item in query.filters:
        if hasattr(filter_item, 'values') and filter_item.values:
            if isinstance(filter_item.values, list):
                filter_values_count = len(filter_item.values)
            elif isinstance(filter_item.values, str):
                filter_values_count = 1
            else:
                filter_values_count = 1
            
            # 相乘而不是相加
            total_filter_values *= filter_values_count
    
    # 如果没有filter values，返回默认值
    if total_filter_values == 0:
        return default_limit
    
    # 计算动态limit: filter_values数量 * 时间范围天数 * 100
    # 如果date_range_days为0，则按1处理，避免limit为0
    dynamic_limit = total_filter_values * (date_range_days if date_range_days and date_range_days > 0 else 1) * 20
    
    
    logger.debug(f"【calculate_dynamic_limit】计算limit: filter_values={total_filter_values}, date_range_days={date_range_days}, 计算结果={dynamic_limit}")
    
    return dynamic_limit 