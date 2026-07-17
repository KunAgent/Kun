"""
Validator for Word document XML files against XSD schemas.
"""

import random
import re
import tempfile
import zipfile

import defusedxml.minidom
import lxml.etree

from .base import BaseSchemaValidator


class DOCXSchemaValidator(BaseSchemaValidator):
    """Validator for Word document XML files against XSD schemas."""

    # Word-specific namespaces
    WORD_2006_NAMESPACE = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    W14_NAMESPACE = "http://schemas.microsoft.com/office/word/2010/wordml"
    W16CID_NAMESPACE = "http://schemas.microsoft.com/office/word/2016/wordml/cid"

    # Word-specific element to relationship type mappings
    # Start with empty mapping - add specific cases as we discover them
    ELEMENT_RELATIONSHIP_TYPES = {}

    def validate(self):
        """Run all validation checks and return True if all pass."""
        # Test 0: XML well-formedness
        if not self.validate_xml():
            return False

        # Test 1: Namespace declarations
        all_valid = True
        if not self.validate_namespaces():
            all_valid = False

        # Test 2: Unique IDs
        if not self.validate_unique_ids():
            all_valid = False

        # Test 3: Relationship and file reference validation
        if not self.validate_file_references():
            all_valid = False

        # Test 4: Content type declarations
        if not self.validate_content_types():
            all_valid = False

        # Test 5: XSD schema validation
        if not self.validate_against_xsd():
            all_valid = False

        # Test 6: Whitespace preservation
        if not self.validate_whitespace_preservation():
            all_valid = False

        # Test 7: Deletion validation
        if not self.validate_deletions():
            all_valid = False

        # Test 8: Insertion validation
        if not self.validate_insertions():
            all_valid = False

        # Test 9: Relationship ID reference validation
        if not self.validate_all_relationship_ids():
            all_valid = False

        # Test 10: ID constraints (paraId, durableId)
        if not self.validate_id_constraints():
            all_valid = False

        # Test 11: Comment marker validation
        if not self.validate_comment_markers():
            all_valid = False

        # Count and compare paragraphs
        self.compare_paragraph_counts()

        return all_valid

    def validate_whitespace_preservation(self):
        """
        Validate that w:t elements with whitespace have xml:space='preserve'.
        """
        errors = []

        for xml_file in self.xml_files:
            # Only check document.xml files
            if xml_file.name != "document.xml":
                continue

            try:
                root = lxml.etree.parse(str(xml_file)).getroot()

                # Find all w:t elements
                for elem in root.iter(f"{{{self.WORD_2006_NAMESPACE}}}t"):
                    if elem.text:
                        text = elem.text
                        # Check if text starts or ends with whitespace
                        if re.match(r"^\s.*", text) or re.match(r".*\s$", text):
                            # Check if xml:space="preserve" attribute exists
                            xml_space_attr = f"{{{self.XML_NAMESPACE}}}space"
                            if (
                                xml_space_attr not in elem.attrib
                                or elem.attrib[xml_space_attr] != "preserve"
                            ):
                                # Show a preview of the text
                                text_preview = (
                                    repr(text)[:50] + "..."
                                    if len(repr(text)) > 50
                                    else repr(text)
                                )
                                errors.append(
                                    f"  {xml_file.relative_to(self.unpacked_dir)}: "
                                    f"Line {elem.sourceline}: w:t element with whitespace missing xml:space='preserve': {text_preview}"
                                )

            except (lxml.etree.XMLSyntaxError, Exception) as e:
                errors.append(
                    f"  {xml_file.relative_to(self.unpacked_dir)}: Error: {e}"
                )

        if errors:
            print(f"FAILED - Found {len(errors)} whitespace preservation violations:")
            for error in errors:
                print(error)
            return False
        else:
            if self.verbose:
                print("PASSED - All whitespace is properly preserved")
            return True

    def validate_deletions(self):
        """
        Validate that w:t and w:instrText elements are not within w:del elements.
        Inside w:del, use w:delText and w:delInstrText instead.
        XSD validation does not catch this, so we do it manually.
        """
        errors = []

        for xml_file in self.xml_files:
            # Only check document.xml files
            if xml_file.name != "document.xml":
                continue

            try:
                root = lxml.etree.parse(str(xml_file)).getroot()
                namespaces = {"w": self.WORD_2006_NAMESPACE}

                # Find all w:t elements that are descendants of w:del elements
                for t_elem in root.xpath(".//w:del//w:t", namespaces=namespaces):
                    if t_elem.text:
                        # Show a preview of the text
                        text_preview = (
                            repr(t_elem.text)[:50] + "..."
                            if len(repr(t_elem.text)) > 50
                            else repr(t_elem.text)
                        )
                        errors.append(
                            f"  {xml_file.relative_to(self.unpacked_dir)}: "
                            f"Line {t_elem.sourceline}: <w:t> found within <w:del>: {text_preview}"
                        )

                # Find all w:instrText elements that are descendants of w:del elements
                # These should be w:delInstrText instead
                for instr_elem in root.xpath(".//w:del//w:instrText", namespaces=namespaces):
                    text_preview = (
                        repr(instr_elem.text or "")[:50] + "..."
                        if len(repr(instr_elem.text or "")) > 50
                        else repr(instr_elem.text or "")
                    )
                    errors.append(
                        f"  {xml_file.relative_to(self.unpacked_dir)}: "
                        f"Line {instr_elem.sourceline}: <w:instrText> found within <w:del> (use <w:delInstrText>): {text_preview}"
                    )

            except (lxml.etree.XMLSyntaxError, Exception) as e:
                errors.append(
                    f"  {xml_file.relative_to(self.unpacked_dir)}: Error: {e}"
                )

        if errors:
            print(f"FAILED - Found {len(errors)} deletion validation violations:")
            for error in errors:
                print(error)
            return False
        else:
            if self.verbose:
                print("PASSED - No w:t elements found within w:del elements")
            return True

    def count_paragraphs_in_unpacked(self):
        """Count the number of paragraphs in the unpacked document."""
        count = 0

        for xml_file in self.xml_files:
            # Only check document.xml files
            if xml_file.name != "document.xml":
                continue

            try:
                root = lxml.etree.parse(str(xml_file)).getroot()
                # Count all w:p elements
                paragraphs = root.findall(f".//{{{self.WORD_2006_NAMESPACE}}}p")
                count = len(paragraphs)
            except Exception as e:
                print(f"Error counting paragraphs in unpacked document: {e}")

        return count

    def count_paragraphs_in_original(self):
        """Count the number of paragraphs in the original docx file."""
        count = 0

        try:
            # Create temporary directory to unpack original
            with tempfile.TemporaryDirectory() as temp_dir:
                # Unpack original docx
                with zipfile.ZipFile(self.original_file, "r") as zip_ref:
                    zip_ref.extractall(temp_dir)

                # Parse document.xml
                doc_xml_path = temp_dir + "/word/document.xml"
                root = lxml.etree.parse(doc_xml_path).getroot()

                # Count all w:p elements
                paragraphs = root.findall(f".//{{{self.WORD_2006_NAMESPACE}}}p")
                count = len(paragraphs)

        except Exception as e:
            print(f"Error counting paragraphs in original document: {e}")

        return count

    def validate_insertions(self):
        """
        Validate that w:delText elements are not within w:ins elements.
        w:delText is only allowed in w:ins if nested within a w:del.
        """
        errors = []

        for xml_file in self.xml_files:
            if xml_file.name != "document.xml":
                continue

            try:
                root = lxml.etree.parse(str(xml_file)).getroot()
                namespaces = {"w": self.WORD_2006_NAMESPACE}

                # Find w:delText in w:ins that are NOT within w:del
                invalid_elements = root.xpath(
                    ".//w:ins//w:delText[not(ancestor::w:del)]", namespaces=namespaces
                )

                for elem in invalid_elements:
                    text_preview = (
                        repr(elem.text or "")[:50] + "..."
                        if len(repr(elem.text or "")) > 50
                        else repr(elem.text or "")
                    )
                    errors.append(
                        f"  {xml_file.relative_to(self.unpacked_dir)}: "
                        f"Line {elem.sourceline}: <w:delText> within <w:ins>: {text_preview}"
                    )

            except (lxml.etree.XMLSyntaxError, Exception) as e:
                errors.append(
                    f"  {xml_file.relative_to(self.unpacked_dir)}: Error: {e}"
                )

        if errors:
            print(f"FAILED - Found {len(errors)} insertion validation violations:")
            for error in errors:
                print(error)
            return False
        else:
            if self.verbose:
                print("PASSED - No w:delText elements within w:ins elements")
            return True

    def compare_paragraph_counts(self):
        """Compare paragraph counts between original and new document."""
        original_count = self.count_paragraphs_in_original()
        new_count = self.count_paragraphs_in_unpacked()

        diff = new_count - original_count
        diff_str = f"+{diff}" if diff > 0 else str(diff)
        print(f"\nParagraphs: {original_count} → {new_count} ({diff_str})")

    def _parse_id_value(self, val: str, base: int = 16) -> int:
        """Parse an ID value as hex (base=16) or decimal (base=10).

        Args:
            val: The string value to parse
            base: The numeric base (16 for hex, 10 for decimal)

        Returns:
            The parsed integer value
        """
        return int(val, base)

    def validate_id_constraints(self):
        """Validate paraId and durableId values per OOXML spec.

        Checks:
        - paraId < 0x80000000 (always hex)
        - durableId < 0x7FFFFFFF (decimal in numbering.xml, hex elsewhere)
        """
        errors = []
        para_id_attr = f"{{{self.W14_NAMESPACE}}}paraId"
        durable_id_attr = f"{{{self.W16CID_NAMESPACE}}}durableId"

        for xml_file in self.xml_files:
            try:
                for elem in lxml.etree.parse(str(xml_file)).iter():
                    # paraId is always hex format
                    if val := elem.get(para_id_attr):
                        if self._parse_id_value(val, base=16) >= 0x80000000:
                            errors.append(
                                f"  {xml_file.name}:{elem.sourceline}: paraId={val} >= 0x80000000"
                            )

                    if val := elem.get(durable_id_attr):
                        # durableId in numbering.xml must be decimal.
                        # Word rejects hex-formatted durableIds in numbering.xml.
                        if xml_file.name == "numbering.xml":
                            try:
                                if self._parse_id_value(val, base=10) >= 0x7FFFFFFF:
                                    errors.append(
                                        f"  {xml_file.name}:{elem.sourceline}: "
                                        f"durableId={val} >= 0x7FFFFFFF"
                                    )
                            except ValueError:
                                # Contains non-decimal characters (e.g., hex letters A-F)
                                errors.append(
                                    f"  {xml_file.name}:{elem.sourceline}: "
                                    f"durableId={val} must be decimal in numbering.xml"
                                )
                        # durableId in other files (e.g. commentsIds.xml) uses hex format
                        else:
                            if self._parse_id_value(val, base=16) >= 0x7FFFFFFF:
                                errors.append(
                                    f"  {xml_file.name}:{elem.sourceline}: "
                                    f"durableId={val} >= 0x7FFFFFFF"
                                )
            except Exception:
                pass

        if errors:
            print(f"FAILED - {len(errors)} ID constraint violations:")
            for e in errors:
                print(e)
        elif self.verbose:
            print("PASSED - All paraId/durableId values within constraints")
        return not errors

    def validate_comment_markers(self):
        """Validate comment markers are properly paired and reference existing comments.

        Checks:
        - Every commentRangeStart has a matching commentRangeEnd
        - Every commentRangeEnd has a matching commentRangeStart
        - Every marker in document.xml references an existing comment
        """
        errors = []

        # Find document.xml and comments.xml
        document_xml = None
        comments_xml = None
        for xml_file in self.xml_files:
            if xml_file.name == "document.xml" and "word" in str(xml_file):
                document_xml = xml_file
            elif xml_file.name == "comments.xml":
                comments_xml = xml_file

        if not document_xml:
            if self.verbose:
                print("PASSED - No document.xml found (skipping comment validation)")
            return True

        try:
            doc_root = lxml.etree.parse(str(document_xml)).getroot()
            namespaces = {"w": self.WORD_2006_NAMESPACE}

            # Collect all comment marker IDs from document.xml
            range_starts = {
                elem.get(f"{{{self.WORD_2006_NAMESPACE}}}id")
                for elem in doc_root.xpath(".//w:commentRangeStart", namespaces=namespaces)
            }
            range_ends = {
                elem.get(f"{{{self.WORD_2006_NAMESPACE}}}id")
                for elem in doc_root.xpath(".//w:commentRangeEnd", namespaces=namespaces)
            }
            references = {
                elem.get(f"{{{self.WORD_2006_NAMESPACE}}}id")
                for elem in doc_root.xpath(".//w:commentReference", namespaces=namespaces)
            }

            # Check for orphaned commentRangeEnd (missing commentRangeStart)
            orphaned_ends = range_ends - range_starts
            for comment_id in sorted(orphaned_ends, key=lambda x: int(x) if x and x.isdigit() else 0):
                errors.append(
                    f"  document.xml: commentRangeEnd id=\"{comment_id}\" has no matching commentRangeStart"
                )

            # Check for orphaned commentRangeStart (missing commentRangeEnd)
            orphaned_starts = range_starts - range_ends
            for comment_id in sorted(orphaned_starts, key=lambda x: int(x) if x and x.isdigit() else 0):
                errors.append(
                    f"  document.xml: commentRangeStart id=\"{comment_id}\" has no matching commentRangeEnd"
                )

            # Get comment IDs from comments.xml if it exists
            comment_ids = set()
            if comments_xml and comments_xml.exists():
                comments_root = lxml.etree.parse(str(comments_xml)).getroot()
                comment_ids = {
                    elem.get(f"{{{self.WORD_2006_NAMESPACE}}}id")
                    for elem in comments_root.xpath(".//w:comment", namespaces=namespaces)
                }

                # Check for markers referencing non-existent comments
                marker_ids = range_starts | range_ends | references
                invalid_refs = marker_ids - comment_ids
                for comment_id in sorted(invalid_refs, key=lambda x: int(x) if x and x.isdigit() else 0):
                    if comment_id:  # Skip None values
                        errors.append(
                            f"  document.xml: marker id=\"{comment_id}\" references non-existent comment"
                        )

        except (lxml.etree.XMLSyntaxError, Exception) as e:
            errors.append(f"  Error parsing XML: {e}")

        if errors:
            print(f"FAILED - {len(errors)} comment marker violations:")
            for error in errors:
                print(error)
            return False
        else:
            if self.verbose:
                print("PASSED - All comment markers properly paired")
            return True

    def repair(self) -> int:
        """Run DOCX-specific auto-repairs."""
        repairs = super().repair()
        repairs += self.repair_durableId()
        return repairs

    def repair_durableId(self) -> int:
        """Fix invalid durableId values.

        Repairs:
        - durableId >= 0x7FFFFFFF (value out of range)
        - durableId with hex letters in numbering.xml (wrong format)

        Note: paraId is not auto-repaired because it may be referenced by
        commentsExtended.xml, commentsIds.xml, and comment threading (paraIdParent).
        Changing paraId without updating all references would break comment associations.
        """
        repairs = 0

        for xml_file in self.xml_files:
            try:
                content = xml_file.read_text(encoding="utf-8")
                dom = defusedxml.minidom.parseString(content)
                modified = False

                for elem in dom.getElementsByTagName("*"):
                    if not elem.hasAttribute("w16cid:durableId"):
                        continue

                    durable_id = elem.getAttribute("w16cid:durableId")
                    needs_repair = False

                    # Check if durableId needs repair based on file type
                    if xml_file.name == "numbering.xml":
                        # numbering.xml requires decimal format
                        try:
                            needs_repair = self._parse_id_value(durable_id, base=10) >= 0x7FFFFFFF
                        except ValueError:
                            # Contains non-decimal characters (e.g., hex letters A-F)
                            needs_repair = True
                    else:
                        # Other files (e.g. commentsIds.xml) use hex format
                        try:
                            needs_repair = self._parse_id_value(durable_id, base=16) >= 0x7FFFFFFF
                        except ValueError:
                            needs_repair = True

                    if needs_repair:
                        # Generate new ID in the correct format for this file type
                        value = random.randint(1, 0x7FFFFFFE)
                        if xml_file.name == "numbering.xml":
                            new_id = str(value)  # decimal for numbering.xml
                        else:
                            new_id = f"{value:08X}"  # hex for other files

                        elem.setAttribute("w16cid:durableId", new_id)
                        print(
                            f"  Repaired: {xml_file.name}: durableId {durable_id} → {new_id}"
                        )
                        repairs += 1
                        modified = True

                if modified:
                    xml_file.write_bytes(dom.toxml(encoding="UTF-8"))

            except Exception:
                pass

        return repairs


if __name__ == "__main__":
    raise RuntimeError("This module should not be run directly.")
