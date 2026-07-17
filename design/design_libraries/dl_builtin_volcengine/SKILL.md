---
name: "yuanli-page-generator-v2"
description: "当用户要求生成页面、创建新页面、还原设计稿页面、搭建管理后台页面时触发本 skill"
---

## 基础规则

- **定位**：页面规范映射引擎。
- **作用**：基于用户的业务需求（哪怕是极其模糊的描述），通过推演匹配出最佳的 `ve-o` 页面范式，补齐所需的缺省模块，并生成一份标准化的**页面UI和交互实现规范**
- **组件**：所有组件应尽可能复用 `preview/` 里的组件，避免重复实现基础 UI 与交互
- **规范**："设计规范与组件规范落位"优先级高于"视觉还原"

## 生成规则

### 1. 页面骨架

生成任何页面时，必须使用页面骨架（TopNav 48px + Sidebar 200px + Content flex:1）。

### 2. 组件使用

生成页面时，**必须**参考 `preview/ui-xxx.html` 对应组件的样式实现，提取精确的：
- HTML 结构
- CSS 类名
- 设计 Token（颜色、尺寸、间距、阴影、圆角）
- 交互状态样式

### 3. 可用组件清单

| 组件 | 文件 | 用途 |
|------|------|------|
| Alert | `preview/ui-alert.html` | 警告提示（Info/Error/Success/Warning） |
| Anchor | `preview/ui-anchor.html` | 锚点导航 |
| Avatar | `preview/ui-avatar.html` | 头像 |
| Badge | `preview/ui-badge.html` | 徽标数 |
| Breadcrumb | `preview/ui-breadcrumb.html` | 面包屑 |
| Button | `preview/ui-button.html` | 按钮 |
| Cascader | `preview/ui-cascader.html` | 级联选择 |
| Checkbox | `preview/ui-checkbox.html` | 多选框 |
| Descriptions | `preview/ui-descriptions.html` | 描述列表 |
| Drawer | `preview/ui-drawer.html` | 抽屉 |
| Dropdown | `preview/ui-dropdown.html` | 下拉菜单 |
| Form | `preview/ui-form.html` | 表单 |
| Icon | `preview/ui-icon.html` | 图标 |
| Input | `preview/ui-input.html` | 输入框 |
| Message | `preview/ui-message.html` | 全局提示 |
| Modal | `preview/ui-modal.html` | 对话框 |
| PageHeader | `preview/ui-page-header.html` | 页面标题（复合：面包屑+标题+Tag+按钮+Tab） |
| Pagination | `preview/ui-pagination.html` | 分页 |
| Popconfirm | `preview/ui-popconfirm.html` | 气泡确认框 |
| Progress | `preview/ui-progress.html` | 进度条 |
| SegmentedPicker | `preview/ui-segmented-picker.html` | 分段选择器 |
| Select | `preview/ui-select.html` | 选择器 |
| Sidebar | `preview/ui-sidebar.html` | 侧边导航 |
| Slider | `preview/ui-slider.html` | 滑动输入条 |
| StatusTag | `preview/ui-status-tag.html` | 状态标签 |
| Steps | `preview/ui-steps.html` | 步骤条 |
| Switch | `preview/ui-switch.html` | 开关 |
| Table | `preview/ui-table.html` | 表格 |
| Tabs | `preview/ui-tabs.html` | 标签页 |
| Tag | `preview/ui-tag.html` | 标签 |
| TimePicker | `preview/ui-timepicker.html` | 时间选择器 |
| Tooltip | `preview/ui-tooltip.html` | 文字气泡 |
| TopNav | `preview/ui-topnav.html` | 顶部导航 |

### 4. 页面类型规范

根据页面类型参考本文档对应章节：
- 列表页 → "列表页设计规范" 章节
- 详情页 → "详情页设计规范" 章节
- 图表页 → "图表页设计规范" 章节

### 5. 图标

统一使用 `iconfont/` 目录下的图标。在纯 HTML 中以内联 SVG 方式引用。

### 6. 还原校验

生成页面后，按照"通用还原校验清单"和对应页面类型的专项校验清单进行自检。

---

