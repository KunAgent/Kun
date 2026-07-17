#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
文件解析器：支持txt/md/docx/pdf/图片OCR
从各种格式的诉讼文书中提取纯文本内容
"""

import os
import re
import zipfile
import xml.etree.ElementTree as ET
from typing import Optional


class FileParser:
    """文件解析器"""

    # XML命名空间
    NAMESPACES = {
        'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
        'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    }

    def __init__(self, ocr_enabled: bool = True):
        """
        Args:
            ocr_enabled: 是否启用图片OCR（需要Pillow和pytesseract）
        """
        self.ocr_enabled = ocr_enabled

    def parse(self, file_path: str) -> str:
        """
        解析文件，返回纯文本内容
        
        Args:
            file_path: 文件路径
            
        Returns:
            文件文本内容
        """
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"文件不存在: {file_path}")
        
        ext = os.path.splitext(file_path)[1].lower()
        
        parsers = {
            '.txt': self._parse_text,
            '.md': self._parse_text,
            '.docx': self._parse_docx,
            '.doc': self._parse_docx_fallback,
            '.pdf': self._parse_pdf,
            '.png': self._parse_image,
            '.jpg': self._parse_image,
            '.jpeg': self._parse_image,
            '.bmp': self._parse_image,
            '.tiff': self._parse_image,
        }
        
        parser = parsers.get(ext)
        if parser is None:
            # 尝试作为文本文件解析
            try:
                return self._parse_text(file_path)
            except:
                raise ValueError(f"不支持的文件格式: {ext}")
        
        return parser(file_path)

    def _parse_text(self, file_path: str) -> str:
        """解析纯文本/Markdown文件"""
        # 尝试多种编码
        encodings = ['utf-8', 'utf-8-sig', 'gbk', 'gb2312', 'gb18030', 'latin-1']
        
        for encoding in encodings:
            try:
                with open(file_path, 'r', encoding=encoding) as f:
                    return f.read()
            except (UnicodeDecodeError, UnicodeError):
                continue
        
        # 最后用utf-8忽略错误
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            return f.read()

    def _parse_docx(self, file_path: str) -> str:
        """解析docx文件，提取全部文本"""
        paragraphs = self._extract_docx_paragraphs(file_path)
        return '\n'.join(paragraphs)

    def _extract_docx_paragraphs(self, file_path: str) -> list:
        """从docx提取段落列表"""
        ns = self.NAMESPACES
        
        try:
            with zipfile.ZipFile(file_path, 'r') as zf:
                with zf.open('word/document.xml') as f:
                    content = f.read()
        except zipfile.BadZipFile:
            # 可能是旧版.doc格式
            return self._parse_docx_fallback_list(file_path)
        
        root = ET.fromstring(content)
        paragraphs = []
        
        for p in root.findall('.//w:p', ns):
            texts = []
            for t in p.findall('.//w:t', ns):
                if t.text:
                    texts.append(t.text)
            if texts:
                paragraphs.append(''.join(texts))
        
        return paragraphs

    def _parse_docx_fallback(self, file_path: str) -> str:
        """doc格式回退：尝试用python-docx或纯文本提取"""
        paragraphs = self._parse_docx_fallback_list(file_path)
        return '\n'.join(paragraphs)

    def _parse_docx_fallback_list(self, file_path: str) -> list:
        """doc格式回退：尝试python-docx"""
        try:
            from docx import Document
            doc = Document(file_path)
            return [p.text for p in doc.paragraphs if p.text.strip()]
        except ImportError:
            # python-docx不可用，尝试二进制提取
            return self._extract_text_from_binary(file_path)
        except Exception:
            return self._extract_text_from_binary(file_path)

    def _extract_text_from_binary(self, file_path: str) -> list:
        """从二进制文件中暴力提取中文/英文字符"""
        try:
            with open(file_path, 'rb') as f:
                data = f.read()
            # 提取UTF-8中文
            text = data.decode('utf-8', errors='ignore')
            # 过滤出有意义的行
            lines = [l.strip() for l in text.split('\n') if l.strip() and len(l.strip()) > 1]
            # 过滤非可打印字符过多的行
            result = []
            for line in lines:
                printable = sum(1 for c in line if c.isprintable())
                if printable / max(len(line), 1) > 0.5:
                    result.append(line)
            return result
        except:
            return ["[无法解析文件内容]"]

    def _parse_pdf(self, file_path: str) -> str:
        """解析PDF文件"""
        # 优先使用PyMuPDF
        try:
            import fitz  # PyMuPDF
            doc = fitz.open(file_path)
            text_parts = []
            for page in doc:
                text_parts.append(page.get_text())
            doc.close()
            return '\n'.join(text_parts)
        except ImportError:
            pass
        except Exception as e:
            pass
        
        # 尝试pdfplumber
        try:
            import pdfplumber
            text_parts = []
            with pdfplumber.open(file_path) as pdf:
                for page in pdf.pages:
                    t = page.extract_text()
                    if t:
                        text_parts.append(t)
            return '\n'.join(text_parts)
        except ImportError:
            pass
        except Exception:
            pass
        
        # 尝试PyPDF2
        try:
            from PyPDF2 import PdfReader
            reader = PdfReader(file_path)
            text_parts = []
            for page in reader.pages:
                t = page.extract_text()
                if t:
                    text_parts.append(t)
            return '\n'.join(text_parts)
        except ImportError:
            pass
        except Exception:
            pass
        
        # 都不可用，尝试pdftotext命令行
        try:
            import subprocess
            result = subprocess.run(
                ['pdftotext', '-layout', file_path, '-'],
                capture_output=True, text=True, timeout=30
            )
            if result.returncode == 0 and result.stdout.strip():
                return result.stdout
        except Exception:
            pass
        
        raise RuntimeError(
            "PDF解析需要安装以下库之一：PyMuPDF (pip install PyMuPDF), "
            "pdfplumber (pip install pdfplumber), 或 PyPDF2 (pip install PyPDF2)"
        )

    def _parse_image(self, file_path: str) -> str:
        """解析图片（OCR）"""
        if not self.ocr_enabled:
            raise RuntimeError("OCR未启用，请设置 ocr_enabled=True")
        
        # 尝试pytesseract
        try:
            import pytesseract
            from PIL import Image
            
            img = Image.open(file_path)
            text = pytesseract.image_to_string(img, lang='chi_sim+eng')
            return text
        except ImportError:
            pass
        except Exception:
            pass
        
        # 尝试easyocr
        try:
            import easyocr
            reader = easyocr.Reader(['ch_sim', 'en'])
            results = reader.readtext(file_path)
            text = '\n'.join([item[1] for item in results])
            return text
        except ImportError:
            pass
        except Exception:
            pass
        
        raise RuntimeError(
            "图片OCR需要安装以下库之一：pytesseract (需先安装Tesseract-OCR), "
            "或 easyocr (pip install easyocr)"
        )

    def extract_docx_detailed(self, file_path: str) -> dict:
        """
        提取docx文件的详细信息（用于对比模板和实例）
        
        Returns:
            {
                "paragraphs": [{"index": int, "text": str, "runs": [str]}],
                "checkboxes": [{"paragraph_index": int, "text_before": str, "char": str}],
                "fields": [{"paragraph_index": int, "label": str, "value": str}]
            }
        """
        result = {
            "paragraphs": [],
            "checkboxes": [],
            "fields": []
        }
        
        ns = self.NAMESPACES
        
        with zipfile.ZipFile(file_path, 'r') as zf:
            with zf.open('word/document.xml') as f:
                content = f.read()
        
        root = ET.fromstring(content)
        
        for idx, p in enumerate(root.findall('.//w:p', ns)):
            runs = []
            all_text = []
            
            for r in p.findall('.//w:r', ns):
                run_texts = []
                for t in r.findall('w:t', ns):
                    if t.text:
                        run_texts.append(t.text)
                run_text = ''.join(run_texts)
                if run_text:
                    runs.append(run_text)
                    all_text.append(run_text)
            
            full_text = ''.join(all_text)
            
            para_info = {
                "index": idx,
                "text": full_text,
                "runs": runs
            }
            result["paragraphs"].append(para_info)
            
            # 检测勾选框
            for char in ['□', '☐', '☑', '√']:
                if char in full_text:
                    # 找到每个勾选框的前文
                    pos = 0
                    for run in runs:
                        if char in run:
                            before = full_text[:full_text.index(char, pos)]
                            result["checkboxes"].append({
                                "paragraph_index": idx,
                                "text_before": before[-30:],
                                "char": char,
                                "full_text": full_text
                            })
                        pos += len(run)
            
            # 检测字段（"标签：值"模式）
            field_match = re.match(r'^(.+?[：:])(.*)$', full_text)
            if field_match:
                label = field_match.group(1)
                value = field_match.group(2).strip()
                if value:
                    result["fields"].append({
                        "paragraph_index": idx,
                        "label": label,
                        "value": value
                    })
        
        return result


# 单独测试
if __name__ == '__main__':
    parser = FileParser()
    
    # 测试docx解析
    text = parser.parse('/tmp/templates-example/民事起诉状-民间借贷纠纷-实例.docx')
    print("=== 实例文本 ===")
    print(text[:1000])
    print("...")
    
    # 测试详细解析
    detailed = parser.extract_docx_detailed('/tmp/templates-example/民事起诉状-民间借贷纠纷-实例.docx')
    print(f"\n段落数: {len(detailed['paragraphs'])}")
    print(f"勾选框: {len(detailed['checkboxes'])}")
    print(f"字段: {len(detailed['fields'])}")
