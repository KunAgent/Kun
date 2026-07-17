import re
from datetime import datetime, timedelta, timezone
from loguru import logger
from dashboard_common.config import globalvar as gl
from dashboard_strategy.constants import AgentName
from typing import List
from loguru import logger

    # ==================== 关键词规则配置 ====================
    # 定义关键词模式和对应的规则，使用正则表达式进行匹配
    # 配置说明：
    # - 键：正则表达式模式，用于匹配用户查询中的关键词
    # - 值：包含'title'和'rules'的字典
    #   - title: 规则的标题（用于日志记录）
    #   - rules: 当匹配到关键词时要添加的具体规则文本
    # 
    # 使用示例：
    # 1. 添加新的关键词规则：
    #    keyword_rules_config[r'(新关键词|new_keyword)'] = {
    #        'title': 'My Custom Rules',
    #        'rules': '**Custom Rules:**\n- 自定义规则内容'
    #    }
    #
    # 2. 支持的正则表达式功能：
    #    - 简单匹配：r'(steam|评分)' 
    #    - 复杂匹配：r'(最近|近期).*?(天|日|周)'
    #    - 可选匹配：r'update.*?(内容|影响)?'
    #
    # 3. 匹配示例：
    #    - "steam评分怎么样" → 匹配Steam规则
    #    - "最近一周的热门内容" → 匹配时间范围规则和热门内容规则
    #    - "竞品销量对比分析" → 匹配竞品分析规则和销量规则
    
keyword_rules_config = {
    # Steam评分相关规则
#     r'(steam|score|评分|好评率)': {
# 'title': 'Steam Score Rules',
# 'rules': """**Steam Score Rules:**
# Tool: get_game_score  
# 累计评分（cumulative score, period=cumulative, metrics=[score, review_count]）
# 新增评分（incremental score, period=incremental, metrics=[score, review_count]）
# 注：“实时/最新评分（latest score）”需要并行call两次get_game_score，分别查询累计评分和新增评分
# """
#     },
#     r'(热门|火|排行|贴|视频|trending|hot|post|video|top)': {
# 'title': 'Hot Posts Rules',
# 'rules': """**Hot Posts Rules:**
# - 利用 read_data 从 feeds 表获取热门内容feeds.content，按照 engagement（或 views/likes）排序
# - 必须设置 ungrouped=True，并结合 limit，例如 Top 10
# - 输出结果需包含：帖子标题、帖子 URL 链接、渠道、发布时间、发布人、观看量、点赞数、互动量
# """
#     },
#     # 竞品分析相关规则
#     r'(competitor|竞品|相比|对比|比较|compar)': {
# 'title': 'Competitor Analysis Rules',
# 'rules': """**Competitor Analysis Rules:**
# - When user asks about competitor analysis
# -首先使用read_data获取竞品游戏列表和game_id
# -对竞品进行舆情分析，dimensions中应包含游戏名称，对竞品进行对比分析"""
#     },
#     # 维度分析相关规则
#     r'(国家|国|各地|地区|语|中文|英文|东南亚|美国|日本|韩国|chinese|english|language|countr|region)': {
# 'title': 'Dimension Analysis Rules',
# 'rules': """**Dimension Analysis Rules:**
# 1. 如果有某语种/国家的表现特别突出，请特别展示该语种/国家的评分或声量数据
# 2. 分析比对Top语种/国家/地区和总量级各指标数据，对比各国家/语种/地区的差异，并给出分析结论
# """
#     },
#     # 上线游戏分析相关规则
#     r'(上线|上线游戏|上线时间|上线日期|release|launch)': {
# 'title': 'New Game Analysis Rules',
# 'rules': """**New Game Analysis Rules:**
# -所有的查询应该考虑上线时间，基于用户问题选择时间参数，声量等数据在上线前30天以上就可以开始分析，评分数据在上线当天开始才有数据
# -调用get_game_score查询累计评分数据, period=cumulative, metrics=[score, review_count], granularity=day
# -**必须**get_game_score查询小时级评分, period=incremental, metrics=[score, review_count], granularity=hour
# -利用opinion_summary_tool对上线游戏的舆情话题进行分析
# -所有的分析结论应该考虑游戏上线带来的影响
# """
#     },
        # 实时查询相关规则
#     r'(实时|即时|realtime|hour|minute)': {
# 'title': 'Realtime Rules',
# 'rules': """**Realtime Rules:**
# - 所有查询必须考虑“实时”语境，根据用户问题合理设置时间参数。
# - 调用 read_data 时，**必须** `granularity = hour`。
# - dateRange 必须为 "last N hours" 或具体的小时范围，格式为 ["YYYY-MM-DD HH:MM:SS","YYYY-MM-DD HH:MM:SS"]。
# """
#     }
}

def get_keyword_rules(query_text: str, rules_config: dict) -> str:
    """根据用户查询应用相应的关键词规则"""
    if not query_text:
        return ""
        
    matched_rules = []
    query_lower = query_text.lower()
    
    # 获取Rainbow关键词规则
    rules = get_extension_rules(AgentName.OpinionAgent.value, "prompt", query_text)
    # 遍历所有规则配置
    for pattern, rule_config in rules_config.items():
        # 使用正则表达式进行匹配
        if re.search(pattern, query_lower, re.IGNORECASE):
            matched_rules.append(rule_config['rules'])
            logger.info(f"【关键词规则匹配】模式: {pattern}, 标题: {rule_config['title']}")
    
    # 返回所有匹配的规则，用换行连接
    return "\n".join(matched_rules) + "\n".join(rules) if matched_rules or rules else ""