# 基础设计规范（Design Tokens）

## 1. 字体

| Token | 值 |
| --- | --- |
| 字体族 | `"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", SimHei, Arial, Helvetica, sans-serif` |
| 字号 - 页面标题 (h1/PageTitle) | `18px / 26px / 500` |
| 字号 - 模块标题 (h2/Section) | `16px / 22px / 500` |
| 字号 - 正文/Tab/操作 | `14px / 22px / 400 ~ 500` |
| 字号 - 表单/列表项 | `13px / 22px / 400`，`letter-spacing: 0.04px` |
| 字号 - 辅助/Placeholder/坐标 | `12px / 18~20px / 400` |

---

## 2. 颜色（语义 Token）

| Token | 值 | 用途 |
| --- | --- | --- |
| `--Text-color-text-1` / `--Text-1` | `#0C0D0E` / `#020814` | 一级正文/标题 |
| `--Text-color-text-2` | `#42464E` | 二级正文/坐标轴 |
| `--Text-color-text-3` | `#737A87` / `#80838A` | 占位符、辅助说明 |
| `--Gray-1` | `#333333` | 顶部导航文字 |
| `--Primary-Color-primary-6` / `--Blue-link-6` | `#1664FF` | 主色：选中 Tab、链接、主按钮 |
| `--Primary-active` | `#006EFF` | 选中态高亮线（Tab 顶部 2px） |
| `--Primary-bg-light` | `#A2C1FF33` (rgba) | 选中按钮浅蓝底 |
| `--Primary-border-light` | `#A2C1FF` | 选中按钮描边 |
| `--Green-success-6` | `#2A814B` | 成功状态文字（"正常运行"） |
| `--Green-Tag-success-2` | `#E1F6E6` | 成功状态背景 |
| `--Red-error` | `#E63F3F` | 通知红点、"创建失败" |
| `--Background-color-bg-white` | `#FFFFFF` | 顶部导航、内容卡片背景 |
| `--Background-color-bg-4` | `#F6F8FA` | 左侧侧边栏背景、灰色 Tab 背景 |
| `--Background-page` | `#F2F6FA` | 整页外层背景（列表页） |
| `--Border-1` | `#EAEDF1` | 表格行/Tab 分隔线 |
| `--Border-2` | `#DDE2E9` | 输入框 1px shadow border |
| `--Border-3` | `#D5DBE3` / `#E1E4E8` | 分隔线、网格线 |
| `--Chart-line-1` | `#2E62F1` | 折线主色 |

### 状态色速查

```css
/* 主色 */
--primary: #1664FF;
--primary-hover: rgba(22, 100, 255, 0.8);
--primary-active: #006EFF;

/* 文字 */
--text-1: #0C0D0E;
--text-2: #42464E;
--text-3: #737A87;
--text-disabled: #C7CCD6;

/* 背景 */
--bg-white: #FFFFFF;
--bg-page: #F2F6FA;
--bg-sidebar: #F6F8FA;
--bg-hover: #F6F8FA;

/* 边框 */
--border-1: #EAEDF1;
--border-2: #DDE2E9;

/* 状态色 */
--success-text: #00B365;
--success-bg: #E8FFEA;
--error-text: #F53F3F;
--error-bg: #FDE2E2;
--warning-text: #FF7D00;
--warning-bg: #FFF3E5;
```

---

## 3. 阴影 / 圆角 / 间距

| Token | 值 |
| --- | --- |
| `--shadow-Card-1` | `0 2px 6px 0 #0000000D` |
| `--shadow-Assembly-list-bottom` | `0 2px 6px 0 #0000000D`（顶部导航底阴影） |
| `--shadow-Border-all` (输入框) | `inset 0 0 0 1px #EAEDF1` 或 `0 0 0 1px #DDE2E9` |
| `--shadow-Tab-active` | `inset 0 2px 0 0 #006EFF, inset ±1px 0 0 0 #EAEDF1` |
| `--shadow-dropdown` | `0px 15px 35px -2px rgba(0,0,0,0.05), 0px 5px 15px rgba(0,0,0,0.05)` |
| 圆角 - 输入/按钮/Tag | `4px` |
| 圆角 - 头像/小红点 | `50%` / `20px` |
| 间距栅格 | 4 / 8 / 12 / 16 / 20 / 24 / 32 / 48 |

