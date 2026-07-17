---
name: authorfilter
description: >
  顶会论文作者标注任务。对 Excel 中的论文逐篇搜索 arxiv、查看首页机构标注，
  填写方向(J)、身份(K)、组织(L)列，并对企业作者加粗（含正式员工和 intern）。
  每批30篇，逐篇搜索确认，不跳过不猜测。
  触发词：论文标注、作者标注、CVPR标注、authorfilter、全部跑完、继续标注、跑下一批。
agent_created: true
---

## iWiki 公共知识库规则

本模块涉及的归档、查重、读取、更新一律遵循 `references/iwiki-storage-protocol.md`：按 `getCurrentUser` 获取 `{user_key}`，只处理 `用户-{user_key}` 目录树下的页面；其他用户页面只读参考，不得更新。Mapping 结束后必须拆解实体并分别写入 `01-公司组织库`、`02-候选人档案`、`03-项目经历库`、必要时 `04-面评归档`、以及 `05-Mapping报告`；不得只生成报告页。

# AuthorFilter — 顶会论文作者标注

## 运行模式

- **默认模式**：每批 30 篇，逐篇搜索确认，跑完存档，等用户说"继续"
- 用户说 **"全部跑完"**：连续跑多批不停顿，但每批仍逐篇搜索，每50篇自动存档
- 上下文快满时主动停下并告知进度，用户开新对话说"继续标注"即可续跑

**绝对不能做的事**：
- 不搜索就标注（编造J列方向）
- 猜测K列身份（没确认就标全学生/工业界）
- 跳过任何论文不处理
- **从人物库/记忆推断L列公司名（必须从论文首页原文抄）**
- **把不同公司混为一谈（阿里≠蚂蚁，华为≠地平线，字节≠快手）**
- **有华人却不打开 arxiv 就判定"全学生"（有华人→必须搜索+WebFetch 确认每个作者的 affiliation）**

---

## 使用前配置（自动检测）

用户只需将 Excel 文件拖入对话或说出文件名，AI 自动完成：

1. **读取文件路径**
2. **检测表头** — 找到 Title 和 Authors 所在列
3. **检测进度** — 扫描 J 列，找到第一个空行作为断点
4. **汇报后开始** — 告诉用户总数/已标注/待处理，然后开始

---

## 执行流程（逐篇搜索）

```
对每篇论文：
1. 看作者名字判断华人
   ├─ 无华人（全西方/韩/日名） → K="无华人" → 从标题写J方向 → 下一篇（不需搜索）
   └─ 有华人 → 继续

2. WebSearch 搜论文标题 + arxiv
   ├─ 搜不到 → 标题红色 + J="论文未公布" + K="存疑" → 下一篇
   └─ 搜到 → 继续

3. WebFetch arxiv HTML 查机构（⚠️ 硬性要求，不可跳过）
   ├─ **必须提取每个作者的具体 affiliation**（不是只看"有没有企业"）
   ├─ WebFetch prompt: "List ALL authors with their EXACT numbered affiliation. Format: Author Name → ¹Institution"
   ├─ **L列只能从这一步的结果中抄**，不能从记忆/人物库/搜索摘要推断
   ├─ ⚠️ 不允许仅凭搜索摘要中"某大学"字样就判定全学生——必须打开 HTML 看完整 affiliation 列表
   ├─ 全大学/研究所 → K="全学生" → 写J方向 → 下一篇
   └─ 有公司参与 → K="工业界" + L=**论文原文公司名**（含部门/实验室）
       ├─ 企业作者 → F列全部加粗
       └─ 写J方向 → 下一篇
```

**L列来源唯一性原则**：L列的值只能来自步骤3 WebFetch 提取的论文首页 affiliation 原文。任何其他来源（人物库、搜索结果摘要、记忆）都不能作为 L 列的依据。

**注意**：只有"无华人"可以不搜索直接标注。有华人的论文必须搜索确认机构。

---

## ⚠️ 常见漏判模式（从190篇复核中总结）

以下3种情况最容易被错标为"全学生"，执行时必须警惕：

### 模式A：大学主导 + 企业少数参与（7/9 错标属于此类）
- 特征：第一作者/通讯作者在大学，企业只贡献1-2个作者，混在中间不显眼
- 实例：
  - ConsisVLA-4D：哈工大深圳主导，ZTE 只出了 Junwen Tong 1人（排第4）
  - SparseWorld-TC：同济大学主导，理想汽车出了6人但第一作者是同济的
  - Stabilizing Streaming Video Geometry：港大博士生主导，滴滴的 Shaoshuai Shi 排第7
  - ACoT-VLA：北航主导，智元机器人出了 Maoqing Yao 和 Guanghui Ren
  - MixFlow Training：复旦主导，百度的 Jingdong Wang 排末位
