#!/usr/bin/env python3
"""Unpack Office files (DOCX, PPTX, XLSX) for editing.

Extracts the ZIP archive, pretty-prints XML files, and optionally:
- Merges adjacent runs with identical formatting (DOCX only)
- Simplifies adjacent tracked changes from same author (DOCX only)

Usage:
    python unpack.py <office_file> <output_dir> [options]

Examples:
    python unpack.py document.docx unpacked/
    python unpack.py presentation.pptx unpacked/
    python unpack.py document.docx unpacked/ --merge-runs false
"""

import argparse
import sys
import zipfile
from pathlib import Path

import defusedxml.minidom

from helpers.merge_runs import merge_runs as do_merge_runs
from helpers.simplify_redlines import simplify_redlines as do_simplify_redlines

# Smart quotes that get mangled by the tokenizer - convert to XML entities
SMART_QUOTE_REPLACEMENTS = {
    "\u201c": "&#x201C;",  # Left double quote "
    "\u201d": "&#x201D;",  # Right double quote "
    "\u2018": "&#x2018;",  # Left single quote '
    "\u2019": "&#x2019;",  # Right single quote '
}


def unpack(
    input_file: str,
    output_directory: str,
    merge_runs: bool = True,
    simplify_redlines: bool = True,
) -> tuple[None, str]:
    """Unpack an Office file and prepare for editing.

    Args:
        input_file: Path to Office file (.docx, .pptx, .xlsx)
        output_directory: Path to output directory
        merge_runs: If True, merge adjacent runs with identical formatting (DOCX only)
        simplify_redlines: If True, merge adjacent tracked changes from same author (DOCX only)

    Returns:
        (None, message) - message indicates success or failure
    """
    input_path = Path(input_file)
    output_path = Path(output_directory)
    suffix = input_path.suffix.lower()

    if not input_path.exists():
        return None, f"Error: {input_file} does not exist"

    if suffix not in {".docx", ".pptx", ".xlsx"}:
        return None, f"Error: {input_file} must be a .docx, .pptx, or .xlsx file"

    try:
        # Create output directory
        output_path.mkdir(parents=True, exist_ok=True)

        # Extract ZIP contents
        with zipfile.ZipFile(input_path, "r") as zf:
            zf.extractall(output_path)

        # Pretty print all XML files
        xml_files = list(output_path.rglob("*.xml")) + list(output_path.rglob("*.rels"))
        for xml_file in xml_files:
            _pretty_print_xml(xml_file)

        message = f"Unpacked {input_file} ({len(xml_files)} XML files)"

        # DOCX-specific processing
        if suffix == ".docx":
            # Simplify tracked changes (before merge_runs so more runs can merge)
            if simplify_redlines:
                simplify_count, _ = do_simplify_redlines(str(output_path))
                message += f", simplified {simplify_count} tracked changes"

            # Merge runs
            if merge_runs:
                merge_count, _ = do_merge_runs(str(output_path))
                message += f", merged {merge_count} runs"

        # Escape smart quotes AFTER transformations (which rewrite files)
        for xml_file in xml_files:
            _escape_smart_quotes(xml_file)

        return None, message

    except zipfile.BadZipFile:
        return None, f"Error: {input_file} is not a valid Office file"
    except Exception as e:
        return None, f"Error unpacking: {e}"


def _pretty_print_xml(xml_file: Path) -> None:
    """Pretty print an XML file with indentation."""
    try:
        content = xml_file.read_text(encoding="utf-8")
        dom = defusedxml.minidom.parseString(content)
        xml_file.write_bytes(dom.toprettyxml(indent="  ", encoding="utf-8"))
    except Exception:
        pass  # Skip files that can't be parsed


def _escape_smart_quotes(xml_file: Path) -> None:
    """Replace smart quotes with XML entities so they survive tokenization."""
    try:
        content = xml_file.read_text(encoding="utf-8")
        for char, entity in SMART_QUOTE_REPLACEMENTS.items():
            content = content.replace(char, entity)
        xml_file.write_text(content, encoding="utf-8")
    except Exception:
        pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Unpack an Office file (DOCX, PPTX, XLSX) for editing"
    )
    parser.add_argument("input_file", help="Office file to unpack")
    parser.add_argument("output_directory", help="Output directory")
    parser.add_argument(
        "--merge-runs",
        type=lambda x: x.lower() == "true",
        default=True,
        metavar="true|false",
        help="Merge adjacent runs with identical formatting (DOCX only, default: true)",
    )
    parser.add_argument(
        "--simplify-redlines",
        type=lambda x: x.lower() == "true",
        default=True,
        metavar="true|false",
        help="Merge adjacent tracked changes from same author (DOCX only, default: true)",
    )
    args = parser.parse_args()

    _, message = unpack(
        args.input_file,
        args.output_directory,
        merge_runs=args.merge_runs,
        simplify_redlines=args.simplify_redlines,
    )
    print(message)

    if "Error" in message:
        sys.exit(1)