### 尺寸

```css
--height-lg: 36px;
--height-md: 32px;
--height-sm: 28px;
--height-xs: 24px;
--radius: 4px;
```

---

## 4. 页面骨架（必须固化）

整页基础容器：`width: 100%`、`height: 100vh`、`overflow: hidden`，垂直布局：

```
┌──────────────────────────── TopNav (48px) ───────────────────────────┐
│                                                                      │
├─ Sidebar (200px) ─┬─────────── Content (flex:1) ─────────────────────┤
│                   │                                                  │
│                   │                                                  │
└───────────────────┴──────────────────────────────────────────────────┘
```

- TopNav 高度 **48px**，宽度 100%。
- Sidebar 宽度 **200px**，背景 `#F6F8FA`，与内容区无间距（贴合）。
- Content 区域宽度自适应（扣除 Sidebar 后撑满剩余空间），背景默认 `#FFFFFF`。

---

## 5. 顶部导航栏（TopNav）★ 固化

```
高度: 48px
背景: #FFFFFF
底阴影: 0 2px 6px 0 #0000000D
左 padding: 0（汉堡按钮自带 padding）
右 padding: 24px（详情/图表）/ 32px（列表）
布局: flex / space-between / align-items:center
```

### 5.1 左侧（Logo 区）

注意：导航栏 **必须使用火山引擎 Logo**。
| 元素 | 规格 |
| --- | --- |
| 汉堡按钮 | 48×48 容器，padding 17px 16px；2 条 16×2px 横线，`#42464E`，间距 4px |
| Logo（火山引擎） | 高 24px，紧贴汉堡按钮（间距 0）；图片地址：`https://cba92c92a501.aime-app.bytedance.net/a2e02d6a31ce47d5b93b7d378ff82b20.png` |

### 5.2 右侧（功能区）

按从左到右顺序，整体 `column-gap: 16px`：

1. **搜索框** `200~240 × 32px`，圆角 4px，1px border `#DDE2E9`/`#EAEDF1`，背景半透明白 `#FFFFFF85`，左内 padding 12px，placeholder 12px `#737A87`，文字"请输入关键词进行搜索"，前置放大镜 16×16。
2. **链接组** `column-gap: 16px`，文字 13px `#0C0D0E`（详情/图表）或 12px `#333333`（列表），依次：`官网 / 费用 / 工单 / 文档中心`。
3. **图标组** `column-gap: 8px`：
   - 通知铃铛（32×32 圆形容器，padding `5px 1px 8px 8px`），含 6×6 圆形红点 `#E63F3F`。
   - 帮助 ?（32×32 圆形容器，padding 8px，icon 16×16）。
4. **头像** 28×28 圆形 (`border-radius: 50%`)，与图标组间距 16px。

---

## 6. 左侧导航（Sidebar）★ 固化

```
宽度: 200px
高度: 撑满（约 852~872px）
背景: #F6F8FA
内 padding: 左右 12px（菜单项）
底部: 折叠按钮 padding-bottom 12px
```

### 6.1 业务标题区（Sidebar Header）

```
高度: 58px
padding: 17px 0 21px 24px（图标距左 24，距标题 8）
图标: 22~24 × 22~24px（业务图标，如 "云服务器ECS" / "火山数据库"）
标题: 16px / 22px / 500，#0C0D0E
底部 1px 分隔线: #EAEDF1（仅列表页2/详情页 1593 出现）
```

### 6.2 分组标题（Group Label）

```
内容: 如 "常用功能" / "关系型数据库RDS" / "NoSQL数据库" / "数据库工具"
字号: 12px，颜色 #737A87
padding: 3px 12px
margin-top: 8px
```

### 6.3 菜单项（Menu Item）

```
高度: 36px
padding: 7px 12px
min-width: 176px（在 200 宽内的内部宽度）
背景: 默认透明（继承 #F6F8FA）；hover/active 见下
图标: 20~21px，左边
文字: 13px / 22px，#020814，左 icon 间距 12px
右侧: 可选 折叠箭头 16×16（有子菜单时）
```

