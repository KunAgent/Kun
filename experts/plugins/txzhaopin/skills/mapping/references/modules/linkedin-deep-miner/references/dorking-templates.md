# LinkedIn Dorking 查询模板库（金融行业）

> 本文档定义所有 LinkedIn 公开搜索的查询模板。  
> 在 Stage 2（查询展开）阶段，根据 MiningTask 的字段填充模板生成具体 query。  
> 所有 query 都通过 `web_search` 工具发起，不需要登录 LinkedIn。

---

## 一、占位符约定

| 占位符 | 含义 | 示例值 |
|--------|------|--------|
| `{COMPANY}` | 公司名（含别名变体） | `"Goldman Sachs"`, `"高盛"`, `"GS"` |
| `{DEPT}` | 部门关键词 | `"TMT"`, `"Technology"`, `"Tech, Media & Telecom"` |
| `{LEVEL}` | 职级关键词 | `"Managing Director"`, `"MD"`, `"董事总经理"` |
| `{LOCATION}` | 地域关键词 | `"Hong Kong"`, `"HK"`, `"香港"` |
| `{SCHOOL}` | 学校（校友策略） | `"LSE"`, `"HKU"`, `"Wharton"`, `"清华"` |
| `{DEAL_TYPE}` | 交易类型 | `"IPO"`, `"M&A"`, `"follow-on"` |

---

## 二、5 大策略模板

### 策略 A：基础职级矩阵（**P0 必跑**）

**适用**：所有金融岗位的目标人才挖掘。

**模板**：
```
T-A-1: site:linkedin.com/in "{COMPANY}" "{DEPT}" "{LEVEL}" "{LOCATION}"
T-A-2: site:linkedin.com/in "{COMPANY}" "{LEVEL}" "{LOCATION}"
T-A-3: site:linkedin.com/in "{COMPANY}" "{DEPT}" "{LEVEL}"
T-A-4: "{COMPANY}" "{DEPT}" "{LEVEL}" linkedin
```

**示例**（GS 香港 TMT MD）：
```
1. site:linkedin.com/in "Goldman Sachs" "TMT" "Managing Director" "Hong Kong"
2. site:linkedin.com/in "Goldman Sachs" "Managing Director" "Hong Kong"
3. site:linkedin.com/in "Goldman Sachs" "Technology, Media" "MD"
4. "高盛" "TMT" "董事总经理" linkedin
```

**预期**：每个 query 5-15 个候选人，去重后约 8-12 人。

---

### 策略 B：项目反查（**投行 P0 推荐**）

**适用**：投行 IBD 业务，从公开 deal 反查参与团队。

**模板**：
```
T-B-1: site:linkedin.com/in "{COMPANY}" "advised" "{DEAL_TYPE}"
T-B-2: site:linkedin.com/in "{COMPANY}" "joint global coordinator" "{LOCATION}"
T-B-3: site:linkedin.com/in "{COMPANY}" "lead manager" "{DEAL_TYPE}"
T-B-4: site:linkedin.com/in "{COMPANY}" "executed" "transaction"
T-B-5: site:linkedin.com/in "{COMPANY}" "led IPO of"
```

**示例**（GS 香港 TMT IPO 项目）：
```
1. site:linkedin.com/in "Goldman Sachs" "advised" "IPO" "Hong Kong"
2. site:linkedin.com/in "Goldman Sachs" "joint global coordinator" "Hong Kong"
3. site:linkedin.com/in "Goldman Sachs" "led IPO of"
```

**预期**：能挖到那些 LinkedIn profile 不挂明显职级、但写了"参与过 XX 项目"的 banker。

---

### 策略 C：校友网络（**水下人选 P0**）

**适用**：当已知种子候选人的教育背景时，反查同校同公司的水下人选。

**模板**：
```
T-C-1: site:linkedin.com/in "{COMPANY}" "{LOCATION}" "{SCHOOL}"
T-C-2: site:linkedin.com/in "{COMPANY}" "{SCHOOL}" "{LEVEL}"
```

**金融行业重点学校清单**：

| 类别 | 学校 |
|------|------|
| **欧美 Top** | LSE, Oxford, Cambridge, Wharton, Harvard, Stanford, MIT, Columbia, NYU Stern, Chicago Booth, Kellogg, Insead |
| **HK Top** | HKU (港大), CUHK (中大), HKUST (科大) |
| **中国 Top** | 北大 / Peking University, 清华 / Tsinghua, 上交 / SJTU, 复旦 / Fudan, 人大, 中欧 |
| **新加坡** | NUS, NTU |

