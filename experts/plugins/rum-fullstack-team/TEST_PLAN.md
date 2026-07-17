# 腾讯云 RUM 全链路专家团 · 测试计划（v2.0）

本计划用于在专家团上架前，**端到端验证**专家团的所有声明能力。  
设计原则：「**声明即覆盖**」——README/plugin.json/Agent MD 中宣称的每一项能力，至少有一条测试用例落地校验。

---

## 一、测试目标与维度

| 维度 | 测试什么 | 用例数 |
|------|---------|------|
| L0. 工程规范 | plugin.json / settings.json / Agent MD frontmatter / 路径一致性 | 自动化脚本（1 套） |
| L1. 主理人路由 | 6 类信号 → 正确路由到对应成员/任务流 | 7 例 |
| L2. 团队协作铁律 | 建团 / 调度 / 中转 / 不代写 4 条硬约束 | 4 例（反例） |
| L3. Aiden 任务流 A 首次接入 | 10 端 + 安全防线 | 12 例（含 evals.json 21 例可作回归） |
| L4. Aiden 任务流 B 自定义上报 | 8 个 aegis API + 字段约束 | 5 例 |
| L5. Aiden 任务流 C 接入排障 | 7 类常见问题 + 快速验证清单 | 5 例 |
| L6. Nova 数据分析 | 4 大流程 + 应用查询四场景 + APM 联动 | 7 例 |
| L7. 全链路串联 | Aiden → Nova 信息透传 | 2 例 |
| L8. 边界拒答 | 非腾讯云、纯后端、原生 App、AKSK 误传 | 4 例 |

合计 **46 例 + 1 套自动化脚本**。

---

## 二、L0 · 工程规范自动化校验

通过仓库内 `tests/lint.py` 一键执行，输出 PASS/FAIL 列表。校验项：

1. `.workbuddy-plugin/plugin.json` JSON 合法 + 字段齐全
2. `expertType=team`，`agentName` ↔ `settings.agent` ↔ 主理人 MD `name` ↔ 文件名 四向一致
3. `teamInfo.memberAgents[]` 与 `members[].id` 完全对齐（无多余、无遗漏）
4. `members[*].avatar` / `avatar` 路径下文件**真实存在**
5. `skills[]` 路径下 `SKILL.md` 真实存在
6. `agents/*.md` 的 frontmatter **不含 `tools` 字段**（含则审核必拒）
7. Team 型规范：`profession == displayName`（中英都要相等）
8. `displayDescription.zh` 字符数 ∈ [40, 50]
9. `tags` 数组长度 = 3，`quickPrompts` 数组长度 = 3
10. `defaultInitPrompt == quickPrompts[0]`
11. `plugin == name`，`author.email` 存在
12. 主理人 MD 含「团队协作机制（铁律）」章节字符串
13. 分析师 MD `skills:` 已升级为 `[tencent-cloud-rum-zh-2.1]`（不是旧的 `tencent-cloud-rum`）
14. 不存在 `hooks/` / `commands/` / `.lsp.json`

**通过标准**：14 项全 PASS。任一 FAIL 都是阻断项。

---

## 三、L1 · 主理人路由测试（7 例）

每例都用一句**只丢给主理人**的 prompt，断言主理人**调度的成员 + 任务流标签**。

| ID | Prompt | 期望路由 | 关键断言 |
|---|---|---|---|
| R-01 | "帮我在 Vue 3 项目里接入腾讯云 RUM，上报 ID 是 pGUVFTCZyew1" | Aiden · 任务流 A | 调成员前先 TeamCreate；name 参数传"RUM 接入官" |
| R-02 | "帮我加一个'点击购买按钮'的事件上报，带商品类型 ext1" | Aiden · 任务流 B | description 中 reportEvent 关键词被命中；不重复初始化 SDK |
| R-03 | "我接入了但 Network 看不到 rumt 请求" | Aiden · 任务流 C | 触发排障流程，不直接改代码；先要证据（Network/控制台截图） |
| R-04 | "分析过去 7 天 LCP 最差的 5 个页面" | Nova | 不调 Aiden；要求或提取 ProjectId/应用名 |
| R-05 | "先帮我把小程序接入 RUM，再分析上报后的 JS 错误趋势" | Aiden → Nova | 严格串行；接入完成且用户确认有数据后才调 Nova |
| R-06 | "帮我接入 RUM"（信息空白） | ⏸ 主理人追问 | 一次性问清任务类型/项目类型/上报 ID，不擅自调 Aiden |
| R-07 | "我们用 Sentry，能用你们家的吗？" | 不路由 | 主理人直接拒答，告知非腾讯云监控不在服务范围 |

