"""
游戏搜索模块 - 按照新的查询规则实现游戏搜索功能
"""

import json
import os
from typing import Dict, List, Any, Tuple, Optional
from opinion_common.config import globalvar as gl
from opinion_common.rainbow_utils import init_rainbow
from loguru import logger
from async_lru import alru_cache
from enum import Enum
import databrain.api

# 搜索结果类型常量
class GAME_SEARCH_RESULT(Enum):
    NORMAL = "normal"  # 高舆情相似度匹配，高于上阈值
    NO_OPINION = "no_opinion"  # 中等相似度且情报高匹配，舆情未配置该游戏主体但找到情报数据
    FUZZY_MATCH = "fuzzy_match"  # 中等相似度且情报低匹配，模糊匹配
    NO_DATABRAIN = "no_databrain"  # 相似度低于下阈值，舆情里没有相关主体，不再查询情报接口
    SPIDER_STOPPED = "spider_stopped"  # 爬虫停止
    LOW_PRIORITY = "low_priority"  # 爬虫低优先级
    ERROR = "error"  # 错误

# 相似度阈值常量
class SIMILARITY_THRESHOLD(Enum):
    SIMILARITY_HIGH_THRESHOLD = 0.75  # 高相似度 [0.75, 1]
    SIMILARITY_LOW_THRESHOLD = 0.3    # 低相似度 [0, 0.3)
    INTELLIGENCE_THRESHOLD = 0.95     # 情报接口相似度阈值 [0.95, 1]

# 平台优先级
PLATFORM_PRIORITY_MAP = {"mobile": 2, "pc": 1, "console": 0}  # Mobile > PC > Console
SPIDER_PRIORITY_MAP = {"emergency": 3, "high": 2, "middle": 1, "normal": 0}



class GameSearchResult:
    """游戏搜索结果封装类"""
    
    def __init__(self):
        self.game_ids: List[str] = []
        self.entity_names: List[str] = []
        self.game_info_dict: Dict[str, Dict] = {}
        
    def add_game(self, search_name: str, game_info: Dict, result_type: GAME_SEARCH_RESULT = GAME_SEARCH_RESULT.NORMAL, message: str = ""):
        """添加游戏信息"""
        game_id = game_info.get("game_id")
        entity_name = game_info.get("entity_name", search_name)
        
        # 有有效game_id的游戏都添加到game_ids中（用于生成reference等）
        # 包括：normal, fuzzy_match, low_priority, spider_stopped等有Databrain数据的类型
        if game_id and result_type.value in ["normal", "fuzzy_match", "low_priority", "spider_stopped"]:
            self.game_ids.append(game_id)
            self.entity_names.append(search_name)
        
        # 处理平台信息
        platforms = self._extract_platforms(game_info)
        
        # 缓存游戏信息
        self.game_info_dict[search_name] = {
            "game_id": game_id,
            "entity_name": entity_name,
            "entity_type": game_info.get("entity_type", ""),
            "game_name": game_info.get("game_name", entity_name),
            "image_url": game_info.get("cover", ""),
            "release_time": game_info.get("release_time", ""),
            "platform": platforms,
            "opinion": game_info.get("opinion", 0),
            "search_result": result_type.value,
            "message": message,
            "spider_status": game_info.get("opinion_info", {}).get("spider_status", 0),
            "spider_priority": game_info.get("opinion_info", {}).get("spider_priority", ""),
            "manual_score": game_info.get("manual_score", 0),
            "match_score": game_info.get("match_score", 0),
            "similarity": game_info.get("similarity", 0.0)
        }
    
    def _extract_platforms(self, game_info: Dict) -> List[str]:
        """提取游戏平台信息"""
        platforms = []
        if game_info.get("pc_id", "").strip():
            platforms.append("PC")
        if game_info.get("mobile_id", "").strip():
            platforms.append("Mobile")
        if game_info.get("console_id", "").strip():
            platforms.append("Console")
        return platforms


