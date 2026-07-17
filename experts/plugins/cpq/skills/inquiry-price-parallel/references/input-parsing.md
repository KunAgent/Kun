# 输入解析：多格式配置清单 → markdown 表格

> **加载触发**：
>
> - **MANDATORY READ** — 当用户提供 **非 markdown 表格** 的输入（`.xlsx` / `.xls` / `.xlsm` / `.csv` / `.pdf` / `.docx` / `.doc` / 图片 / 自由文本）需要转 `source_table.md` 时
> - **可选**：仅当不确定具体格式的解析策略时按需读对应 §段（A=Excel · B=PDF · C=Word · D=图片 · E=自由文本与下游契约）
> - **Do NOT Load** — 用户直接提供了 markdown 表格（或已有 `source_table.md`）· 同一会话内已用同种格式成功跑过 · 单纯做 --resume 续跑时
>
> 本文件由 `SKILL.md` 在"用户提供配置清单需要批量查价"时按需加载。

核心理念一句话：**适配层只搬运，不思考；业务智能全部留给服务端询价智能体。** 所有输入（Excel / PDF / DOCX / 图片 / 文本）最终喂给服务端的都是同一种东西——忠实还原用户原始数据的 markdown 表格（`source_table.md`）。

---

## 输入格式识别与解析策略

按文件扩展名自动选择解析策略，**优先使用父级 `cpq/skills/` 目录中的专用 skill**（通过 `use_skill` 加载），降级才用本 skill 内置脚本或 LLM 视觉。

| 输入类型 | 扩展名 | 优先策略 | 降级策略 |
|----------|--------|---------|---------|
| Excel 表格 | `.xlsx` `.xls` `.xlsm` `.csv` | 加载 `xlsx-manipulation` skill → openpyxl 读取 | 本 skill 的 `parse_excel.py` |
| PDF 文档 | `.pdf` | 加载 `pdf-extraction` skill → pdfplumber 提取表格/文本 | LLM 视觉识图（逐页截图） |
| Word 文档 | `.docx` `.doc` | 加载 `docx-manipulation` skill → python-docx 提取表格/文本 | LLM 视觉识图（逐页截图） |
| 图片 | `.png` `.jpg` `.jpeg` `.webp` `.bmp` | LLM 视觉直接识图 | — |
| 自由文本 | — | 按白名单转 markdown 表格 | — |

> **关于 skill 加载**：使用 `use_skill("<skill-name>")` 工具加载对应 skill。加载后 skill 的 Python 库使用模式和代码示例即对当前会话可用，AI 据此生成并执行解析脚本。

---

## A. Excel 配置清单解析

### 策略 1（优先）：使用父级 `xlsx-manipulation` skill

1. **加载 skill**：`use_skill("xlsx-manipulation")`
2. 该 skill 提供 `openpyxl` 的完整使用模式（包括 `load_workbook`、`iter_rows`、合并单元格展开等）
3. **生成并执行 Python 脚本**：读 Excel → 忠实搬运为 markdown 表格 → 写入 `source_table.md`

```python
# 示例骨架（具体代码由 AI 参照 xlsx-manipulation skill 的模式生成，确保合并单元格正确展开）
from openpyxl import load_workbook

wb = load_workbook('/path/to/配置清单.xlsx', data_only=True)
ws = wb.active  # 或用 wb[sheet_name] 指定 sheet

# 1) 展开合并单元格（关键：被合并的非左上角 cell 在 iter_rows 中值为 None）
#    ✅ 基于真实合并区域（ws.merged_cells.ranges）填值——只在合并组内填，不会跨组
#    ❌ 不要做"前向填充"（forward-fill）：那会把上一组的值错误地填到下一个独立的留空组里
for merged_range in list(ws.merged_cells.ranges):
    min_col, min_row, max_col, max_row = merged_range.bounds
    top_left = ws.cell(row=min_row, column=min_col).value
    ws.unmerge_cells(str(merged_range))
    for r in range(min_row, max_row + 1):
        for c in range(min_col, max_col + 1):
            ws.cell(row=r, column=c).value = top_left

# 2) 读表头（第一行）+ 数据行
rows = list(ws.iter_rows(values_only=True))
headers = [str(h).strip() if h is not None else f"列{i+1}" for i, h in enumerate(rows[0])]

# 3) 转 markdown 表格 → 写入 source_table.md
# （注意：单元格内换行压成空格、竖线 | 转义为 \|）
# 用户故意留空的格子（不在任何合并区域内）保留为空串，让远端 LLM 自行追问
```

