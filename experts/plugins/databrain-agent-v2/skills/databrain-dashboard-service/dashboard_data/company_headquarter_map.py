# Company Headquarter Map
# 
# 维护 publisher/developer 名称（小写）到总部所在地（country + region）的映射。
# 用于 get_topN_games_by_filters 工具支持按公司所在地区/国家筛选游戏。
# 字段名 company_headquarter 与 get_topN_companies 工具保持一致。
#
# 使用方式：
#   from dashboard_data.company_headquarter_map import PUBLISHER_REGION_MAP, REGION_PUBLISHER_MAP
#
# 维护指南：
#   - PUBLISHER_REGION_MAP: key 为 publisher 名称（小写），value 为 (country, region) 元组
#   - 新增公司时，请在 PUBLISHER_REGION_MAP 中添加条目
#   - REGION_PUBLISHER_MAP / COUNTRY_PUBLISHER_MAP 会自动反向构建
#   - region 建议使用: "asia", "north_america", "europe", "other"
#   - country 使用小写英文国家名: "china", "japan", "south_korea", "usa", "france" 等
#   - publisher 名称应使用小写，且尽量覆盖常见别名/写法

# ==================== Publisher → (Country, Region) 映射 ====================
# key: publisher 名称（小写）, value: (country, region)
PUBLISHER_REGION_MAP = {
    # ==================== Asia - China ====================
    "tencent": ("china", "asia"),
    "tencent games": ("china", "asia"),
    "tencent mobile games": ("china", "asia"),
    "腾讯": ("china", "asia"),
    "腾讯游戏": ("china", "asia"),
    "netease": ("china", "asia"),
    "netease games": ("china", "asia"),
    "网易": ("china", "asia"),
    "网易游戏": ("china", "asia"),
    "mihoyo": ("china", "asia"),
    "mihoyo limited": ("china", "asia"),
    "cognosphere": ("china", "asia"),  # miHoYo's global publishing arm
    "cognosphere pte. ltd.": ("china", "asia"),
    "hoyoverse": ("china", "asia"),
    "米哈游": ("china", "asia"),
    "lilith games": ("china", "asia"),
    "lilith technology": ("china", "asia"),
    "莉莉丝": ("china", "asia"),
    "莉莉丝游戏": ("china", "asia"),
    "funplus": ("china", "asia"),
    "funplus international ag": ("china", "asia"),
    "趣加": ("china", "asia"),
    "37games": ("china", "asia"),
    "37 games": ("china", "asia"),
    "37互娱": ("china", "asia"),
    "yostar": ("china", "asia"),
    "yostar limited": ("china", "asia"),
    "yostar games": ("china", "asia"),
    "papergames": ("china", "asia"),
    "papergames co., ltd.": ("china", "asia"),
    "infold games": ("china", "asia"),
    "bytedance": ("china", "asia"),
    "nuverse": ("china", "asia"),
    "朝夕光年": ("china", "asia"),
    "字节跳动": ("china", "asia"),
    "perfect world": ("china", "asia"),
    "perfect world games": ("china", "asia"),
    "完美世界": ("china", "asia"),
    "giant network": ("china", "asia"),
    "giant interactive": ("china", "asia"),
    "巨人网络": ("china", "asia"),
    "bilibili": ("china", "asia"),
    "bilibili inc.": ("china", "asia"),
    "哔哩哔哩": ("china", "asia"),
    "xd global": ("china", "asia"),
    "xd inc.": ("china", "asia"),
    "xd entertainment": ("china", "asia"),
    "心动网络": ("china", "asia"),
    "seasun games": ("china", "asia"),
    "seasun entertainment": ("china", "asia"),
    "西山居": ("china", "asia"),
    "kingsoft": ("china", "asia"),
    "hero entertainment": ("china", "asia"),
    "hero games": ("china", "asia"),
    "英雄互娱": ("china", "asia"),
    "4399": ("china", "asia"),
    "tap4fun": ("china", "asia"),
    "im30": ("china", "asia"),
    "habby": ("china", "asia"),
    "habby games": ("china", "asia"),
    "topwar studio": ("china", "asia"),
    "top war studio": ("china", "asia"),
    "diandian interactive": ("china", "asia"),
    "点点互动": ("china", "asia"),
    "igg": ("china", "asia"),
    "igg inc.": ("china", "asia"),
    "igg.com": ("china", "asia"),
    "moonton": ("china", "asia"),
    "moonton games": ("china", "asia"),
    "shanda games": ("china", "asia"),
    "盛大游戏": ("china", "asia"),
    "盛趣游戏": ("china", "asia"),
    "changyou": ("china", "asia"),
    "changyou.com": ("china", "asia"),
    "畅游": ("china", "asia"),
    "zulong entertainment": ("china", "asia"),
    "祖龙娱乐": ("china", "asia"),
    "century games": ("china", "asia"),
    "century game": ("china", "asia"),
    "世纪华通": ("china", "asia"),
    "cmge": ("china", "asia"),
    "中国手游": ("china", "asia"),
    "yotta games": ("china", "asia"),
    "yo1": ("china", "asia"),
    "galaxy interactive": ("china", "asia"),
    "ourpalm": ("china", "asia"),
    "掌趣科技": ("china", "asia"),
    "g-bits": ("china", "asia"),
    "g-bits network": ("china", "asia"),
    "吉比特": ("china", "asia"),
    "zlong games": ("china", "asia"),
    "紫龙游戏": ("china", "asia"),
    "dragonest": ("china", "asia"),
    "dragonest game": ("china", "asia"),
    "junhai games": ("china", "asia"),
    "longtugame": ("china", "asia"),
    "longtu game": ("china", "asia"),
    "龙图游戏": ("china", "asia"),
    "dreamstar": ("china", "asia"),
    "dreamstar network": ("china", "asia"),
    "droidhang games": ("china", "asia"),
    "yeeha games": ("china", "asia"),
    "trip.com game": ("china", "asia"),
    "snail games": ("china", "asia"),
    "snail games usa": ("china", "asia"),
    "蜗牛游戏": ("china", "asia"),
    "joycastle": ("china", "asia"),
    "youyoutang": ("china", "asia"),
    "youyoutang technology": ("china", "asia"),
    "wejoy": ("china", "asia"),
    "weipai": ("china", "asia"),
    "funfinity": ("china", "asia"),
    "funfinity hk": ("china", "asia"),
    "leiting games": ("china", "asia"),
    "leiting": ("china", "asia"),
    "雷霆游戏": ("china", "asia"),
    "wonder games": ("china", "asia"),
    "ohayoo": ("china", "asia"),  # ByteDance casual game brand
    "x.d. network": ("china", "asia"),
    "creator games": ("china", "asia"),
    "taptap": ("china", "asia"),
    "37 entertainment": ("china", "asia"),
    "r2games": ("china", "asia"),
    "u8 game": ("china", "asia"),
    "mechanist games": ("china", "asia"),
    "mechanist": ("china", "asia"),
    "gtarcade": ("china", "asia"),
    "youzu": ("china", "asia"),
    "youzu interactive": ("china", "asia"),
    "betta games": ("china", "asia"),
    "kok play": ("china", "asia"),
    "ftt games": ("china", "asia"),
    "dreamsky": ("china", "asia"),
    "aispeech": ("china", "asia"),
    
    # ==================== Asia - Japan ====================
    "sony": ("japan", "asia"),
    "sony interactive entertainment": ("japan", "asia"),
    "sie": ("japan", "asia"),
    "playstation": ("japan", "asia"),
    "square enix": ("japan", "asia"),
    "square enix co., ltd.": ("japan", "asia"),
    "bandai namco": ("japan", "asia"),
    "bandai namco entertainment": ("japan", "asia"),
    "bandai namco entertainment inc.": ("japan", "asia"),
    "capcom": ("japan", "asia"),
    "capcom co., ltd.": ("japan", "asia"),
    "sega": ("japan", "asia"),
    "sega corporation": ("japan", "asia"),
    "konami": ("japan", "asia"),
    "konami digital entertainment": ("japan", "asia"),
    "nintendo": ("japan", "asia"),
    "nintendo co., ltd.": ("japan", "asia"),
    "koei tecmo": ("japan", "asia"),
    "koei tecmo games": ("japan", "asia"),
    "atlus": ("japan", "asia"),
    "atlus co., ltd.": ("japan", "asia"),
    "fromsoft": ("japan", "asia"),
    "fromsoftware": ("japan", "asia"),
    "fromsoftware inc.": ("japan", "asia"),
    "spike chunsoft": ("japan", "asia"),
    "level-5": ("japan", "asia"),
    "level-5 inc.": ("japan", "asia"),
    "gungho": ("japan", "asia"),
    "gungho online": ("japan", "asia"),
    "gungho online entertainment": ("japan", "asia"),
    "colopl": ("japan", "asia"),
    "colopl inc.": ("japan", "asia"),
    "dena": ("japan", "asia"),
    "dena co., ltd.": ("japan", "asia"),
    "gree": ("japan", "asia"),
    "gree inc.": ("japan", "asia"),
    "cygames": ("japan", "asia"),
    "cygames inc.": ("japan", "asia"),
    "mixi": ("japan", "asia"),
    "mixi inc.": ("japan", "asia"),
    "akatsuki": ("japan", "asia"),
    "akatsuki inc.": ("japan", "asia"),
    "sumzap": ("japan", "asia"),
    "aniplex": ("japan", "asia"),
    "aniplex inc.": ("japan", "asia"),
    "aiming": ("japan", "asia"),
    "aiming inc.": ("japan", "asia"),
    "klab": ("japan", "asia"),
    "klab inc.": ("japan", "asia"),
    "goodroid": ("japan", "asia"),
    
    # ==================== Asia - South Korea ====================
    "nexon": ("south_korea", "asia"),
    "nexon company": ("south_korea", "asia"),
    "nexon korea": ("south_korea", "asia"),
    "netmarble": ("south_korea", "asia"),
    "netmarble corporation": ("south_korea", "asia"),
    "ncsoft": ("south_korea", "asia"),
    "ncsoft corporation": ("south_korea", "asia"),
    "krafton": ("south_korea", "asia"),
    "krafton inc.": ("south_korea", "asia"),
    "pubg corporation": ("south_korea", "asia"),
    "smilegate": ("south_korea", "asia"),
    "smilegate rpg": ("south_korea", "asia"),
    "smilegate entertainment": ("south_korea", "asia"),
    "kakao games": ("south_korea", "asia"),
    "kakao games corp.": ("south_korea", "asia"),
    "pearl abyss": ("south_korea", "asia"),
    "pearl abyss corp.": ("south_korea", "asia"),
    "com2us": ("south_korea", "asia"),
    "com2us corp.": ("south_korea", "asia"),
    "gamevil": ("south_korea", "asia"),
    "gamevil inc.": ("south_korea", "asia"),
    "shift up": ("south_korea", "asia"),
    "shift up corp.": ("south_korea", "asia"),
    "devsisters": ("south_korea", "asia"),
    "devsisters corporation": ("south_korea", "asia"),
    "neowiz": ("south_korea", "asia"),
    "neowiz games": ("south_korea", "asia"),
    "webzen": ("south_korea", "asia"),
    "webzen inc.": ("south_korea", "asia"),
    "line games": ("south_korea", "asia"),
    "line games corporation": ("south_korea", "asia"),
    "nhn": ("south_korea", "asia"),
    "nhn entertainment": ("south_korea", "asia"),
    "super creative": ("south_korea", "asia"),
    "supercreative": ("south_korea", "asia"),
    "haegin": ("south_korea", "asia"),
    "kabam": ("south_korea", "asia"),  # acquired by Netmarble (Korea)
    "kabam games": ("south_korea", "asia"),
    "crafton": ("south_korea", "asia"),
    "joycity": ("south_korea", "asia"),
    "supercent": ("south_korea", "asia"),
    "supercent inc.": ("south_korea", "asia"),
    "onestore": ("south_korea", "asia"),
    "sundaytoz": ("south_korea", "asia"),
    "sunday toz": ("south_korea", "asia"),
    "sunday.gg": ("south_korea", "asia"),
    "cookapps co.": ("south_korea", "asia"),
    "cookapps": ("south_korea", "asia"),
    "ngel games": ("south_korea", "asia"),
    "snowpipe": ("south_korea", "asia"),
    "ngelgames": ("south_korea", "asia"),
    "wemade": ("south_korea", "asia"),
    "wemade entertainment": ("south_korea", "asia"),
    "gravity": ("south_korea", "asia"),
    "gravity co.": ("south_korea", "asia"),
    "gravity co., ltd.": ("south_korea", "asia"),
    "awesomepiece": ("south_korea", "asia"),
    "shycheese": ("south_korea", "asia"),
    
    # ==================== Asia - Southeast Asia ====================
    "garena": ("singapore", "asia"),
    "garena online": ("singapore", "asia"),
    "sea limited": ("singapore", "asia"),
    "vng": ("vietnam", "asia"),
    "vng corporation": ("vietnam", "asia"),
    "vnggames": ("vietnam", "asia"),
    "razer": ("singapore", "asia"),
    "grab": ("singapore", "asia"),
    
    # ==================== Asia - India ====================
    "nazara technologies": ("india", "asia"),
    "nazara": ("india", "asia"),
    "games2win": ("india", "asia"),
    "octro": ("india", "asia"),
    "ncore games": ("india", "asia"),
    
    # ==================== Asia - Other ====================
    "yoozoo games": ("china", "asia"),
    "yoozoo interactive": ("china", "asia"),
    "游族网络": ("china", "asia"),
    
    # ==================== North America - USA ====================
    "microsoft": ("usa", "north_america"),
    "xbox game studios": ("usa", "north_america"),
    "activision": ("usa", "north_america"),
    "activision blizzard": ("usa", "north_america"),
    "blizzard entertainment": ("usa", "north_america"),
    "blizzard": ("usa", "north_america"),
    "electronic arts": ("usa", "north_america"),
    "ea": ("usa", "north_america"),
    "ea games": ("usa", "north_america"),
    "ea mobile": ("usa", "north_america"),
    "epic games": ("usa", "north_america"),
    "take-two interactive": ("usa", "north_america"),
    "take two interactive": ("usa", "north_america"),
    "rockstar games": ("usa", "north_america"),
    "2k games": ("usa", "north_america"),
    "2k": ("usa", "north_america"),
    "riot games": ("usa", "north_america"),
    "valve": ("usa", "north_america"),
    "valve corporation": ("usa", "north_america"),
    "bethesda": ("usa", "north_america"),
    "bethesda softworks": ("usa", "north_america"),
    "warner bros.": ("usa", "north_america"),
    "warner bros. games": ("usa", "north_america"),
    "wb games": ("usa", "north_america"),
    "apple": ("usa", "north_america"),
    "apple inc.": ("usa", "north_america"),
    "google": ("usa", "north_america"),
    "google llc": ("usa", "north_america"),
    "zynga": ("usa", "north_america"),
    "zynga inc.": ("usa", "north_america"),
    "roblox": ("usa", "north_america"),
    "roblox corporation": ("usa", "north_america"),
    "scopely": ("usa", "north_america"),
    "scopely inc.": ("usa", "north_america"),
    "jam city": ("usa", "north_america"),
    "jam city inc.": ("usa", "north_america"),
    "glu mobile": ("usa", "north_america"),
    "glu": ("usa", "north_america"),
    "playtika": ("usa", "north_america"),  # HQ in Israel but listed in US
    "playtika holdings": ("usa", "north_america"),
    "moon active": ("usa", "north_america"),  # Israel-based, global ops
    "sciplay": ("usa", "north_america"),
    "sciplay corporation": ("usa", "north_america"),
    "niantic": ("usa", "north_america"),
    "niantic inc.": ("usa", "north_america"),
    "bungie": ("usa", "north_america"),
    "bungie inc.": ("usa", "north_america"),
    "lion studios": ("usa", "north_america"),  # AppLovin subsidiary, San Francisco
    "lion studios plus": ("usa", "north_america"),
    "applovin": ("usa", "north_america"),
    "applovin corporation": ("usa", "north_america"),
    "chartboost": ("usa", "north_america"),
    "supersonic studios": ("usa", "north_america"),  # ironSource/Unity
    "supersonic": ("usa", "north_america"),
    "ironsource ltd.": ("usa", "north_america"),
    "ironsource": ("usa", "north_america"),
    "unity technologies": ("usa", "north_america"),
    "unity": ("usa", "north_america"),
    "ketchapp": ("usa", "north_america"),
    "azur games": ("usa", "north_america"),  # HQ in USA
    "azur interactive games": ("usa", "north_america"),
    "tapjoy": ("usa", "north_america"),
    "game district": ("usa", "north_america"),  # Pakistan-origin, US-registered
    "game district llc": ("usa", "north_america"),
    "astrasen global": ("usa", "north_america"),
    "turkey creek": ("usa", "north_america"),
    "print.de": ("usa", "north_america"),
    
    # ==================== Europe ====================
    "supercell": ("finland", "europe"),
    "king": ("sweden", "europe"),  # part of Activision Blizzard
    "king.com": ("sweden", "europe"),
    "dream games": ("turkey", "europe"),
    "ubisoft": ("france", "europe"),
    "ubisoft entertainment": ("france", "europe"),
    "gameloft": ("france", "europe"),
    "gameloft se": ("france", "europe"),
    "voodoo": ("france", "europe"),
    "focus entertainment": ("france", "europe"),
    "focus home interactive": ("france", "europe"),
    "embracer group": ("sweden", "europe"),
    "embracer": ("sweden", "europe"),
    "paradox interactive": ("sweden", "europe"),
    "paradox": ("sweden", "europe"),
    "cd projekt": ("poland", "europe"),
    "cd projekt red": ("poland", "europe"),
    "cd projekt s.a.": ("poland", "europe"),
    "frontier developments": ("uk", "europe"),
    "frontier": ("uk", "europe"),
    "saber interactive": ("sweden", "europe"),
    "505 games": ("italy", "europe"),
    "505 games s.r.l.": ("italy", "europe"),
    "team17": ("uk", "europe"),
    "team17 digital": ("uk", "europe"),
    "innogames": ("germany", "europe"),
    "innogames gmbh": ("germany", "europe"),
    "socialpoint": ("spain", "europe"),
    "socialpoint s.l.": ("spain", "europe"),
    "wargaming": ("cyprus", "europe"),
    "wargaming.net": ("cyprus", "europe"),
    "plarium": ("israel", "europe"),
    "plarium global ltd": ("israel", "europe"),
    "nordeus": ("serbia", "europe"),
    "belka games": ("cyprus", "europe"),  # Belarus-origin, Cyprus-registered
    "rollic": ("turkey", "europe"),
    "rollic games": ("turkey", "europe"),
    "rollic games oyun yazilim ve pazarlama anonim sirketi": ("turkey", "europe"),
    "rooftop games": ("turkey", "europe"),
    "rooftop games oyun teknolojileri anonim sirketi": ("turkey", "europe"),
    "brutal hamsi": ("turkey", "europe"),
    "good job games": ("turkey", "europe"),
    "ace games": ("turkey", "europe"),
    "peak games": ("turkey", "europe"),
    "peak": ("turkey", "europe"),
    "masomo": ("turkey", "europe"),
    "gram games": ("turkey", "europe"),
    "ruby games": ("turkey", "europe"),
    "alictus": ("turkey", "europe"),
    "matchingham games": ("turkey", "europe"),
    "tuto games": ("turkey", "europe"),
    
    # ==================== Other ====================
    "blackhub games": ("uae", "other"),
    "blackhub games fzco": ("uae", "other"),
}


