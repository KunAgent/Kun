# -*- coding: utf-8 -*-
"""Inject opinion-metric definitions into tool results.

This helper is shared by all opinion-side tools whose ``measures`` parameter
carries cube-style field names (e.g. ``hotness.negative_rate``). It looks up
the corresponding metric record from ``opinion_metric_kb.json`` and attaches
a small ``metric_kb`` block to the tool's result dict so the downstream LLM
sees the canonical Chinese / English name, calculation, threshold brief, and
disambiguation note for every metric it just queried.

Design constraints (kept intentionally tiny so this is safe to call from any
tool right before ``return``):

* Pure look-up by *exact* cube field name. No fuzzy / business-name mapping.
* Falls back silently when the result is not a dict, when ``measures`` is
  empty, or when no measure matches the KB. Tool behaviour never breaks even
  if the KB file is missing or malformed.
* JSON load is wrapped in ``functools.lru_cache`` → the file is parsed once
  per process.
"""
from __future__ import annotations

import json
import logging
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

logger = logging.getLogger(__name__)

KB_PATH = (
    Path(__file__).resolve().parents[1]
    / "data"
    / "opinion_metric_kb.json"
)


@lru_cache(maxsize=1)
def _load_kb() -> Dict[str, Dict[str, Any]]:
    """Load and cache the KB file. Returns an empty dict on any failure."""
    try:
        if not KB_PATH.exists():
            logger.warning("opinion_metric_kb.json not found at %s", KB_PATH)
            return {}
        raw = json.loads(KB_PATH.read_text(encoding="utf-8"))
        return raw.get("metrics", {}) or {}
    except Exception as exc:  # noqa: BLE001 — never break the tool over KB IO
        logger.warning("Failed to load opinion_metric_kb.json: %s", exc)
        return {}


def lookup_metric_definitions(
    measures: Optional[Iterable[str]],
) -> List[Dict[str, Any]]:
    """Return the KB records matching the given measure field names.

    Order follows ``measures``; duplicates are removed; unknown fields are
    silently dropped.
    """
    if not measures:
        return []
    kb = _load_kb()
    if not kb:
        return []
    seen: set = set()
    out: List[Dict[str, Any]] = []
    for raw in measures:
        if not raw or not isinstance(raw, str):
            continue
        field = raw.strip()
        if field in seen or field not in kb:
            continue
        seen.add(field)
        record = kb[field]
        # Only surface the small set of fields the LLM needs at runtime — keeps
        # token cost predictable.
        slim = {
            "field": field,
            "name_cn": record.get("name_cn", ""),
            "name_en": record.get("name_en", ""),
            "calculation": record.get("calculation", ""),
            "thresholds_brief": record.get("thresholds_brief", ""),
        }
        if record.get("disambiguation"):
            slim["disambiguation"] = record["disambiguation"]
        out.append(slim)
    return out


def inject_metric_kb(
    measures: Optional[Iterable[str]],
    result: Any,
) -> Any:
    """Attach a ``metric_kb`` block to a tool result dict, in place.

    Returns the same ``result`` object so callers can write
    ``return inject_metric_kb(measures, result)``.

    No-ops when:
      * ``result`` is not a dict (e.g. already a truncated string)
      * ``measures`` is empty / yields no KB hits
      * ``result`` already contains a ``metric_kb`` key (idempotent)
    """
    if not isinstance(result, dict):
        return result
    if "metric_kb" in result:
        return result
    definitions = lookup_metric_definitions(measures)
    if not definitions:
        return result
    result["metric_kb"] = {
        "_note": (
            "Authoritative metric definitions for the fields you just queried. "
            "Use the Chinese / English names verbatim in your narrative; obey "
            "the threshold brief; respect any 'disambiguation' note to avoid "
            "mixing up easily-confused metrics."
        ),
        "definitions": definitions,
    }
    return result
