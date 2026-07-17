# 画像更新 — 信号检测规则

## 高置信度信号（立即更新）

- 用户明确表达兴趣："我最近在学 Rust"、"我开始关注量化交易了"
- 用户透露身份/状态变化："我跳槽到金融行业了"、"我搬到杭州了"
- 用户主动要求："帮我多关注新能源"、"以后别推区块链了"

**操作：** 立即执行 `--update-profile --add`

## 中置信度信号（观察，不立即更新）

- 讨论新闻时顺带提及某领域，但未明确表达持续兴趣
- 问了一个领域的问题但目的不明："量化交易是什么？"

**规则：** 同一领域在 2 轮以上对话中被提及，才升级为高置信度并触发更新

## 低置信度信号（不更新或特殊处理）

| 信号 | 操作 |
|------|------|
| 强烈否定："区块链都是骗人的" | `action: "remove"` |
| 犹豫/放弃："Rust太难了放弃了" | `action: "skeptical"`（降权不删除） |
| 复述新闻关键词 | 不操作 |
| 说的是别人的情况："我朋友在做量化" | 不操作 |

## 更新命令

```bash
# 添加兴趣
node {SKILL_DIR}/scripts/news-buddy.cjs --update-profile --add '{"field":"hard_interests","value":"量化交易"}'

# 标记怀疑态度
node {SKILL_DIR}/scripts/news-buddy.cjs --update-profile --add '{"field":"hard_interests","value":"Rust","action":"skeptical"}'

# 移除兴趣
node {SKILL_DIR}/scripts/news-buddy.cjs --update-profile --add '{"field":"hard_interests","value":"区块链","action":"remove"}'

# 写入观察备忘
node {SKILL_DIR}/scripts/news-buddy.cjs --update-profile --add '{"field":"notes","value":"用户倾向于看深度长文"}'
```

## 支持更新的字段

- `hard_interests` / `soft_interests` / `core_risk_avoidance` — 支持 add/remove/skeptical
- `notes` — 支持 append/replace/remove（上限2000字符，§分隔）
- `industry_bg` / `life_stage` / `city_tier` — 跳槽/搬家时更新

## 消费信号（即时 boost，区别于画像更新）

消费信号和画像更新是两条独立通道：

| 信号类型 | 触发场景 | 命令 | 幅度 |
|----------|----------|------|------|
| 消费信号 | 用户展开某条新闻 / 追问 / 讨论 | `--boost-dimension --dim "维度"` | +0.15 |
| 画像信号 | 用户表达兴趣偏好/身份变化 | `--update-profile --add ...` | +0.3 |

**消费信号触发规则：**

| 用户行为 | 操作 |
|----------|------|
| "展开第3条"、"详细说说"、"那条怎么回事" | boost 该条的 dimension |
| 对某条追问/发表看法 | 识别指代条目 → boost 其 dimension |
| 默读不说话（无交互） | 不做任何 boost |
| "换一批"、"不感兴趣" | 不 boost 当前批次 |

**幂等保护：** 同一 dimension 当天只 boost 一次，不用担心重复。

```bash
# 消费信号 boost
node {SKILL_DIR}/scripts/news-buddy.cjs --boost-dimension --dim "AI与大模型"
```

## 关键原则

- 画像更新时**不要告知用户**，后台静默执行
- skeptical 的兴趣不参与搜索维度推断，但保留在画像中
- 重复添加同一兴趣不会重复，而是自动提升权重
- 消费 boost 和画像更新互不冲突，可以同时触发（如用户追问某条新闻时既 boost dimension 又检测到新兴趣）
