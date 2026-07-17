# AuthorFilter Skill — 安装与使用指南

## 这是什么

AuthorFilter 是一个 WorkBuddy (CodeBuddy) 技能，用于**批量标注顶会论文（CVPR/ICCV/NeurIPS 等）的作者身份和机构信息**。

它能自动：
- 逐篇搜索 arxiv 确认每篇论文的作者机构
- 判断论文是"全学生"、"工业界"还是"无华人"
- 在 Excel 中填写论文方向(J列)、身份(K列)、组织(L列)
- 对企业作者在 F 列加粗标记

---

## 前置要求

1. **WorkBuddy 桌面端**（macOS / Windows）— 最新版本
2. **Excel 文件**：包含论文列表，至少有 Title(E列) 和 Authors(F列)
3. 确保 WorkBuddy 处于 **Craft 模式**（可执行文件操作）

---

## 安装方法（3步）

### 方法一：直接复制文件夹（推荐）

1. 将本压缩包中的 `authorfilter` 文件夹整个复制到你电脑上的：
   ```
   ~/.workbuddy/skills/authorfilter/
   ```
   
   具体路径：
   - **macOS**: `/Users/你的用户名/.workbuddy/skills/authorfilter/`
   - **Windows**: `C:\Users\你的用户名\.workbuddy\skills\authorfilter\`

2. 确认文件结构如下：
   ```
   ~/.workbuddy/skills/
   └── authorfilter/
       └── SKILL.md
   ```

3. **重启 WorkBuddy**（或开一个新对话），skill 即自动生效。

### 方法二：在 WorkBuddy 中直接安装

1. 打开 WorkBuddy
2. 把 `SKILL.md` 文件拖入对话窗口
3. 说：「帮我把这个安装为 skill，放到 ~/.workbuddy/skills/authorfilter/SKILL.md」
4. AI 会自动帮你创建文件

---

## 使用方法

### 基本使用

1. 将 Excel 文件拖入 WorkBuddy 对话（或说出文件路径）
2. 输入以下任一触发词：
   - `论文标注`
   - `作者标注`
   - `CVPR标注`
   - `继续标注`
   - `跑下一批`
   - `全部跑完`

3. AI 会自动：
   - 检测 Excel 结构和当前进度
   - 汇报总数/已标注/待处理
   - 开始逐篇处理

### 运行模式

| 指令 | 行为 |
|------|------|
| 默认（直接触发） | 每批处理30篇，完成后等你说"继续" |
| "全部跑完" | 连续跑多批不停顿，每50篇自动存档 |
| "继续标注" | 从上次断点继续 |

### 示例对话

```
你：[拖入 cvpr2026.xlsx] 论文标注
AI：检测到 Excel，共 300 行，E列=Title，F列=Authors。
    已标注: 0 篇，待处理: 299 篇。
    开始第1批（Row 2-31）...

你：继续
AI：开始第2批（Row 32-61）...

你：全部跑完
AI：连续处理剩余论文，每50篇自动存档...
```

---

## Excel 文件格式要求

| 列 | 内容 | 说明 |
|----|------|------|
| E | Title | 论文标题（必须有） |
| F | Authors | 作者列表（必须有） |
| G-I | Oral/Award/Highlight | 不动 |
| J | 论文方向 | AI 自动填写 |
| K | 身份 | AI 自动填写：全学生/工业界/无华人/存疑 |
| L | 组织 | AI 自动填写（仅工业界） |

**注意**：第1行必须是表头，数据从第2行开始。

---

## K列标注规则

| 情况 | 标注 |
|------|------|
| 作者中无华人 | 无华人 |
| 有华人，全在学校/研究所 | 全学生 |
| 有华人，有企业参与（哪怕只有1家） | 工业界 |
| 搜不到论文 / 无法判断 | 存疑 |

**重要**：上海AI Lab、A*STAR 等非高校研究机构 → 按**工业界**处理。

---

## 使用注意事项

### 必须遵守

1. **每篇有华人的论文都会搜索 arxiv 并打开 HTML 确认 affiliation** — 这是硬性要求
2. **L列（组织）只能从论文首页原文抄** — 不能从记忆/人物库推断
3. **不同公司严格区分** — 阿里≠蚂蚁，华为≠地平线，字节≠快手
4. **产学研合作论文**中企业作者可能只有1-2个混在中间，必须逐一确认

### 常见问题

**Q: 跑到一半上下文满了怎么办？**
A: AI 会主动停下并告知进度。开新对话说"继续标注"，拖入同一个 Excel 即可从断点继续。

**Q: 标注出错了怎么复核？**
A: 说"复核全学生"或"复核工业界"，AI 会重新验证已标注的论文。

**Q: Excel 列结构和上面不一样怎么办？**
A: AI 会自动检测表头。只要有 Title 和 Authors 列就能工作。

**Q: 速度太慢？**
A: 每篇搜索+验证是必要的（保证准确率）。约 1-2 分钟/篇。30篇一批约 30-60 分钟。

---

## 技术细节（给想了解原理的人）

- AI 使用 `openpyxl` 库读写 Excel（支持富文本/加粗）
- 搜索用 WebSearch（搜 arxiv）
- 机构确认用 WebFetch（读 arxiv HTML 页面提取 affiliation）
- 企业作者加粗用 `CellRichText` + `InlineFont(b=True)`
- 每批处理完自动 `wb.save()` 存档，不会丢失进度

---

## 文件清单

```
authorfilter-skill-package/
├── SKILL.md          ← 核心技能文件（放到 ~/.workbuddy/skills/authorfilter/）
└── README.md         ← 本说明文档（给人看的）
```

---

## 版本信息

- **版本**: 2026-05-18
- **适用会议**: CVPR / ICCV / NeurIPS / ICML 等 AI 顶会
- **维护者**: Ori (混元多模态 HR)
