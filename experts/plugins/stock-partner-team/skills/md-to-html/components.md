# 圆桌报告组件接口手册

> 本文档是 HTML body 片段的**渲染接口**——告诉 agent 用什么 class、什么 DOM 结构。
> **内容要求（写什么、写几条、怎么组织）以主理人 prompt 为准**，本文档不重复定义。
>
> Body 片段交给 `scripts/render.py`，脚本套外壳输出最终 HTML。

---

## 总图：body 的 7 个区块

按出现顺序：

```
1. <nav>                  导航条           固定 4 个锚点
2. .hero                  封面             报告标题 + 副标题 + 主理人署名
3. .conclusion-card       Module 1 · 结论  conclusion-card 组件
4. <section id="voices">  Module 2 · 视角  voice-card × N
5. <section id="thinking"> Module 3 · 思考 notes-stack + qa-stack
6. <section id="watch">   Module 4 · 关注  trigger-table + notes-stack
7. （可选）.passage-card  非标内容兜底     M1-4 装不下时用
```

footer 已写在 shell 里，**body 里不要重复写 footer**。

---

## 全局规则

- **头像**：所有 `<img src="avatars/<file>.png">` 由 `embed_avatars.py` 自动嵌成 base64。文件名映射见 `avatar-mapping.md`，不要写绝对路径。
- **涨红跌绿**：`.cc-snap-up` / `.up` 红（涨），`.cc-snap-down` / `.down` 绿（跌）——中国股市习惯，不要反。
- **emoji**：成员标记 🌊📡🧮🏔️🔬⚡ 用在 voice-card 名字旁；其它位置克制。
- **强调色**：`.cc-headline` 内关键判断词用 `<strong>` 加粗，核心强调字眼用 `<em>`（自动染红），每段红字 2-3 处即可。
- **不要写 `<style>`**：CSS 全在 shell 里，body 里只用现成 class。

---

## 1. Nav 导航条

固定 4 个锚点。`#conclusion` / `#voices` / `#thinking` / `#watch` 不要改 ID。

```html
<nav>
  <a class="nav-logo">📰 {{标的简称}} · 圆桌</a>
  <div class="nav-links">
    <a href="#conclusion">结论</a>
    <a href="#voices">视角</a>
    <a href="#thinking">思考</a>
    <a href="#watch">关注</a>
  </div>
</nav>
```

---

## 2. Hero 封面

```html
<section class="hero">
  <div class="kicker">ROUND TABLE · {{YYYY-MM-DD}} · {{副标签}}</div>
  <h1>{{报告主问题}}？</h1>
  <div class="hero-dek">{{1-2 句概述}}</div>
  <div class="host">
    <img src="avatars/stock-partner-lead.png" alt="投研主编">
    <span>投研主编 · 圆汇众（Yuan）· 腾讯自选股股票投研专家团</span>
  </div>
</section>
```

**关键 class**：`.kicker`（橙色小标签）/ `.hero h1`（大标题）/ `.hero-dek`（副标题）/ `.host`（主理人署名）

---

## 3. Module 1 · Conclusion Card

承接 MD 模块 1。DOM 结构：section-head + 五件套 (a)-(e)：

```html
<section id="conclusion">
  <div class="section-head">
    <div class="section-num">01 · 结论</div>
    <div><h2>圆桌怎么看</h2><p class="section-dek">多视角交叉验证后的综合判断</p></div>
  </div>
  <div class="conclusion-wrap">
    <div class="conclusion-card">

    <!-- (a) YOU ASKED -->
    <div class="cc-question">YOU ASKED</div>
    <div class="cc-question-text">{{用户原话}}</div>

    <!-- (b) 数据快照：4 或 8 个 cell -->
    <div class="cc-snapshot">
      <div class="cc-snapshot-label">当前关键数据 · {{日期}}</div>
      <div class="cc-snapshot-grid">
        <div class="cc-snap-cell">
          <div class="cc-snap-cell-label">{{指标名}}</div>
          <div class="cc-snap-cell-value">{{数值}}</div>
          <div class="cc-snap-cell-sub cc-snap-down">{{副标 · 涨跌}}</div>
        </div>
        <!-- ... 重复 4 或 8 个 cell ... -->
      </div>
    </div>

    <!-- (c) 圆桌综合视角：关键判断词 <strong>；核心强调字眼 <em>（自动染红） -->
    <div class="cc-headline-label">圆桌综合视角</div>
    <div class="cc-headline">{{内容见主理人 prompt 模块 1.3}}</div>

    <!-- (d) 核心分析观点：3-5 行 -->
    <div class="cc-actions-intro">圆桌的几个核心视角：</div>
    <div class="cc-actions">
      <div class="cc-action-row">
        <div class="cc-action-label">{{视角标签}}</div>
        <div class="cc-action-detail">{{论据 + 判断}}</div>
      </div>
      <!-- ... 重复 3-5 行 ... -->
    </div>

    <!-- (e) 投票分布 -->
    <div class="cc-vote">
      <span class="cc-vote-label">投票分布：</span>
      <span class="cc-vote-tag"><span class="dot" style="background:var(--red)"></span>{{维度A}} {{N}}</span>
      <span class="cc-vote-tag"><span class="dot" style="background:var(--accent)"></span>{{维度B}} {{N}}</span>
      <span class="cc-vote-tag"><span class="dot" style="background:var(--gold)"></span>{{维度C}} {{N}}</span>
      <span class="cc-vote-tag"><span class="dot" style="background:var(--green)"></span>{{维度D}} {{N}}</span>
    </div>

  </div>
  </div>
</section>
```