四种状态：

| 状态 | 背景 | 文字色 | 备注 |
| --- | --- | --- | --- |
| 默认 | `transparent` | `#020814` / `#0C0D0E` | — |
| Hover | `#FFFFFF` 或浅化 4 号灰 | 同上 | — |
| 选中（叶子） | `#FFFFFF`，左 3px 蓝条 `#1664FF`（可选） | `#1664FF` 500 | 列表页 2 中"实例列表"高亮即此态 |
| 禁用 | — | `#A0A8B3` | 鼠标 not-allowed |

### 6.4 子菜单缩进

二级菜单文字 `margin-left: 8~12px`（图标对齐父级文字处），字号 13px。展开时父项右侧箭头旋转 180°。

### 6.5 折叠按钮（Sidebar Collapse）

```
位置: Sidebar 左下
尺寸: 24×24
图标: 双横线收起/箭头
颜色: #42464E
```

---

## 7. 通用组件规范

### 7.1 按钮

| 类型 | 高度 | 背景 | 文字 | 边框 |
| --- | --- | --- | --- | --- |
| Primary | 32 | `#1664FF` | `#FFF` 14/500 | — |
| Default | 32 | `#FFF` | `#0C0D0E` 14 | 1px `#DDE2E9` |
| Text（表格行操作） | — | 透明 | `#1664FF` 13 | — |
| Disabled | 32 | `#F6F8FA` | `#A0A8B3` | 1px `#EAEDF1` |

> 表格行内操作必须使用 `Button type="text"`，不使用 `<a>`。

### 7.2 输入框 / 下拉

- 高度 32px，圆角 4px，padding 5~6px 12px
- 描边采用 inset shadow `0 0 0 1px #DDE2E9`
- placeholder 12px `#737A87`，文字 13px `#000B1A`

### 7.3 Tag

- 高度 24px，圆角 4px，padding 2px 8px，文字 12/20/500
- 状态色对：成功 `#E1F6E6`/`#2A814B`，错误 `#FDE2E2`/`#E63F3F`，进行中 `#E5F1FF`/`#1664FF`，灰 `#F2F3F5`/`#737A87`
- 状态前置 6×6 圆点（列表表格中）

### 7.4 图标

- 通知红点：6×6 `#E63F3F` 圆形
- 业务图标：22~24px
- 页面中的搜索、帮助、返回、刷新、更多、翻页、菜单等通用图标统一使用 `iconfont/` 目录内的 SVG
- 在纯 HTML 中以内联 SVG 方式引用

---

## 8. 通用还原校验清单

- [ ] 页面容器采用 `width:100%` + `height:100vh`，自适应屏幕宽高
- [ ] TopNav 高 48，左 Logo + 汉堡，右搜索 + 链接 + 图标 + 头像，间距 16
- [ ] Sidebar 宽 200，背景 `#F6F8FA`，业务标题高 58，菜单项高 36
- [ ] 主色统一为 `#1664FF`（链接、主按钮、选中文字）
- [ ] 输入框使用 box-shadow 边框（非 border）
- [ ] 下拉面板使用 dropdown 阴影
- [ ] 图标统一 iconfont/ 目录下的图标
- [ ] 状态色对正确（success/error/warning/info）
- [ ] 组件样式从 `preview/ui-xxx.html` 中精确提取，不自行编造
- [ ] 字体族：PingFang SC 优先

---

# 详情页设计规范（Detail Page）

整页背景 `#FFFFFF`，含面包屑 + 主标题 + Tabs + 双栏内容。

---

## 一、页面框架组成

- 详情页由标题区域和内容区域两部分组成。

### 页面标题区域 (PageHeader)

- **位置**：位于页面框架的最顶部
- **组件**：`ui-page-header`
- **作用**：明确告知用户当前页面名称、类型、所处的具体位置等信息，起到 **承上启下** 的作用。
- **构成**：
  - 面包屑（可选）
  - 主标题区（PageHeader 紧凑型）
  - 操作按钮组（可选）如"远程连接 / 刷新 / ..."
  - Tabs（可选）

