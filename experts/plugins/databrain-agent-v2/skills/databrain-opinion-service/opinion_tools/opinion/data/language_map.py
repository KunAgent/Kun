"""
Steam 语言映射表

用途：
- 将多样化的语言输入（自然语言/ISO/别名）映射到：
  1) ISO 语言代码（用于 Feeds 等场景）
  2) Steam 平台在 steam_score_by_language.language 中使用的语言显示名称
- 注意：中文语系拆分为 Simplified Chinese / Traditional Chinese；此处 zh 默认映射为 Simplified Chinese。

来源：常见映射与经验规则，可按需扩充/修正。
"""

STEAM_LANGUAGE_CODE_MAP = {
    # Map Input ISO Language Code to Steam Language

    # --- Chinese mapping ---
    "zh": "Simplified Chinese",        # feeds zh → Steam 简体
    "zh-hans": "Simplified Chinese",
    "zh-hant": "Traditional Chinese",  # feeds zh-hant → Steam 繁体
    "zh-cn": "Simplified Chinese",     # Steam 简体（小写统一）
    "zh-tw": "Traditional Chinese",    # Steam 繁体（小写统一）

    # --- Core / Major languages ---
    "en": "English",
    "ja": "Japanese",
    "ko": "Korean",
    "ru": "Russian",
    "tr": "Turkish",
    "vi": "Vietnamese",
    "th": "Thai",
    "id": "Indonesian",
    "ms": "Malay",

    "pt": "Portuguese",                # generic Portuguese
    "pt-br": "Portuguese - Brazil",

    "es": "Spanish - Spain",
    "es-419": "Spanish - Latin America",

    "fr": "French",
    "de": "German",
    "it": "Italian",
    "pl": "Polish",
    "uk": "Ukrainian",
    "cs": "Czech",
    "da": "Danish",
    "nl": "Dutch",
    "fi": "Finnish",
    "sv": "Swedish",
    "el": "Greek",
    "hu": "Hungarian",
    "ro": "Romanian",
    "ar": "Arabic",
    "bg": "Bulgarian",
    "no": "Norwegian",

    # --- Feeds-only or Rare ISO codes (not in Steam list, map to closest or keep raw) ---
    "ga": "Irish",
    "kha": "Khasi",
    "ha": "Hausa",
    "om": "Oromo",
    "ve": "Venda",
    "tl": "Tagalog",
    "uz": "Uzbek",
    "ur": "Urdu",
}

