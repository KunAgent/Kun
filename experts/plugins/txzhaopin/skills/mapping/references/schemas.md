# 各 Agent 输出 JSON Schema 字段中文释义

每个子 Agent 输出的 JSON 结构及各字段的中文含义、前端展示方式。

> 所有字段释义均以 `前端展示为...` 结尾，方便理解业务语义。

---

## 一、市场概览 (marketOverview)

```json
{
  "marketOverview": {
    "targetCompanies": [{
      "name": "公司名称，前端展示为卡片标题",
      "tier": "公司梯队：第一梯队|第二梯队，前端按此分组展示（第一梯队3列、第二梯队4列）",
      "talentCount": "该公司目标方向人才总数，前端大号数字展示",
      "activeCount": "近30天活跃看机会人数，前端绿色展示为'活跃人才'",
      "recentMoves": "近期人事/业务异动（裁员、扩招、高管变动），前端灰色小字",
      "hiringTrend": "招聘趋势：扩张→绿色标签|稳定→紫色标签|收缩→红色标签"
    }],
    "industryTrends": [{
      "icon": "【可选】趋势图标，Remix Icon 类名如'ri-rocket-line'，不填则默认折线图图标",
      "trend": "趋势标题，最长15字，前端加粗展示",
      "detail": "趋势详情，最长60字，前端灰色文本",
      "impact": "影响度：high→红色'高影响'|medium→黄色'中影响'|low→绿色'低影响'"
    }],
    "cityDistribution": [{
      "icon": "【可选】城市 emoji，如'🏙️'，不填则默认📍",
      "name": "城市名，如'北京'/'上海'/'深圳'",
      "count": "该城市人才总数，前端展示'XX人'",
      "ratio": "占全市场比例（纯数字），前端进度条+文字",
      "active": "该城市活跃人才数，前端绿色'活跃 XX人'"
    }],
    "summary": {
      "totalTalentPool": "人才池总规模，前端顶部指标卡'总人才池 XX人'",
      "activeTalent": "活跃人才总数，前端指标卡'活跃人才 XX人'",
      "talentGrowthYoY": "人才同比增长百分比，如24代表+24%，前端展示'+24% YoY'",
      "supplyDemandRatio": "供需比，如'0.56'或'1:3.2'，前端展示'供需比 0.56'"
    }
  }
}
```

---

## 二、组织架构 (orgStructure)

```json
{
  "orgStructure": [{
    "company": "公司名，前端树形架构图根节点标题",
    "leader": {
      "name": "技术方向最高负责人，前端根节点副行",
      "title": "职务，如'VP/技术负责人'，前端灰色文字",
      "scope": "管辖范围，如'技术研发线'，前端展示'管辖：XX'"
    },
    "departments": [{
      "name": "部门/团队名称，前端L1节点标题",
      "focus": "部门核心职能，最长30字，前端灰色文本",
      "headcount": "部门估计总编制，前端紫色胶囊'XX人'",
      "subTeams": ["下属子团队名称列表"],
      "openings": "当前在招岗位数，前端绿色胶囊'X个在招'",
      "growth": "团队人数增长百分比（可为负），正→绿色'↑12%'，负→红色'↓5%'",
      "keyRoles": ["关键岗位名称列表"],
      "teamInsight": {
        "coreResponsibilities": ["团队核心职责列表，前端带圆点逐条展示"],
        "currentFocus": "当前重点方向，最长60字，前端黄色背景卡片",
        "teamCulture": "团队文化描述，最长40字，前端绿色卡片",
        "keyChallenge": "招聘最大挑战，最长40字，前端红色卡片"
      },
      "projects": [{
        "name": "项目名称，前端L2节点标题",
        "headcount": "项目组人数，前端'XX人'",
        "techStack": "技术栈，逗号分隔，前端'技术栈：Flink, Go'",
        "status": "项目状态：进行中→绿|规划中→黄|已上线→紫",
        "keyPersonnel": [{
          "name": "核心骨干姓名，前端L3人物卡片（首字做圆形头像）",
          "title": "职位名称，前端灰色文字",
          "level": "职级：专家|资深|管理|高级，前端彩色胶囊",
          "isKeyPerson": "是否核心KP，true时前端皇冠图标",
          "skills": ["专业技能标签"],
          "focusWork": "当前主攻方向，最长40字"
        }]
      }]
    }],
    "levelMapping": [{
      "equivalent": "通用对标职级，如'P8'/'T3-3'，前端表格第一列",
      "level": "该公司内部职级，如'8级'/'T9'，前端按公司分列展示",
      "title": "典型职称，如'高级算法专家'/'技术总监'",
      "yearRange": "年限参考，如'8-12年'"
    }],
    "totalHeadcount": "该公司目标方向总编制，前端根节点右侧绿色指标",
    "keyPositions": [{
      "role": "关键岗位名称",
      "dept": "所属部门",
      "count": "岗位需求/存量人数",
      "importance": "重要程度：核心|重要|一般"
    }]
  }]
}
```

