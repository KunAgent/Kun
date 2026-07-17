"""
Country variant mapping helpers.

This module normalizes country inputs (ISO2 / English names / Chinese names / aliases)
to ISO2 codes, and is intended to be used before strict validator checks.
"""

import re
import unicodedata
from functools import lru_cache
from typing import Any, Dict, Iterable, List, Sequence, Set, Tuple

from opinion_data.region_code_map import COUNTRY_MAP_INTEL


# COUNTRY_MAP_INTEL already covers most countries. These aliases fill the gap for
# 10 ISO2 codes that appear in industry_video ALLOWED_COUNTRIES but are absent there.
_MISSING_COUNTRY_ALIASES: Dict[str, List[str]] = {
    "aq": ["aq", "antarctica", "antarctic", "south pole", "南极", "南极洲"],
    "bv": ["bv", "bouvet island", "布韦岛"],
    "cc": ["cc", "cocos islands", "cocos keeling islands", "科科斯群岛", "科科斯（基林）群岛"],
    "cx": ["cx", "christmas island", "圣诞岛"],
    "eh": ["eh", "western sahara", "west sahara", "西撒哈拉"],
    "io": ["io", "british indian ocean territory", "英属印度洋领地"],
    "kp": ["kp", "north korea", "dprk", "democratic peoples republic of korea", "朝鲜"],
    "pn": ["pn", "pitcairn", "pitcairn islands", "皮特凯恩群岛"],
    "sh": [
        "sh",
        "saint helena",
        "st helena",
        "saint helena ascension and tristan da cunha",
        "圣赫勒拿",
    ],
    "sj": ["sj", "svalbard and jan mayen", "svalbard", "jan mayen", "斯瓦尔巴和扬马延"],
}


def _normalize_variant(value: str) -> str:
    """Normalize country input to a compact matching key."""
    if not isinstance(value, str):
        return ""

    v = value.strip().lower()
    if not v:
        return ""

    # Strip accents so "côte d'ivoire" and "cote d ivoire" can match.
    v = unicodedata.normalize("NFKD", v)
    v = "".join(ch for ch in v if not unicodedata.combining(ch))

    v = v.replace("（", "(").replace("）", ")")
    v = v.replace("&", " and ")
    v = "".join(
        ch for ch in v if ch.isalnum() or ch in ["-", "_", "/", "(", ")", ",", ".", "'", " "]
    )
    v = v.replace("_", " ").replace("/", " ").replace(".", " ").replace("'", " ")
    v = " ".join(v.split())
    return v.replace(" ", "")


def _iter_iso_candidates(value: Any) -> Iterable[str]:
    if isinstance(value, str):
        yield value
        return
    if isinstance(value, list):
        for item in value:
            if isinstance(item, str):
                yield item


@lru_cache(maxsize=64)
def _build_variant_to_iso(allowed_codes_key: Tuple[str, ...]) -> Dict[str, str]:
    """
    Build normalized variant -> ISO2 map for a specific allowed-code set.
    """
    allowed_codes = {code.lower() for code in allowed_codes_key if isinstance(code, str) and code}
    variant_to_iso: Dict[str, str] = {}

    # 1) Always support direct ISO2 input for each allowed code.
    for code in allowed_codes:
        variant_to_iso[_normalize_variant(code)] = code

    # 2) Ingest rich alias data from COUNTRY_MAP_INTEL.
    for raw_variant, raw_target in COUNTRY_MAP_INTEL.items():
        key = _normalize_variant(str(raw_variant))
        if not key:
            continue
        for iso_candidate in _iter_iso_candidates(raw_target):
            iso2 = iso_candidate.strip().lower()
            if iso2 in allowed_codes:
                variant_to_iso[key] = iso2

    # 3) Fill known missing aliases so all allowed codes are addressable.
    for iso2, aliases in _MISSING_COUNTRY_ALIASES.items():
        if iso2 not in allowed_codes:
            continue
        for alias in aliases:
            key = _normalize_variant(alias)
            if key:
                variant_to_iso[key] = iso2

    return variant_to_iso


def map_countries_to_iso(inputs: List[str], allowed_codes: Set[str]) -> List[str]:
    """
    Normalize country variants to ISO2 for downstream validation.

    - Known variants map to ISO2.
    - Unknown values are preserved for strict validator error reporting.
    """
    if not inputs:
        return []

    allowed_key = tuple(sorted({c.lower() for c in allowed_codes if isinstance(c, str) and c.strip()}))
    variant_to_iso = _build_variant_to_iso(allowed_key)

    normalized: List[str] = []
    for raw in inputs:
        if not isinstance(raw, str):
            normalized.append(str(raw))
            continue

        stripped = raw.strip()
        if not stripped:
            normalized.append(stripped)
            continue

        key = _normalize_variant(stripped)
        mapped = variant_to_iso.get(key)
        if mapped:
            normalized.append(mapped)
            continue

        # Keep unknown values unchanged so ParamValidator can surface explicit errors.
        if re.fullmatch(r"[a-z]{2}", key):
            normalized.append(key)
        else:
            normalized.append(stripped)

    return normalized


def build_country_variant_map(allowed_codes: Sequence[str]) -> Dict[str, str]:
    """
    Expose the generated variant map for diagnostics/tests.
    """
    allowed_key = tuple(sorted({c.lower() for c in allowed_codes if isinstance(c, str) and c.strip()}))
    return dict(_build_variant_to_iso(allowed_key))