class GameSearchEngine:
    """游戏搜索引擎"""
    
    @staticmethod
    async def search_opinion_api(game_names: List[str], token: str) -> List[Dict]:
        """调用舆情接口搜索游戏，返回top5结果"""
        data = {
            "keywords": game_names,
            "entity_type": "pc,console,mobile",
            "system": "opinion",
            "top": 5,  # 返回top 5游戏
        }
        
        try:
            response = await databrain.api.async_send_request_with_token(
                databrain.api.OPINION_GAME_SEARCH_API, data, token
            )
            if response is None:
                logger.warning("【Opinion Game Search】API返回空响应")
                return []
            try:
                response_data = response.json()
            except Exception as json_error:
                logger.warning(f"【Opinion Game Search】响应解析失败: {json_error}")
                return []
            logger.debug(f"【Opinion API Response】{response_data}")
            raw_data = response_data.get("data") if isinstance(response_data, dict) else None
            if isinstance(raw_data, list):
                return raw_data
            logger.warning(
                f"【Opinion Game Search】data 字段非列表或为 None: {type(raw_data).__name__ if raw_data is not None else 'None'}"
            )
            return []
        except Exception as e:
            logger.warning(f"【Opinion Game Search】舆情接口失败: {e}")
        return []
    
    @staticmethod
    async def search_intelligence_api(game_names: List[str], token: str) -> List[Dict]:
        """调用情报接口搜索游戏"""
        data = {
            "keywords": game_names,
            "entity_type": "pc,console,mobile",
            "system": "intelligence",
            "top": 1,
        }
        
        try:
            response = await databrain.api.async_send_request_with_token(
                databrain.api.OPINION_GAME_SEARCH_API, data, token
            )
            if response is None:
                logger.warning("【Intelligence Game Search】API返回空响应")
                return []
            try:
                response_data = response.json()
            except Exception as json_error:
                logger.warning(f"【Intelligence Game Search】响应解析失败: {json_error}")
                return []
            logger.debug(f"【Intelligence API Response】{response_data}")
            raw_data = response_data.get("data") if isinstance(response_data, dict) else None
            if isinstance(raw_data, list):
                return raw_data
            logger.warning(
                f"【Intelligence Game Search】data 字段非列表或为 None: {type(raw_data).__name__ if raw_data is not None else 'None'}"
            )
            return []
        except Exception as e:
            logger.warning(f"【Intelligence Game Search】情报接口失败: {e}")
        return []
    
    @staticmethod
    def sort_databrain_games(games: List[Dict]) -> List[Dict]:
        """对Databrain数据进行排序 - 按照用户关注度排序"""
        if not games:
            return []
        
        # 排序规则：
        # 1. Manual Score (最高优先级)
        # 2. Spider Status (1 > 0)  
        # 3. Spider Priority (Emergency > High > Middle > Normal)
        # 4. Platform Priority (PC = Mobile > Console)
        def sort_key(game):
            entity_type = game.get("entity_type", "").lower()
            platform_priority = PLATFORM_PRIORITY_MAP.get(entity_type, 0)
            opinion_info = game.get("opinion_info", {})
            spider_status = opinion_info.get("spider_status", 0)
            spider_priority = SPIDER_PRIORITY_MAP.get(opinion_info.get("spider_priority", "normal").lower(), 0)
            # manual_score = game.get("manual_score", 0)
            similarity = game.get("similarity", 0.0)
            similarity_group = 1 if similarity >= SIMILARITY_THRESHOLD.SIMILARITY_HIGH_THRESHOLD.value else 0
            
            return (-similarity_group, 
                    -spider_status, 
                    -spider_priority, 
                    -platform_priority)
        
        sorted_games = sorted(games, key=sort_key)
        return sorted_games


class SimilarityAnalyzer:
    """相似度分析器"""
    
    @staticmethod
    def analyze_similarity(opinion_similarity: float, intelligence_similarity: float) -> Tuple[str, str]:
        """
        分析相似度并返回处理策略
        
        Returns:
            Tuple[strategy, reason]: 策略和原因说明
        """
        if opinion_similarity >= SIMILARITY_THRESHOLD.SIMILARITY_HIGH_THRESHOLD.value:
            return "databrain", f"高相似度匹配 (sim={opinion_similarity:.3f})"
        
        elif SIMILARITY_THRESHOLD.SIMILARITY_LOW_THRESHOLD.value < opinion_similarity < SIMILARITY_THRESHOLD.SIMILARITY_HIGH_THRESHOLD.value:
            if intelligence_similarity >= SIMILARITY_THRESHOLD.INTELLIGENCE_THRESHOLD.value:
                return "websearch", f"中等相似度且情报高匹配 (opinion_sim={opinion_similarity:.3f}, intel_sim={intelligence_similarity:.3f})"
            else:
                return "databrain", f"中等相似度且情报低匹配 (opinion_sim={opinion_similarity:.3f}, intel_sim={intelligence_similarity:.3f})"
        
        else:  # opinion_similarity < SIMILARITY_THRESHOLD.SIMILARITY_LOW_THRESHOLD.value
            return "websearch", f"低相似度匹配 (sim={opinion_similarity:.3f})"


