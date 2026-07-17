"""
Steam 语言映射表

用途：
- 将国家输入（自然语言/ISO/别名）映射到ISO语言代码：
  1) ISO 语言代码（用于 Feeds 等场景）
- 例：cn 默认映射为 zh

来源：常见映射与经验规则，可按需扩充/修正。
"""

COUNTRY_LANGUAGE_MAP = {
    # Map common country (code/name/alias) to ISO language code used by Feeds/Steam mapping

    # --- Chinese world ---
    "cn": "zh", "china": "zh", "mainland china": "zh",
    "tw": "zh-hant", "taiwan": "zh-hant",
    "hk": "zh-hant", "hong kong": "zh-hant", "hongkong": "zh-hant",

    # --- English ---
    "us": "en", "usa": "en", "united states": "en",
    "uk": "en", "gb": "en", "united kingdom": "en", "great britain": "en",
    "au": "en", "australia": "en",
    "ca": "en", "canada": "en",

    # --- Japanese / Korean ---
    "jp": "ja", "japan": "ja",
    "kr": "ko", "korea": "ko", "south korea": "ko",

    # --- European majors ---
    "de": "de", "germany": "de",
    "fr": "fr", "france": "fr",
    "it": "it", "italy": "it",
    "es": "es", "spain": "es",
    "pl": "pl", "poland": "pl",
    "nl": "nl", "netherlands": "nl",
    "se": "sv", "sweden": "sv",
    "no": "no", "norway": "no",
    "fi": "fi", "finland": "fi",
    "dk": "da", "denmark": "da",
    "cz": "cs", "czech": "cs", "czech republic": "cs",
    "ro": "ro", "romania": "ro",
    "ua": "uk", "ukraine": "uk",

    # --- Portuguese / Spanish (LatAm) ---
    "pt": "pt", "portugal": "pt",
    "br": "pt-br", "brazil": "pt-br",
    # 拉美国家 → 西语拉美（es-419）
    "mx": "es-419", "mexico": "es-419",
    "ar": "es-419", "argentina": "es-419",
    "cl": "es-419", "chile": "es-419",
    "co": "es-419", "colombia": "es-419",
    "pe": "es-419", "peru": "es-419",

    # --- Russian / Turkish / Arabic / SEA ---
    "ru": "ru", "russia": "ru",
    "tr": "tr", "turkey": "tr",
    "sa": "ar", "ksa": "ar", "saudi": "ar", "saudi arabia": "ar",
    "ae": "ar", "uae": "ar", "united arab emirates": "ar",
    "eg": "ar", "egypt": "ar",
    "th": "th", "thailand": "th",
    "id": "id", "indonesia": "id",
    "vn": "vi", "vietnam": "vi",
}

def _normalize_variant(value: str) -> str:
    if not isinstance(value, str):
        return ""
    v = value.strip().lower()
    v = v.replace("（", "(").replace("）", ")")
    v = "".join(ch for ch in v if ch.isalnum() or ch in ["-", "(", ")", "/", ":", ",", " "])
    v = v.replace("_", " ").replace("/", " ")
    v = " ".join(v.split())
    return v

def map_countries_to_iso_languages(inputs: list[str]) -> list[str]:
    """将国家输入映射为 ISO 语言代码列表（用于 Steam/Feeds 语言兜底）。"""
    if not inputs:
        return []
    langs: set[str] = set()
    for raw in inputs:
        key = _normalize_variant(raw)
        if not key:
            continue
        lang = COUNTRY_LANGUAGE_MAP.get(key)
        if lang:
            langs.add(lang)
    return sorted(list(langs))