# 别名到 ISO 代码的映射（输入归一化后匹配）
_VARIANT_TO_ISO = {
    # English
    "en": ["en"],
    "english": ["en"],
    
    # Chinese family
    "zh": ["zh"],
    "chinese": ["zh"],
    "simplifiedchinese": ["zh"],
    "chinesesimplified": ["zh"],
    "chinese(simplified)": ["zh"],
    "zhhans": ["zh-hans"],
    "zh-hans": ["zh-hans"],
    "traditionalchinese": ["zh-hant"],
    "chinesetraditional": ["zh-hant"],
    "chinese(traditional)": ["zh-hant"],
    "zhhant": ["zh-hant"],
    "zh-hant": ["zh-hant"],

    # Common languages
    "fr": ["fr"], "french": ["fr"],
    "de": ["de"], "german": ["de"],
    "es": ["es"], "spanish": ["es"], "spanishspain": ["es"],
    "es419": ["es-419"], "spanishlatam": ["es-419"],
    "spanishlatinamerica": ["es-419"], "latinamericanspanish": ["es-419"],
    "pt": ["pt"], "portuguese": ["pt"],
    "ptbr": ["pt-br"], "portuguesebrazil": ["pt-br"], "brazilianportuguese": ["pt-br"],
    "russian": ["ru"],
    "japanese": ["ja"],
    "korean": ["ko"],
    "italian": ["it"],
    "polish": ["pl"],
    "dutch": ["nl"],
    "turkish": ["tr"],
    "thai": ["th"],
    "indonesian": ["id"],
    "vietnamese": ["vi"],
    "ukrainian": ["uk"],
    "arabic": ["ar"],
    "czech": ["cs"],
    "danish": ["da"],
    "finnish": ["fi"],
    "hungarian": ["hu"],
    "norwegian": ["no"],
    "romanian": ["ro"],
    "swedish": ["sv"],

    # ---- Region → language expansions（地区名自动展开为对应语言列表）----
    # 北美 / North America → 英语 + 西班牙语
    "na": ["en", "es"],
    "northamerica": ["en", "es"],
    "northamericanregion": ["en", "es"],
    "北美": ["en", "es"],
    "北美区": ["en", "es"],
    "北美地区": ["en", "es"],
    # 拉丁美洲 / Latin America → 西班牙语 + 葡萄牙语（巴西）
    "latam": ["es-419", "pt-br"],
    "latinamerica": ["es-419", "pt-br"],
    "latinamericanregion": ["es-419", "pt-br"],
    "拉丁美洲": ["es-419", "pt-br"],
    "拉美": ["es-419", "pt-br"],
    "拉美区": ["es-419", "pt-br"],
    # 欧洲 / Europe → 主要欧洲语言
    "eu": ["en", "de", "fr", "es", "ru"],
    "europe": ["en", "de", "fr", "es", "ru"],
    "欧洲": ["en", "de", "fr", "es", "ru"],
    "欧洲地区": ["en", "de", "fr", "es", "ru"],
    # 东南亚 / SEA
    "sea": ["id", "ms", "th", "vi", "tl", "en"],
    "southeastasia": ["id", "ms", "th", "vi", "tl", "en"],
    "东南亚": ["id", "ms", "th", "vi", "tl", "en"],
    "东南亚地区": ["id", "ms", "th", "vi", "tl", "en"],
    # 中东 / Middle East
    "me": ["ar"],
    "middleeast": ["ar"],
    "中东": ["ar"],
    "中东地区": ["ar"],
    # 亚太 / APAC → 东亚 + 东南亚主要语言
    "apac": ["en", "zh", "zh-hant", "ja", "ko", "id", "ms", "th", "vi"],
    "asiapacific": ["en", "zh", "zh-hant", "ja", "ko", "id", "ms", "th", "vi"],
    "亚太": ["en", "zh", "zh-hant", "ja", "ko", "id", "ms", "th", "vi"],
    "亚太区": ["en", "zh", "zh-hant", "ja", "ko", "id", "ms", "th", "vi"],
}

def _normalize_variant(value: str) -> str:
    """将输入归一化为匹配键：
    - 去除前后空白，统一小写
    - 去除两侧括号中的多余空格
    - 将多个空白和下划线去除
    - 保留连字符（用于 zh-hant 匹配）
    """
    if not isinstance(value, str):
        return ""
    v = value.strip().lower()
    # 简化括号表达
    v = v.replace("（", "(").replace("）", ")")
    v = "".join(ch for ch in v if ch.isalnum() or ch in ["-", "(", ")", "/", ":", ",", " "])
    v = v.replace("_", " ").replace("/", " ")
    v = " ".join(v.split())
    # 去除空格后做一个无空格版本用于匹配
    v_nospace = v.replace(" ", "")
    return v_nospace

def _to_iso_set(inputs: list[str]) -> set[str]:
    if not inputs:
        return set()
    iso_set: set[str] = set()
    for raw in inputs:
        key = _normalize_variant(raw)
        mapped = _VARIANT_TO_ISO.get(key)
        if mapped:
            iso_set.update([m.lower() for m in mapped])
            continue
        # 直接 ISO 代码（保持小写）
        if key in STEAM_LANGUAGE_CODE_MAP:
            iso_set.add(key)
            continue
        # 去掉连字符重试（如 zhhant）
        key2 = key.replace("-", "")
        mapped2 = _VARIANT_TO_ISO.get(key2)
        if mapped2:
            iso_set.update([m.lower() for m in mapped2])
    return iso_set

def map_languages_to_iso(inputs: list[str]) -> list[str]:
    """将多样化语言输入映射为 ISO 代码列表（用于 Feeds language_code）"""
    return sorted(list(_to_iso_set(inputs)))

def map_languages_to_steam(inputs: list[str]) -> tuple[list[str], list[str]]:
    """将多样化语言输入映射为 (iso_codes, steam_language_names)

    - iso_codes：适用于 Feeds 的 language_code 过滤
    - steam_language_names：适用于 steam_score_by_language.language 过滤
    """
    iso_set = _to_iso_set(inputs)
    steam_set: set[str] = set()
    for code in iso_set:
        names = STEAM_LANGUAGE_CODE_MAP.get(code)
        if not names:
            continue
        if isinstance(names, list):
            steam_set.update(names)
        else:
            steam_set.add(names)
    return sorted(list(iso_set)), sorted(list(steam_set))