@alru_cache(maxsize=24, ttl=1800)  # 30分钟缓存
async def _search_game_opinion(game_names_tuple: tuple, token: str) -> Tuple[List[str], List[str], Dict]:
    """
    游戏搜索函数 - 按照流程图逻辑
    
    Args:
        game_names_tuple: 游戏名称元组
        token: 认证token
    
    Returns:
        Tuple[game_ids, entity_names, game_info_dict]
    """
    game_names = list(game_names_tuple)
    if not game_names:
        return [], [], {}
    
    logger.info(f"【游戏搜索开始】查询游戏: {game_names}")
    
    search_engine = GameSearchEngine()
    similarity_analyzer = SimilarityAnalyzer()
    result = GameSearchResult()
    
    try:
        # 1. 调用舆情接口搜索（ES匹配，获取top5）
        opinion_data = await search_engine.search_opinion_api(game_names, token)
        logger.debug(f"【舆情接口返回】获取到 {len(opinion_data)} 个游戏数据")
        
        # 2. 分析每个游戏的舆情相似度，筛选出需要查询情报接口的游戏（和舆情接口串行，可能会导致性能下降）
        intelligence_needed_games = []
        intelligence_game_mapping = {}  # 用于映射情报查询结果到原始游戏
        
        for i, search_name in enumerate(game_names):
            opinion_games = _extract_game_list(opinion_data, i)
            if opinion_games:
                opinion_sim = opinion_games[0].get("similarity", 0.0)
                # 只有在中等相似度范围内才需要查询情报接口
                if (SIMILARITY_THRESHOLD.SIMILARITY_LOW_THRESHOLD.value <= opinion_sim < 
                    SIMILARITY_THRESHOLD.SIMILARITY_HIGH_THRESHOLD.value):
                    intelligence_needed_games.append(search_name)
                    intelligence_game_mapping[search_name] = i
                    logger.debug(f"【需要情报查询】{search_name} (similarity={opinion_sim:.3f})")
        
        # 3. 批量调用情报接口（如果有需要的话）
        intelligence_data = []
        if intelligence_needed_games:
            logger.info(f"【批量调用情报接口】需要查询 {len(intelligence_needed_games)} 个游戏")
            intelligence_data = await search_engine.search_intelligence_api(intelligence_needed_games, token)
            logger.debug(f"【情报接口返回】获取到 {len(intelligence_data)} 个游戏数据")
        
        # 4. 处理每个游戏的搜索结果
        for i, search_name in enumerate(game_names):
            # 获取舆情数据
            opinion_games = _extract_game_list(opinion_data, i)
            opinion_sim = opinion_games[0].get("similarity", 0.0) if opinion_games else 0.0
            
            # 获取情报数据（如果需要的话）
            intelligence_sim = 0.0
            intelligence_games = []
            if search_name in intelligence_game_mapping:
                # 查找对应的情报数据
                intel_index = intelligence_needed_games.index(search_name)
                if intel_index < len(intelligence_data):
                    intelligence_games = _extract_game_list(intelligence_data, intel_index)
                    intelligence_sim = intelligence_games[0].get("similarity", 0.0) if intelligence_games else 0.0
            
            logger.debug(f"【相似度分析】{search_name}: opinion={opinion_sim:.3f}, intelligence={intelligence_sim:.3f}")
            
            # 5. 根据相似度组合判断决定处理策略
            strategy, reason = similarity_analyzer.analyze_similarity(opinion_sim, intelligence_sim)
            logger.info(f"【游戏处理策略】{search_name}: {strategy} - {reason}")
            
            # 根据策略和相似度确定基础结果类型
            if opinion_sim >= SIMILARITY_THRESHOLD.SIMILARITY_HIGH_THRESHOLD.value:
                # 高舆情相似度匹配
                base_result_type = GAME_SEARCH_RESULT.NORMAL
                logger.info(f"【高相似度匹配】{search_name}: {opinion_sim:.3f}")
            elif (SIMILARITY_THRESHOLD.SIMILARITY_LOW_THRESHOLD.value <= opinion_sim < 
                  SIMILARITY_THRESHOLD.SIMILARITY_HIGH_THRESHOLD.value):
                if intelligence_sim >= SIMILARITY_THRESHOLD.INTELLIGENCE_THRESHOLD.value:
                    # 中等相似度且情报高匹配 - 舆情未配置该游戏主体
                    base_result_type = GAME_SEARCH_RESULT.NO_OPINION
                    logger.info(f"【舆情未配置主体】{search_name}: opinion={opinion_sim:.3f}, intel={intelligence_sim:.3f}")
                else:
                    # 中等相似度且情报低匹配 - 模糊匹配
                    base_result_type = GAME_SEARCH_RESULT.FUZZY_MATCH
                    logger.info(f"【模糊匹配】{search_name}: opinion={opinion_sim:.3f}, intel={intelligence_sim:.3f}")
            elif opinion_sim < SIMILARITY_THRESHOLD.SIMILARITY_LOW_THRESHOLD.value:
                # 低相似度 - 舆情里没有相关主体
                base_result_type = GAME_SEARCH_RESULT.NO_DATABRAIN
                logger.info(f"【无相关主体】{search_name}: {opinion_sim:.3f}")
            else:
                base_result_type = GAME_SEARCH_RESULT.ERROR
                logger.info(f"【错误】{search_name}: {opinion_sim:.3f}")
            
            # 根据策略执行具体处理
            if strategy == "databrain":
                # Databrain策略：对数据进行排序，选择用户关注度最高的游戏
                sorted_games = search_engine.sort_databrain_games(opinion_games)
                selected_game = sorted_games[0]
                
                # 根据爬虫状态和优先级决定最终结果类型和提示信息
                opinion_info = selected_game.get("opinion_info", {})
                spider_status = opinion_info.get("spider_status", 0)
                spider_priority = opinion_info.get("spider_priority", "normal").lower()
                
                if spider_status == 1:
                    # 爬虫正常运行
                    if spider_priority == "normal":
                        # 爬虫运行但优先级低
                        result.add_game(search_name, selected_game, GAME_SEARCH_RESULT.LOW_PRIORITY,
                                      "当前游戏优先级低，舆情数据可能不全，可联系sophiaxwxu@tencent.com提高游戏优先级或要求Agent进行联网搜索 **必须**使用websearch_tool进行联网搜索")
                        logger.info(f"【{base_result_type.value}-优先级低】{search_name} -> {selected_game.get('entity_name')}")
                    else:
                        # 爬虫运行且优先级正常
                        result.add_game(search_name, selected_game, base_result_type)
                        logger.info(f"【{base_result_type.value}】{search_name} -> {selected_game.get('entity_name')}")
                elif spider_status == 0:
                    # 爬虫已停止
                    result.add_game(search_name, selected_game, GAME_SEARCH_RESULT.SPIDER_STOPPED,
                                  f"当前游戏页面访问低，暂无数据拉取任务，可联系sophiaxwxu@tencent.com重启外部数据拉取 **必须**使用websearch_tool进行联网搜索")
                    logger.info(f"【爬虫已停止】{search_name} -> {selected_game.get('entity_name')}")
                else:
                    result.add_game(search_name, selected_game, GAME_SEARCH_RESULT.ERROR,
                                  f"在Databrain未找到游戏{search_name}，**必须**使用websearch_tool进行联网搜索")
                    logger.info(f"【未知状态】{search_name} -> spider_status: {spider_status}")
            
            elif strategy == "websearch":
                # 网络搜索策略 - 根据不同场景选择最佳游戏信息
                if base_result_type == GAME_SEARCH_RESULT.NO_OPINION:
                    # 舆情未配置该游戏主体 - 优先使用intelligence的高匹配结果
                    best_game = intelligence_games[0] if intelligence_games else (opinion_games[0] if opinion_games else None)
                    if best_game:
                        result.add_game(search_name, best_game, base_result_type,
                                      f"在Databrain找到游戏{best_game.get('entity_name')}，但舆情未配置该游戏主体，舆情数据需要通过网络搜索获取")
                    else:
                        empty_game_info = {"game_id": None, "entity_name": search_name}
                        result.add_game(search_name, empty_game_info, base_result_type,
                                      f"舆情未配置游戏{search_name}主体，舆情数据需要通过网络搜索获取")
                elif base_result_type == GAME_SEARCH_RESULT.NO_DATABRAIN:
                    # 舆情里没有相关主体 - 使用最佳可用信息
                    best_game = intelligence_games[0] if intelligence_games else (opinion_games[0] if opinion_games else None)
                    if best_game:
                        result.add_game(search_name, best_game, base_result_type,
                                      f"在Databrain找到游戏{best_game.get('entity_name')}，但与{search_name}相似度较低，舆情数据需要通过网络搜索获取")
                    else:
                        empty_game_info = {"game_id": None, "entity_name": search_name}
                        result.add_game(search_name, empty_game_info, base_result_type,
                                      f"在Databrain未找到游戏{search_name}，舆情数据需要通过网络搜索获取")
                
                logger.info(f"【网络搜索-{base_result_type.value}】{search_name}")
        
        # 6. 去重处理
        _deduplicate_results(result)
        
        logger.info(f"【搜索完成】成功获取 {len(result.game_ids)} 个有效游戏，{len(result.game_info_dict)} 个游戏信息")
        return result.game_ids, result.entity_names, result.game_info_dict
        
    except Exception as e:
        logger.error(f"【游戏搜索失败】{e}")
        return [], [], {}