**示例**（GS HK + LSE 校友交叉）：
```
1. site:linkedin.com/in "Goldman Sachs" "Hong Kong" "LSE"
2. site:linkedin.com/in "Goldman Sachs" "London School of Economics" "Hong Kong"
```

---

### 策略 D：跳槽轨迹（前同事 P1）

**适用**：金融行业有典型跳槽链路（如 GS → MS → BAML），追踪可挖角人选。

**典型跳槽链**：
- 投行：**GS ↔ MS ↔ JPM ↔ BAML ↔ Citi**
- 中资投行：**中金 ↔ 中信 ↔ 华泰 ↔ 海通**
- PE：**KKR ↔ Carlyle ↔ Blackstone ↔ Bain**
- 一级市场互联网赛道：**红杉 ↔ 高瓴 ↔ 启明 ↔ 软银愿景**

**模板**：
```
T-D-1: site:linkedin.com/in "{PREV_COMPANY}" "{COMPANY}" "{LEVEL}"
T-D-2: site:linkedin.com/in "Previously at {PREV_COMPANY}" "{COMPANY}"
```

**示例**（从 Citi 跳槽到 GS 的 TMT MD）：
```
1. site:linkedin.com/in "Citi" "Goldman Sachs" "Managing Director" "TMT"
```

---

### 策略 E：时间过滤（验证在职 P1）

**适用**：Top 候选人的活跃度验证。

**机制**：在原 query 基础上追加 Google 时间过滤参数 `&tbs=qdr:m6`（近 6 个月）。

注：实际 web_search 工具可能不直接支持 tbs 参数，可在 query 中加入年份关键词作为替代：

**模板**：
```
T-E-1: site:linkedin.com/in "{COMPANY}" "{NAME}" 2026
T-E-2: site:linkedin.com/in "{COMPANY}" "{NAME}" "current"
T-E-3: site:linkedin.com/in "{COMPANY}" "{NAME}" "Present"
```

**示例**：
```
1. site:linkedin.com/in "Goldman Sachs" "David Hoyer" 2026
2. site:linkedin.com/in "Goldman Sachs" "David Hoyer" "Present"
```

如果近期没有命中 → 提示该候选人可能已离职，触发 `alumni-network-miner` 反查。

---

## 三、查询展开决策树

```
用户输入解析后的 MiningTask
        │
        ├─ 必跑：策略 A（4 个 query）
        │
        ├─ 投行场景？ → 加策略 B（5 个 query）
        │
        ├─ 已知种子候选人？ → 加策略 C（2 个 query/学校 × 主要学校）
        │
        ├─ 已知前公司？ → 加策略 D（2 个 query）
        │
        └─ Top 5 候选人（Stage 5）→ 加策略 E 验证（每人 2-3 个 query）
```

**Token 控制**：单次执行的 query 总数 ≤ 10（避免搜索成本爆炸）。

---

## 四、查询优化技巧

### 1. 公司名变体优先级
按命中率从高到低：
1. 英文全称（"Goldman Sachs"）
2. 英文简称（"Goldman"）— 谨慎使用，可能误命中其他公司
3. 中文（"高盛"）— 中国/香港 profile 必加
4. 缩写（"GS"）— 噪音大，仅在其他都无果时使用

### 2. 部门变体优先级
- 先用**机构内部说法**："TMT", "Technology Coverage"
- 再用**通用说法**："Technology", "Tech sector"
- 最后用**中文**："科技组", "TMT 组"

### 3. 职级变体陷阱
- "VP" 在投行/咨询/Tech 是不同层级，搜索时必须带行业上下文
- "Director" 在欧美投行 = 中层；在中资投行 = 高管；在咨询 = 合伙人候选
- 中文"总监"映射到英文要根据公司性质区分

### 4. 反爬规避
- **不要**短时间内对同一 LinkedIn URL 反复 fetch（Google 会限流）
- **建议**两次 web_search 之间间隔 1-2 秒
- 如遇验证码 → 切换到 Bing 搜索或暂停任务

---

## 五、失败兜底查询

当主查询返回结果过少（< 3）时，按以下顺序兜底：

```
1. 去掉地域约束 → 全球范围搜
2. 放宽职级 → 搜整个高层（"Managing Director" OR "Executive Director" OR "Partner"）
3. 不限定 site:linkedin.com/in，搜整个网络（可能命中公司官网/媒体报道）
4. 切换搜索引擎（Google → Bing）
```

**兜底标记**：兜底查询返回的候选人 confidence 自动 -0.2。
