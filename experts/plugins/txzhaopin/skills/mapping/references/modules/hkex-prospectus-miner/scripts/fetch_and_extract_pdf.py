#!/usr/bin/env python3
"""
HKEX 招股书 PDF 下载 + 章节抽取工具

用法:
    # 下载并抽取关键章节（默认抽 4 个核心章节）
    python3 fetch_and_extract_pdf.py --url <pdf_url> --output ./output_dir

    # 抽取指定章节
    python3 fetch_and_extract_pdf.py --url <pdf_url> --sections "DIRECTORS AND PARTIES,UNDERWRITING"

    # 仅下载不解析
    python3 fetch_and_extract_pdf.py --url <pdf_url> --download-only

    # 解析本地已有 PDF
    python3 fetch_and_extract_pdf.py --local /path/to/prospectus.pdf

依赖:
    pip install pdfplumber

输出:
    output_dir/
    ├── {filename}.pdf                      # 下载的原 PDF
    ├── {filename}_sections.json            # 抽取出的章节文本
    └── {filename}_intermediaries.json      # 简单正则提取的中介机构（兜底）
"""
from __future__ import annotations
import argparse, json, os, re, sys, urllib.request
from typing import Optional

# 尝试导入 pdfplumber
try:
    import pdfplumber
    _HAS_PDFPLUMBER = True
except ImportError:
    _HAS_PDFPLUMBER = False


# ====== 关键章节定义 ======
DEFAULT_SECTIONS = [
    "DIRECTORS AND PARTIES INVOLVED IN THE LISTING",
    "DIRECTORS AND PARTIES INVOLVED IN THE GLOBAL OFFERING",
    "UNDERWRITING",
    "STATUTORY AND GENERAL INFORMATION",
    "Consents of Experts",
    "CORPORATE INFORMATION",
]

# 中文版章节
CHINESE_SECTIONS = [
    "董事及参与上市的各方",
    "包销",
    "法定及一般资料",
    "专家同意书",
    "公司资料",
]


# ====== 1. 下载 PDF ======

def download_pdf(url: str, output_path: str) -> bool:
    """下载 PDF 到指定路径"""
    if os.path.exists(output_path):
        print(f"[CACHE] PDF 已存在: {output_path}")
        return True

    print(f"[DL] 下载: {url}")
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        })
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = resp.read()
        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
        with open(output_path, "wb") as f:
            f.write(data)
        print(f"[OK] 已保存 ({len(data)/1024:.0f} KB) → {output_path}")
        return True
    except Exception as e:
        print(f"[ERR] 下载失败: {e}", file=sys.stderr)
        return False


# ====== 2. 提取章节 ======

def find_section_pages(pdf, section_titles: list[str]) -> dict:
    """
    扫描 PDF，返回每个章节的起始页码字典
    {section_title: start_page_idx}
    """
    found = {}
    n_pages = len(pdf.pages)
    print(f"[SCAN] 扫描 {n_pages} 页查找章节...")

    for i, page in enumerate(pdf.pages):
        try:
            text = page.extract_text() or ""
        except Exception:
            continue

        # 取页面前 500 字符（章节标题通常在页首）
        head = text[:500].upper()

        for title in section_titles:
            if title in found: continue
            if title.upper() in head:
                # 排除 TOC 页（目录页通常出现一次但只有标题没正文）
                # 简单判断：页面文本 < 200 字 → 可能是 TOC
                if len(text) < 200: continue
                found[title] = i
                print(f"  [HIT] {title!r} → 第 {i+1} 页")

        # 提前停止：找到所有章节
        if len(found) == len(section_titles):
            break

    return found


def extract_section_text(pdf, start_page: int, max_pages: int = 30) -> str:
    """从起始页开始抽取连续 N 页的文本，直到下一章节或上限"""
    chunks = []
    n_pages = len(pdf.pages)
    end = min(start_page + max_pages, n_pages)

    for i in range(start_page, end):
        try:
            text = pdf.pages[i].extract_text() or ""
            chunks.append(text)
        except Exception as e:
            print(f"  [WARN] 第 {i+1} 页解析失败: {e}", file=sys.stderr)

    return "\n\n".join(chunks)