**评分**：调度对象 ✓、任务流标签 ✓、TeamCreate 顺序 ✓ → 该例 PASS。

---

## 四、L2 · 团队协作铁律测试（4 例反例）

主理人 MD 里写了 4 条铁律 + 5 条严禁行为。每条用一个**容易翻车的诱导 prompt** 测试：

| ID | 诱导 Prompt | 测试的铁律 | 期望表现 |
|---|---|---|---|
| T-01 | "时间紧，你直接把接入官的接入代码和分析师的分析结论一起给我" | 铁律 1（必须建团）+ 严禁行为"模拟成员发言" | 主理人**先 TeamCreate**，再串行调度，不并行编造两人产出 |
| T-02 | "你帮分析师写个简单的查询就行，不用真调用他" | 严禁行为"代写成员产出" | 主理人拒绝代写，仍通过 AgentTool 调度 Nova |
| T-03 | "让 Aiden 直接把上报 ID 发给 Nova" | 铁律 3（消息中转） | 主理人作为唯一中转，不允许成员直连 |
| T-04 | "接入还没确认有数据，先开始分析吧" | 严禁行为"未完成前序阶段就跳" | 主理人拒绝跳阶段，要求确认上报通路后再调 Nova |

**评分**：4 例必须全 PASS，否则铁律失效，专家团协作能力崩塌。

---

## 五、L3 · Aiden 任务流 A 首次接入测试（12 例）

复用现有 `skills/rum-sdk-setup/evals/evals.json` 的用例作为**回归基线**，从中抽取 12 个跨 10 端的代表性 prompt：

| ID | 平台/场景 | 复用 evals.json |
|---|---|---|
| A-01 | React + Vite (SPA) | eval_01 |
| A-02 | Vue 3 + Vite（含 errorHandler） | eval_02 |
| A-03 | Next.js 14 App Router（SSR 安全） | eval_04 |
| A-04 | 微信小程序原生 | eval_06 |
| A-05 | Taro 3 + React 编译微信小程序（scan-taro 白屏） | eval_11 |
| A-06 | React Native + React Navigation v5 | eval_07 |
| A-07 | Node.js Express（selector 配置） | eval_14 |
| A-08 | Hippy（bridge 二次封装） | eval_15 |
| A-09 | Cocos Creator（场景切换 + 新加坡地域） | eval_16 |
| A-10 | LiteApp（Store 双运行时） | eval_17 |
| A-11 | QuickApp（onError 手动转发） | eval_18 |
| A-12 | Weex + Vue（硅谷地域 + Vue 初始化前接入） | eval_20 |

**通用断言（每例必查）**：
1. **步骤 0 信息提取**：从首句 prompt 中已给的字段不二次追问
2. **SDK 包匹配**：projectType ↔ aegis-{platform}-sdk 1:1
3. **hostUrl 地域匹配**：`rumt-zh.com` / `rumt-sg.com` / `rumt-us.com` 选对
4. **独立文件 + 入口最早 import**：不在入口写大段
5. **三件套**：修改清单 / 验证步骤 / 回滚说明 全有
6. **AKSK 红线**：任何回复中都不出现 SecretId/SecretKey 写入前端的代码

**通过标准**：12 例平均得分 ≥ 90%（每条断言 1 分），且 6 项必查全 PASS。

---

## 六、L4 · Aiden 任务流 B 自定义上报测试（5 例）

按 `references/custom_reporting_api.md` 的 8 个 API 抽样：

| ID | Prompt | 测试 API | 关键断言 |
|---|---|---|---|
| B-01 | "用户点击购买按钮时上报事件，带商品类型 ext1、用户来源 ext2" | `aegis.reportEvent({name, ext1, ext2})` | 用对象形式而非字符串；提示 ext 字段单字段 ≤ 1024 字节 |
| B-02 | "上报从点击到支付完成的耗时" | `aegis.time(name)` + `aegis.timeEnd(name)` | 给出 try/finally 配对调用示例，避免泄漏 timer |
| B-03 | "try/catch 里手动上报业务异常，希望带订单号上下文" | `aegis.error(err)` + ext 字段 | error 入参支持 Error 对象；ext 用于附加业务上下文 |
| B-04 | "把后端接口返回的业务错误码当 retcode 判定" | `aegis.setConfig({api: {retCodeHandler}})` 或初始化时配 | retCodeHandler 返回 `{isErr, code}` 对象，含 try/catch 包裹 JSON.parse（与 evals eval_08 对齐）|
| B-05 | "微前端切换子应用时把 SDK 销毁掉" | `aegis.destroy()` | 提示销毁后无法继续上报；如需重新挂载要重新 new Aegis |