### 策略 2（降级）：本 skill 内置 `parse_excel.py`

当 `xlsx-manipulation` skill 不可用或 openpyxl 环境异常时降级：

```bash
SKILL_BASE_DIR="<加载 skill 时显示的 Base directory>"
python3 "$SKILL_BASE_DIR/scripts/parse_excel.py" --file /path/to/配置清单.xlsx
```

#### 参数说明

| 参数 | 必填 | 说明 |
|------|------|------|
| `--file` | 是 | Excel 文件路径 |
| `--sheet` | 否 | 指定 Sheet 名称（默认取第一个） |
| `--format` | 否 | 输出格式：`markdown`（默认）、`json`、`text` |

#### 输出示例（markdown 格式）

```
| 产品/规格 | 站点 | 地域 | 计费模式 | 数量 | 时长 |
| --- | --- | --- | --- | --- | --- |
| 云服务器CVM 标准型S5 2核2GB | 国际站 | ap-singapore | 包年包月 | 1 | 12 |
| 云硬盘CBS 高性能云硬盘 100GB | 国际站 | ap-singapore | 包年包月 | 2 | 12 |
```

> **关于列名**：无论哪种策略，都以用户文件的**第一行作为表头原样输出**，不会强制要求必须是上面这 6 列。用户文件里有什么列就输出什么列。智能体那端会自己判断列含义、容忍列的多寡、缺啥追问啥。

---

## B. PDF 配置清单解析

### 策略 1（优先）：使用父级 `pdf-extraction` skill

1. **加载 skill**：`use_skill("pdf-extraction")`
2. 该 skill 提供 `pdfplumber` 的完整使用模式（`extract_text`、`extract_tables`、表格调试可视化等）
3. **生成并执行 Python 脚本**：读 PDF → 提取表格或文本 → 忠实搬运为 markdown 表格 → 写入 `source_table.md`

```python
# 示例骨架（具体代码由 AI 参照 pdf-extraction skill 的模式生成）
import pdfplumber

with pdfplumber.open('/path/to/配置清单.pdf') as pdf:
    all_rows = []
    header = None

    for page in pdf.pages:
        # 优先尝试 extract_tables（PDF 中的规整表格）
        tables = page.extract_tables()
        if tables:
            for table in tables:
                for i, row in enumerate(table):
                    clean = [cell.strip() if cell else '' for cell in row]
                    if header is None:
                        header = clean  # 第一个表的第一行作表头
                    elif clean != header:
                        all_rows.append(clean)  # 后续出现的相同表头行跳过
        else:
            # 无规整表格时提取纯文本
            text = page.extract_text()
            if text:
                for line in text.split('\n'):
                    line = line.strip()
                    if line:
                        # 按空白列切分 → 可能是不规整的表格行
                        ...
```

#### 搬运原则

- PDF 表格的列名原样保留，不翻译、不归一化
- **合并单元格按视觉边界展开到每行**（关键！）：
  - pdfplumber 的 `extract_tables` 默认**不展开**合并 —— 合并区域只有第一格有值，其它格是 `None` 或空串
  - 需要在脚本中按视觉边界（pdfplumber 的 cell bbox / table.cells）判断哪些 None 是"合并的延续"、哪些是"用户故意留空"
  - 安全做法：如果无法精确判断合并边界，**保留原始 None 为空串**（让远端 LLM 追问），**不要做"前向填充"猜测**（会跨越合并组）
- 跨页表格需拼接：后续页的表头行如果与首页表头相同则跳过，不重复输出
- 空单元格输出为空字符串 `""`，不填占位符

### 策略 2（降级）：LLM 视觉识图

当 `pdf-extraction` skill 不可用、pdfplumber 无法提取出可用表格、或 PDF 是扫描件（纯图片）时降级为视觉识图。处理原则与 §D（图片配置清单解析）一致：逐页截图 → LLM 识图 → 忠实搬运为 markdown 表格。

---

## C. Word 文档解析（.docx / .doc）

### 策略 1（优先）：使用父级 `docx-manipulation` skill

