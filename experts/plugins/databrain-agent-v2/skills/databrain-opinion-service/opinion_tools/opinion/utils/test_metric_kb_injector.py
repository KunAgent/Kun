# -*- coding: utf-8 -*-
"""Self-contained unit tests for metric_kb_injector.

Run from repo root:

    python projects/databrain_host/tools/opinion/utils/test_metric_kb_injector.py
"""
from __future__ import annotations

import sys
from pathlib import Path

THIS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(THIS_DIR))

from metric_kb_injector import inject_metric_kb, lookup_metric_definitions  # noqa: E402


def _check(label: str, cond: bool, detail: str = "") -> bool:
    mark = "PASS" if cond else "FAIL"
    print(f"[{mark}] {label}{(' — ' + detail) if detail else ''}")
    return cond


def main() -> int:
    failures = 0

    # 1. single hit
    defs = lookup_metric_definitions(["hotness.mentions"])
    if not _check(
        "single-hit returns one definition with name_cn",
        len(defs) == 1 and defs[0].get("name_cn") == "声量",
        f"got={defs}",
    ):
        failures += 1

    # 2. disambiguation surfaces for negative_rate
    defs = lookup_metric_definitions(["hotness.negative_rate"])
    has_disambig = bool(defs and "disambiguation" in defs[0]) and "负面话题" in defs[0]["disambiguation"]
    if not _check("negative_rate carries disambiguation about 负面话题", has_disambig):
        failures += 1

    # 3. order preserved + dedup
    defs = lookup_metric_definitions([
        "hotness.brand_health",
        "hotness.mentions",
        "hotness.brand_health",  # dup
        "feeds_topic.negative_rate",
    ])
    fields = [d["field"] for d in defs]
    if not _check(
        "order preserved + duplicate dropped",
        fields == ["hotness.brand_health", "hotness.mentions", "feeds_topic.negative_rate"],
        f"got={fields}",
    ):
        failures += 1

    # 4. unknown measure silently skipped
    defs = lookup_metric_definitions(["totally.unknown.field", "hotness.mentions"])
    if not _check(
        "unknown measure dropped, valid one kept",
        len(defs) == 1 and defs[0]["field"] == "hotness.mentions",
    ):
        failures += 1

    # 5. None / empty inputs
    if not _check("None measures returns []", lookup_metric_definitions(None) == []):
        failures += 1
    if not _check("empty list returns []", lookup_metric_definitions([]) == []):
        failures += 1

    # 6. inject into dict
    result = {"data": "csv...", "data_id": "x"}
    out = inject_metric_kb(["hotness.negative_rate"], result)
    if not _check(
        "inject_metric_kb adds metric_kb key with definitions list",
        out is result and "metric_kb" in out and len(out["metric_kb"]["definitions"]) == 1,
    ):
        failures += 1

    # 7. inject is idempotent (does not double-overwrite)
    sentinel = out["metric_kb"]
    inject_metric_kb(["hotness.mentions"], out)
    if not _check("inject_metric_kb is idempotent", out["metric_kb"] is sentinel):
        failures += 1

    # 8. non-dict result is returned unchanged
    untouched = inject_metric_kb(["hotness.mentions"], "already-truncated-string")
    if not _check("non-dict result returned unchanged", untouched == "already-truncated-string"):
        failures += 1

    # 9. cross-table alias works (feeds_topic.negative_rate has its own disambig)
    defs = lookup_metric_definitions(["feeds_topic.negative_rate"])
    if not _check(
        "feeds_topic.negative_rate has disambiguation distinct from hotness one",
        bool(defs and "disambiguation" in defs[0]) and "话题数量" in defs[0]["disambiguation"],
    ):
        failures += 1

    # 10. score_tool style: steam_score.recent_reviews_positive_rate
    defs = lookup_metric_definitions(["steam_score.recent_reviews_positive_rate"])
    if not _check(
        "Steam recent reviews rate resolved",
        bool(defs) and "好评率" in defs[0]["name_cn"],
    ):
        failures += 1

    print(f"\n{'OK' if failures == 0 else 'FAILED'}: {failures} failure(s)")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