def _extract_game_list(api_data: List, index: int) -> List[Dict]:
    """从API数据中提取指定索引的游戏列表"""
    if not api_data or index >= len(api_data):
        return []
    
    item = api_data[index]
    if isinstance(item, dict) and "list" in item:
        return item.get("list", [])
    elif isinstance(item, dict):
        return [item]
    return []


def _deduplicate_results(result: GameSearchResult):
    """去重处理 - 移除重复的game_id"""
    seen_game_ids = set()
    dedupe_game_ids = []
    dedupe_entity_names = []
    
    for i, game_id in enumerate(result.game_ids):
        if game_id and game_id not in seen_game_ids:
            seen_game_ids.add(game_id)
            dedupe_game_ids.append(game_id)
            dedupe_entity_names.append(result.entity_names[i])
        else:
            logger.info(f"【去重处理】移除重复游戏ID: {game_id}")
    
    result.game_ids = dedupe_game_ids
    result.entity_names = dedupe_entity_names


# 为了兼容性，提供一个简化的调用接口
async def search_games_by_opinion(game_names: List[str], token: str) -> Tuple[List[str], List[str], Dict]:
    """
    简化的游戏搜索接口
    
    Args:
        game_names: 游戏名称列表
        token: 认证token
    
    Returns:
        Tuple[game_ids, entity_names, game_info_dict]
    """
    return await _search_game_opinion(tuple(game_names), token)