### 内容区域 (Content Area)

- **位置**：位于页面标题区域下方
- **特征**：它是页面中 **面积最大、信息密度最高** 的矩形区域，承载详情页的主要信息。
- **构成**：
  - DetailsDisplay（基本信息 / 网络信息 / 计费信息）
  - 双栏内容（基本信息 / 网络信息 / 计费信息）
  - 图表（可选）

## 二、通用设计规范

- 页面背景色为 `#FFFFFF`。
- 内容区域除图表之外，其他各个模块之间无卡片式的分割。
- **重点**：每个模块都必须横向撑满内容区整行宽度。
- **模块间距**：各模块之间的间距为 `40px`；详情页第一个模块距离页面 tab 或 页面标题 的 间距为 20px
- **内容区两侧间距**：内容区距离页面两侧 32px

## 三、页面示例模版

### 1. 面包屑

- 字号 13px，颜色 `#737A87`
- 分隔符 `>`
- padding `12px 32px 0`

---

### 2. 主标题区（PageHeader 紧凑型）

```
padding: 20px 32px
高度: 72px
```

- **左侧**：返回箭头 20×20 + 标题 `18px / 26px / 500` + 状态 Tag
  - 状态 Tag：绿底 `#E1F6E6` / 文字 `#2A814B` 500 / 12px / padding 2px 8px / icon 14px / 圆角 4px
- **右侧**：操作按钮组（"远程连接 / 刷新 / ..."），按钮 32px

---

### 3. Tabs

```
高度: 36px
位置: 紧贴 PageHeader 下方，0px 间距
```

| 状态 | 背景 | 文字 | 边框 |
| --- | --- | --- | --- |
| 选中 | 白色 | `#1664FF` 500 14px | 顶部 2px `#006EFF` |
| 未选中 | `#F6F8FA` | `#0C0D0E` 14px | 1px `#EAEDF1` |

- padding `7px 16px`
- 顶部圆角 `4px 4px 0 0`
- PageHeader 与 Tabs **必须 0px 间距**

---

### 4. DetailsDisplay（基本信息 / 网络信息 / 计费信息）

#### 4.1 基本样式

- 区块标题 `16px / 22px / 500`
- 标签-值 **垂直布局**：
  - label: 13px `#737A87`
  - content: 13~14px `#0C0D0E`
- **label-content 间距 8px**
- **行间距 20px**
- 列间距 24px
- **无外框线**（borderless），区块之间留 32px 空白

#### 4.2 响应式列数规则

根据屏幕宽度，信息区每行展示字段数量按断点自适应：

| 屏幕宽度（w） | colNumber 值 |
| --- | --- |
| `xs` | `1` |
| `sm` | `2` |
| `md` | `2` |
| `lg` | `3` |
| `xl` | `4` |
| `xxl` | `4` |
| `xxxl` | `5` |

---

### 5. 右侧信息卡片

适用于云盘/网卡/公网 IP/安全组等附属信息展示：

- 卡片宽 ~360px
- 标题带可折叠 ± 图标
- 内部数据行：`label + tag` 横排
- tag 圆角 4px / 12px / padding 2px 8px

---

### 6. 详情页还原校验清单

- [ ] 列表页、详情页、图表页背景统一为 `#FFFFFF`
- [ ] 详情页 PageHeader 与 Tabs **0px 间距**
- [ ] Tab 选中态：顶部 2px `#006EFF` + 文字 `#1664FF` 500 + 顶部圆角 4px
- [ ] DetailsDisplay 无边框，label-content 8px，行 20px
- [ ] 字段列数按断点响应式变化（xs:1 → xxxl:5）
- [ ] 区块之间留 32px 空白

---

# 列表页设计规范（List Page）

> 整页背景 `#FFFFFF`，内容区域顶部为 PageHeader（无白卡背景），其下为筛选/表格区域。

---

## 1. PageHeader

```
padding: 20px 32px 16px
```

- 标题 `18px / 26px / 500`（如"实例列表"）
- 右侧操作链接 `13px #42464E`（"使用引导 / 帮助文档"）+ icon 14px

---