---

## 三、候选人画像 (candidateProfiles)

```json
{
  "candidateProfiles": [{
    "name": "候选人真实姓名，前端卡片标题+首字圆形头像",
    "company": "当前所在公司，前端'公司 · 职位'",
    "title": "当前职位，前端'公司 · 职位'",
    "experience": "总工作年限，如'6年'，前端'经验/司龄'行",
    "yearsInCompany": "在现公司年限，如'1年'，前端'在职1年'",
    "school": "毕业院校，前端学历行",
    "degree": "最高学历：本科|硕士|博士，前端'清华大学 · 硕士'",
    "skills": ["技能标签，前端紫色胶囊标签行"],
    "domain": ["业务领域标签，前端顿号连接"],
    "coreStrengths": "一句话核心优势，最长30字，前端星号图标+白色卡片",
    "intention": {
      "label": "跳槽意向：积极看机会|开放沟通|观望中",
      "level": "意向等级：high→绿|medium→紫|low→橙"
    },
    "motivation": "跳槽动机，最长40字，前端意向卡片补充文字",
    "matchScore": "匹配度 0-100，前端大号：≥90绿|≥80紫|<80橙",
    "active": "是否近期活跃，前端：true→'🟢活跃'|false→'⚪非活跃'",
    "salary": "当前/期望薪资，如'73K'，前端加粗"
  }]
}
```

---

## 四、洞察建议 (insights)

```json
{
  "insights": {
    "talentFlow": {
      "flowData": [{
        "from": "人才流出公司",
        "to": "人才流入公司",
        "count": "流动人数，前端桑基图/弦图渲染",
        "trend": "趋势：up→绿色↑|down→红色↓|stable→灰色→"
      }],
      "topFlows": "flowData中按count降序前6条，前端TOP流动排行榜",
      "netFlow": [{
        "company": "公司名",
        "inflow": "流入人才数，前端柱状图绿色柱",
        "outflow": "流出人才数，前端柱状图红色柱",
        "net": "净流入 = inflow - outflow，正绿负红"
      }]
    },
    "skillGap": {
      "coreSkills": [{
        "name": "核心技能名，前端雷达图维度标签",
        "demand": "需求热度 0-100，前端雷达图外圈(红色)",
        "supply": "供给充裕度 0-100，前端雷达图内圈(蓝色)",
        "gap": "供需缺口 = demand - supply"
      }],
      "emergingSkills": [{
        "name": "新兴热门技能名",
        "heat": "市场热度 0-100，前端渐变色进度条",
        "growth": "增长幅度%，如274→前端绿色'+274%'"
      }]
    },
    "recruitingStrategies": [{
      "icon": "【可选】Remix Icon 类名，如'ri-user-search-line'，不填则默认灯泡图标",
      "color": "【可选】主题色：primary(紫)|emerald(绿)|amber(橙)，不填默认紫色",
      "category": "策略分类：目标人才吸引策略|渠道触达策略|激励方案设计|流程优化建议",
      "items": [{
        "title": "策略标题，最长20字，前端加粗",
        "desc": "策略描述，最长80字，前端正文",
        "priority": "优先级：高→红色|中→橙色|低→绿色",
        "impact": "预期影响，最长30字，前端紫色带箭头"
      }]
    }],
    "riskAssessment": [{
      "risk": "风险名称，最长20字，前端加粗",
      "level": "风险等级：high→红色|medium→黄色|low→绿色",
      "probability": "发生概率 0-100（百分比整数），前端散点图X轴",
      "impact": "影响描述，最长40字",
      "mitigation": "应对措施，最长60字，前端紫色文本"
    }]
  }
}
```
