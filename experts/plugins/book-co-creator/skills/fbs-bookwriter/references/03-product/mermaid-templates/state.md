# Mermaid 状态图模板

> 模板版本：v2.0.1.1
> 最后更新：2026-03-23
> 图表类型：stateDiagram-v2
> 引用位置：`templates.md` 第五节

---

## 一、标准注释头

```mermaid
%%{init: {
  'theme': 'base',
  'themeVariables': {
    'primaryColor': '[book.color]',
    'primaryTextColor': '#ffffff',
    'primaryBorderColor': '[book.color]',
    'lineColor': '[book.color]88',
    'secondaryColor': '[book.lightBg]',
    'tertiaryColor': '[book.accentBg]',
    'fontFamily': 'Source Han Sans SC, Microsoft YaHei, SimHei, sans-serif'
  }
}}%%
```

---

## 二、常用基础模板

### 2.1 简单状态转换

```mermaid
%%{init: { 'theme': 'base', 'themeVariables': { 'primaryColor': '[book.color]', 'primaryTextColor': '#ffffff', 'primaryBorderColor': '[book.color]', 'lineColor': '[book.color]88', 'fontFamily': 'Source Han Sans SC, Microsoft YaHei, SimHei, sans-serif' } }}%%
stateDiagram-v2
  [*] --> 初始状态
  初始状态 --> 处理中: 事件A
  处理中 --> 完成: 事件B
  完成 --> [*]
```

### 2.2 嵌套状态机

```mermaid
%%{init: { 'theme': 'base', 'themeVariables': { 'primaryColor': '[book.color]', 'primaryTextColor': '#ffffff', 'primaryBorderColor': '[book.color]', 'lineColor': '[book.color]88', 'fontFamily': 'Source Han Sans SC, Microsoft YaHei, SimHei, sans-serif' } }}%%
stateDiagram-v2
  [*] --> 审核中

  state 审核中 {
    [*] --> 待审
    待审 --> 审核通过: 批准
    待审 --> 已被拒绝: 拒绝
  }

  审核通过 --> 已发布: 发布
  已被拒绝 --> 审核中: 重新提交
  已发布 --> [*]
```

### 2.3 状态与动作

```mermaid
%%{init: { 'theme': 'base', 'themeVariables': { 'primaryColor': '[book.color]', 'primaryTextColor': '#ffffff', 'primaryBorderColor': '[book.color]', 'lineColor': '[book.color]88', 'fontFamily': 'Source Han Sans SC, Microsoft YaHei, SimHei, sans-serif' } }}%%
stateDiagram-v2
  [*] --> 空闲

  state 空闲 {
    [*] --> idle_entry: 进入
    idle_entry --> idle: 就绪
    idle --> idle_exit: 触发
    idle_exit --> [*]: 离开
  }

  空闲 --> 工作: 触发
  工作 --> 空闲: 完成
```

---

## 三、使用指南

### 3.1 状态命名约定

| 约定 | 说明 |
|------|------|
| **字数限制** | 状态名不超过 5 个字 |
| 层级结构 | 使用"父状态+子状态"，如 `审核中`、`待审核` |
| 终态 | 使用三角形符号 `[*]` |

### 3.2 转换标注

```mermaid
%%{init: { 'theme': 'base', 'themeVariables': { 'primaryColor': '[book.color]', 'lineColor': '[book.color]88' } }}%%
stateDiagram-v2
  [*] --> A
  A --> B: 事件/动作
```

### 3.3 图注约定

```markdown
```mermaid
stateDiagram-v2
  [*] --> 草稿
  草稿 --> 审核: 提交
  审核 --> [*]
```
<!-- FIG: 5-1：文档状态机图 -->
```

### 3.4 选型原则

| 场景 | 推荐图表 |
|------|--------|
| 状态机/条件分支 | 线性流程，用 flowchart |
| 阶段转换记录 | 时间相关，用 flowchart |
| 多角色状态机 | 角色交互，用 sequenceDiagram |

---

## 四、模板速查

```mermaid
%%{init: { 'theme': 'base', 'themeVariables': { 'primaryColor': '[book.color]', 'primaryTextColor': '#ffffff', 'primaryBorderColor': '[book.color]', 'lineColor': '[book.color]88', 'fontFamily': 'Source Han Sans SC, Microsoft YaHei, SimHei, sans-serif' } }}%%
stateDiagram-v2
  [*] --> 状态A
  状态A --> 状态B: 事件
  状态B --> 状态C: 事件
  状态C --> [*]
```
