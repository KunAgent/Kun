#!/usr/bin/env python3
"""
replay_batch_io.py

Replay minimal batch_io contracts without calling MigraQ, cloud services, or Office/PDF parsers.
Creates small local fixtures under .tmp/, verifies JSON / Markdown normalization plus
unsupported Office/PDF guidance, then removes the fixtures before exiting.
"""

import json
import os
import shutil
import sys

from batch_io import read_batch

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP_DIR = os.path.join(ROOT, ".tmp", "replay_batch_io")


def assert_true(condition, message):
    if not condition:
        raise AssertionError(message)


def assert_contains(items, expected, label):
    assert_true(isinstance(items, list), f"{label}: expected list")
    assert_true(
        any(expected in str(item.get("input", "")) for item in items),
        f"{label}: expected input containing '{expected}'",
    )


def assert_rejects_office(file_path, expected_skill, label):
    try:
        read_batch(file_path)
    except ValueError as e:
        assert_true(
            expected_skill in str(e),
            f"{label}: expected guidance mentioning {expected_skill}",
        )
        return
    raise AssertionError(f"{label}: expected unsupported Office/PDF input to reject")


def write_fixtures():
    shutil.rmtree(TMP_DIR, ignore_errors=True)
    os.makedirs(TMP_DIR, exist_ok=True)

    files = {
        "json": os.path.join(TMP_DIR, "extracted.json"),
        "markdown": os.path.join(TMP_DIR, "input.md"),
        "excel": os.path.join(TMP_DIR, "input.xlsx"),
        "docx": os.path.join(TMP_DIR, "input.docx"),
        "pdf": os.path.join(TMP_DIR, "input.pdf"),
    }

    with open(files["json"], "w", encoding="utf-8") as f:
        json.dump(
            [
                {
                    "input": "阿里云 ECS cn-hangzhou g7 包年包月",
                    "hint": "spec",
                    "row": 2,
                    "sheet": "ECS",
                    "format": "excel",
                    "source": "xlsx-manipulation",
                },
                {
                    "text": "AWS EC2 m5 PDF",
                    "page": 1,
                    "bbox": {"x": 40, "y": 20, "width": 220, "height": 60, "unit": "pt", "origin": "top-left"},
                    "format": "pdf",
                    "source": "pdf-extraction",
                },
            ],
            f,
            ensure_ascii=False,
            indent=2,
        )

    with open(files["markdown"], "w", encoding="utf-8") as f:
        f.write("阿里云 ECS cn-hangzhou g7 包年包月\n\nAWS EC2 m5 默认策略\n")

    for key in ("excel", "docx", "pdf"):
        with open(files[key], "w") as f:
            f.write("placeholder")

    return files


def main():
    results = {}
    try:
        files = write_fixtures()

        # JSON test
        json_items = read_batch(files["json"])
        assert_contains(json_items, "cn-hangzhou", "json")
        assert_true(json_items[0]["source"] == "xlsx-manipulation", "json: expected xlsx source")
        assert_true(json_items[0]["sheet"] == "ECS", "json: expected sheet metadata")
        assert_true(json_items[1].get("bbox", {}).get("origin") == "top-left", "json: expected bbox metadata")
        results["json"] = "pass"

        # Markdown test
        md_items = read_batch(files["markdown"])
        assert_true(len(md_items) == 2, "markdown: expected two blocks")
        assert_contains(md_items, "AWS EC2 m5", "markdown")
        results["markdown"] = "pass"

        # Office rejection tests
        assert_rejects_office(files["excel"], "xlsx-manipulation", "excelUnsupported")
        results["excelUnsupported"] = "pass"

        assert_rejects_office(files["pdf"], "pdf-extraction", "pdfUnsupported")
        results["pdfUnsupported"] = "pass"

        assert_rejects_office(files["docx"], "docx-manipulation", "docxUnsupported")
        results["docxUnsupported"] = "pass"

        print(json.dumps({"ok": True, "cases": results}, ensure_ascii=False, indent=2))

    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False, indent=2), file=sys.stderr)
        sys.exit(1)
    finally:
        shutil.rmtree(TMP_DIR, ignore_errors=True)


if __name__ == "__main__":
    main()