**核心 class**：

| Class | 用途 |
|---|---|
| `.conclusion-card` | 整张卡，金色描边 |
| `.cc-question` / `.cc-question-text` | YOU ASKED + 用户原话 |
| `.cc-snapshot` / `.cc-snapshot-grid` / `.cc-snap-cell` | 数据快照（cell 数 = 4 / 8）|
| `.cc-snap-cell-label` / `.cc-snap-cell-value` / `.cc-snap-cell-sub` | cell 内三层 |
| `.cc-snap-up` / `.cc-snap-down` | 涨红跌绿着色 |
| `.cc-headline` | 综合视角（1.15rem 黑色正文）；`<strong>` 加粗、`<em>` 染红 |
| `.cc-actions` / `.cc-action-row` / `.cc-action-label` / `.cc-action-detail` | 核心分析观点 |
| `.cc-vote` / `.cc-vote-tag` + `.dot` | 立场分布 |

---

## 4. Module 2 · Voice Cards

每位上场成员一张卡。容器固定用 `voice-stack`（单列），不混双列 grid。

```html
<section id="voices">
  <div class="section-head">
    <div class="section-num">02 · 视角</div>
    <div>
      <div class="section-title">{{N}} 人怎么看</div>
      <div class="section-lede">每位从自己的方法论独立诊断 —— 想看完整推理的人来这里</div>
    </div>
  </div>

  <div class="voice-stack">

    <article class="voice-card">
      <div class="voice-head">
        <img src="avatars/{{kebab-name}}.png" alt="{{头衔}}">
        <div class="voice-name">{{emoji}} {{头衔}} · {{花名}}</div>
      </div>
      <p>{{方法论一句话定调}}</p>

      <h4>{{子标题}}</h4>
      <table>
        <thead><tr><th>...</th></tr></thead>
        <tbody><tr><td>...</td></tr></tbody>
      </table>

      <h4>{{下一段}}</h4>
      <ul><li>...</li></ul>

      <div class="pull-quote">"{{标志性引用句}}"</div>
    </article>

    <!-- ... 其它成员 ... -->

  </div>
</section>
```

**核心 class**：

| Class | 用途 |
|---|---|
| `.voice-stack` | 单列容器（不要用 grid）|
| `.voice-card` | 单张发言卡 |
| `.voice-head` + `<img>` + `.voice-name` | 顶条：头像 + emoji + 头衔 + 花名 |
| 卡内 `<h4>` / `<p>` / `<ul>` / `<table>` | 直接用，CSS 已 scope 到 voice-card |
| `.pull-quote` | 卡尾标志性引用句（可选）|

**头像 src** 从 `avatar-mapping.md` 查。

---

## 5. Module 3 · Deep Thinking

由 **3a 札记** + **3b Q&A** 两个子区块组成，用 `subsection-label` 分隔。

```html
<section id="thinking">
  <div class="section-head">
    <div class="section-num">03 · 思考</div>
    <div>
      <div class="section-title">深度思考</div>
      <div class="section-lede">主持人替你想到的 —— 你没想到的问题、可能误读的地方、应该问但没问的</div>
    </div>
  </div>

  <!-- 3a · 主持人札记 -->
  <div class="subsection-label">3a · 主持人札记</div>
  <div class="notes-stack">
    <article class="note-item">
      <div class="note-num">01</div>
      <div class="note-body">
        <h4>{{札记标题}}</h4>
        <p>{{札记内容}}</p>
      </div>
    </article>
    <!-- 重复 3-5 条 -->
  </div>

  <!-- 3b · 主持人 Q&A -->
  <div class="subsection-label">3b · 主持人 Q&amp;A</div>
  <div class="qa-stack">
    <article class="qa-card">
      <span class="qa-tag tag-confuse">⚠️ 易混淆</span>
      <div class="qa-question">{{问题}}</div>
      <div class="qa-answer">
        <p>{{答案}}</p>
      </div>
    </article>
    <!-- 重复 3-5 条 -->
  </div>
</section>
```

**Q&A 类型标签 class（4 选 1）**：