# ==================== LLM 输入归一化映射 ====================
# LLM 可能传入各种写法的国家/地区名，归一化为映射表中使用的标准 key
# key: LLM 可能传入的值（小写），value: 标准化的 country 或 region 名
HEADQUARTER_ALIAS_MAP = {
    # Region aliases
    "asia": "asia",
    "asian": "asia",
    "north_america": "north_america",
    "north america": "north_america",
    "na": "north_america",
    "europe": "europe",
    "european": "europe",
    "eu": "europe",
    # China
    "china": "china",
    "chinese": "china",
    "cn": "china",
    "中国": "china",
    # Japan
    "japan": "japan",
    "japanese": "japan",
    "jp": "japan",
    "日本": "japan",
    # South Korea
    "south_korea": "south_korea",
    "south korea": "south_korea",
    "korea": "south_korea",
    "korean": "south_korea",
    "kr": "south_korea",
    "韩国": "south_korea",
    # USA
    "usa": "usa",
    "us": "usa",
    "united states": "usa",
    "united_states": "usa",
    "american": "usa",
    "america": "usa",
    "美国": "usa",
    # Specific European countries
    "france": "france",
    "french": "france",
    "法国": "france",
    "germany": "germany",
    "german": "germany",
    "德国": "germany",
    "uk": "uk",
    "united kingdom": "uk",
    "british": "uk",
    "英国": "uk",
    "sweden": "sweden",
    "swedish": "sweden",
    "瑞典": "sweden",
    "finland": "finland",
    "finnish": "finland",
    "芬兰": "finland",
    "poland": "poland",
    "polish": "poland",
    "波兰": "poland",
    "italy": "italy",
    "italian": "italy",
    "意大利": "italy",
    "spain": "spain",
    "spanish": "spain",
    "西班牙": "spain",
    "turkey": "turkey",
    "turkish": "turkey",
    "土耳其": "turkey",
    "israel": "israel",
    "以色列": "israel",
    "cyprus": "cyprus",
    "serbia": "serbia",
    # Southeast Asia
    "singapore": "singapore",
    "新加坡": "singapore",
    "vietnam": "vietnam",
    "越南": "vietnam",
    "india": "india",
    "indian": "india",
    "印度": "india",
    "southeast asia": "southeast_asia",
    "southeast_asia": "southeast_asia",
    "东南亚": "southeast_asia",
}