- **防范**：必须 WebFetch HTML 逐一看每个 affiliation，不能只看第一作者的学校就判定全学生

### 模式B：机构名看起来像学校/研究所（实为企业性质）
- 实例：
  - 上海AI Lab (Shanghai AI Laboratory) — 按工业界处理
  - 智元机器人 AGIBOT — 是企业
  - Wherobots — 是 startup 公司
- **防范**：对不认识的机构名，查清楚再标

### 模式C：纯企业团队但作者全是华人学术风格姓名
- 实例：
  - Scaling Zero-Shot Reference-to-Video：17个作者 15 个来自 Meta AI，但姓名全是 Zhou/Liu/Qiu/Ren 等
  - VisionDirector：HKUST+CUHK 的学生+华为研究员合作
- **防范**：有华人就必须搜索确认，不能凭"看起来像学术团队"就跳过

---

## 断点续跑机制

每批跑完自动 `wb.save()` 存档。检测进度逻辑：

```python
START_ROW = 2
for row in range(2, ws.max_row + 1):
    if not ws.cell(row=row, column=10).value:
        START_ROW = row
        break
```

---

## ❌ 已废弃：企业人物库

废弃原因：
1. 同名人太多，匹配容易张冠李戴
2. 人会换工作，库里信息过时直接导致标错（如 Naiyan Wang 曾在图森，图森已倒闭，人已去小米）
3. 人物库的存在鼓励"认人推断公司"而非"读论文抄公司"，违背本 skill 核心原则

**唯一正确做法**：打开论文首页，读 affiliation 原文，抄。论文里没写公司的就标"存疑"。绝不猜。

---

## Excel 结构

| 列 | 内容 | 说明 |
|----|------|------|
| E | Title | 不改（搜不到时字体改红色） |
| F | Authors | 企业作者名字加粗（CellRichText） |
| G-I | Oral/Award/Highlight | **不填** |
| J | 论文方向 | 一句话中文概括（必须基于实际论文内容） |
| K | 身份 | 四选一：全学生 / 工业界 / 无华人 / 存疑 |
| L | 组织 | 仅工业界填，写公司+部门 |

---

## L列命名规则

**铁律：论文首页怎么标就怎么写，不推断不合并**

⚠️ **易混淆公司必须严格区分**：
- `阿里巴巴` ≠ `蚂蚁集团`（Ant Group 已独立，论文标 Ant Group 就写蚂蚁集团）
- `字节跳动` ≠ `TikTok`（看论文原文）
- `上海AI Lab` ≠ `小米AI Lab` ≠ `腾讯AI Lab`（看清全称：Shanghai AI Laboratory / Xiaomi AI Lab / Tencent AI Lab）
- `华为` ≠ `地平线`（Horizon Robotics 是独立公司）
- `阿里巴巴` vs `阿里巴巴 淘天集团` vs `阿里巴巴 达摩院`（论文写啥就标啥）

⚠️ **高频混淆场景（从实际标注错误中总结）**：

| 混淆类型 | 具体案例 | 区分方法 |
|---------|---------|---------|
| 都有"AI Lab" | 上海AI Lab / 小米AI Lab / 腾讯AI Lab / 华为 | 看英文全称区分 |
| 历史上是一家 | 阿里巴巴 / 蚂蚁集团 / 达摩院 | Ant Group已独立；达摩院仍属阿里 |
| 都做自动驾驶 | 华为 / 地平线 / 小米汽车 / 百度Apollo | 完全不同的公司，看论文原文 |
| 都是"国家队" | 上海AI Lab / 北京智源BAAI / 鹏城实验室 | 三家完全独立 |
| 看到某个人名就推断公司 | Bo Zheng→以为字节(实为阿里) | 禁止从人名推断，以论文为准 |
| 腾讯内部子品牌 | 优图/ARC Lab/AI Lab/Hunyuan/WeChat | 都是腾讯但L列要写具体部门 |
| 都做短视频 | 快手 / 字节(抖音) | 竞对公司，看论文标注 |
| 作者跳槽 | 曾在华为发论文，现在在上海AI Lab | 以当前论文标注为准 |
| 商汤体系 | 商汤/SenseNova(日日新)/联合实验室 | 都标"商汤"，看具体部门 |
| 百度体系 | 百度/百度研究院/Apollo/文心 | 都标"百度"，加部门名 |

