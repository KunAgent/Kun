<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{{title}} - Mapping 人才寻访报告</title>
<link href="https://cdn.jsdelivr.net/npm/remixicon@4.3.0/fonts/remixicon.css" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; background: #f9fafb; color: #111827; line-height: 1.6; }
  .report { max-width: 1200px; margin: 0 auto; padding: 32px; }

  /* 报告头部 */
  .report-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 32px; }
  .report-header .badge { padding: 2px 8px; background: #eef2ff; color: #4f46e5; border-radius: 9999px; font-size: 12px; }
  .report-header h1 { font-size: 24px; font-weight: 700; margin: 4px 0; }
  .report-header .subtitle { font-size: 14px; color: #6b7280; }

  /* 板块 */
  .section { margin-bottom: 32px; }
  .section-title { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
  .section-title .icon { width: 40px; height: 40px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0; }
  .section-title h2 { font-size: 18px; font-weight: 700; }
  .section-title p { font-size: 14px; color: #6b7280; }

  /* 指标卡片 */
  .metric-cards { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-bottom: 32px; }
  .metric-card { background: #fff; border-radius: 16px; border: 1px solid #f3f4f6; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
  .metric-card .mc-header { display: flex; justify-content: space-between; margin-bottom: 12px; }
  .metric-card .mc-label { font-size: 14px; color: #6b7280; }
  .metric-card .mc-icon { width: 36px; height: 36px; border-radius: 12px; display: flex; align-items: center; justify-content: center; }
  .metric-card .mc-value { font-size: 24px; font-weight: 700; margin-bottom: 4px; }
  .metric-card .mc-sub { font-size: 12px; }

  /* 折叠卡片 */
  .collapse-card { background: #fff; border-radius: 16px; border: 1px solid #f3f4f6; padding: 0; box-shadow: 0 1px 3px rgba(0,0,0,0.05); overflow: hidden; margin-bottom: 16px; }
  .collapse-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 20px 24px; cursor: pointer; user-select: none; }
  .collapse-header:hover { background: #f9fafb; }
  .collapse-body { padding: 0 24px 24px; overflow: hidden; transition: max-height 0.4s ease; }

  /* 公司卡片网格 */
  .company-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; } /* 第一梯队3列 */
  .company-cards.col4 { grid-template-columns: repeat(4, 1fr); }
  .company-card { padding: 16px; border-radius: 12px; border: 1px solid #f3f4f6; background: #fff; }
  .company-card .cc-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  .company-card .cc-name { font-weight: 700; font-size: 14px; }
  .company-card .cc-trend { padding: 2px 8px; font-size: 10px; border-radius: 9999px; }
  .company-card .cc-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px; }
  .company-card .cc-stat { text-align: center; padding: 8px; border-radius: 8px; background: #f9fafb; }
  .company-card .cc-stat-value { font-size: 18px; font-weight: 700; }
  .company-card .cc-stat-label { font-size: 10px; color: #9ca3af; }
  .company-card .cc-moves { font-size: 11px; color: #6b7280; line-height: 1.5; }

  /* 趋势卡片 */
  .trend-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .trend-card { padding: 16px; border-radius: 12px; border: 1px solid #f3f4f6; }
  .trend-card .tc-icon { width: 40px; height: 40px; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .trend-card .tc-header { display: flex; align-items: flex-start; gap: 12px; }
  .trend-card .tc-body { flex: 1; }
  .trend-card .tc-title { font-weight: 600; font-size: 14px; display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  .trend-card .tc-impact { padding: 2px 8px; font-size: 10px; border-radius: 9999px; }
  .trend-card .tc-detail { font-size: 12px; color: #6b7280; line-height: 1.6; }

  /* 城市分布 */
  .city-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  .city-list { display: flex; flex-direction: column; gap: 12px; }
  .city-item { display: flex; align-items: center; gap: 16px; padding: 12px; border-radius: 12px; }
  .city-item .ci-emoji { font-size: 24px; }
  .city-item .ci-name { font-weight: 600; font-size: 14px; }
  .city-item .ci-bar { width: 100%; height: 8px; background: #e5e7eb; border-radius: 9999px; overflow: hidden; }
  .city-item .ci-fill { height: 100%; border-radius: 9999px; transition: width 0.3s; }

  /* 组织架构 */
  .org-tree { display: flex; flex-direction: column; gap: 20px; }
  .org-company { background: #fff; border-radius: 16px; border: 1px solid #f3f4f6; overflow: hidden; }
  .org-company-header { padding: 20px 24px; background: linear-gradient(to right, #ecfdf5, #d1fae5); cursor: pointer; display: flex; align-items: center; justify-content: space-between; }
  .org-company-body { padding: 16px 24px; }
  .org-dept { display: flex; gap: 12px; margin-bottom: 12px; }
  .org-dept-line { display: flex; flex-direction: column; align-items: center; width: 24px; flex-shrink: 0; }
  .org-dept-card { flex: 1; padding: 16px; border-radius: 12px; border: 1px solid #f3f4f6; background: linear-gradient(to right, #fff, #eef2ff11); }
  .org-project { display: flex; gap: 12px; }
  .org-project-card { flex: 1; padding: 12px; border-radius: 12px; border: 1px solid #f3f4f6; background: linear-gradient(to right, rgba(254,243,199,0.4), #fff); }
  .person-tag { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 10px; background: #fff; border: 1px solid #f3f4f6; }

  /* 表格 */
  .data-table { width: 100%; border-collapse: separate; border-spacing: 0; }
  .data-table th { background: #f9fafb; padding: 12px 16px; text-align: left; font-size: 12px; font-weight: 600; color: #6b7280; border-bottom: 2px solid #e5e7eb; }
  .data-table td { padding: 12px 16px; font-size: 14px; border-bottom: 1px solid #f3f4f6; }

  /* 候选人卡片 */
  .candidate-cards { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
  .candidate-card { background: #fff; border-radius: 16px; border: 1px solid #f3f4f6; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
  .candidate-card .cd-avatar { width: 48px; height: 48px; border-radius: 12px; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 18px; font-weight: 700; flex-shrink: 0; }
  .candidate-card .cd-header { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 16px; }
  .candidate-card .cd-name { font-weight: 700; font-size: 16px; }
  .candidate-card .cd-company { font-size: 13px; color: #6b7280; }
  .candidate-card .cd-score { font-size: 24px; font-weight: 700; }
  .candidate-card .cd-row { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #374151; margin-bottom: 8px; }
  .candidate-card .cd-skills { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .candidate-card .cd-skill { padding: 4px 10px; background: #eef2ff; color: #4f46e5; border-radius: 9999px; font-size: 12px; font-weight: 500; }
  .candidate-card .cd-intention { display: inline-flex; align-items: center; gap: 4px; padding: 6px 12px; border-radius: 8px; font-size: 12px; font-weight: 500; }

  /* 洞察板块 */
  .insight-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .insight-card { background: #fff; border-radius: 16px; border: 1px solid #f3f4f6; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
  .risk-item { padding: 16px; border-radius: 12px; border: 1px solid #f3f4f6; margin-bottom: 12px; }
  .strategy-item { padding: 14px; border-radius: 10px; border: 1px solid #f3f4f6; margin-bottom: 8px; }
  .strategy-item .si-priority { padding: 2px 8px; border-radius: 9999px; font-size: 10px; font-weight: 500; }

  /* AI 综合研判 */
  .ai-summary { background: linear-gradient(135deg, #6366f1, #4338ca); border-radius: 16px; padding: 32px; color: #fff; box-shadow: 0 10px 30px rgba(99,102,241,0.3); margin-bottom: 48px; }
  .ai-summary h2 { font-size: 20px; font-weight: 700; margin-bottom: 20px; display: flex; align-items: center; gap: 8px; }
  .ai-summary .ai-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; }
  .ai-summary h4 { font-weight: 600; color: #c7d2fe; margin-bottom: 12px; }
  .ai-summary li { font-size: 14px; color: #c7d2fe; line-height: 2; }
  .ai-summary strong { color: #fff; }

  /* 页脚 */
  .report-footer { text-align: center; padding: 24px; color: #9ca3af; font-size: 12px; border-top: 1px solid #f3f4f6; margin-top: 32px; }
  .report-footer i { margin: 0 4px; }

  .tier-label { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
  .tier-dot { width: 8px; height: 8px; border-radius: 9999px; display: inline-block; }

  /* 状态标签 */
  .tag { padding: 2px 8px; font-size: 10px; border-radius: 9999px; }
  .tag-green { background: #ecfdf5; color: #059669; border: 1px solid #d1fae5; }
  .tag-purple { background: #eef2ff; color: #4f46e5; border: 1px solid #c7d2fe; }
  .tag-red { background: #fff1f2; color: #e11d48; border: 1px solid #fecdd3; }
  .tag-yellow { background: #fef3c7; color: #d97706; border: 1px solid #fde68a; }
</style>
</head>
<body>
<div class="report">
  <!-- 报告头部 -->
  <div class="report-header">
    <div>
      <div style="display:flex;align-items:center;gap:8px;font-size:14px;color:#6366f1;margin-bottom:8px;">
        <i class="ri-map-2-line"></i>
        <span>Mapping 人才寻访报告</span>
        <span class="badge">AI生成</span>
      </div>
      <h1>{{title}}</h1>
      <p class="subtitle">{{subtitle}} | 生成时间：{{date}}</p>
    </div>
  </div>

  <!-- 核心指标概览 -->
  <div class="metric-cards">
    <div class="metric-card">
      <div class="mc-header">
        <span class="mc-label">总人才池</span>
        <div class="mc-icon" style="background:#eef2ff;"><i class="ri-team-line" style="color:#6366f1;"></i></div>
      </div>
      <div class="mc-value">{{summary.totalTalentPool}}人</div>
      <div class="mc-sub" style="color:#6366f1;">+{{summary.talentGrowthYoY}}% YoY</div>
    </div>
    <div class="metric-card">
      <div class="mc-header">
        <span class="mc-label">活跃人才</span>
        <div class="mc-icon" style="background:#ecfdf5;"><i class="ri-user-star-line" style="color:#10b981;"></i></div>
      </div>
      <div class="mc-value">{{summary.activeTalent}}人</div>
      <div class="mc-sub" style="color:#10b981;">近30天活跃求职者 · 供需比 {{summary.supplyDemandRatio}}</div>
    </div>
  </div>

  <!-- 板块一：行业与市场概况 -->
  <div class="section">
    <div class="section-title">
      <div class="icon" style="background:#eef2ff; color:#6366f1;"><i class="ri-bar-chart-grouped-line"></i></div>
      <div><h2>板块一 · 行业与市场概况</h2><p>目标公司名单、行业趋势与人才分布</p></div>
    </div>

    <!-- 目标公司 -->
    <div class="collapse-card">
      <div class="collapse-header" onclick="toggleCollapse(this)">
        <div>
          <h3 style="font-size:16px;font-weight:700;display:flex;align-items:center;gap:8px;"><i class="ri-building-4-line" style="color:#6366f1;"></i>目标公司名单</h3>
          <p style="font-size:14px;color:#6b7280;">调研对标公司</p>
        </div>
        <i class="ri-arrow-down-s-line" style="font-size:22px;color:#9ca3af;"></i>
      </div>
      <div class="collapse-body">
        <!-- 第一梯队 3列 -->
        {{#tier1.length}}
        <div style="margin-bottom:16px;">
          <div class="tier-label">
            <span class="tier-dot" style="background:#6366f1;"></span>第一梯队
          </div>
          <div class="company-cards">
            {{#tier1}}<div class="company-card">
              <div class="cc-header">
                <div style="display:flex;align-items:center;gap:8px;">
                  <div style="width:36px;height:36px;background:#eef2ff;border-radius:8px;display:flex;align-items:center;justify-content:center;"><i class="ri-building-4-line" style="color:#6366f1;"></i></div>
                  <span class="cc-name">{{name}}</span>
                </div>
                <span class="cc-trend tag-{{hiringTrendClass}}">{{hiringTrend}}</span>
              </div>
              <div class="cc-stats">
                <div class="cc-stat"><div class="cc-stat-value">{{talentCount}}</div><div class="cc-stat-label">总人才数</div></div>
                <div class="cc-stat"><div class="cc-stat-value" style="color:#059669;">{{activeCount}}</div><div class="cc-stat-label">活跃人才</div></div>
              </div>
              <div class="cc-moves"><i class="ri-information-line"></i> {{recentMoves}}</div>
            </div>{{/tier1}}
          </div>
        </div>
        {{/tier1.length}}

        <!-- 第二梯队 4列 -->
        {{#tier2.length}}
        <div>
          <div class="tier-label">
            <span class="tier-dot" style="background:#10b981;"></span>第二梯队
          </div>
          <div class="company-cards col4">
            {{#tier2}}<div class="company-card">
              <div class="cc-header">
                <div style="display:flex;align-items:center;gap:8px;">
                  <div style="width:36px;height:36px;background:#ecfdf5;border-radius:8px;display:flex;align-items:center;justify-content:center;"><i class="ri-building-4-line" style="color:#10b981;"></i></div>
                  <span class="cc-name">{{name}}</span>
                </div>
                <span class="cc-trend tag-{{hiringTrendClass}}">{{hiringTrend}}</span>
              </div>
              <div class="cc-stats">
                <div class="cc-stat"><div class="cc-stat-value">{{talentCount}}</div><div class="cc-stat-label">总人才数</div></div>
                <div class="cc-stat"><div class="cc-stat-value" style="color:#059669;">{{activeCount}}</div><div class="cc-stat-label">活跃人才</div></div>
              </div>
              <div class="cc-moves"><i class="ri-information-line"></i> {{recentMoves}}</div>
            </div>{{/tier2}}
          </div>
        </div>
        {{/tier2.length}}
      </div>
    </div>

    <!-- 行业趋势 -->
    {{#industryTrends.length}}
    <div class="collapse-card">
      <div class="collapse-header" onclick="toggleCollapse(this)">
        <div>
          <h3 style="font-size:16px;font-weight:700;display:flex;align-items:center;gap:8px;"><i class="ri-line-chart-line" style="color:#f59e0b;"></i>行业趋势</h3>
          <p style="font-size:14px;color:#6b7280;">人才流动率、扩张/收缩动态与关键信号</p>
        </div>
        <i class="ri-arrow-down-s-line" style="font-size:22px;color:#9ca3af;"></i>
      </div>
      <div class="collapse-body">
        <div class="trend-cards">
          {{#industryTrends}}<div class="trend-card">
            <div class="tc-header">
              <div class="tc-icon" style="background:{{impactBg}}11;"><i class="{{icon}}" style="color:{{impactColor}};font-size:18px;"></i></div>
              <div class="tc-body">
                <div class="tc-title">{{trend}}<span class="tc-impact" style="background:{{impactBg}}11;color:{{impactColor}};border:1px solid {{impactColor}}33;">{{impactLabel}}</span></div>
                <p class="tc-detail">{{detail}}</p>
              </div>
            </div>
          </div>{{/industryTrends}}
        </div>
      </div>
    </div>
    {{/industryTrends.length}}

    <!-- 人才分布 -->
    {{#cityDistribution.length}}
    <div class="collapse-card">
      <div class="collapse-header" onclick="toggleCollapse(this)">
        <div>
          <h3 style="font-size:16px;font-weight:700;display:flex;align-items:center;gap:8px;"><i class="ri-map-pin-line" style="color:#f43f5e;"></i>人才分布</h3>
          <p style="font-size:14px;color:#6b7280;">核心人才在各城市的分布与活跃度</p>
        </div>
        <i class="ri-arrow-down-s-line" style="font-size:22px;color:#9ca3af;"></i>
      </div>
      <div class="collapse-body">
        <div class="city-list">
          {{#cityDistribution}}<div class="city-item" style="background:{{#first}}#eef2ff{{/first}}{{^first}}#f9fafb{{/first}};{{#first}}border:1px solid #e0e7ff;{{/first}}">
            <span class="ci-emoji">{{icon}}</span>
            <div style="flex:1;">
              <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                <span class="ci-name">{{name}}</span>
                <span style="font-size:14px;font-weight:700;">{{count}}人</span>
              </div>
              <div class="ci-bar"><div class="ci-fill" style="background:{{#first}}#6366f1{{/first}}{{^first}}#a5b4fc{{/first}};width:{{ratio}}%;"></div></div>
              <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:10px;color:#9ca3af;">
                <span>占比 {{ratio}}%</span>
                <span style="color:#10b981;">活跃 {{active}}人</span>
              </div>
            </div>
          </div>{{/cityDistribution}}
        </div>
      </div>
    </div>
    {{/cityDistribution.length}}
  </div>

  <!-- 板块二：组织架构 -->
  {{#orgStructure.length}}
  <div class="section">
    <div class="section-title">
      <div class="icon" style="background:#ecfdf5;color:#10b981;"><i class="ri-organization-chart"></i></div>
      <div><h2>板块二 · 人才架构图</h2><p>公司 → 部门 → 项目 → 关键人员 的层级结构</p></div>
    </div>

    <div class="org-tree">
      {{#orgStructure}}<div class="org-company">
        <div class="org-company-header" onclick="toggleCollapse(this)">
          <div style="display:flex;align-items:center;gap:16px;">
            <div style="width:56px;height:56px;background:linear-gradient(135deg,#34d399,#059669);border-radius:16px;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(16,185,129,0.3);flex-shrink:0;">
              <i class="ri-building-4-line" style="color:#fff;font-size:24px;"></i>
            </div>
            <div>
              <h3 style="font-weight:700;font-size:18px;">{{company}}</h3>
              <p style="font-size:14px;color:#374151;">{{leader.name}} · {{leader.title}}</p>
              <p style="font-size:12px;color:#9ca3af;">管辖：{{leader.scope}}</p>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:16px;">
            <div style="text-align:center;"><div style="font-size:20px;font-weight:700;color:#059669;">{{totalHeadcount}}</div><div style="font-size:10px;color:#9ca3af;">总编制</div></div>
            <div style="text-align:center;border-left:1px solid #a7f3d0;padding-left:12px;"><div style="font-size:20px;font-weight:700;color:#6366f1;">{{deptCount}}</div><div style="font-size:10px;color:#9ca3af;">部门</div></div>
            <i class="ri-arrow-down-s-line" style="font-size:24px;color:#059669;"></i>
          </div>
        </div>
        <div class="org-company-body">
          {{#departments}}<div style="margin-bottom:12px;">
            <div class="org-dept">
              <div class="org-dept-line">
                <div style="width:2px;height:12px;background:#a7f3d0;"></div>
                <div style="width:12px;height:12px;border-radius:4px;background:linear-gradient(135deg,#818cf8,#4f46e5);"></div>
                <div style="width:2px;flex:1;background:#c7d2fe;"></div>
              </div>
              <div class="org-dept-card">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
                  <div>
                    <h4 style="font-weight:600;font-size:14px;">{{name}}<span style="font-size:12px;color:{{growthColor}};margin-left:8px;">{{growthArrow}}{{absGrowth}}%</span></h4>
                    <p style="font-size:12px;color:#9ca3af;">{{focus}}</p>
                  </div>
                  <div style="display:flex;gap:8px;">
                    <span class="tag tag-purple">{{headcount}}人</span>
                    <span class="tag tag-yellow">{{projectCount}}个项目</span>
                    <span class="tag tag-green">{{openings}}个在招</span>
                  </div>
                </div>
                {{#teamInsight}}<div style="padding:16px;border-radius:12px;background:linear-gradient(to right,rgba(238,242,255,0.6),#fff,rgba(237,233,254,0.4));border:1px solid #e0e7ff;margin-bottom:12px;">
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                    <div style="width:28px;height:28px;background:linear-gradient(135deg,#818cf8,#7c3aed);border-radius:8px;display:flex;align-items:center;justify-content:center;"><i class="ri-lightbulb-flash-line" style="color:#fff;font-size:14px;"></i></div>
                    <h5 style="font-weight:700;font-size:14px;">团队关键洞察</h5>
                    <span class="tag tag-purple">AI分析</span>
                  </div>
                  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                    <div style="padding:10px;border-radius:8px;background:rgba(236,253,245,0.5);border:1px solid #d1fae5;">
                      <div style="font-size:12px;font-weight:600;color:#059669;"><i class="ri-team-line"></i> 团队文化</div>
                      <p style="font-size:11px;color:#374151;margin-top:4px;">{{teamCulture}}</p>
                    </div>
                    <div style="padding:10px;border-radius:8px;background:rgba(255,241,242,0.5);border:1px solid #fecdd3;">
                      <div style="font-size:12px;font-weight:600;color:#e11d48;"><i class="ri-alarm-warning-line"></i> 招聘挑战</div>
                      <p style="font-size:11px;color:#374151;margin-top:4px;">{{keyChallenge}}</p>
                    </div>
                  </div>
                </div>{{/teamInsight}}
                {{#projects}}<div class="org-project" style="margin-bottom:8px;">
                  <div class="org-dept-line">
                    <div style="width:2px;height:12px;background:#c7d2fe;"></div>
                    <div style="width:10px;height:10px;border-radius:4px;background:linear-gradient(135deg,#fbbf24,#f59e0b);"></div>
                    <div style="width:2px;flex:1;background:#fde68a;"></div>
                  </div>
                  <div style="flex:1;padding-bottom:8px;">
                    <div class="org-project-card">
                      <div style="display:flex;align-items:center;justify-content:space-between;">
                        <div style="display:flex;align-items:center;gap:10px;">
                          <div style="width:32px;height:32px;background:linear-gradient(135deg,#fef3c7,#fde68a);border-radius:8px;display:flex;align-items:center;justify-content:center;"><i class="ri-folder-chart-line" style="color:#d97706;"></i></div>
                          <div><span style="font-weight:500;font-size:14px;">{{name}}</span><span class="tag tag-{{statusClass}}" style="margin-left:8px;">{{status}}</span></div>
                        </div>
                        <span style="font-size:12px;color:#6b7280;">{{headcount}}人 · {{techStack}}</span>
                      </div>
                    </div>
                    {{#keyPersonnel}}<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;margin-left:16px;">
                      {{#keyPersonnel}}<div class="person-tag" style="position:relative;">
                        <div style="width:28px;height:28px;border-radius:9999px;background:{{personBg}};display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700;outline:2px solid {{personRing}};outline-offset:1px;">{{initial}}</div>
                        <div>
                          <div style="font-weight:600;font-size:12px;">{{name}}{{#isKeyPerson}}<i class="ri-vip-crown-2-fill" style="color:#fbbf24;font-size:10px;margin-left:2px;"></i>{{/isKeyPerson}}</div>
                          <div style="font-size:10px;color:#9ca3af;">{{title}}<span class="tag tag-{{levelClass}}" style="margin-left:4px;">{{level}}</span></div>
                        </div>
                      </div>{{/keyPersonnel}}
                    </div>{{/keyPersonnel}}
                  </div>
                </div>{{/projects}}
              </div>
            </div>
          </div>{{/departments}}
        </div>
      </div>{{/orgStructure}}
    </div>

    <!-- 职级对标 -->
    {{#hasLevelMapping}}
    <div class="collapse-card" style="margin-top:20px;">
      <div class="collapse-header" onclick="toggleCollapse(this)">
        <h3 style="font-size:16px;font-weight:700;display:flex;align-items:center;gap:8px;"><i class="ri-scales-3-line" style="color:#6366f1;"></i>各公司职级对标体系</h3>
        <i class="ri-arrow-down-s-line" style="font-size:22px;color:#9ca3af;"></i>
      </div>
      <div class="collapse-body">
        <div style="overflow-x:auto;">
          <table class="data-table">{{! levelMapping rendered by data }}</table>
        </div>
      </div>
    </div>
    {{/hasLevelMapping}}
  </div>
  {{/orgStructure.length}}

  <!-- 板块三：候选人画像 -->
  {{#candidateProfiles.length}}
  <div class="section">
    <div class="section-title">
      <div class="icon" style="background:#fef3c7;color:#d97706;"><i class="ri-user-search-line"></i></div>
      <div><h2>板块三 · 人才详细画像</h2><p>匹配候选人完整履历与跳槽意向</p></div>
    </div>
    <div class="collapse-card">
      <div class="collapse-header" onclick="toggleCollapse(this)">
        <div style="display:flex;align-items:center;gap:16px;">
          <span style="display:flex;align-items:center;gap:4px;padding:6px 12px;background:#ecfdf5;color:#059669;border-radius:9999px;border:1px solid #d1fae5;font-size:12px;font-weight:500;">
            <i class="ri-database-2-line"></i> 共 {{candidateCount}} 人
          </span>
          {{#intentionBars}}<span style="display:flex;align-items:center;gap:4px;font-size:12px;color:#6b7280;">
            <span style="width:8px;height:8px;border-radius:4px;background:{{color}};display:inline-block;"></span>
            {{label}} {{count}}人
          </span>{{/intentionBars}}
        </div>
        <i class="ri-arrow-down-s-line" style="font-size:22px;color:#9ca3af;"></i>
      </div>
      <div class="collapse-body">
        <div class="candidate-cards">
          {{#candidateProfiles}}<div class="candidate-card">
            <div class="cd-header">
              <div class="cd-avatar" style="background:{{avatarColor}};">{{initial}}</div>
              <div style="flex:1;">
                <div style="display:flex;align-items:center;justify-content:space-between;">
                  <div>
                    <div class="cd-name">{{name}}</div>
                    <div class="cd-company">{{company}} · {{title}}</div>
                  </div>
                  <div class="cd-score" style="color:{{scoreColor}};">{{matchScore}}</div>
                </div>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">
              <div class="cd-row"><i class="ri-briefcase-line" style="color:#9ca3af;"></i> {{experience}} · 在职{{yearsInCompany}}</div>
              <div class="cd-row"><i class="ri-building-line" style="color:#9ca3af;"></i> {{school}} · {{degree}}</div>
            </div>
            <div class="cd-skills">
              {{#skills}}<span class="cd-skill">{{.}}</span>{{/skills}}
            </div>
            <div style="margin-top:12px;padding:12px;border-radius:10px;background:linear-gradient(to right,rgba(238,242,255,0.6),#fff);border:1px solid #e0e7ff;">
              <div style="display:flex;align-items:center;gap:4px;margin-bottom:4px;"><i class="ri-star-fill" style="color:#f59e0b;font-size:12px;"></i><span style="font-size:12px;font-weight:600;color:#374151;">核心优势</span></div>
              <p style="font-size:12px;color:#374151;">{{coreStrengths}}</p>
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px;">
              <div class="cd-intention" style="background:{{intentionBg}};color:{{intentionColor}};border:1px solid {{intentionBorder}};">
                <i class="ri-fire-line"></i> {{intention.label}} · {{intention.levelText}}
              </div>
              {{#salary}}<div style="font-size:13px;font-weight:600;color:#111827;">💰 {{salary}}</div>{{/salary}}
            </div>
            {{#motivation}}<p style="font-size:11px;color:#9ca3af;margin-top:8px;">{{motivation}}</p>{{/motivation}}
          </div>{{/candidateProfiles}}
        </div>
      </div>
    </div>
  </div>
  {{/candidateProfiles.length}}

  <!-- 板块四：洞察与建议 -->
  {{#hasInsights}}
  <div class="section">
    <div class="section-title">
      <div class="icon" style="background:#fff1f2;color:#f43f5e;"><i class="ri-lightbulb-line"></i></div>
      <div><h2>板块四 · 洞察与招聘建议</h2><p>人才流向、技能缺口、策略建议与风险评估</p></div>
    </div>

    <div class="insight-grid">
      <!-- 人才流向 -->
      <div class="insight-card">
        <h4 style="display:flex;align-items:center;gap:8px;margin-bottom:16px;font-size:15px;"><i class="ri-flow-chart" style="color:#6366f1;"></i>人才流向</h4>
        {{#talentFlow}}<div class="risk-item">
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <span style="font-size:14px;font-weight:600;">{{from}} <span style="color:#9ca3af;margin:0 4px;">→</span> {{to}}</span>
            <span style="font-weight:700;color:#6366f1;">{{count}}人 <span style="font-size:11px;color:{{trendColor}};">{{trendArrow}}</span></span>
          </div>
        </div>{{/talentFlow}}
        {{#hasNetFlow}}
        <div style="margin-top:16px;">
          <h5 style="font-size:13px;font-weight:600;margin-bottom:12px;">净流入统计</h5>
          {{#netFlow}}<div class="risk-item" style="display:flex;align-items:center;justify-content:space-between;">
            <span style="font-weight:600;font-size:14px;">{{company}}</span>
            <div style="display:flex;gap:12px;font-size:12px;">
              <span style="color:#10b981;">流入 +{{inflow}}</span>
              <span style="color:#ef4444;">流出 -{{outflow}}</span>
              <span style="font-weight:700;color:{{netColor}};">净 {{net}}</span>
            </div>
          </div>{{/netFlow}}
        </div>
        {{/hasNetFlow}}
      </div>

      <!-- 技能缺口 -->
      <div class="insight-card">
        <h4 style="display:flex;align-items:center;gap:8px;margin-bottom:16px;font-size:15px;"><i class="ri-radar-line" style="color:#10b981;"></i>技能供需缺口</h4>
        {{#coreSkills}}
        <div class="risk-item">
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <span style="font-weight:600;font-size:14px;">{{name}}</span>
            <span style="font-size:12px;color:{{gapColor}};">缺 {{gap}}（需求{{demand}} vs 供给{{supply}}）</span>
          </div>
          <div style="width:100%;height:6px;background:#e5e7eb;border-radius:9999px;margin-top:8px;overflow:hidden;">
            <div style="height:100%;border-radius:9999px;background:{{gapColor}};width:{{demand}}%;"></div>
          </div>
        </div>
        {{/coreSkills}}
        {{#hasEmergingSkills}}
        <h5 style="font-size:13px;font-weight:600;margin:16px 0 12px;">🔥 新兴技能</h5>
        {{#emergingSkills}}<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <span style="font-size:13px;">{{name}}</span>
          <div style="display:flex;gap:8px;font-size:11px;">
            <span style="color:#6366f1;">热度 {{heat}}</span>
            <span style="color:#10b981;">+{{growth}}%</span>
          </div>
        </div>{{/emergingSkills}}
        {{/hasEmergingSkills}}
      </div>
    </div>

    <!-- 招聘策略 -->
    {{#recruitingStrategies}}
    <div class="collapse-card" style="margin-top:16px;">
      <div class="collapse-header" onclick="toggleCollapse(this)">
        <h4 style="font-size:15px;font-weight:700;display:flex;align-items:center;gap:8px;">
          <i class="{{icon}}" style="color:{{color}};"></i>{{category}}
        </h4>
        <i class="ri-arrow-down-s-line" style="font-size:22px;color:#9ca3af;"></i>
      </div>
      <div class="collapse-body">
        {{#items}}<div class="strategy-item">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
            <span style="font-weight:600;font-size:14px;">{{title}}</span>
            <span class="si-priority tag-{{priorityClass}}">{{priority}}</span>
          </div>
          <p style="font-size:12px;color:#6b7280;line-height:1.6;">{{desc}}</p>
          <p style="font-size:11px;color:#6366f1;margin-top:4px;"><i class="ri-arrow-right-line"></i> 预期影响：{{impact}}</p>
        </div>{{/items}}
      </div>
    </div>
    {{/recruitingStrategies}}

    <!-- 风险评估 -->
    {{#riskAssessment.length}}
    <div class="collapse-card" style="margin-top:16px;">
      <div class="collapse-header" onclick="toggleCollapse(this)">
        <h4 style="font-size:15px;font-weight:700;display:flex;align-items:center;gap:8px;"><i class="ri-shield-flash-line" style="color:#f43f5e;"></i>风险评估</h4>
        <i class="ri-arrow-down-s-line" style="font-size:22px;color:#9ca3af;"></i>
      </div>
      <div class="collapse-body">
        {{#riskAssessment}}<div class="risk-item" style="display:grid;grid-template-columns:1fr auto;gap:12px;">
          <div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
              <span style="font-weight:600;font-size:14px;">{{risk}}</span>
              <span class="tag tag-{{riskLevelClass}}">{{levelText}} · {{probability}}%概率</span>
            </div>
            <p style="font-size:12px;color:#6b7280;">影响：{{impact}}</p>
            <p style="font-size:12px;color:#6366f1;margin-top:4px;"><i class="ri-shield-check-line"></i> 应对：{{mitigation}}</p>
          </div>
        </div>{{/riskAssessment}}
      </div>
    </div>
    {{/riskAssessment.length}}
  </div>
  {{/hasInsights}}

  <!-- AI 综合研判 -->
  <div class="ai-summary">
    <h2><i class="ri-sparkling-2-line"></i> AI 综合研判</h2>
    <div class="ai-grid">
      <div>
        <h4>📊 市场现状</h4>
        <ul style="list-style:none;padding:0;">
          <li>• 总人才池规模约 <strong>{{summary.totalTalentPool}}</strong> 人，同比增长 <strong>{{summary.talentGrowthYoY}}%</strong></li>
          <li>• 活跃人才 <strong>{{summary.activeTalent}}</strong> 人</li>
          <li>• 供需比为 <strong>{{summary.supplyDemandRatio}}</strong>，{{supplyJudgment}}</li>
        </ul>
      </div>
      <div>
        <h4>🎯 核心建议</h4>
        <ul style="list-style:none;padding:0;">
          <li>• 薪酬策略应瞄准市场 P75 水平，配合 RSU/签字费增强竞争力</li>
          <li>• 对 TOP 候选人启用 VP/TL 亲自面试 + 越级职级的吸引方案</li>
          <li>• 加大内推渠道投入，升级猎头战略合作覆盖核心对标公司</li>
        </ul>
      </div>
    </div>
  </div>

  <!-- 页脚 -->
  <div class="report-footer">
    <p>本报告由 AI 自动生成，数据来源：公开渠道 + 内部简历库 | <i class="ri-time-line"></i> 生成时间：{{date}}</p>
  </div>
</div>

<script>
function toggleCollapse(header) {
  var body = header.nextElementSibling;
  var arrow = header.querySelector('[class*="arrow"]');
  if (!body) return;
  if (body.style.maxHeight && body.style.maxHeight !== '0px' && body.style.maxHeight !== 'none') {
    body.style.maxHeight = '0px';
    body.style.opacity = '0';
    if (arrow) arrow.style.transform = 'rotate(0deg)';
  } else {
    body.style.maxHeight = body.scrollHeight + 'px';
    body.style.opacity = '1';
    if (arrow) arrow.style.transform = 'rotate(180deg)';
  }
}
</script>
</body>
</html>