## 2. 筛选区（FilterBar）

- 一行控件高度 32px，`column-gap: 12px`，可换行
- 输入框/下拉宽度自适应或 200px，圆角 4px，border `#DDE2E9`
- **主操作按钮（"创建实例"）**：
  - 主按钮：`#1664FF` 背景 / `#FFFFFF` 文字 / 32px / 圆角 4px / padding 5px 16px
  - 次按钮：白底 / 1px `#DDE2E9` / `#0C0D0E` 文字

---

## 3. 表格（DataTable）

### 3.1 行与列

- 行高：双行（名称+ID）56px，单行 40px
- 表头背景 `#F6F8FA`，文字 13px `#42464E` 500
- 行分隔线 `inset 0 -1px 0 0 #EAEDF1`
- 外围容器：`1px solid #EAEDF1` 描边，背景白色，**不使用阴影卡片**

### 3.2 状态列

- 状态文字使用语义色（绿/蓝/红/灰）
- 前置 6×6 圆点

### 3.3 行操作

- 使用 `Button type="text"` 蓝色（`#1664FF`）
- 分隔符 `|`
- 省略号触发 `...`

### 3.4 可点击字段

- 设备名称为可点击主链接，点击后进入设备详情页

---

## 4. 底部固定操作栏（BatchBar）

```
高度: 48px
背景: #FFFFFF
顶部: 1px #EAEDF1
左侧: "已选 N 条" + 批量按钮
右侧: 分页器
```

---

## 5. 分页器

- 页码方块 32×32
- 选中：`#1664FF` 背景白字
- 下拉："20 条/页"

---

## 6. 列表页还原校验清单

- [ ] 列表页背景统一为 `#FFFFFF`
- [ ] 表格外围为 `1px solid #EAEDF1` 描边，不使用带阴影卡片
- [ ] 表格行操作使用文字按钮，主色蓝
- [ ] 列表页设备名称支持点击跳转详情页
- [ ] 分页器选中态使用 `#1664FF` 背景
- [ ] 筛选区控件高度统一 32px

---

# 图表页设计规范（Chart Page）

> 详情页内嵌的"监控"Tab，整页背景 `#FFFFFF`。

---

## 1. 时间筛选条

### 1.1 快捷标签按钮

内容：`近1小时 / 3小时 / 12小时 / 24小时 / 3天 / 7天`

| 状态 | 背景 | 边框 | 文字 |
| --- | --- | --- | --- |
| 默认 | 白底 | 1px `#DDE2E9` | 13px `#42464E` |
| 选中 | `#A2C1FF33` | 1px `#A2C1FF` | `#1664FF` 500 |

- 高 32px，padding 5px 16px，圆角 4px，column-gap 8px

### 1.2 DateRangePicker

- 白底 32px，1px `#DDE2E9`，icon 16×16

---

## 2. 图表卡片网格

### 2.1 布局

- **3 列**
- 行间距 16px
- 列间距 16px

### 2.2 卡片样式

- 白底，**无外阴影**（依靠背景区分）
- padding 20px
- 标题 `13px / 22px / 500` `#0C0D0E` + 信息 icon 16×16
- 副标题 12px `#737A87`（如"周期：90s 聚合方式：average"）
- 右上角放大按钮 16×16

---

## 3. 折线图规范

### 3.1 线条与填充

- 折线主色 `#2E62F1`
- 区域填充 `#2E62F11A`（透明度 10%）

### 3.2 坐标轴

- Y 轴 5 段（如 0/10/20/30/40），文字 `#42464E` 12px
- X 轴：12px `#42464E`

### 3.3 图例

- 8×8 方块色块 + 文字 12px `#141414A6`

---

## 4. 图表页还原校验清单

- [ ] 图表页背景统一为 `#FFFFFF`
- [ ] 快捷标签选中态：浅蓝底 `#A2C1FF33` + 蓝描边 `#A2C1FF` + 文字 `#1664FF`
- [ ] 图表卡片 3 列布局，间距 16px
- [ ] 折线 `#2E62F1`，填充透明度 10%
- [ ] Y 轴文字 `#42464E` 12px
- [ ] 卡片无外阴影