1. **加载 skill**：`use_skill("docx-manipulation")`
2. 该 skill 提供 `python-docx` 的完整使用模式（`Document`、`tables`、`paragraphs`、样式处理等）
3. **生成并执行 Python 脚本**：读 docx → 提取表格或文本 → 忠实搬运为 markdown 表格 → 写入 `source_table.md`

```python
# 示例骨架（具体代码由 AI 参照 docx-manipulation skill 的模式生成）
from docx import Document

doc = Document('/path/to/配置清单.docx')

# 优先提取 docx 中的表格
if doc.tables:
    table = doc.tables[0]  # 取第一个表格
    rows = []
    for i, row in enumerate(table.rows):
        cells = [cell.text.strip() for cell in row.cells]
        rows.append(cells)

    # 第一行作为表头，后续为数据行 → 转 markdown 表格 → 写入 source_table.md
    ...
else:
    # 无表格时从段落文本按行解析
    for para in doc.paragraphs:
        text = para.text.strip()
        if text:
            ...
```

#### 搬运原则

- docx 表格列名原样保留，不翻译
- 合并单元格按 Word 内部结构展开：python-docx 对合并区域内每个 cell 返回相同值（这是 docx 内部表示决定的行为，**天然只在合并组内填**，不会跨组——直接用 `cell.text` 即可，**不需要**额外做前向填充）
- 表格之外的段落文本（标题、备注、脚注）用 markdown 引用块（`>`）贴在表格前后，给远端智能体完整上下文

### 策略 2（降级）：LLM 视觉识图

当 `docx-manipulation` skill 不可用或 python-docx 无法提取时降级为视觉识图。处理原则与 §D（图片配置清单解析）一致：逐页截图 → LLM 识图 → 忠实搬运为 markdown 表格。

---

## D. 图片配置清单解析（截图 / 拍照 / PDF 截图等）

当用户提供图片形式的配置清单（Excel 截图、Word 截图、聊天截图、手写拍照、PDF 页面截图等），由 LLM 调用方用自身视觉能力直接处理，**与脚本解析完全对称**：忠实搬运图片中的表格内容到 markdown，不做任何语义改写、不强加 schema、不脑补字段。

### 处理原则（搬运工原则）

1. **图里有什么列就是什么列**，列名原样照抄
   - "地区" 不要改成 "地域"
   - "实例" 不要改成 "产品/规格"
   - "month" 不要翻译成 "月"
2. **图里有几行就是几行**，单元格原样转录
   - 含 `-`、`未填写`、`待定`、`/` 等用户自己写的占位符也要照抄
   - **合并单元格必须按视觉边界展开到每一个数据行**（关键！）：
     - 如果你看到 Excel 里某列第 2-5 行被合并显示成一格写着"Object Storage"，输出 markdown 时**必须**把"Object Storage"分别写到第 2、3、4、5 行的对应列里
     - 如果你看到第 6-10 行该列**视觉上是空的**（没有被合并、没有写字），输出 markdown 时**必须**保留为空 —— **不要**把上一组的值"延续"过来
     - 判断依据：**合并区域的视觉边界（边框线 / 单元格背景 / 视觉分组）**，不是"上一行有什么我就抄什么"
     - 反例：图中 A 列第 2-5 行合并写"Object Storage"，第 6-10 行虽然 A 列空白但属于另一个独立组（可能是 TDSQL/PostgreSQL 等多个产品共享的留空），**绝对不要**把"Object Storage"延续到第 6 行及以后
   - 标题行跨多列的合并按相同原则处理（每列都填该跨列值）
3. **不脑补字段**：图里没有的列**绝对不要**替用户补全
   - 缺"计费模式"列？不要自己加一列填"包年包月"——让服务端智能体自己追问
   - 缺"地域"列？同上
   - ⚠️ 哪怕用户在"产品/规格"列写了"中国香港"、"新加坡一区"这种带地理位置的字眼，**也不要把它推断成 region code（如 `ap-hongkong` / `ap-singapore`）补到地域列**——这是服务端的解析职责，客户端越界=出错风险
4. **保留表外文字**：如果图片中有表格之外的关键信息（标题、备注、脚注、口头说明），用 markdown 引用块贴在表格前后，给服务端完整上下文
5. **不做单位/格式归一化**：用户写"2C4G"就是"2C4G"，不要改成"2核4GB"；用户写"12个月"就是"12个月"，不要改成"12"

### 编排流程

