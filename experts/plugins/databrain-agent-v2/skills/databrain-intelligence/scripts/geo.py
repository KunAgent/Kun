#!/usr/bin/env python3
"""
geo.py — country/region resolver for metrics queries

Input:
- countries: list of user-provided country names / aliases / ISO-2 codes
- regions:   list of user-provided region names / aliases

Output:
- codes: list[str] resolved codes
- ok: bool (False if any input is invalid)
- region_type: "market" or "region"
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


REF_DIR = Path(__file__).resolve().parent.parent / "references"
GEO_MAP_PATH = REF_DIR / "geo_map.json"


def _normalize_geo_key(s: str) -> str:
    s = (s or "").strip().lower()
    s = re.sub(r"[\s_]+", " ", s)
    return s


def _load_geo_map() -> dict[str, Any]:
    data = json.loads(GEO_MAP_PATH.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("geo_map.json must be an object")
    return data


def _is_iso2(s: str) -> bool:
    return bool(re.fullmatch(r"[a-z]{2}", s))

def _normalize_map_keys(m: dict) -> dict[str, Any]:
    """Normalize mapping keys using _normalize_geo_key (case/space/underscore-insensitive)."""
    out: dict[str, Any] = {}
    for k, v in m.items():
        if not isinstance(k, str):
            continue
        nk = _normalize_geo_key(k)
        if not nk:
            continue
        # last write wins (allows overrides in source file)
        out[nk] = v
    return out


def resolve_geo(countries: list[str] | None, regions: list[str] | None) -> tuple[list[str], bool, str]:
    """
    Resolve geo filters to either:
    - market codes (ISO-2 / global buckets) when only countries are provided
    - region codes when any region is provided
    """
    countries = countries or []
    regions = regions or []

    if not countries and not regions:
        return [], False, "market"

    geo = _load_geo_map()
    country_map = geo.get("country_map_intel") or {}
    region_map = geo.get("region_map_for_metrics_query") or {}
    if not isinstance(country_map, dict) or not isinstance(region_map, dict):
        raise ValueError("geo_map.json missing country_map_intel / region_map_for_metrics_query objects")

    country_map = _normalize_map_keys(country_map)
    region_map = _normalize_map_keys(region_map)

    codes: list[str] = []
    region_type = "market"

    for c in countries:
        k = _normalize_geo_key(c)
        if _is_iso2(k):
            codes.append(k)
            continue
        if k not in country_map:
            return [], False, region_type
        codes.append(str(country_map[k]))

    for r in regions:
        k = _normalize_geo_key(r)
        if k not in region_map:
            return [], False, region_type
        codes.extend(list(region_map[k]))
        region_type = "region"

    return codes, True, region_type


def main() -> None:
    parser = argparse.ArgumentParser(description="Resolve countries/regions to query codes")
    parser.add_argument("--countries", default="", help="Comma-separated countries (names/aliases/ISO-2)")
    parser.add_argument("--regions", default="", help="Comma-separated regions (names/aliases)")
    # Accept extra positional args so that callers mistakenly passing individual country
    # names as positional arguments (e.g. geo.py '越南' '巴基斯坦') still work instead
    # of crashing with "unrecognized arguments".
    parser.add_argument("positional_countries", nargs="*", default=[],
                        help="(Compat) Country names/codes as positional args — prefer --countries")
    args = parser.parse_args()

    countries = [x.strip() for x in args.countries.split(",") if x.strip()]
    regions = [x.strip() for x in args.regions.split(",") if x.strip()]

    # Merge positional args into countries when --countries was not provided
    if args.positional_countries and not countries:
        countries = [x.strip() for x in args.positional_countries if x.strip()]

    codes, ok, region_type = resolve_geo(countries, regions)
    payload: dict[str, Any] = {"ok": ok, "region_type": region_type, "codes": codes}
    if not ok:
        payload["hint"] = (
            "Geo mapping failed. Try using lowercase ISO-2 country codes (e.g. 'us', 'jp', 'cn') for countries, "
            "or look up the standard country/region values in `common.country_region`."
        )
    print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