def _normalize_headquarter_value(value: str) -> str:
    """将 LLM 传入的国家/地区名归一化为标准 key"""
    if not value or not isinstance(value, str):
        return ""
    return HEADQUARTER_ALIAS_MAP.get(value.strip().lower(), value.strip().lower())


# ==================== Region → Publishers 反向映射 ====================
# 自动从 PUBLISHER_REGION_MAP 构建
def _build_region_publisher_map():
    """从 PUBLISHER_REGION_MAP 反向构建 region → set(publisher_names) 映射"""
    region_map = {}
    for publisher, (country, region) in PUBLISHER_REGION_MAP.items():
        region_lower = region.lower()
        if region_lower not in region_map:
            region_map[region_lower] = set()
        region_map[region_lower].add(publisher.lower())
    return region_map


def _build_country_publisher_map():
    """从 PUBLISHER_REGION_MAP 反向构建 country → set(publisher_names) 映射"""
    country_map = {}
    for publisher, (country, region) in PUBLISHER_REGION_MAP.items():
        country_lower = country.lower()
        if country_lower not in country_map:
            country_map[country_lower] = set()
        country_map[country_lower].add(publisher.lower())
    return country_map


REGION_PUBLISHER_MAP = _build_region_publisher_map()
COUNTRY_PUBLISHER_MAP = _build_country_publisher_map()

