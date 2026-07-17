"""Simplify tracked changes by merging adjacent w:ins or w:del elements.

Merges adjacent <w:ins> elements from the same author into a single element.
Same for <w:del> elements. This makes heavily-redlined documents easier to
work with by reducing the number of tracked change wrappers.

Rules:
- Only merges w:ins with w:ins, w:del with w:del (same element type)
- Only merges if same author (ignores timestamp differences)
- Only merges if truly adjacent (only whitespace between them)
"""

import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

import defusedxml.minidom

WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def simplify_redlines(input_dir: str) -> tuple[int, str]:
    """Merge adjacent tracked changes from the same author in document.xml.

    Args:
        input_dir: Path to unpacked DOCX directory

    Returns:
        (merge_count, message)
    """
    doc_xml = Path(input_dir) / "word" / "document.xml"

    if not doc_xml.exists():
        return 0, f"Error: {doc_xml} not found"

    try:
        dom = defusedxml.minidom.parseString(doc_xml.read_text(encoding="utf-8"))
        root = dom.documentElement

        merge_count = 0

        # Find all paragraphs and table cells (containers for content)
        containers = _find_elements(root, "p") + _find_elements(root, "tc")

        for container in containers:
            merge_count += _merge_tracked_changes_in(container, "ins")
            merge_count += _merge_tracked_changes_in(container, "del")

        doc_xml.write_bytes(dom.toxml(encoding="UTF-8"))
        return merge_count, f"Simplified {merge_count} tracked changes"

    except Exception as e:
        return 0, f"Error: {e}"


def _merge_tracked_changes_in(container, tag: str) -> int:
    """Merge adjacent w:ins or w:del elements from the same author."""
    merge_count = 0

    # Get direct children that are tracked changes of this type
    tracked = [
        child
        for child in container.childNodes
        if child.nodeType == child.ELEMENT_NODE and _is_element(child, tag)
    ]

    if len(tracked) < 2:
        return 0

    # Process from front: merge next into current when possible
    i = 0
    while i < len(tracked) - 1:
        curr = tracked[i]
        next_elem = tracked[i + 1]

        if _can_merge_tracked(curr, next_elem):
            _merge_tracked_content(curr, next_elem)
            container.removeChild(next_elem)
            tracked.pop(i + 1)
            merge_count += 1
            # Don't increment i - try to merge more into curr
        else:
            i += 1

    return merge_count


def _is_element(node, tag: str) -> bool:
    """Check if node matches the given tag name."""
    name = node.localName or node.tagName
    return name == tag or name.endswith(f":{tag}")


def _get_author(elem) -> str:
    """Get the author attribute from a tracked change element."""
    author = elem.getAttribute("w:author")
    if not author:
        for attr in elem.attributes.values():
            if attr.localName == "author" or attr.name.endswith(":author"):
                return attr.value
    return author


def _can_merge_tracked(elem1, elem2) -> bool:
    """Check if two tracked change elements can be merged."""
    # Must be same author
    if _get_author(elem1) != _get_author(elem2):
        return False

    # Must be truly adjacent (only whitespace between them)
    node = elem1.nextSibling
    while node and node != elem2:
        if node.nodeType == node.ELEMENT_NODE:
            return False
        if node.nodeType == node.TEXT_NODE and node.data.strip():
            return False
        node = node.nextSibling

    return True


def _merge_tracked_content(target, source):
    """Move all children from source tracked change to target."""
    while source.firstChild:
        child = source.firstChild
        source.removeChild(child)
        target.appendChild(child)


def _find_elements(root, tag: str) -> list:
    """Find all elements matching tag name (with or without namespace)."""
    results = []

    def traverse(node):
        if node.nodeType == node.ELEMENT_NODE:
            name = node.localName or node.tagName
            if name == tag or name.endswith(f":{tag}"):
                results.append(node)
            for child in node.childNodes:
                traverse(child)

    traverse(root)
    return results


def get_tracked_change_authors(doc_xml_path: Path) -> dict[str, int]:
    """Get authors and their tracked change counts from a document.xml file.

    Returns:
        Dict mapping author name to count of tracked changes (w:ins + w:del)
    """
    if not doc_xml_path.exists():
        return {}

    try:
        tree = ET.parse(doc_xml_path)
        root = tree.getroot()
    except ET.ParseError:
        return {}

    namespaces = {"w": WORD_NS}
    author_attr = f"{{{WORD_NS}}}author"

    authors: dict[str, int] = {}
    for tag in ["ins", "del"]:
        for elem in root.findall(f".//w:{tag}", namespaces):
            author = elem.get(author_attr)
            if author:
                authors[author] = authors.get(author, 0) + 1

    return authors


def _get_authors_from_docx(docx_path: Path) -> dict[str, int]:
    """Get authors and counts from a packed DOCX file."""
    try:
        with zipfile.ZipFile(docx_path, "r") as zf:
            if "word/document.xml" not in zf.namelist():
                return {}
            with zf.open("word/document.xml") as f:
                tree = ET.parse(f)
                root = tree.getroot()

                namespaces = {"w": WORD_NS}
                author_attr = f"{{{WORD_NS}}}author"

                authors: dict[str, int] = {}
                for tag in ["ins", "del"]:
                    for elem in root.findall(f".//w:{tag}", namespaces):
                        author = elem.get(author_attr)
                        if author:
                            authors[author] = authors.get(author, 0) + 1
                return authors
    except (zipfile.BadZipFile, ET.ParseError):
        return {}


def infer_author(modified_dir: Path, original_docx: Path, default: str = "Claude") -> str:
    """Infer the author to validate by finding who added tracked changes.

    Compares tracked change counts between modified and original documents.
    Returns the author who added new tracked changes.

    Args:
        modified_dir: Path to unpacked DOCX directory
        original_docx: Path to original DOCX file
        default: Default author if no new changes found

    Returns:
        Author name to use for validation

    Raises:
        ValueError: If multiple authors added new changes (ambiguous)
    """
    modified_xml = modified_dir / "word" / "document.xml"
    modified_authors = get_tracked_change_authors(modified_xml)

    if not modified_authors:
        return default

    original_authors = _get_authors_from_docx(original_docx)

    # Calculate new changes per author (modified count - original count)
    new_changes: dict[str, int] = {}
    for author, count in modified_authors.items():
        original_count = original_authors.get(author, 0)
        diff = count - original_count
        if diff > 0:
            new_changes[author] = diff

    if not new_changes:
        return default

    if len(new_changes) == 1:
        return next(iter(new_changes))

    raise ValueError(
        f"Multiple authors added new changes: {new_changes}. "
        "Cannot infer which author to validate."
    )