常见写法参考：
- `Meta Reality Labs` / `Meta FAIR`
- `Google DeepMind` / `Google Research`
- `NVIDIA Research`
- `Adobe Research`
- `微软 MSRA`
- `字节跳动 Seed` / `字节跳动 Research`
- `腾讯 WeChat Vision` / `腾讯 ARC Lab` / `腾讯 优图实验室` / `腾讯 AI Lab` / `腾讯 Hunyuan`
- `商汤 SenseTime`
- `快手 Kuaishou Technology`
- `上海AI Lab`（Shanghai AI Laboratory）
- `蚂蚁集团`（Ant Group）
- `Apple`
- `百度` / `百度 Baidu Inc.`
- `京东 JD.COM` / `京东 AI Research`
- `地平线 Horizon Robotics`
- `小米 Xiaomi Research` / `小米 EV`

---

## K列判断逻辑

| 情况 | 标注 |
|------|------|
| 无华人（不管是否工业界） | 无华人 |
| 有华人，全在学校 | 全学生 |
| 有华人，有企业参与（哪怕只有一家） | 工业界 |
| 搜不到论文 / 无法判断 | 存疑 |

- 有企业参与即标工业界，不管通讯作者是谁
- 上海AI Lab、A*STAR 等 → 按工业界处理

---

## 华人判断

看姓氏。常见非华人东亚姓：
- 韩国：Kim, Lee, Park, Choi, Jung, Cho, Yoo, Jeong, Kang, Shin, Moon, Jang, Kwon, Seo, Yun, Hwang
- 日本：Tanaka, Suzuki, Sato, Yamamoto, Ito, Nakamura, Kobayashi, Umetani

---

## F列加粗规则

- **所有企业所属作者**全部加粗（正式员工 + intern）
- 使用 `CellRichText` + `TextBlock(InlineFont(b=True), name)` 实现
- 已经是 CellRichText 的跳过不重复处理

---

## 技术实现

```python
import openpyxl
from openpyxl.styles import Font
from openpyxl.cell.rich_text import CellRichText, TextBlock
from openpyxl.cell.text import InlineFont

wb = openpyxl.load_workbook(EXCEL_PATH, rich_text=True)
ws = wb.active

bold_ifont = InlineFont(b=True)
normal_ifont = InlineFont()

def bold_company_authors(ws, row, company_authors):
    cell = ws.cell(row=row, column=6)
    f_val = cell.value
    if isinstance(f_val, CellRichText):
        return
    original = str(f_val) if f_val else ''
    if not original:
        return
    found = []
    for name in company_authors:
        idx = original.find(name)
        if idx != -1:
            found.append((idx, name))
    if not found:
        return
    found.sort(key=lambda x: x[0])
    parts = []
    cur = 0
    for idx, name in found:
        if idx > cur:
            parts.append(TextBlock(normal_ifont, original[cur:idx]))
        parts.append(TextBlock(bold_ifont, name))
        cur = idx + len(name)
    if cur < len(original):
        parts.append(TextBlock(normal_ifont, original[cur:]))
    if parts:
        cell.value = CellRichText(parts)

def annotate(row, j, k, l=None, bold_authors=None):
    ws.cell(row=row, column=10).value = j
    ws.cell(row=row, column=11).value = k
    if l:
        ws.cell(row=row, column=12).value = l
    if bold_authors:
        bold_company_authors(ws, row, bold_authors)

wb.save(EXCEL_PATH)
```

---

## 搜索效率优化

1. **无华人直接跳过不搜**（唯一允许不搜索的情况）
2. 有华人的必须搜 arxiv 确认机构
3. 用 arxiv HTML 版（`/html/`）直接提取机构
4. WebFetch prompt："List ALL authors and their EXACT numbered affiliation (¹²³). Format: Author Name → ¹Institution Name"
5. **论文里作者没标公司的情况**：有些作者论文里只写了大学没写公司（哪怕实际在公司工作），这种情况只能按论文原文标，不猜
6. **不确定就标"存疑"**：无法从论文首页确认的信息，一律标存疑，由人工复核

---

## 搜不到论文处理

1. E列标题字体改红色：`Font(color="FF0000")`
2. J = "论文未公布"
3. K = "存疑"

---

## 🔗 Stage X: 入库到 Mapping 知识库（Full Mapping Skill 体系整合）