# ==================== Rainbow规则配置 ====================
# 基于Rainbow配置的关键词召回规则
def get_extension_rules(agent_name: str, rule_type: str, user_input: str) -> List[str]:
    rules = gl.get_value("rb_strategy_json", expected_type=dict).get("agent_rules", {}).get(agent_name, [])
    user_input_lower = user_input.lower()
    output: List[str] = []
    for rule in rules:
        # if any non-empty substring is in user_input.lower()
        if any(substr.lower() in user_input_lower for substr in rule.get("contains", []) if substr != ""):
            output.append(rule.get(rule_type, ""))
    return output

# ==================== 游戏信息规则配置 ====================
# 基于游戏信息（release_time, platform, entity_type等）的规则系统

def get_game_info_rules(game_info_dict: dict, user_query: str = "") -> str:
    """
    根据游戏信息生成相应的分析规则
    
    Args:
        game_info_dict: 游戏信息字典，包含各游戏的详细信息
        user_query: 用户查询文本，用于更精确的规则匹配
        
    Returns:
        根据游戏信息生成的规则文本
    """
    if not game_info_dict:
        return ""
    
    rules = []
    current_time = datetime.now(timezone(timedelta(hours=8)))
    
    # 遍历所有游戏信息
    for game_name, game_info in game_info_dict.items():
        game_rules = _analyze_single_game_info(game_info, game_name, current_time, user_query)
        if game_rules:
            rules.extend(game_rules)
    
    return "\n\n".join(rules) if rules else ""


def _analyze_single_game_info(game_info: dict, game_name: str, current_time: datetime, user_query: str = "") -> list:
    """分析单个游戏信息并生成相应规则"""
    rules = []
    
    # 1. 基于发布时间的规则
    release_time_rule = _get_release_time_rules(game_info, game_name, current_time, user_query)
    if release_time_rule:
        rules.append(release_time_rule)
    
    # 2. 基于平台的规则
    platform_rule = _get_platform_rules(game_info, game_name, user_query)
    if platform_rule:
        rules.append(platform_rule)
    
    # 4. 基于搜索结果状态的规则
    search_result_rule = _get_search_result_rules(game_info, game_name, user_query)
    if search_result_rule:
        rules.append(search_result_rule)
    
    return rules


def _get_release_time_rules(game_info: dict, game_name: str, current_time: datetime, user_query: str = "") -> str:
    """基于发布时间生成规则"""
    release_time_str = game_info.get("release_time", "")
    if not release_time_str:
        return ""
    
    try:
        # 尝试解析发布时间（支持多种格式）
        if len(release_time_str) == 4:  # 只有年份
            release_time = datetime(int(release_time_str), 1, 1)
        elif len(release_time_str) == 7:  # YYYY-MM
            year, month = release_time_str.split('-')
            release_time = datetime(int(year), int(month), 1)
        elif len(release_time_str) == 10:  # YYYY-MM-DD
            release_time = datetime.strptime(release_time_str, "%Y-%m-%d")
        else:
            return ""
        
        # 统一日期格式，只比较日期部分，忽略具体时间
        current_date = current_time.date()
        release_date = release_time.date()
        days_since_release = (current_date - release_date).days
        
        if days_since_release < 0:
            # 未来发布的游戏
            return f"""**{game_name} - To be released**
- Query the pre-launch sentiment and player discussions"""
        elif days_since_release <= 3:
            # 新发布游戏（3天内）
            return f"""**{game_name} - Newly released {days_since_release} days ago**
- Query the game score and sentiment changes (hourly) and player feedback during the pre-launch period of the first 3 days"""
        elif days_since_release <= 30:
            # 最近发布游戏（30天内）
            return f"""**{game_name} - Released {days_since_release} days ago**
- Analyze the game score and sentiment trend, pay attention to the player feedbacks. Query content updates if needed."""
        else:
            # 老游戏
            return f"""**{game_name} - Released {days_since_release} days ago**
- Analyze the long-term mentions and sentiment trend, pay attention to the player feedbacks. Query content updates if needed. Pay attention to the major updates, DLC releases and their impact on sentiment"""
    
    except (ValueError, TypeError):
        logger.warning(f"Failed to parse the release time of game {game_name}: {release_time_str}")
        return ""


def _get_platform_rules(game_info: dict, game_name: str, user_query: str = "") -> str:
    """基于平台生成规则"""
    platforms = game_info.get("platform", [])
    entity_type = game_info.get("entity_type", "").lower()
    
    if not platforms and not entity_type:
        return ""
    
    platform_rules = []
    
    if "mobile" in entity_type or "Mobile" in platforms:
        platform_rules.append(f"""**{game_name} - Mobile**
- Analyze the mobile score, sentiment and mentions, pay attention to the player feedbacks.""")
    
    if "pc" in entity_type or "PC" in platforms:
        platform_rules.append(f"""**{game_name} - PC:**
- Analyze the steam score, sentiment and mentions, pay attention to the player feedbacks.""")
    
#     # 多平台游戏的特殊规则
#     if len(platforms) > 1:
#         platform_rules.append(f"""**{game_name} - 多平台游戏:**
# - 对比不同平台的表现差异和玩家反馈
# - 分析跨平台功能和体验的舆情表现
# - 重点关注平台独有功能或限制的玩家反应""")
    
    return "\n\n".join(platform_rules)

def _get_search_result_rules(game_info: dict, game_name: str, user_query: str = "") -> str:
    """基于搜索结果状态生成规则"""
    search_result = game_info.get("search_result", "")
    message = game_info.get("message", "")
    
    rules = []
    
    if search_result in ["fuzzy_match", "low_priority", "spider_stopped", "no_databrain", "no_opinion"]:
        rules.append(f"""**{game_name} - Data Acquisition Suggestions:**
- The tool data may not be sufficient, call websearch_tool to get more data to answer the question.""")
    
    return "\n\n".join(rules)
