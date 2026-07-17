# HTML 组织架构图生成指引

## 概述

本文档定义了如何根据公司 JSON 数据生成自包含的 HTML 组织架构图。
生成的 HTML 文件无任何外部依赖，可直接在浏览器中打开查看。

## 技术方案

使用纯 CSS + JavaScript 实现树状组织架构图，不依赖外部库。

## HTML 模板

以下为完整的 HTML 生成模板。AI 在生成时需要根据实际 JSON 数据填充 `DATA_PLACEHOLDER` 部分。

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{{COMPANY_NAME}} - 组织架构图</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
    min-height: 100vh;
    padding: 40px 20px;
  }

  .header {
    text-align: center;
    margin-bottom: 40px;
  }

  .header h1 {
    font-size: 28px;
    color: #1a365d;
    margin-bottom: 8px;
  }

  .header .subtitle {
    font-size: 14px;
    color: #718096;
  }

  .header .meta {
    font-size: 12px;
    color: #a0aec0;
    margin-top: 4px;
  }

  /* ====== 树形连线 ====== */
  .tree ul {
    padding: 0; position: relative;
    display: flex; justify-content: center; list-style: none;
  }
  .tree li {
    display: flex; flex-direction: column; align-items: center;
    position: relative; padding: 24px 6px 0;  /* 顶部留连线空间 */
  }

  /* 竖线：从横线位置向下连到卡片 */
  .tree li::before {
    content: ''; position: absolute;
    top: 0; left: 50%;
    width: 0; height: 24px;
    border-left: 2px solid #cbd5e0;
    transform: translateX(-1px);
  }

  /* 横线：在 li padding 顶部连接同层兄弟 */
  .tree li::after {
    content: ''; position: absolute;
    top: 0; left: 0;
    width: 100%; height: 0;
    border-top: 2px solid #cbd5e0;
  }
  .tree li:first-child::after { left: 50%; width: 50%; }
  .tree li:last-child::after { left: 0; width: 50%; }
  .tree li:only-child::after { display: none; }

  /* 根 li 不画线也不留连线空间 */
  .tree > ul > li { padding-top: 0; }
  .tree > ul > li::before, .tree > ul > li::after { display: none; }

  /* 虚线（推断关系）*/
  .tree li.inferred::before {
    border-left: 2px dashed #cbd5e0;
  }

  /* 父节点到子ul的连接竖线 — 生成HTML时必须在.node和子ul之间插入 */
  .vline { width: 0; border-left: 2px solid #cbd5e0; height: 24px; margin-left: -1px; }

  /* ====== 节点卡片 ====== */
  .node {
    position: relative;
    display: inline-block;
    padding: 8px 12px;           /* ★ 统一 padding */
    border-radius: 10px;
    text-align: center;
    min-width: 110px;
    max-width: 200px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    transition: transform 0.2s, box-shadow 0.2s;
    cursor: default;
    z-index: 1;
  }

  .node:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  }

  /* 公司根节点 */
  .node.company {
    background: #1a365d;
    color: white;
    font-size: 16px;
    font-weight: 700;
    padding: 16px 24px;
    border-radius: 12px;
  }

  /* 部门节点 */
  .node.department {
    background: #2b6cb0;
    color: white;
    font-size: 14px;
    font-weight: 600;
  }

  /* 团队/赛道节点 */
  .node.team, .node.sub_team {
    background: #4299e1;
    color: white;
    font-size: 13px;
    font-weight: 500;
  }

  /* 人员节点 */
  .node.person {
    background: white;
    border: 2px solid #bee3f8;
    color: #2d3748;
    font-size: 12px;
    padding: 8px 12px;
    min-width: 140px;
  }

  /* 有详细背景的人员（高亮） */
  .node.person.known {
    border-color: #48bb78;
    border-width: 2.5px;
  }

  .node .name {
    font-weight: 600;
    font-size: 13px;
    margin-bottom: 2px;
  }

  .node .title {
    font-size: 11px;
    opacity: 0.85;
  }

  .node .headcount {
    font-size: 11px;
    opacity: 0.7;
    margin-top: 2px;
  }

  .node .background {
    font-size: 10px;
    color: #718096;
    margin-top: 3px;
    line-height: 1.3;
  }

  .node .note-badge {
    font-size: 10px;
    background: #fefcbf;
    color: #975a16;
    padding: 1px 6px;
    border-radius: 4px;
    margin-top: 4px;
    display: inline-block;
  }

  /* ====== 图例 ====== */
  .legend {
    display: flex;
    justify-content: center;
    gap: 20px;
    margin-top: 40px;
    flex-wrap: wrap;
  }

  .legend-item {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #4a5568;
  }

  .legend-dot {
    width: 14px;
    height: 14px;
    border-radius: 4px;
  }

  .legend-dot.company { background: #1a365d; }
  .legend-dot.department { background: #2b6cb0; }
  .legend-dot.team { background: #4299e1; }
  .legend-dot.person { background: white; border: 2px solid #bee3f8; }
  .legend-dot.known { background: white; border: 2px solid #48bb78; }

  .legend-line {
    width: 20px;
    height: 2px;
  }

  .legend-line.solid { background: #cbd5e0; }
  .legend-line.dashed { border-top: 2px dashed #cbd5e0; background: none; }

  /* ====== 备注区域 ====== */
  .notes-section {
    max-width: 700px;
    margin: 40px auto 0;
    background: white;
    border-radius: 12px;
    padding: 20px 24px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  }

  .notes-section h3 {
    font-size: 15px;
    color: #2d3748;
    margin-bottom: 12px;
  }

  .note-item {
    font-size: 13px;
    color: #4a5568;
    padding: 6px 0;
    border-bottom: 1px solid #edf2f7;
  }

  .note-item:last-child { border-bottom: none; }

  .note-source {
    font-size: 11px;
    color: #a0aec0;
    margin-left: 8px;
  }

  /* ====== 响应式 ====== */
  @media (max-width: 768px) {
    body { padding: 20px 10px; }
    .header h1 { font-size: 22px; }
    .node { min-width: 100px; padding: 8px 12px; }
    .tree li { padding: 0 6px; }
  }
</style>
</head>
<body>

<div class="header">
  <h1>{{COMPANY_NAME}}</h1>
  <div class="subtitle">{{COMPANY_DESCRIPTION}}</div>
  <div class="meta">最后更新：{{LAST_UPDATED}} · 已录入 {{PERSONNEL_COUNT}} 位人员</div>
</div>

<!-- 组织架构树 -->
<div class="tree-wrapper">
<div class="tree" id="orgTree">
  {{TREE_HTML}}
</div>
</div>

<script>
// 自适应缩放
function fitTree() {
  var tree = document.getElementById('orgTree');
  var wrapper = tree.parentElement;
  tree.style.transform = '';
  tree.style.transformOrigin = 'top center';
  var treeW = tree.scrollWidth;
  var wrapperW = wrapper.clientWidth;
  if (treeW > wrapperW) {
    var scale = wrapperW / treeW;
    tree.style.transform = 'scale(' + scale + ')';
    wrapper.style.height = (tree.scrollHeight * scale) + 'px';
  } else {
    wrapper.style.height = '';
  }
}

window.addEventListener('load', fitTree);
window.addEventListener('resize', fitTree);
</script>

<!-- 图例 -->
<div class="legend">
  <div class="legend-item"><div class="legend-dot company"></div> 公司</div>
  <div class="legend-item"><div class="legend-dot department"></div> 部门/行业组</div>
  <div class="legend-item"><div class="legend-dot team"></div> 团队/赛道</div>
  <div class="legend-item"><div class="legend-dot person"></div> 人员</div>
  <div class="legend-item"><div class="legend-dot known"></div> 已知联系人</div>
  <div class="legend-item"><div class="legend-line solid"></div> 确认汇报关系</div>
  <div class="legend-item"><div class="legend-line dashed"></div> 推断汇报关系</div>
</div>

<!-- 备注 -->
{{NOTES_HTML}}

</body>
</html>
```

## 树状 HTML 生成规则

### 节点生成

将 `org_structure` 中的每个节点递归转换为嵌套的 `<ul><li>` 结构：

```html
<ul>
  <li>
    <div class="node {type}">
      <div class="name">{name}</div>
      <div class="headcount">{headcount_note}</div>  <!-- 如有 -->
    </div>
    <div class="vline"></div>  <!-- ★ 有子节点时必须插入 vline -->
    <ul>
      <!-- 子节点递归 -->
      <!-- 人员节点（挂在该部门/团队下的 personnel） -->
    </ul>
  </li>
</ul>
```

### 人员节点生成

根据 `personnel` 数组中的 `department_id` 和 `team_id`，将人员挂到对应的组织节点下：

```html
<li>
  <div class="node person known">  <!-- known 类：有 background_brief -->
    <div class="name">{name} | {title_abbr}</div>
    <div class="background">{background_brief}</div>
  </li>
</li>
```

如果人员没有 `background_brief`，不加 `known` class：

```html
<li>
  <div class="node person">
    <div class="name">{name} | {title_abbr}</div>
  </div>
</li>
```

### 备注区域生成

```html
<div class="notes-section">
  <h3>📝 备注信息</h3>
  <div class="note-item">
    {content} <span class="note-source">— {source}, {added_at}</span>
  </div>
</div>
```

如果没有备注，则不生成 notes-section。

## 数据占位符替换表

| 占位符 | 来源 |
|-------|------|
| `{{COMPANY_NAME}}` | `json.name` |
| `{{COMPANY_DESCRIPTION}}` | `json.description` 或 `json.industry` |
| `{{LAST_UPDATED}}` | `json.updated_at` 格式化为 `YYYY-MM-DD` |
| `{{PERSONNEL_COUNT}}` | `json.personnel.length` |
| `{{TREE_HTML}}` | 根据 `org_structure` + `personnel` 递归生成 |
| `{{NOTES_HTML}}` | 根据 `json.notes` 生成，无备注则为空 |
