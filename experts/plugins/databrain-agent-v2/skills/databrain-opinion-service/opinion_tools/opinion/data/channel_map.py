"""
渠道代码映射表

用途：
- 将多样化的渠道输入（自然语言/渠道名/渠道代码）映射到：
  1) 标准渠道代码（用于 Feeds 等场景）

来源：常见映射与经验规则，可按需扩充/修正。
更新日期：2026-01-13
"""

# 所有合法的渠道代码
CHANNEL_CODE_MAP = {
    "bluenews",
    "vg247",
    "fivech",
    "sleekplan",
    "jpnkn",
    "nikke_ua",
    "mirrativ",
    "qq",
    "hok_cbt_chatting",
    "tof_chatting",
    "famitsu",
    "game_watch",
    "nordicgame",
    "unknowncheats",
    "quora",
    "reddit",
    "nishikiお問い合わせ詳細データ",
    "twitch_live",
    "gamersky",
    "youtube_live",
    "pathofexile",
    "forumlastepoch",
    "huya",
    "zendesk",
    "kuaishou",
    "chzzk",
    "pixiv",
    "metacritic",
    "steam",
    "vgtime",
    "pcgamesn",
    "navercafe",
    "twitch_keyword",
    "douyin",
    "qq_channel",
    "app store",
    "opencritic",
    "gameinformer",
    "dengekionline",
    "fatsharkgames",
    "pubgm_kesu",
    "discord",
    "tiktok",
    "opensurvey",
    "youtube_keyword",
    "google_keyword",
    "snackvideo",
    "forumblizzard",
    "forumsbohemia",
    "xiaoheihe",
    "meta_store",
    "taptap",
    "tap io",
    "mlbb_suggestion",
    "gamesindustry",
    "ign",
    "elitepvpers",
    "level infinite pass",
    "vk",
    "3dm",
    "arca",
    "bilibili",
    "threads",
    "xbox",
    "steamdb",
    "epgame",
    "droidgamers",
    "pacgamer",
    "4gamer",
    "gamereactor",
    "game_with",
    "游戏葡萄",
    "co_ptimus",
    "游戏陀螺",
    "nga",
    "tieba",
    "feedback",
    "questionnaire",
    "instagram",
    "forumgamer",
    "featureupvote",
    "aha",
    "facebook",
    "pubgm_wiki",
    "bistudio",
    "steam_community",
    "google play",
    "gamerspot",
    "steamcommunity",
    "bsky",
    "dcinside",
    "funcom forum",
    "kwai",
    "pubgm_security",
    "kick",
    "xiaoheihe_store",
    "游戏茶馆",
    "allgames",
    "ua_facebook",
    "supercell stores",
    "twitter",
    "tumblr",
    "nikke_community",
    "line",
    "navergame",
    "pubgm_chat",
    "hok_camp",
    "xiaohongshu",
    "heybox",
    "tiktok_ads",
    "playstation",
    "uamo_chatting"
}

