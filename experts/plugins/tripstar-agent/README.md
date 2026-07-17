# TripStar Agent · AI 旅行管家『路小鲜（Leo）』

> WorkBuddy 专家市场上架的 **Agent 型** 单专家。**9 大内置技能加持**，从"想出门"到"花得值"全流程托底的 AI 旅行管家。

---

## 一、专家简介

- **中文名**：路小鲜
- **英文名**：Leo
- **职业**：AI 旅行管家
- **名字寓意**：走过的"路"要有"小而新鲜"的体验——省心、不踩坑、花得值
- **定位**：帮用户摆脱"信息过载 + 决策疲劳"，几分钟交付一份可直接照着走的分日行程；并在真正要花钱/搜索/预订/追踪的节点，自动调用对应技能。
- **专家类型**：Agent 型（单专家 + 9 个技能）
- **分类**：12-IndustryConsultant（行业顾问 / 生活服务）

## 二、核心能力

| # | 能力 | 说明 | 背后技能 |
|---|------|------|---------|
| 1 | 行程规划 | 按目的地/天数/人数/预算/偏好输出分日行程 | （Agent 主体） |
| 2 | 景点精选 | 附预约提醒、最佳时段、耗时、避坑提示 | WebSearch + `flyai` |
| 3 | 酒店建议 | 2–3 档位，注明区位与适合人群 | `flyai`（国内外）、`airbnb`（民宿） |
| 4 | 天气 & 穿搭 | 当季气温/降水/必备物品 | WebFetch |
| 5 | 飞行气象 | METAR/TAF/PIREP/飞行类别（VFR/IFR） | `aviation-weather` |
| 6 | 城际交通 | 国内高铁/火车 + 国际机票 | `12306-train-assistant` + `flights-search` |
| 7 | 航班追踪 | 按区域/呼号/机场查实时飞行状态 | `flight-tracker` |
| 8 | 预算测算 | 门票/住宿/餐饮/交通分项拆解 | （Agent 主体） |
| 9 | 出境软信息 | 签证、货币、文化、紧急联系、隐秘景点 | `globepilot-ai-agent-2` |
| 10 | 行程记忆管理 | 愿望清单/预订/预算/打包清单持久化 | `travel-planning` |
| 11 | 优惠券赋能 | 餐饮/酒店/门票/外卖美团红包 | `meituan-coupon-workbuddy` |

## 三、目录结构

```
tripstar-agent/
├── .codebuddy-plugin/
│   └── plugin.json                  # 插件配置（含 agents、9 个 skills 声明）
├── agents/
│   └── trip-planner.md              # 专家 Agent 定义
├── skills/
│   ├── flyai/                       # 飞猪 MCP：机票/酒店/景点/签证/邮轮/万豪（Node.js）
│   ├── flights-search/              # Google Flights 国际机票比价（Python/uvx）
│   ├── 12306-train-assistant/       # 12306 全链路：余票/中转/候补/下单/支付（Python）
│   ├── airbnb/                      # Airbnb 民宿搜索（Python/uvx）
│   ├── flight-tracker/              # OpenSky 实时航班追踪 + 时刻表（Python）
│   ├── aviation-weather/            # METAR/TAF/PIREP 航空气象（Python）
│   ├── globepilot-ai-agent-2/       # 出境软信息：签证/货币/文化/紧急（WebFetch）
│   ├── travel-planning/             # 本地行程/预算/清单记忆（Read/Write only）
│   └── meituan-coupon-workbuddy/    # 美团红包助手（Python）
├── avatars/
│   └── expert.png                   # 专家头像 512×512
└── README.md
```

## 四、9 大技能路由表

| 触发场景 | 首选技能 | 是否需 API Key |
|---------|---------|---------------|
| "订酒店/查机票/买门票/查签证/邮轮"（自然语言，国内外） | `flyai` | 可选 |
| "NYC to LA 机票"/"国际线比价"/"直飞筛选" | `flights-search` | 不需要 |
| "北京到上海高铁余票"/"G1033 经停"/"候补" | `12306-train-assistant` | 不需要（登录才能下单） |
| "Airbnb 搜索"/"民宿"/"Superhost 房源" | `airbnb` | 不需要 |
| "瑞士上空有哪些飞机"/"AA100 飞到哪了" | `flight-tracker` | OpenSky 免费 |
| "KSMO 机场天气"/"METAR"/"TAF" | `aviation-weather` | 不需要 |
| "去日本要签证吗"/"欧元兑人民币"/"泰国紧急联系" | `globepilot-ai-agent-2` | 不需要 |
| "帮我记住下次要去冰岛"/"管理行程预算" | `travel-planning` | 不需要 |
| "帮我领美团红包"/"手头紧想省点" | `meituan-coupon-workbuddy` | 不需要（需用户登录美团） |

## 五、端到端流程

```
用户提需求
    ↓
Step 1 需求澄清（一次问清）
    ↓
Step 2 信息检索（优先技能 → 联网兜底）
    │   ├─ 国内机酒：flyai
    │   ├─ 国际机票：flights-search
    │   ├─ 国内高铁：12306-train-assistant
    │   ├─ 民宿：airbnb
    │   └─ 出境软信息：globepilot-ai-agent-2
    ↓
Step 3 方案生成（分日行程 + 预算 + 预约清单）
    ↓
Step 4 风险贴士（预约 / 物品 / 避坑 / App / 飞行气象）
    │   └─ 飞行天气：aviation-weather（仅 ICAO 场景）
    ↓
Step 5 省钱加成 → meituan-coupon-workbuddy
    ↓
Step 6 行程建档（可选）→ travel-planning
    ↓
Step 7 收尾互动（延伸问题 / 导出 / 微调）
    ↓
Step ∞ 航班动态监控（可选）→ flight-tracker
```

## 六、默认提示词

- `我想去北京玩3天，2个人，预算5000元，帮我规划一份完整行程`（默认启动语）
- `帮我规划一家三口云南5日游`
- `下个月上海飞东京最便宜的机票找一找`
- `帮我查明天北京到上海的高铁余票并下单`
- `4月去日本赏樱，7天行程怎么安排，顺便告诉我签证怎么办`

## 七、依赖运行时

不同技能依赖不同运行时，Agent 会按需触发：

| 运行时 | 相关技能 |
|-------|---------|
| `python3` | 12306-train-assistant、flight-tracker、aviation-weather、meituan-coupon-workbuddy |
| `uvx` / `uv` (Python uv 工具链) | airbnb、flights-search |
| `node` + `@fly-ai/flyai-cli` | flyai |
| `WebFetch` / `WebSearch` | globepilot-ai-agent-2、通用检索 |
| `Read` / `Write` | travel-planning（本地文件管理） |

首次使用某技能时，若运行时/依赖缺失，Agent 会给出对应的安装指引。

## 八、隐私与合规

- **不编造信息**：景点是否需要预约、具体票价，由技能返回或 WebSearch 查证
- **不询问敏感信息**：身份证、护照号、银行卡号 — 不问、不记录
- **美团登录**：严格按 `meituan-coupon-workbuddy/SKILL.md` 执行；登录由用户主动发起；不输出完整 token；手机号脱敏
- **12306 登录**：仅在用户明确要求"下单/支付/候补"时才触发 `login` 或 `qr-login-create`；查询无需登录

---

**一句话**：让用户出门前省心，出门时省钱，回来后还能把行程发给同行人。
