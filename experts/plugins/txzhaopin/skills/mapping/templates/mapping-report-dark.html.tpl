<!doctype html>
<!--
  📄 HTML 五段式 Mapping 报告模板
  模板版本：v1.0.0 / 2026-04-28
  使用方法：AI 生成最终报告时，以本文件为基准，替换所有 {{ VAR }} 占位符
  结构：§1 组织架构图 → §2 人选详情 → §3 横向对比 → §4 水下挖掘 → §5 Alumni
  兼容性：纯字符串拼接 JS（无 template literal），深色主题，交互式
-->
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>{{ COMPANY_NAME }} · {{ FUNCTION_LINE_CN }} · 招聘 Mapping 报告</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 100%; min-height: 100%; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; background: #0f1419; color: #e6e9ef; }
  body { overflow-x: hidden; }
  a { color: #5ca8ff; text-decoration: none; }
  a:hover { text-decoration: underline; }

  /* Header */
  #header {
    position: sticky; top: 0; z-index: 100;
    padding: 14px 24px; background: rgba(15,20,25,0.94);
    border-bottom: 1px solid #2d3440; backdrop-filter: blur(8px);
    display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;
  }
  #header .title { font-size: 18px; font-weight: 600; color: #ff8c42; }
  #header .meta { font-size: 12px; color: #8b92a0; display: flex; gap: 14px; flex-wrap: wrap; }

  /* TOC */
  #toc {
    position: sticky; top: 56px; z-index: 99;
    background: rgba(20,25,32,0.94); border-bottom: 1px solid #2d3440;
    padding: 8px 24px; display: flex; gap: 16px; flex-wrap: wrap;
    font-size: 13px;
  }
  #toc a { color: #8b92a0; padding: 4px 10px; border-radius: 4px; }
  #toc a:hover { background: #2d3440; color: #e6e9ef; }
  #toc a.active { background: #ff8c42; color: #0f1419; font-weight: 600; }

  /* Sections */
  .section {
    padding: 28px 24px; max-width: 1400px; margin: 0 auto;
    border-bottom: 1px solid #1a1f28;
  }
  .section h2 {
    font-size: 20px; color: #ff8c42; margin-bottom: 16px;
    display: flex; align-items: center; gap: 10px;
  }
  .section h2 .count { font-size: 13px; color: #8b92a0; font-weight: 400; }
  .section h2 .toggle {
    font-size: 12px; background: #2d3440; color: #8b92a0;
    padding: 3px 10px; border-radius: 4px; cursor: pointer; border: none;
    margin-left: auto;
  }
  .section-body { transition: max-height 0.3s ease; overflow: hidden; }
  .section.collapsed .section-body { max-height: 0; }

  /* §1 组织架构图 */
  #tree-canvas {
    position: relative; width: 100%; height: 620px;
    background: #0f1419; border: 1px solid #2d3440; border-radius: 8px;
    overflow: hidden; cursor: grab;
  }
  #tree-canvas.grabbing { cursor: grabbing; }
  #tree-outer {
    position: absolute; top: 30px; left: 50%;
    transform-origin: top center;
    transition: transform 0.12s ease-out; padding: 10px;
  }
  .tree-level { display: flex; justify-content: center; gap: 20px; margin-bottom: 30px; flex-wrap: wrap; }
  .tree-level-label { text-align: center; color: #ff8c42; font-size: 12px; font-weight: 600; margin-bottom: 12px; letter-spacing: 2px; }
  .tree-card {
    background: linear-gradient(135deg, #1c2332 0%, #242c3d 100%);
    border: 1px solid #3a4352; border-radius: 8px; padding: 10px 14px;
    min-width: 200px; max-width: 260px; box-shadow: 0 3px 10px rgba(0,0,0,0.3);
  }
  .tree-card.top { border-color: #ff8c42; }
  .tree-card.senior { border-color: #5ca8ff; }
  .tree-card.mid { border-color: #7acc7a; }
  .tree-card.junior { border-color: #b5bcc7; }
  .tree-card .name { font-size: 14px; font-weight: 600; color: #fff; margin-bottom: 3px; }
  .tree-card .title-txt { font-size: 11px; color: #ffab6b; line-height: 1.4; margin-bottom: 4px; }
  .tree-card.senior .title-txt { color: #86c2ff; }
  .tree-card.mid .title-txt { color: #a2dd95; }
  .tree-card.junior .title-txt { color: #d3d8e0; }
  .tree-card .tags { font-size: 10px; color: #8b92a0; }

  #zoom-toolbar {
    position: absolute; top: 10px; right: 10px; z-index: 5;
    background: rgba(25,30,38,0.9); border: 1px solid #2d3440; border-radius: 6px;
    padding: 5px 8px; display: flex; gap: 4px; align-items: center;
  }
  #zoom-toolbar button {
    background: #2d3440; color: #e6e9ef; border: none;
    padding: 4px 8px; border-radius: 3px; cursor: pointer; font-size: 11px;
  }
  #zoom-toolbar button:hover { background: #3d4450; }
  #zoom-label { font-size: 10px; color: #8b92a0; padding: 0 4px; min-width: 32px; text-align: center; }

  /* §2 人选详情卡片 */
  .person-card {
    background: rgba(28,35,50,0.6); border: 1px solid #2d3440; border-radius: 8px;
    padding: 16px; margin-bottom: 14px;
  }
  .person-card .ph-name {
    font-size: 16px; font-weight: 600; color: #fff; margin-bottom: 4px;
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  }
  .person-card .ph-name .tier-badge {
    font-size: 10px; padding: 2px 8px; border-radius: 3px;
  }
  .tier-top { background: #ff8c42; color: #0f1419; }
  .tier-senior { background: #5ca8ff; color: #0f1419; }
  .tier-mid { background: #7acc7a; color: #0f1419; }
  .tier-junior { background: #b5bcc7; color: #0f1419; }

  .person-card .ph-title { font-size: 12px; color: #ffab6b; margin-bottom: 8px; }
  .person-card .ph-fields { font-size: 12px; color: #d3d8e0; line-height: 1.7; }
  .person-card .ph-fields .k { color: #8b92a0; display: inline-block; width: 80px; }
  .person-card .ph-sources {
    font-size: 11px; color: #6ea8ff; margin-top: 10px; padding-top: 10px;
    border-top: 1px dashed #2d3440;
  }
  .person-card .ph-sources a { margin-right: 8px; word-break: break-all; }

  /* §3 横向对比表 */
  .peer-table {
    width: 100%; border-collapse: collapse; font-size: 12px;
    background: rgba(28,35,50,0.4); border-radius: 8px; overflow: hidden;
  }
  .peer-table th, .peer-table td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #2d3440; }
  .peer-table th { background: #1c2332; color: #ff8c42; font-size: 12px; }
  .peer-table td { color: #d3d8e0; }
  .peer-table tr:hover { background: rgba(255,140,66,0.04); }

  /* §4 水下挖掘建议 */
  .underwater-item {
    background: rgba(255,140,66,0.06); border-left: 3px solid #ff8c42; border-radius: 4px;
    padding: 12px 16px; margin-bottom: 12px; font-size: 13px; line-height: 1.7;
  }
  .underwater-item .uw-priority {
    display: inline-block; font-size: 10px; padding: 2px 8px; border-radius: 3px;
    color: #0f1419; margin-right: 8px;
  }
  .uw-p-immediate { background: #ff5a4a; }
  .uw-p-week { background: #ff8c42; }
  .uw-p-month { background: #ffcc5a; }
  .underwater-item .uw-channel { font-weight: 600; color: #ffab6b; }
  .underwater-item .uw-meta { color: #8b92a0; font-size: 11px; margin-top: 6px; }

  /* §5 Alumni */
  .alumni-card {
    background: rgba(155,160,170,0.05); border: 1px dashed #3a4352; border-radius: 6px;
    padding: 12px 16px; margin-bottom: 10px; font-size: 12px;
  }
  .alumni-card .al-name { font-weight: 600; color: #d3d8e0; margin-bottom: 2px; }
  .alumni-card .al-arrow { color: #6ea8ff; font-weight: 600; }
  .alumni-card .al-meta { color: #8b92a0; font-size: 11px; line-height: 1.6; margin-top: 4px; }

  /* Utility */
  .empty-state {
    background: rgba(30,36,48,0.3); border: 1px dashed #2d3440; border-radius: 6px;
    padding: 16px; color: #8b92a0; font-size: 12px; text-align: center;
  }
  .footer {
    padding: 20px 24px; text-align: center; font-size: 11px; color: #5a6270;
    border-top: 1px solid #1a1f28;
  }
  .footer .disclaimer { margin-top: 6px; color: #ff8c42; }
</style>
</head>
<body>

<!-- ========================================================= -->
<!-- HEADER -->
<!-- ========================================================= -->
<div id="header">
  <div class="title">🧭 {{ COMPANY_NAME }} · {{ FUNCTION_LINE_CN }} · 招聘 Mapping</div>
  <div class="meta">
    <span>📅 {{ GENERATED_AT }}</span>
    <span>🎯 {{ TARGET_LEVEL }}</span>
    <span>📊 覆盖度：{{ COVERAGE_CONFIDENCE }}</span>
    <span>📦 {{ PERSONNEL_COUNT }} 位具名 · {{ ALUMNI_COUNT }} 位离职追踪</span>
  </div>
</div>

<!-- TOC 快速跳转 -->
<div id="toc">
  <a href="#sec-1" class="active">§1 组织架构图</a>
  <a href="#sec-2">§2 人选详情 ({{ PERSONNEL_COUNT }})</a>
  <a href="#sec-3">§3 横向对比</a>
  <a href="#sec-4">§4 水下挖掘 ({{ UNDERWATER_COUNT }})</a>
  <a href="#sec-5">§5 Alumni 追踪 ({{ ALUMNI_COUNT }})</a>
</div>

<!-- ========================================================= -->
<!-- §1 组织架构图（树状 · 可缩放拖拽） -->
<!-- ========================================================= -->
<div class="section" id="sec-1">
  <h2>§1 组织架构图 <span class="count">· 分层展示</span>
    <button class="toggle" onclick="toggleSection('sec-1')">折叠</button>
  </h2>
  <div class="section-body">
    <div id="tree-canvas">
      <div id="zoom-toolbar">
        <button onclick="zoomOut()">−</button>
        <span id="zoom-label">100%</span>
        <button onclick="zoomIn()">+</button>
        <button onclick="resetView()">⟲</button>
      </div>
      <div id="tree-outer">

        <!-- AI 生成时按 level_tier 分层填充 -->
        <!-- ========== Top Tier ========== -->
        <div class="tree-level-label">◆ TOP LAYER</div>
        <div class="tree-level">
          <!-- {{ TREE_CARDS_TOP }} -->
          <!-- 示例：
          <div class="tree-card top">
            <div class="name">张三 / Sam Zhang</div>
            <div class="title-txt">VP Engineering · 技术负责人</div>
            <div class="tags">推荐算法 · 2019 加入</div>
          </div>
          -->
        </div>

        <!-- ========== Senior Tier ========== -->
        <div class="tree-level-label">◆ SENIOR LAYER</div>
        <div class="tree-level">
          <!-- {{ TREE_CARDS_SENIOR }} -->
        </div>

        <!-- ========== Mid Tier ========== -->
        <div class="tree-level-label">◆ MID LAYER</div>
        <div class="tree-level">
          <!-- {{ TREE_CARDS_MID }} -->
        </div>

        <!-- ========== Junior Tier ========== -->
        <div class="tree-level-label">◆ JUNIOR LAYER</div>
        <div class="tree-level">
          <!-- {{ TREE_CARDS_JUNIOR }} -->
        </div>

      </div>
    </div>
  </div>
</div>

<!-- ========================================================= -->
<!-- §2 人选详情（每人 1 张展开卡片） -->
<!-- ========================================================= -->
<div class="section" id="sec-2">
  <h2>§2 人选详情 <span class="count">· 共 {{ PERSONNEL_COUNT }} 位</span>
    <button class="toggle" onclick="toggleSection('sec-2')">折叠</button>
  </h2>
  <div class="section-body">

    <!-- {{ PERSON_CARDS }} -->
    <!-- 示例卡片：
    <div class="person-card">
      <div class="ph-name">
        张三 <span style="color:#8b92a0;font-weight:400;">/ Sam Zhang</span>
        <span class="tier-badge tier-top">TOP</span>
      </div>
      <div class="ph-title">VP Engineering · 推荐算法负责人</div>
      <div class="ph-fields">
        <div><span class="k">📍 驻地</span>北京</div>
        <div><span class="k">🎓 教育</span>清华大学 计算机本硕 · Stanford PhD</div>
        <div><span class="k">💼 前职</span>阿里妈妈 P9 → 腾讯广告 T4 → 字节 2019</div>
        <div><span class="k">🏆 Lead</span>抖音主 Feed 推荐 · 精排架构升级</div>
        <div><span class="k">🏷️ 标签</span>推荐系统 · 多目标 · 大规模 DNN</div>
        <div><span class="k">🔗 联系</span><a href="...">LinkedIn</a> · 清华校友 · Stanford 同学</div>
      </div>
      <div class="ph-sources">
        来源：<a href="...">LinkedIn</a> · <a href="...">36氪专访 2024</a> · <a href="...">NeurIPS 2022 论文</a>
      </div>
    </div>
    -->

  </div>
</div>

<!-- ========================================================= -->
<!-- §3 横向对比矩阵 -->
<!-- ========================================================= -->
<div class="section collapsed" id="sec-3">
  <h2>§3 横向对比 <span class="count">· Peer 公司团队对标</span>
    <button class="toggle" onclick="toggleSection('sec-3')">展开</button>
  </h2>
  <div class="section-body">
    <table class="peer-table">
      <thead>
        <tr>
          <th>公司</th>
          <th>团队规模</th>
          <th>Top Leader</th>
          <th>技术/业务特点</th>
          <th>近期动态</th>
          <th>薪酬区间（Senior）</th>
          <th>招聘热度</th>
        </tr>
      </thead>
      <tbody>
        <!-- {{ PEER_ROWS }} -->
      </tbody>
    </table>
  </div>
</div>

<!-- ========================================================= -->
<!-- §4 水下挖掘建议（核心价值段） -->
<!-- ========================================================= -->
<div class="section" id="sec-4">
  <h2>§4 水下挖掘建议 <span class="count">· 共 {{ UNDERWATER_COUNT }} 条行动</span>
    <button class="toggle" onclick="toggleSection('sec-4')">折叠</button>
  </h2>
  <div class="section-body">

    <!-- {{ UNDERWATER_ITEMS }} -->
    <!-- 示例：
    <div class="underwater-item">
      <span class="uw-priority uw-p-immediate">立即</span>
      <span class="uw-channel">GitHub 贡献者反查</span>
      <div style="margin-top:6px;">
        目标：字节抖音推荐算法团队的 top 10 GitHub Contributor
        做法：搜 "site:github.com bytedance recommendation" + 按 commit 数排序
        预期收益：5-8 位未出现在官方资料的工程师
      </div>
      <div class="uw-meta">
        所需账号：无（免费）· 预计耗时：30 分钟 · 关联 skill：linkedin-public-miner
      </div>
    </div>
    -->

  </div>
</div>

<!-- ========================================================= -->
<!-- §5 Alumni 离职追踪 -->
<!-- ========================================================= -->
<div class="section collapsed" id="sec-5">
  <h2>§5 Alumni 离职追踪 <span class="count">· 共 {{ ALUMNI_COUNT }} 位</span>
    <button class="toggle" onclick="toggleSection('sec-5')">展开</button>
  </h2>
  <div class="section-body">

    <!-- {{ ALUMNI_CARDS }} -->
    <!-- 示例：
    <div class="alumni-card">
      <div class="al-name">
        王五 <span class="al-arrow">➡️</span> 现任 快手 推荐算法总监
      </div>
      <div class="al-meta">
        在职：2018-2024 · 字节 Feed 推荐 → 2024.3 跳快手<br>
        价值：可引荐原字节 team · 能讲清字节技术栈细节
      </div>
    </div>
    -->

  </div>
</div>

<!-- ========================================================= -->
<!-- FOOTER -->
<!-- ========================================================= -->
<div class="footer">
  Generated by <b>mapping-universal</b> Skill v1.0.0 · {{ GENERATED_AT }}
  <div class="disclaimer">
    ⚠️ 本报告仅基于公开信息挖掘（严守 no-hallucination meta-rule），所有具名人物附来源 URL。
    水下挖掘部分需招聘经理结合内部资源 / 付费工具补全。
  </div>
</div>

<!-- ========================================================= -->
<!-- JS（纯字符串拼接，避免 template literal 兼容问题） -->
<!-- ========================================================= -->
<script>
  // §1 树图缩放拖拽
  var zoom = 1;
  var panX = 0, panY = 0;
  var isDragging = false;
  var dragStartX = 0, dragStartY = 0;
  var startPanX = 0, startPanY = 0;

  function applyTransform() {
    var outer = document.getElementById('tree-outer');
    if (!outer) return;
    outer.style.transform = 'translate(calc(-50% + ' + panX + 'px), ' + panY + 'px) scale(' + zoom + ')';
    var label = document.getElementById('zoom-label');
    if (label) label.textContent = Math.round(zoom * 100) + '%';
  }

  function zoomIn() { zoom = Math.min(zoom * 1.2, 3); applyTransform(); }
  function zoomOut() { zoom = Math.max(zoom / 1.2, 0.3); applyTransform(); }
  function resetView() { zoom = 1; panX = 0; panY = 0; applyTransform(); }

  var canvas = document.getElementById('tree-canvas');
  if (canvas) {
    canvas.addEventListener('wheel', function(e) {
      e.preventDefault();
      var delta = e.deltaY > 0 ? 0.9 : 1.1;
      zoom = Math.max(0.3, Math.min(3, zoom * delta));
      applyTransform();
    }, { passive: false });

    canvas.addEventListener('mousedown', function(e) {
      isDragging = true;
      canvas.classList.add('grabbing');
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      startPanX = panX;
      startPanY = panY;
    });

    window.addEventListener('mousemove', function(e) {
      if (!isDragging) return;
      panX = startPanX + (e.clientX - dragStartX);
      panY = startPanY + (e.clientY - dragStartY);
      applyTransform();
    });

    window.addEventListener('mouseup', function() {
      isDragging = false;
      if (canvas) canvas.classList.remove('grabbing');
    });
  }
  applyTransform();

  // 折叠 / 展开各段
  function toggleSection(id) {
    var sec = document.getElementById(id);
    if (!sec) return;
    var isCollapsed = sec.classList.toggle('collapsed');
    var btns = sec.querySelectorAll('.toggle');
    for (var i = 0; i < btns.length; i++) {
      btns[i].textContent = isCollapsed ? '展开' : '折叠';
    }
  }

  // TOC 滚动高亮
  var tocLinks = document.querySelectorAll('#toc a');
  var sections = document.querySelectorAll('.section');
  window.addEventListener('scroll', function() {
    var scrollPos = window.scrollY + 140;
    var currentId = 'sec-1';
    for (var i = 0; i < sections.length; i++) {
      if (sections[i].offsetTop <= scrollPos) currentId = sections[i].id;
    }
    for (var j = 0; j < tocLinks.length; j++) {
      var href = tocLinks[j].getAttribute('href').substring(1);
      if (href === currentId) tocLinks[j].classList.add('active');
      else tocLinks[j].classList.remove('active');
    }
  });
</script>
</body>
</html>