# 别名/自然语言到标准渠道代码的映射
_VARIANT_TO_CHANNEL = {
    # Social Media - 社交媒体
    "youtube": ["youtube_keyword"],
    "youtubekeyword": ["youtube_keyword"],
    "youtubelive": ["youtube_live"],
    "twitter": ["twitter"],
    "x": ["twitter"],  # X (formerly Twitter)
    "facebook": ["facebook"],
    "fb": ["facebook"],
    "instagram": ["instagram"],
    "ig": ["instagram"],
    "tiktok": ["tiktok"],
    "tiktokads": ["tiktok_ads"],
    "reddit": ["reddit"],
    "discord": ["discord"],
    "twitch": ["twitch_keyword"],
    "twitchkeyword": ["twitch_keyword"],
    "twitchlive": ["twitch_live"],
    "bilibili": ["bilibili"],
    "threads": ["threads"],
    "tumblr": ["tumblr"],
    "bsky": ["bsky"],
    "bluesky": ["bsky"],
    "vk": ["vk"],
    "line": ["line"],
    "kick": ["kick"],
    "pixiv": ["pixiv"],
    "nikkecommunity": ["nikke_community"],
    "nikke_community": ["nikke_community"],
    "blablalink": ["nikke_community"],   # NIKKE 独立社区站点
    
    # Chinese Social - 中文社交媒体
    "qq": ["qq"],
    "qqchannel": ["qq_channel"],
    "qq频道": ["qq_channel"],
    "xiaohongshu": ["xiaohongshu"],
    "小红书": ["xiaohongshu"],
    "douyin": ["douyin"],
    "抖音": ["douyin"],
    "kuaishou": ["kuaishou"],
    "快手": ["kuaishou"],
    "kwai": ["kwai"],
    "snackvideo": ["snackvideo"],
    "tieba": ["tieba"],
    "贴吧": ["tieba"],
    "huya": ["huya"],
    "虎牙": ["huya"],
    "mirrativ": ["mirrativ"],
    "chzzk": ["chzzk"],
    
    # Game Stores - 游戏商店
    "steam": ["steam"],
    "googleplay": ["google play"],
    "google play": ["google play"],
    "appstore": ["app store"],
    "app store": ["app store"],
    "metastore": ["meta_store"],
    "meta store": ["meta_store"],
    "xbox": ["xbox"],
    "playstation": ["playstation"],
    "ps": ["playstation"],
    "taptap": ["taptap"],
    "tap io": ["tap io"],
    "tapio": ["tap io"],
    
    # Gaming Communities - 游戏社区
    "steamcommunity": ["steam_community"],
    "steam community": ["steam_community"],
    "steamdb": ["steamdb"],
    "navergame": ["navergame"],
    "naver game": ["navergame"],
    "navercafe": ["navercafe"],
    "naver cafe": ["navercafe"],
    "dcinside": ["dcinside"],
    "arca": ["arca"],
    "nga": ["nga"],
    "xiaoheihe": ["xiaoheihe"],
    "小黑盒": ["xiaoheihe"],
    "xiaoheihestore": ["xiaoheihe_store"],
    "heybox": ["heybox"],
    "3dm": ["3dm"],
    
    # Review Sites - 评测网站
    "metacritic": ["metacritic"],
    "opencritic": ["opencritic"],
    "ign": ["ign"],
    "gamesindustry": ["gamesindustry"],
    "gameinformer": ["gameinformer"],
    "vg247": ["vg247"],
    "pcgamesn": ["pcgamesn"],
    "gamerspot": ["gamerspot"],
    "4gamer": ["4gamer"],
    "famitsu": ["famitsu"],
    "dengekionline": ["dengekionline"],
    "gamewith": ["game_with"],
    "game with": ["game_with"],
    "gamewatch": ["game_watch"],
    "game watch": ["game_watch"],
    "gamereactor": ["gamereactor"],
    "vgtime": ["vgtime"],
    "gamersky": ["gamersky"],
    "游民星空": ["gamersky"],
    "游戏葡萄": ["游戏葡萄"],
    "游戏陀螺": ["游戏陀螺"],
    "游戏茶馆": ["游戏茶馆"],
    "allgames": ["allgames"],
    "droidgamers": ["droidgamers"],
    "pacgamer": ["pacgamer"],
    "nordicgame": ["nordicgame"],
    "bluenews": ["bluenews"],
    
    # Forums - 论坛
    "forumgamer": ["forumgamer"],
    "forumblizzard": ["forumblizzard"],
    "forumsbohemia": ["forumsbohemia"],
    "forumlastepoch": ["forumlastepoch"],
    "funcomforum": ["funcom forum"],
    "funcom forum": ["funcom forum"],
    "funcom": ["funcom forum"],
    "pathofexile": ["pathofexile"],
    "poe": ["pathofexile"],
    "fatsharkgames": ["fatsharkgames"],
    "bistudio": ["bistudio"],
    "elitepvpers": ["elitepvpers"],
    "unknowncheats": ["unknowncheats"],
    "quora": ["quora"],
    
    # Feedback Tools - 反馈工具
    "feedback": ["feedback"],
    "questionnaire": ["questionnaire"],
    "zendesk": ["zendesk"],
    "featureupvote": ["featureupvote"],
    "aha": ["aha"],
    "sleekplan": ["sleekplan"],
    "opensurvey": ["opensurvey"],
    
    # Game-specific - 游戏专属
    "nikkeua": ["nikke_ua"],
    "nikke ua": ["nikke_ua"],
    "nikkecommunity": ["nikke_community"],
    "nikke community": ["nikke_community"],
    "pubgmkesu": ["pubgm_kesu"],
    "pubgm kesu": ["pubgm_kesu"],
    "pubgmchat": ["pubgm_chat"],
    "pubgm chat": ["pubgm_chat"],
    "pubgmsecurity": ["pubgm_security"],
    "pubgm security": ["pubgm_security"],
    "pubgmwiki": ["pubgm_wiki"],
    "pubgm wiki": ["pubgm_wiki"],
    "mlbbsuggestion": ["mlbb_suggestion"],
    "mlbb suggestion": ["mlbb_suggestion"],
    "hokcbtchatting": ["hok_cbt_chatting"],
    "hokcamp": ["hok_camp"],
    "tofchatting": ["tof_chatting"],
    "uamochatting": ["uamo_chatting"],
    "uafacebook": ["ua_facebook"],
    "supercellstores": ["supercell stores"],
    "supercell stores": ["supercell stores"],
    "levelinfinitepass": ["level infinite pass"],
    "level infinite pass": ["level infinite pass"],
    
    # News/Search - 新闻/搜索
    "googlenews": ["google_keyword"],
    "google news": ["google_keyword"],
    "googlekeyword": ["google_keyword"],
    
    # Japanese - 日文
    "jpnkn": ["jpnkn"],
    "fivech": ["fivech"],
    "coptimus": ["co_ptimus"],
}