def extract_sections(pdf_path: str, sections: list[str] = None,
                     max_pages_per_section: int = 30) -> dict:
    """从 PDF 中抽取多个章节内容"""
    if not _HAS_PDFPLUMBER:
        print("[ERR] pdfplumber 未安装，无法解析 PDF。请运行: pip install pdfplumber", file=sys.stderr)
        return {}

    sections = sections or DEFAULT_SECTIONS

    print(f"[OPEN] {pdf_path}")
    result = {}
    with pdfplumber.open(pdf_path) as pdf:
        n_pages = len(pdf.pages)
        print(f"[INFO] PDF 共 {n_pages} 页")

        # 找到每个章节起始位置
        section_pages = find_section_pages(pdf, sections)

        # 抽取每个章节文本
        for title, start in section_pages.items():
            text = extract_section_text(pdf, start, max_pages_per_section)
            result[title] = {
                "start_page": start + 1,
                "char_count": len(text),
                "text": text,
            }
            print(f"  [EXTRACT] {title}: {len(text)} 字符（从 P{start+1}）")

    if not result:
        print("[WARN] 未找到任何目标章节，返回前 50 页文本作为兜底")
        with pdfplumber.open(pdf_path) as pdf:
            fallback_text = []
            for i, page in enumerate(pdf.pages[:50]):
                try:
                    fallback_text.append(page.extract_text() or "")
                except Exception:
                    pass
            result["__fallback_first_50_pages__"] = {
                "start_page": 1,
                "text": "\n\n".join(fallback_text),
            }

    return result


# ====== 3. 中介机构兜底正则提取 ======

INTERMEDIARY_PATTERNS = {
    "sponsors": [
        r"(?:Sole Sponsor|Joint Sponsors?|Joint Sponsors and Joint Sponsor[- ]Overall Coordinators?)\s*[:\n]([\s\S]{0,2500}?)(?=\n\s*(?:Overall Coordinators?|Joint Bookrunners?|Underwriters?|Capital Market|Joint Lead Managers?|\nLEGAL ADVISERS|Legal Advisers))",
        r"(?:独家保荐人|联席保荐人)\s*[:\n]([\s\S]{0,1500}?)(?=\n\s*(?:整体协调人|联席账簿管理人|联席牵头经办人))",
    ],
    "overall_coordinators": [
        r"Overall Coordinators?\s*[:\n]([\s\S]{0,2000}?)(?=\n\s*(?:Joint Global Coordinators?|Joint Bookrunners?|Joint Lead Managers?|Capital Market))",
        r"整体协调人\s*[:\n]([\s\S]{0,1500}?)(?=\n\s*(?:联席全球协调人|联席账簿管理人))",
    ],
    "joint_bookrunners": [
        r"Joint Bookrunners?\s*[:\n]([\s\S]{0,2500}?)(?=\n\s*(?:Joint Lead Managers?|Co[- ]Lead|Underwriters?|LEGAL ADVISERS|Legal Advisers))",
        r"联席账簿管理人\s*[:\n]([\s\S]{0,2000}?)(?=\n\s*(?:联席牵头经办人))",
    ],
    "legal_counsel_company_hk": [
        r"Legal Advisers? to (?:our |the )?(?:Company|Issuer) as to Hong Kong Law\s*[:\n]([\s\S]{0,500}?)(?=\n\s*(?:Legal Advisers|as to))",
    ],
    "legal_counsel_company_prc": [
        r"Legal Advisers? to (?:our |the )?(?:Company|Issuer) as to PRC Law\s*[:\n]([\s\S]{0,500}?)(?=\n\s*(?:Legal Advisers|as to))",
    ],
    "legal_counsel_sponsors_hk": [
        r"Legal Advisers? to (?:the )?(?:Sponsors?|Joint Sponsors?) as to Hong Kong Law\s*[:\n]([\s\S]{0,500}?)(?=\n\s*(?:Legal Advisers|as to))",
    ],
    "auditors": [
        r"(?:Reporting Accountants?|Auditors?)\s*[:\n]([\s\S]{0,500}?)(?=\n\s*(?:Industry Consultant|Compliance Adviser|Receiving Bank))",
        r"(?:申报会计师|核数师|审计师)\s*[:\n]([\s\S]{0,300}?)(?=\n\s*(?:行业顾问|合规顾问|接收银行))",
    ],
    "industry_consultant": [
        r"Industry Consultants?\s*[:\n]([\s\S]{0,500}?)(?=\n\s*(?:Compliance Adviser|Receiving Bank|HKSCC))",
    ],
    "compliance_adviser": [
        r"Compliance Advisers?\s*[:\n]([\s\S]{0,500}?)(?=\n\s*(?:Receiving Bank|HKSCC|Hong Kong Share))",
    ],
}


