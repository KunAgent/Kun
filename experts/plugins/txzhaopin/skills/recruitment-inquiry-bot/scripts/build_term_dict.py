"""
将 `术语词典.xlsx` 转换为 Markdown 参考文件。

⚠️ 本脚本是 **离线维护工具**（不参与 agent 运行时流程）。
   术语词典正文由后端知识库统一维护（documentId=50），agent 通过 MCP 远程拉取。

   维护流程（HR / 词典维护者）：
   1. 在本地编辑私有 `术语词典.xlsx`（不入 skill 仓库）
   2. 运行本脚本生成 markdown
   3. 把生成的 markdown 内容上传到知识库 documentId=50 覆盖旧版本
   4. 通过 inquiry-bot 验证生效（不需要重启 / 也不需要发版）

用法：
    # 优先级：命令行参数 > 环境变量 TERM_DICT_XLSX > 当前 skill 的 references/术语词典.xlsx
    python3 scripts/build_term_dict.py [xlsx_path] [output_md_path]

    # 或通过环境变量指定（推荐 CI/CD 场景）
    TERM_DICT_XLSX=/path/to/术语词典.xlsx python3 scripts/build_term_dict.py

默认：
    xlsx_path    = ../references/术语词典.xlsx   （相对本脚本，开箱即用）
    output_md    = ../references/term-dictionary.md   （仅供维护者预览，不参与运行时）
"""

import os
import sys
from pathlib import Path

import pandas as pd


_SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_XLSX = Path(
    os.environ.get(
        "TERM_DICT_XLSX",
        str(_SCRIPT_DIR.parent / "references" / "术语词典.xlsx"),
    )
)
DEFAULT_OUTPUT = _SCRIPT_DIR.parent / "references" / "term-dictionary.md"


def build(xlsx_path: Path, md_path: Path) -> None:
    df = pd.read_excel(xlsx_path)
    df = df.fillna("")

    lines: list[str] = []
    lines.append("# 招聘业务术语词典（SKILL 参考）\n")
    lines.append(
        "> 本文件由 `scripts/build_term_dict.py` 从 `术语词典.xlsx` 自动生成，"
        "请不要手工编辑。更新流程：修改 xlsx → 重新运行脚本。\n"
    )
    lines.append(
        "术语词典用途：当 LLM 需要改写检索词时，先在此处查询用户问题中的口语化/模糊表达"
        "对应的**标准术语**与**同义词**，再组合成检索友好的查询串；回答问题时也可用于"
        "消歧与语义对齐。\n"
    )

    # 按一级分类 → 二级分类 分组
    for cat1, g1 in df.groupby("一级分类", sort=False):
        if not str(cat1).strip():
            continue
        lines.append(f"\n## {cat1}\n")
        for cat2, g2 in g1.groupby("二级分类", sort=False):
            if str(cat2).strip():
                lines.append(f"\n### {cat2}\n")
            lines.append("| 标准术语 | 同义词/口语化表达 | 业务定义 |")
            lines.append("| --- | --- | --- |")
            for _, row in g2.iterrows():
                term = str(row.get("标准术语", "")).strip()
                syn = str(row.get("检索同义词", "")).strip().replace("\n", " ")
                defn = str(row.get("业务定义与系统逻辑说明", "")).strip().replace("\n", " ").replace("|", "/")
                if not term:
                    continue
                lines.append(f"| **{term}** | {syn} | {defn} |")
            lines.append("")

    md_path.parent.mkdir(parents=True, exist_ok=True)
    md_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"[ok] 已生成术语词典 Markdown: {md_path}  (术语总数: {len(df)})")


def main() -> None:
    xlsx = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_XLSX
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_OUTPUT
    if not xlsx.exists():
        print(f"[err] 找不到 xlsx: {xlsx}")
        sys.exit(1)
    build(xlsx, out)


if __name__ == "__main__":
    main()
