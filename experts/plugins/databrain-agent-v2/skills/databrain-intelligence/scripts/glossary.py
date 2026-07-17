#!/usr/bin/env python3
"""
glossary.py — lightweight glossary loader / matcher

Goal:
- Accept a user question
- Return matched glossary explanations (for prompt injection / explanation)

Primary glossary source: references/glossaries.json (list of {term_regex, info}).
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


_REF_DIR = Path(__file__).resolve().parent.parent / "references"
GLOSSARIES_JSON_PATH = _REF_DIR / "glossaries.json"

def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _load_terms(path: Path) -> list[dict]:
    data = json.loads(_read_text(path))
    if not isinstance(data, list):
        raise ValueError("glossaries.json must be a JSON array of {term_regex, info}")
    return [x for x in data if isinstance(x, dict)]


def match_glossaries(question: str, terms: list[dict], top_k: int = 8) -> dict[str, str]:
    q = (question or "").strip()
    if not q:
        return {}

    matches: list[tuple[str, str]] = []
    for item in terms:
        term_regex = item.get("term_regex")
        info = item.get("info")
        if not isinstance(term_regex, str) or not isinstance(info, str):
            continue
        term_regex = term_regex.strip()
        info = info.strip()
        if not term_regex or not info:
            continue
        try:
            if re.search(term_regex, q, flags=re.IGNORECASE):
                matches.append((term_regex, info))
        except re.error:
            continue

    matches.sort(key=lambda x: x[0])
    return {k: v for k, v in matches[: max(0, top_k)]}


def main() -> None:
    parser = argparse.ArgumentParser(description="Regex glossary matcher (databrain-intelligence)")
    parser.add_argument("--question", required=True, help="User question")
    parser.add_argument("--top_k", type=int, default=8, help="Max entries to return (default: 8)")
    args = parser.parse_args()

    terms = _load_terms(GLOSSARIES_JSON_PATH)
    matches = match_glossaries(args.question, terms, top_k=max(0, args.top_k))
    payload = {"needed": bool(matches), "matches": matches}
    print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