# Channel type mapping (used for internal validation and conflict checking)
# This map categorizes channels into 'social' and 'comments' types internally
# 
# Note: This is NOT the same as feeds_topic.channel_type Cube field values
#   - CHANNEL_TYPE_MAP: 'social' and 'comments' (for validation)
#   - feeds_topic.channel_type: 'Social Media' and 'Game Store' (Cube field values)
#   - Strategy 1 channel_category: 'social' and 'game_store' (tool parameters)
# 
# Mapping: 'comments' (validation) = 'Game Store' (Cube) = 'game_store' (param)
CHANNEL_TYPE_MAP = {
    # Comments type channels (game_store in Strategy 1)
    "xiaoheihe_store": "comments",
    "taptap": "comments",
    "epgame": "comments",
    "xbox": "comments",
    "meta_store": "comments",
    "opencritic": "comments",
    "vgtime": "comments",
    "steamdb": "comments",
    "metacritic": "comments",
    "playstation": "comments",
    "google play": "comments",
    "tap io": "comments",
    "app store": "comments",
    "steam": "comments",  # Note: steam has both social and comments, using comments for validation
    
    # Social type channels (social in both strategies)
    "hok_camp": "social",
    "navercafe": "social",
    "dcinside": "social",
    "level infinite pass": "social",
    "pubgm_chat": "social",
    "line": "social",
    "reddit": "social",
    "qq_channel": "social",
    "steam_community": "social",
    "facebook": "social",
    "quora": "social",
    "featureupvote": "social",
    "pubgm_kesu": "social",
    "zendesk": "social",
    "threads": "social",
    "xiaohongshu": "social",
    "sleekplan": "social",
    "twitter": "social",
    "navergame": "social",
    "kwai": "social",
    "questionnaire": "social",
    "twitch_keyword": "social",
    "ua_facebook": "social",
    "funcom forum": "social",
    "forumgamer": "social",
    "tieba": "social",
    "steamcommunity": "social",
    "nga": "social",
    "nikke_community": "social",
    "tumblr": "social",
    "nishikiお問い合わせ詳細データ": "social",
    "aha": "social",
    "heybox": "social",
    "xiaoheihe": "social",
    "qq": "social",
    "kuaishou": "social",
    "forumsbohemia": "social",
    "forumblizzard": "social",
    "pixiv": "social",
    "mirrativ": "social",
    "bistudio": "social",
    "tiktok_ads": "social",
    "hok_cbt_chatting": "social",
    "uamo_chatting": "social",
    "feedback": "social",
    "chzzk": "social",
    "gamersky": "social",
    "jpnkn": "social",
    "instagram": "social",
    "youtube_live": "social",
    "youtube_keyword": "social",
    "forumlastepoch": "social",
    "bsky": "social",
    "discord": "social",
    "bilibili": "social",
    "opensurvey": "social",
    "nikke_ua": "social",
    "pubgm_wiki": "social",
    "tof_chatting": "social",
    "3dm": "social",
    "fivech": "social",
    "tiktok": "social",
    "pathofexile": "social",
    "snackvideo": "social",
    "kick": "social",
    "supercell stores": "social",
    "vk": "social",
    "arca": "social",
    "huya": "social",
    "twitch_live": "social",
    "fatsharkgames": "social",
    "douyin": "social",
    "pubgm_security": "social",
    "mlbb_suggestion": "social",
}