| Class | 文字 | 颜色 |
|---|---|---|
| `.tag-key` | 🔑 关键 | 金 |
| `.tag-confuse` | ⚠️ 易混淆 | 红 |
| `.tag-miss` | 🔍 易疏忽 | 蓝 |
| `.tag-meta` | ⭐ 重要 | 紫 |

**核心 class**：

| Class | 用途 |
|---|---|
| `.subsection-label` | 3a / 3b 分节标签 |
| `.notes-stack` / `.note-item` / `.note-num` / `.note-body` | 札记列表（编号 01-05）|
| `.qa-stack` / `.qa-card` / `.qa-tag` / `.qa-question` / `.qa-answer` | Q&A 列表 |

---

## 6. Module 4 · What to Watch

两个子区块：**4a 关键变量观察台**（trigger-table）+ **4b 综合视角失效条件**（notes-stack）。

```html
<section id="watch">
  <div class="section-head">
    <div class="section-num">04 · 关注</div>
    <div>
      <div class="section-title">后续关注</div>
      <div class="section-lede">当下综合视角是基于现有数据的快照 —— 什么时候该回来重看，什么情况下我们这次的视角可能错了</div>
    </div>
  </div>

  <!-- 4a · 关键变量观察台 -->
  <div class="subsection-label">4a · 关键变量观察台</div>
  <div class="trigger-wrap">
    <table class="trigger-table">
      <thead>
        <tr>
          <th style="width: 30%;">变量 · 当前</th>
          <th>重新评估触发线</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="trigger-var">
            {{变量名}}
            <span class="now">当前 {{现值}}</span>
          </td>
          <td class="trigger-action">
            {{阈值 1}} → <span class="up">{{语义含义}}</span>；
            {{阈值 2}} → <span class="down">{{语义含义}}</span>。
          </td>
        </tr>
        <!-- 重复 5-8 行 -->
      </tbody>
    </table>
  </div>

  <!-- 4b · 综合视角失效条件 -->
  <div class="subsection-label">4b · 综合视角失效条件</div>
  <div class="notes-stack">
    <div class="note-item">
      <div class="note-num">01</div>
      <div class="note-body">
        {{失效条件内容}}
      </div>
    </div>
    <!-- 重复 3-5 条 -->
  </div>
</section>
```

**核心 class**：

| Class | 用途 |
|---|---|
| `.subsection-label` | 4a / 4b 分节标签（沿用 Module 3 同名 class）|
| `.trigger-wrap` / `.trigger-table` | 4a 容器 + 观察表（圆角 + 灰边）|
| `.trigger-var` + `.now` | 4a 左列：变量名 + 当前值 |
| `.trigger-action` + `.up` / `.down` | 4a 右列：触发线 + 涨红跌绿着色 |
| `.notes-stack` / `.note-item` / `.note-num` / `.note-body` | 4b 失效条件列表（沿用 3a notes 同名 class）|

**渲染规格**：4a 表 5-8 行；4b 列表 3-5 条。

---

## 7. Passage Card（兜底）

只在 M1-4 装不下的非标内容才用。一般情况**不需要**。

```html
<section>
  <div class="section-head">
    <div class="section-num">05 · {{标签}}</div>
    <div>
      <div class="section-title">{{标题}}</div>
      <div class="section-lede">{{副标}}</div>
    </div>
  </div>
  <div class="passage-card">
    <h3>...</h3>
    <p>...</p>
    <table>...</table>
  </div>
</section>
```

**何时用**：报告里有"数据来源详表"、"方法论附录"等无法归入 4 模块的内容。MD 里没有就不要用。

---

## 自检清单（写完 body 前过一遍）

- [ ] `<nav>` 4 个锚点齐：`#conclusion` / `#voices` / `#thinking` / `#watch`
- [ ] `<section class="hero">` 包含 `.kicker` / `<h1>` / `.hero-dek` / `.host`
- [ ] **Module 1**：`<section id="conclusion">` 包含 `.section-head`（01 · 结论）+ `.conclusion-card` 五件套——question / snapshot / headline / actions / vote
- [ ] **Module 1.c**：`.cc-headline` 用 `<strong>` 加粗 + `<em>` 局部染红（每段 2-3 处，不要整段红色）
- [ ] **Module 2**：每位上场成员一张 `.voice-card`，容器是 `.voice-stack`，头像 src 用 `avatars/<kebab>.png`
- [ ] **Module 3**：`#thinking` 内含 3a `.notes-stack` + 3b `.qa-stack`，用 `.subsection-label` 分隔
- [ ] **Module 4**：`#watch` 内含 4a `.trigger-table` + 4b `.notes-stack`，用 `.subsection-label` 分隔
- [ ] body **不写 `<style>`**、**不写 `<footer>`**、**不写 `<head>`**
- [ ] 涨跌着色对：`.cc-snap-up` / `.up` 红、`.cc-snap-down` / `.down` 绿

写完 body 片段，存成 `<主题>-圆桌报告.body.html`，调用 `scripts/render.py` 合成最终 HTML。