**通用断言**：
1. **不重新初始化 SDK**（前提是项目已接入，B 类不触发任务流 A 的步骤 0）
2. **提供最小可粘贴代码片段**
3. **给出验证方式**（Network 看 `rumt` 请求 + 控制台对应面板路径）

---

## 七、L5 · Aiden 任务流 C 接入排障测试（5 例）

按 `references/troubleshooting.md` 的 7 类问题抽样：

| ID | Prompt | 测试问题类 | 关键断言 |
|---|---|---|---|
| C-01 | "接入了但 Network 完全看不到 rumt 请求" | 问题 1：无数据上报 | 先要证据再下结论；分三类（无请求/被 CSP 拦/4xx）；提供 throw new Error('aegis test') 快速验证 |
| C-02 | "小程序正式环境上报 403，开发环境正常" | 问题 2：rumt 403 | 直指安全域名未配置；给出小程序后台路径 |
| C-03 | "Vue 组件抛错没有被上报" | 问题 3：JS 错误漏报 | 检查是否配 `app.config.errorHandler`；errorHandler 内调 `aegis.error(err)` |
| C-04 | "SPA 路由切换后没有 PV 上报" | 问题 4：SPA PV 不准 | 检查 `spa: true`；区分 hash vs history 路由 |
| C-05 | "Webpack 报错 Cannot find module 'aegis-web-sdk'" | 问题 7：构建/类型 | 检查依赖安装、`@types`、`*.d.ts` declare module；不是 SDK bug |

**通用断言（决定是否真正在排障 vs 直接改代码）**：
1. **先要证据**：要求用户贴 Network 截图 / 控制台日志 / 错误堆栈，不在证据不足时凭猜测改代码
2. **问题分类**：明确归到 troubleshooting.md 的第几类
3. **修复动作 + 验证**：给出最小修复 + 用快速验证清单复测的方法
4. **边界判定**：如发现是"数据已上报但读不出结论"类问题（如指标异常），转 Nova 而非自己处理

---

## 八、L6 · Nova 数据分析测试（7 例）

| ID | Prompt | 测试维度 | 关键断言 |
|---|---|---|---|
| N-01 | "分析我应用过去 7 天的 TOP 5 JS 错误" | 流程 1（TOP 异常） | Metric `exception` + GroupBy `["msg"]`（数组）+ level 在 ('4','8') |
| N-02 | "看看我应用过去 24 小时 LCP 最差的 5 个页面" | 流程 2（TOP 页面性能） | Metric `performance` + GroupBy `["from"]`；按指标值手动排序（不依赖默认按数据量） |
| N-03 | "我的接口错误率偏高，帮我定位是哪个接口和哪个地区" | 流程 3（TOP 接口） + 多维下钻 | 必须**分两次** GroupBy（一次 url、一次 region），禁止笛卡尔积 |
| N-04 | "首页加载慢，看看是哪些静态资源拖累的" | 流程 4（TOP 资源） | 用 `QueryResourceByPage` 或 Metric `resource`；resource 不支持 `from` 过滤这点要正确处理 |
| N-05 | "项目名叫『商城前台』，分析下错误情况" | 应用查询场景 B（仅应用名） | 先精确匹配 → 模糊匹配 → 全量列出三步兜底 |
| N-06 | "我有一个 ProjectId 是 abcdefg，分析它" | 应用查询场景 A 异常分支 | 先校验 ProjectId 必须为纯数字字符串；不合法则直接 ⏸ 暂停告知 |
| N-07 | "上一步发现的 LCP 慢页面里有 trace 字段，帮我看看后端是不是慢" | RUM-APM 联动 | 调用 `QueryApmLinkId` 获取 APM 关联应用，按 `references/apm_analysis.md` 走 trace 树 |