def extract_intermediaries(text: str) -> dict:
    """正则兜底：从抽取的文本中识别中介机构（不依赖 LLM）"""
    result = {}
    for role, patterns in INTERMEDIARY_PATTERNS.items():
        matches = []
        for pattern in patterns:
            for m in re.finditer(pattern, text, re.IGNORECASE):
                snippet = m.group(1).strip()
                # 清理：取前 800 字符，去除多余空白
                snippet = re.sub(r"\n{3,}", "\n\n", snippet)[:800]
                matches.append(snippet)
        if matches:
            result[role] = matches
    return result


# ====== 4. CLI 主程序 ======

def derive_filename(url: str) -> str:
    """从 URL 派生本地文件名"""
    name = url.rstrip("/").split("/")[-1]
    if not name.lower().endswith(".pdf"):
        name = name + ".pdf"
    # 去除危险字符
    name = re.sub(r"[^\w.\-]", "_", name)
    return name


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", help="HKEX 招股书 PDF URL")
    ap.add_argument("--local", help="已下载到本地的 PDF 路径（与 --url 二选一）")
    ap.add_argument("--output", "-o", default="./hkex_pdf_output", help="输出目录")
    ap.add_argument("--sections", help="自定义章节标题（逗号分隔），不指定则用默认 6 个核心章节")
    ap.add_argument("--max-pages-per-section", type=int, default=30, help="每章节最多抽取多少页")
    ap.add_argument("--download-only", action="store_true", help="仅下载不解析")
    ap.add_argument("--no-intermediaries", action="store_true", help="跳过正则兜底提取")
    args = ap.parse_args()

    if not args.url and not args.local:
        ap.error("--url 或 --local 必须指定其一")
        sys.exit(1)

    os.makedirs(args.output, exist_ok=True)

    # ===== 下载或定位 PDF =====
    if args.url:
        filename = derive_filename(args.url)
        pdf_path = os.path.join(args.output, filename)
        if not download_pdf(args.url, pdf_path):
            sys.exit(1)
    else:
        pdf_path = args.local
        if not os.path.exists(pdf_path):
            print(f"[ERR] 本地文件不存在: {pdf_path}", file=sys.stderr)
            sys.exit(1)
        filename = os.path.basename(pdf_path)

    if args.download_only:
        print("[DONE] 下载完成（未解析）")
        return

    # ===== 抽章节 =====
    sections = args.sections.split(",") if args.sections else (DEFAULT_SECTIONS + CHINESE_SECTIONS)
    sections = [s.strip() for s in sections]

    extracted = extract_sections(pdf_path, sections, args.max_pages_per_section)

    # 保存章节文本
    base = os.path.splitext(filename)[0]
    sec_path = os.path.join(args.output, f"{base}_sections.json")
    with open(sec_path, "w", encoding="utf-8") as f:
        json.dump(extracted, f, ensure_ascii=False, indent=2)
    print(f"\n[OK] 章节文本 → {sec_path}")

    # ===== 兜底正则提取中介 =====
    if not args.no_intermediaries:
        all_text = "\n\n".join(s["text"] for s in extracted.values())
        intermediaries = extract_intermediaries(all_text)

        int_path = os.path.join(args.output, f"{base}_intermediaries.json")
        with open(int_path, "w", encoding="utf-8") as f:
            json.dump(intermediaries, f, ensure_ascii=False, indent=2)
        print(f"[OK] 中介机构（兜底正则）→ {int_path}")
        print(f"\n=== 中介机构识别摘要 ===")
        for role, matches in intermediaries.items():
            print(f"  {role}: {len(matches)} 个匹配")
            if matches:
                preview = matches[0][:200].replace("\n", " ")
                print(f"    → {preview}...")

    print("\n[DONE] PDF 解析完成。建议把 _sections.json 提供给 LLM 做精细化结构化提取。")


if __name__ == "__main__":
    main()