# 所有 region 值集合（用于判断输入是 region 还是 country）
_ALL_REGIONS = set(REGION_PUBLISHER_MAP.keys())
# 所有 country 值集合
_ALL_COUNTRIES = set(COUNTRY_PUBLISHER_MAP.keys())


# ==================== 辅助函数 ====================
def get_publisher_region(publisher_name: str) -> str:
    """
    查询 publisher 所属 region。
    
    Args:
        publisher_name: publisher 名称
    
    Returns:
        region 字符串（如 "asia", "north_america", "europe"），未知则返回 "unknown"
    """
    if not publisher_name or not isinstance(publisher_name, str):
        return "unknown"
    entry = PUBLISHER_REGION_MAP.get(publisher_name.strip().lower())
    if entry is None:
        return "unknown"
    return entry[1]  # (country, region) -> region


def get_publisher_country(publisher_name: str) -> str:
    """
    查询 publisher 所属 country。
    
    Args:
        publisher_name: publisher 名称
    
    Returns:
        country 字符串（如 "china", "japan", "usa"），未知则返回 "unknown"
    """
    if not publisher_name or not isinstance(publisher_name, str):
        return "unknown"
    entry = PUBLISHER_REGION_MAP.get(publisher_name.strip().lower())
    if entry is None:
        return "unknown"
    return entry[0]  # (country, region) -> country