# 单元测试
async def test_game_search():
    """游戏搜索功能测试"""
    print("=" * 50)
    print("游戏搜索功能测试")
    print("=" * 50)

    gl.set_value("ENV", os.environ.get("ENVIRONMENT", "local.local"))
    logger.info(f"ENV: {gl.get_value('ENV')}")
    init_rainbow("databrain_host.base", {"rb_strategy_json": "strategy.json", "rb_test_json": "test.json"})
    
    token = gl.get_value("rb_test_json", expected_type=dict).get("token", "")
    
    for i, game_names in enumerate(test_cases, 1):
        print(f"\n测试用例 {i}: {game_names}")
        print("-" * 30)
        
        try:
            game_ids, entity_names, game_info_dict = await search_games_by_opinion(game_names, token)
            
            print(f"返回的游戏ID: {game_ids}")
            print(f"实体名称: {entity_names}")
            print(f"游戏信息数量: {len(game_info_dict)}")
            
            # 详细分析每个游戏的搜索结果
            for name, info in game_info_dict.items():
                result_type = info['search_result']
                print(f"\nsearch_name: {name}")
                print(f"entity_name: {info['entity_name']}")
                print(f"game_id: {info['game_id']}")
                print(f"entity_type: {info['entity_type']}")
                print(f"search_result: {result_type}")
                print(f"opinion_similarity: {info.get('similarity', 'N/A')}")
                print(f"spider_status: {info.get('spider_status', 'N/A')}")
                print(f"spider_priority: {info.get('spider_priority', 'N/A')}")
                print(f"platform: {info['platform']}")
                if info.get('message'):
                    print(f"message: {info['message']}")
                    
        except Exception as e:
            print(f"❌ 测试失败: {e}")
    
    print("\n" + "=" * 50)
    print("测试完成")


if __name__ == "__main__":
    import asyncio
    """
    测试：在databrain_host目录下执行
    ENVIRONMENT=local.local PYTHONPATH="$PYTHONPATH:$(pwd)/../.." python tools/opinion/utils/game_search.py
    """
    # 运行测试
    print("启动游戏搜索模块测试...")

        # 测试游戏列表
    test_cases = [
        ["pubg","dune","warframe","MLBB","Animal Crossing","Ruiner","SYNTHETIK: Legion Rising","BL6","Garena Free Fire"]
    ]
    
    asyncio.run(test_game_search())