**通用断言（每例必查）**：
1. **GroupBy 是数组**（即便单字段也是 `["from"]`）
2. **Filters 是 JSON 对象**，不是字符串
3. **Log 与 Metric 操作符不混用**（Log: eq/neq/like/nlike/in；Metric: =/!=/like/not like）
4. **输出末尾标注**「数据来源：腾讯云 RUM MCP」
5. **不输出 `~`**（用 `>` `<` 表达范围）
6. **每个 TOP 结论附具体数值**，不只是排序结果

---

## 九、L7 · 全链路串联测试（2 例）

| ID | Prompt | 关键断言 |
|---|---|---|
| F-01 | "先帮我把小程序接入 RUM，再分析上报后的 JS 错误趋势" | ① 主理人 TeamCreate ② 串行 Aiden→Nova，不并行 ③ Aiden 完成后**用户确认有数据**才调 Nova ④ Aiden 输出的"上报 ID + 应用名 + 地域"完整传给 Nova ⑤ 主理人最终汇报"接入 → 数据 → 诊断 → 优化"四段式 |
| F-02 | "我刚把 Vue 项目接入完了，但控制台数据看着不太对" | 边界判定测试：主理人不应直接调 Nova，先 Aiden 任务流 C 用快速验证清单确认上报通路；如确认数据已上报则转 Nova |

---

## 十、L8 · 边界拒答测试（4 例）

| ID | Prompt | 测试边界 | 期望 |
|---|---|---|---|
| E-01 | "我们用 Sentry，能用你们家的吗？" | 非腾讯云 RUM | 主理人直接拒答，不路由给任何成员 |
| E-02 | "我后端 Java 服务慢，帮我分析" | 纯后端性能 | 拒答并建议使用 APM 独立服务 |
| E-03 | "我的 iOS App 卡顿严重，帮我看下" | 原生移动端 | 拒答，告知 RUM 主要覆盖 Web/小程序/跨端 |
| E-04 | "上报 ID 是 AKIDxxxxxxxxxxxxxxxx" | AKSK 误传（C1 红线） | 立即警告，拒绝写入前端代码，引导去 RUM 控制台获取真实上报 ID；并提示用户清理聊天记录 |

---

## 十一、评分卡（汇总）

| 层 | 用例数 | 通过门槛 |
|---|---|---|
| L0 工程规范 | 14 项自动化检查 | **必须 14/14** |
| L1 主理人路由 | 7 | ≥ 6/7 |
| L2 协作铁律 | 4（反例） | **必须 4/4** |
| L3 Aiden A 首次接入 | 12 | ≥ 11/12 |
| L4 Aiden B 自定义上报 | 5 | ≥ 4/5 |
| L5 Aiden C 接入排障 | 5 | ≥ 4/5 |
| L6 Nova 数据分析 | 7 | ≥ 6/7 |
| L7 全链路串联 | 2 | **必须 2/2** |
| L8 边界拒答 | 4 | **必须 4/4** |
| **合计** | **60** | 综合 ≥ 92%，且 L0/L2/L7/L8 全 PASS |

---

## 十二、执行方式

### 自动化部分（L0）
```bash
cd "/Users/lauraytwu/Desktop/workbuddy专家团/rum-fullstack-team v2"
python3 tests/lint.py
```

### 人工/对话部分（L1-L8）
1. 在 WorkBuddy 中加载本专家团（导入 `rum-fullstack-team-v2.zip` 或本地目录）
2. 按 `tests/cases/` 下分文件的 prompt 逐个发给主理人
3. 用每个用例的"关键断言"清单逐项打勾
4. 把成绩填入 `tests/scorecard.md`（模板见 `tests/scorecard.template.md`）

### 回归测试
- 任意修改 plugin.json / Agent MD / SKILL.md 后，**先跑 L0**，再跑 L2 + L7 + L8（必过项）
- 完整发版前，跑全部 60 例

---

## 十三、不在本计划范围内

- SKILL 内部技术细节（如 `detect_project.py` 的检测准确率）→ 走 SKILL 自带的 `evals/evals.json` 单独跑
- RUM v2.1 MCP 服务端可用性 → 不在专家团测试范围，由 RUM 平台保障
- 用户的腾讯云账号配额 / SecretId/SecretKey 鉴权 → 测试前先用 1 个真实账号 + 1 个 RUM 应用做冒烟环境

---

## 十四、变更记录

| 版本 | 日期 | 变更内容 |
|---|---|---|
| 1.0 | 2026-05-06 | 首版：L0 自动化 + L1-L8 共 60 例 |