def is_publisher_in_region(publisher_name: str, target_regions: list) -> bool:
    """
    检查 publisher 是否属于目标 region/country 列表。
    
    支持混合粒度匹配：target_regions 中可以同时包含 region 级别（如 "asia"）
    和 country 级别（如 "japan", "china"）的值。LLM 传入的值会先归一化。
    
    匹配逻辑：publisher 的 country 或 region 匹配 target 中任意一个即返回 True。
    
    Args:
        publisher_name: publisher 名称
        target_regions: 目标 region/country 列表，如 ["asia"] 或 ["japan"] 或 ["asia", "japan"]
    
    Returns:
        bool: 如果 publisher 属于任一目标 region/country 则返回 True
    """
    if not publisher_name or not target_regions:
        return False
    
    entry = PUBLISHER_REGION_MAP.get(publisher_name.strip().lower() if isinstance(publisher_name, str) else "")
    if entry is None:
        return False  # 未知 publisher 不匹配任何 target
    
    pub_country, pub_region = entry  # e.g. ("japan", "asia")
    
    for t in target_regions:
        if not t:
            continue
        normalized = _normalize_headquarter_value(t)
        if not normalized:
            continue
        # 匹配 region（如 "asia"）或 country（如 "japan"）
        if normalized == pub_region or normalized == pub_country:
            return True
    
    return False


def get_publishers_by_region(region: str) -> set:
    """
    获取指定 region 或 country 的所有 publisher 名称集合。
    
    Args:
        region: region 或 country 名称，如 "asia" 或 "japan"
    
    Returns:
        set: publisher 名称集合（小写）
    """
    normalized = _normalize_headquarter_value(region)
    # 先尝试 region 级别
    result = REGION_PUBLISHER_MAP.get(normalized, set())
    if result:
        return result
    # 再尝试 country 级别
    return COUNTRY_PUBLISHER_MAP.get(normalized, set())