1. **识别**：LLM 直接读图，转成 markdown 表格（一字不动地搬运）
2. **校对识别准确性**（**强制环节**）：把识别结果展示给用户，请用户**核对识别得对不对**——是否有看错的字、漏掉的行、串列的内容
   > ⚠️ 这一步**只校对"我识别得对不对"**，不校对"内容对不对、维度齐不齐"。后者是服务端智能体的职责（它会追问、会兜底、会归一化），客户端不替它做决策。
3. **发送**：用户确认识别无误后，把 markdown 表格作为 `source_table.md` 保存到 run-dir。后续追问/确认/查价/归一化全部由服务端智能体主导，客户端**只透传**。

---

## E. 所有输入形式的对称关系与下游契约

### 输入形式对照

| 输入 | 适配方式 | 适配层智能含量 | 中间产物 |
|------|---------|--------------|---------|
| `.xlsx` / `.xls` 等 | `xlsx-manipulation` skill（openpyxl）或 `parse_excel.py` | 0%（纯字符串搬运） | markdown 表格 |
| `.pdf` | `pdf-extraction` skill（pdfplumber）或 LLM 视觉识图 | 仅"看懂字"，不做语义判断 | markdown 表格 |
| `.docx` / `.doc` | `docx-manipulation` skill（python-docx）或 LLM 视觉识图 | 仅"看懂字"，不做语义判断 | markdown 表格 |
| 图片 | LLM 视觉直接识图 | 仅"看懂图里写的字"，不做语义判断 | markdown 表格 |
| 文本 | 用户自己整理 / 直接粘贴 | 0% | markdown 表格 |

### tasks_proposal.json 的构造（不变的下游契约）

无论 markdown 表格来自哪种输入，最终都通过同一个脚本切片：

```bash
python3 "$SKILL_BASE_DIR/scripts/build_proposal.py" \
  --source-table "$RUN_DIR/source_table.md" \
  --output       "$RUN_DIR/tasks_proposal.json"
```

**这一步是纯机械动作，不需要 LLM 介入**。脚本：
- 直接读 markdown 文件**字节流**（避免任何 shell 中转的转义风险）
- 复用 `split_tasks.parse_source_table` 函数解析表格结构
- 按行 fan-out：N 行数据 → N 个 task，每个 message 是 (表头, 分隔, 数据行) 三行的精确拼接
- 输出后由 `split_tasks.py` 字符级校验把关

> **关于合并单元格**：`build_proposal.py` 不做任何"前向填充"——这一职责必须在 markdown 生成阶段（解析层 or LLM 视觉识图层）完成。
> - **Excel 路径**：`parse_excel.py` 的 `_expand_merged_cells` 基于 openpyxl 的 `ws.merged_cells.ranges` 真实合并区域填值，**只在合并组内填**，不会跨组。
> - **LLM 视觉路径（图片 / PDF 视觉降级 / DOCX 视觉降级）**：必须在视觉识别时按视觉合并边界把值复制到每一行，**不要留空让下游脑补**（详见 §D 处理原则第 2 条）。
> - **自由文本路径**：用户已经手工写完整时，每行就是完整的；如果用户用了"同上"等口语合并，需要在转 markdown 时按用户指示展开。
>
> ⚠️ 为什么 `build_proposal.py` 不做：到了 markdown 阶段，"合并组边界"信息已丢失，无法区分"用户故意留空"和"合并的延续行"。盲目前向填充会跨越合并组边界，把上一组的值错误地填到下一组（图中真实案例：Object Storage 组结束后，下面 TDSQL/PostgreSQL 组的 Service 列**故意留空**，不应被填成 "Object Storage"）。

### 为什么不让 LLM 手写

历史教训（来自 `2026-06-16` 实战 run 的 issue 2/3/4）：

1. 手抄字面 `\n`（反斜杠+n）→ Python/JSON 字面量解释规则会把它吞成真换行
2. 全角标点 `（）`、`，` 在多层 shell（`echo` / heredoc / `cat <<EOF`）中转时编码漂移
3. 空单元格、含 `-` 占位符、含 emoji 的单元格手抄都易错
4. 表格越长（>10 行），错误概率越高
5. 手抄翻车后 LLM 反复迭代临时脚本（曾观测到三版才通过校验）

`build_proposal.py` 把这些风险一次性消除——直接字节流读取，零字符串字面量参与。