> **本 Skill 已加入 Full Mapping Skill 体系**，与 `org-knowledge-base` + `linkedin-deep-miner` + `hkex-prospectus-miner` + `sec-filing-miner` + `deal-news-miner` + `artstation-talent-finder` 共享同一知识库。
> Excel 标注完成后，可执行 Stage X 把企业作者沉淀到 `{workspace}/iWiki 用户目录/01-公司组织库/` 下的对应公司 JSON，并生成 HTML 组织图。

### X.1 触发条件

完成主流程（Excel J/K/L 列填好 + F 列加粗）后，**用户主动**执行 Stage X，触发短语：
- "入库到 mapping"
- "沉淀到知识库"
- "生成组织图"
- "authorfilter to mapping"

### X.2 数据契约

详见 `references/output-contract-mapping.md`。核心规则：

| 规则 | 说明 |
|------|------|
| **公司维度** | 按公司主体（阿里 / 蚂蚁 / 字节 / 腾讯 / 华为 / Meta / Google ...）拆 JSON |
| **AI Lab 是部门** | 腾讯 ARC Lab / Meta FAIR / 微软 MSRA 等映射到该公司下的 `team_id` |
| **入库范围** | 仅 `K=工业界` 且 `F 列有加粗作者` 的论文 |
| **置信度** | very_high（论文首页 affiliation 是法定可引用来源） |
| **去重** | 相同 `name` + 相同公司 → 合并 `paper_history` |
| **跨公司合作论文** | 一篇论文若有多家企业作者，每家公司 JSON 都独立加该作者记录 |

### X.3 执行命令

```bash
python3 {SKILL_BASE_DIR}/scripts/to_mapping_kb.py \
    --excel /path/to/cvpr2026.xlsx \
    --workspace {WORKSPACE} \
    --venue "CVPR 2026" \
    --source-note "标注于 2026-06-10"
```

### X.4 输出

```
{workspace}/iWiki 用户目录/01-公司组织库/
├── tencent.json                ← 腾讯（AI Lab / ARC Lab / Hunyuan 等部门）
├── alibaba.json                ← 阿里（达摩院 / 通义 等）
├── bytedance.json              ← 字节（Seed / Research）
├── meta.json                   ← Meta（FAIR / Reality Labs / Meta AI）
├── google.json                 ← Google（DeepMind / Research）
├── shanghai-ai-lab.json        ← 上海AI Lab（独立 JSON）
└── charts/
    ├── tencent.html            ← 各公司组织图（按部门聚合）
    └── ...
```

### X.5 与其他 Mapping Skill 联动

```
authorfilter（学术研究员）
        ↓ 入库到 tencent.json
        ↓
        ↓ 触发联动验证
        ↓
linkedin-deep-miner（验证当前是否还在腾讯）
github-miner（验证开源代码贡献）
deal-news-miner（验证人事变动事件）
        ↓
        ↓ 多源交叉确认
        ↓
org-knowledge-base（沉淀完整画像）
```

**联动指令示例**：
> "对 tencent.json 中论文数 ≥ 3 的人，跑 linkedin 验证当前职位"

### X.6 报告生成

执行 Stage X 后，输出格式：

```markdown
## AuthorFilter 入库报告

**Excel**: cvpr2026.xlsx
**会议**: CVPR 2026
**扫描行数**: 300 | 工业界论文: 89 | 跳过(L列空): 0

**已入库公司**:
- 腾讯 (tencent): 18 人 / 12 篇 → [架构图](file:///workspace/iWiki 用户目录/01-公司组织库/tencent.html)
- 阿里巴巴 (alibaba): 12 人 / 8 篇 → [架构图](...)
- Meta (meta): 9 人 / 5 篇 → [架构图](...)
- ...
```

### X.7 注意事项

- **F 列加粗是必须的**：转换器只识别 RichText 中的 bold 作者作为企业作者；如果某行 K=工业界 但 F 列没加粗，会跳过并 WARN
- **L 列多公司用 `/` 或 `+` 分隔**：如 "腾讯 ARC Lab / 上海AI Lab" 会拆成两个公司分别入库
- **首次入库某公司**：自动创建新 JSON 文件
- **重复入库**：自动按 `paper_id`（venue + title slug）去重，不会重复插入论文
- **HTML 风格**：与 org-knowledge-base 保持一致（蓝色主色 + 部门分组卡片）

### X.8 不入库的边界场景

| 情况 | 原因 |
|------|------|
| K = 全学生 | 无企业归属 |
| K = 无华人 | 当前 Mapping 体系聚焦中国/华人市场 |
| K = 存疑 | 数据不可靠 |
| L 列为空 | 无法定位公司主体 |
| F 列无加粗作者 | 无法识别哪些是企业作者 → WARN 提示用户回去补加粗 |