def get_channel_type(channel_code: str) -> str:
    """
    Get channel type for a channel code.
    Returns 'social' or 'comments' (Strategy 2) / 'game_store' (Strategy 1).
    
    Args:
        channel_code: Standard channel code
        
    Returns:
        'social' or 'comments'
    """
    return CHANNEL_TYPE_MAP.get(channel_code, "social")

def _normalize_variant(value: str) -> str:
    """
    将输入归一化为匹配键：
    - 去除前后空白，统一小写
    - 去除括号、下划线、空格等特殊字符
    - 保留字母和数字
    
    Args:
        value: 待标准化的字符串
        
    Returns:
        标准化后的字符串（只包含小写字母数字）
    """
    if not isinstance(value, str):
        return ""
    v = value.strip().lower()
    # 简化括号表达
    v = v.replace("（", "(").replace("）", ")")
    # 只保留字母、数字和空格
    v = "".join(ch for ch in v if ch.isalnum() or ch in [" ", "-", "_"])
    # 将下划线、空格、连字符统一处理
    v = v.replace("_", "").replace(" ", "").replace("-", "")
    return v

def _strip_cjk(key: str) -> str:
    """剥离 CJK 等非 ASCII 字符，仅保留 ASCII 字母数字，用于回退匹配。
    例：'x平台' → 'x'，'youtube频道' → 'youtube'
    """
    return "".join(ch for ch in key if ord(ch) < 128 and ch.isalnum())


def _to_channel_set(inputs: list[str]) -> set[str]:
    """
    将多样化的渠道输入映射为标准渠道代码集合
    
    Args:
        inputs: 输入的渠道列表（可以是自然语言、别名或标准代码）
        
    Returns:
        标准渠道代码集合
    """
    if not inputs:
        return set()
    
    channel_set: set[str] = set()
    for raw in inputs:
        # 标准化输入
        key = _normalize_variant(raw)
        
        # 1. 尝试从别名映射表匹配
        mapped = _VARIANT_TO_CHANNEL.get(key)
        if mapped:
            channel_set.update([m.lower() for m in mapped])
            continue
        
        # 2. 尝试直接匹配标准代码（保持原样，因为可能有空格）
        raw_lower = raw.strip().lower()
        if raw_lower in CHANNEL_CODE_MAP:
            channel_set.add(raw_lower)
            continue
        
        # 3. 尝试标准化后匹配（去掉空格、下划线）
        for valid_code in CHANNEL_CODE_MAP:
            if _normalize_variant(valid_code) == key:
                channel_set.add(valid_code)
                break
        else:
            # 4. 回退：剥离 CJK 字符后重试（处理 "X平台"→"x"、"YouTube频道"→"youtube" 等情形）
            key_ascii = _strip_cjk(key)
            if key_ascii and key_ascii != key:
                mapped = _VARIANT_TO_CHANNEL.get(key_ascii)
                if mapped:
                    channel_set.update([m.lower() for m in mapped])
                    continue
                if key_ascii in CHANNEL_CODE_MAP:
                    channel_set.add(key_ascii)
    
    return channel_set

def map_channels_to_code(inputs: list[str]) -> list[str]:
    """
    将多样化渠道输入映射为标准渠道代码列表（用于 Feeds channel_code）
    
    Args:
        inputs: 输入的渠道列表，支持多种格式：
               - 标准代码：youtube_keyword, steam, reddit
               - 自然语言：Youtube, Steam, Reddit
               - 别名：X (→ twitter), Google Play (→ google play)
    
    Returns:
        标准化的渠道代码列表（已排序）
        
    Example:
        >>> map_channels_to_code(["Youtube", "Steam", "X"])
        ['steam', 'twitter', 'youtube_keyword']
        
        >>> map_channels_to_code(["Google Play", "App Store"])
        ['app store', 'google play']
    """
    return sorted(list(_to_channel_set(inputs)))
