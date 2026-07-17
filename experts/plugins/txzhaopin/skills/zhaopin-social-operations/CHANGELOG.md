# 版本变更历史

本文件记录 `zhaopin-social-operations` skill 所有版本变更。最新版本号见 `SKILL.md` 的 frontmatter。

---

**v6.2.0 变更**（2026-05-19）：
- **`data/tier1-companies-by-domain.json` 下线**：原静态公司词典（16 个领域各 20 家头部公司，共 117 行 JSON）整体删除，公司清单改由 LLM 在阶段 1 基于用户画像（行业/岗位/技术栈）**现场生成**
- **新增"会话内唯一清单源"约定（方案 B）**：LLM 只在阶段 1 生成一次 tier1 公司清单并写入 `profile.bonus.tier1_companies`；阶段 2 公司锚定路的 `allCompany` 必须**原样照搬**该字段，禁止重新组织一份清单。粗筛 `rough_screen.py` 维度 2 加权读取的也是同一份 → 保证粗筛打分和搜索召回锚定的公司集合完全一致
- **新增 7 条 LLM 生成公司清单的硬约束**（SKILL.md 阶段 2 公司锚定路一节）：数量 10-20 家、腾讯 ATS 规范名、真实存在仍运营、综合大厂与行业垂类合理搭配、行业垂类 ≥ 5 家、生成前自检"ATS 是否搜得到"、同会话只生成一次
- **影响范围**：
  - 文档：SKILL.md（+18 行约束 / -1 行 JSON 引用 / -1 行目录树）、step1-profile-template.md（+23 行一致性约束段 / 替换 1 行白名单表）、step2-search-templates.md（替换 3 行 + 新增 4 行复用规则）
  - 数据：删除 `data/tier1-companies-by-domain.json`（-117 行，-4.84 KB）
  - 脚本：**零改动**（`social_search.py` / `rough_screen.py` / `deep_read.py` / `mcp_client.py` 从未读 JSON 词典，本次也无需调整）
- **动机**：
  1. 移除人工维护成本（原 JSON 每年需更新独角兽新进场/老公司倒闭/改名）
  2. 自然覆盖冷门垂类（机器人/具身智能/储能/AI 制药等原 JSON 没列的领域，LLM 知识自动跟进）
  3. Skill 体积减少 4.84 KB
- **向前兼容**：旧版生成的 `profile.json` / `search_params.json` 文件结构完全不变，`bonus.tier1_companies` / `allCompany` 字段语义不变，脚本无感知
- **风险与缓解**：
  - 风险 1：LLM 可能用非规范公司名（"字节"/"ByteDance"）→ 缓解：SKILL.md 新增硬约束第 2 条
  - 风险 2：LLM 不同 session 间生成的清单抖动 → 缓解：方案 B 的"会话内唯一来源"约定彻底消除（同一会话内只生成一次）
  - 风险 3：LLM 偶发幻觉公司名 → 缓解：硬约束第 3、6 条要求"真实存在 + ATS 自检"

---

**v6.1.8 变更**（2026-04-27）：
- **版本号规范化**：v6.1.7 因历史原因存在两份内容不一致的压缩包（一份仅含 v6.1.6 的 T1+T2+T3 文档加固；一份含本次 Token 大升级），为消除版本语义冲突，将真正的「Token 大升级版」单独升号为 v6.1.8 重新发布
- **本版本 = 原 v6.1.7-.zip 全量内容**（脚本 + 文档完全一致），仅 CHANGELOG/SKILL.md 的版本号字样从 6.1.7 更新为 6.1.8
- **v6.1.7 已废弃**：建议所有用户升级到 v6.1.8

---

**v6.1.7 变更**（2026-04-27，已废弃）：
- **Token 发现大升级**（Hunyuan3.0 / Box 引擎场景实战发现）：
  - **问题 1**：`auto_discover_tokens()` 只扫 CodeBuddy / Cursor / Claude / AnyDev，**漏扫 mcporter 全部路径**。Box 引擎实际把真实 token 写到 `~/.box/Workspace/config/mcporter.json` 和 `{cwd}/config/mcporter.json`，老版本脚本完全发现不了，直接 `SystemExit(1)` 报错
  - **问题 2**：`~/.mcporter/mcporter.json` 里 Authorization 可能是 `Bearer ${TAI_IT_TOKEN}` 这种模板，老版本把它当字面量用，导致 HTTP 请求 `UnicodeEncodeError`
  - **问题 3**：`recruit-Authorization` 可能是说明文字（如 `"招活MCP token"` 中文字面量，mcporter 内部约定），老版本直接拿去当 header 用必失败
  - **问题 4**：失败时只 `SystemExit(1)`，没输出结构化信息，agent 无法识别"需要用户操作"场景，容易误判为业务错误盲目重试
  - **修复**（`scripts/mcp_client.py` 重构）：
    1. **扩候选路径**：新增 5 条 mcporter 相关路径，优先级高于 IDE 配置（因为 mcporter/Box 引擎路径通常有更新鲜的真实 token）
    2. **`${VAR}` 环境变量占位符展开**：新增 `_expand_env_vars()`，自动把 `${TAI_IT_TOKEN}` 替换为环境变量值；未展开成功则视为无效
    3. **占位符过滤**：新增 `_is_placeholder()`，跳过含中文、残留 `${...}`、`xxx/TBD/placeholder` 等明显非 token 值
    4. **JWT 过期检测**：新增 `_jwt_is_expired()`，解析 JWT 的 `exp` 字段，过期 token 自动跳过。修复"Box Workspace 里缓存了过期 token 导致 401 而不是继续找下一个候选"的问题
    5. **跨文件组合**：`auto_discover_tokens()` 分别收集 Authorization 和 recruit-Authorization，允许跨文件凑齐（如 Auth 从 `~/.mcporter` 的 `${TAI_IT_TOKEN}` 展开来，rAuth 从 `~/.box/Workspace` 拿真实值）
    6. **`TAI_IT_TOKEN` 积极兜底**：当 Authorization 在配置文件里都过期时，优先用环境变量 `TAI_IT_TOKEN` 组装 `Bearer xxx`（用户明确要求的优先级）
    7. **结构化报错**：失败时向 stdout 输出 JSON `{"status":"need_auth","hint":...,"actions":[...]}` + stderr 详细引导 + exit code 2（区别于业务错误的 1），agent 可捕获并向用户呈现
  - **SKILL.md 新增**：「🔑 Token 获取与故障排查」章节（置于 MCP 调用方式之后），含发现优先级表 / 候选路径列表 / 首次获取流程 / 退出码约定
  - **影响范围**：`mcp_client.py` +~200 行；SKILL.md +60 行；其他脚本与文档零改动
  - **向前兼容**：老的环境变量 / IDE 配置 / `.env` 文件路径全部保留，只是加了新候选并修了三类误判
  - **实测验证**：在 Box Workspace 里 `~/.box/Workspace/config/mcporter.json` 的 Auth 已过期、`~/.mcporter/mcporter.json` 是 `Bearer ${TAI_IT_TOKEN}` 模板、rAuth 只在 Box Workspace 有真实值的场景下，脚本正确跳过过期配置、从 env 展开 TAI_IT_TOKEN、跨文件组合出可用凭据，3 路并发搜索全部成功（30+30+30 → 去重 84 → 过权限 78）

---

**v6.1.6 变更**（2026-04-26）：
- **`rough_screen.py` null 容错修复**（Hunyuan3.0 实战发现）：
  - **问题**：当 `profile.json` 的 `must.workYears.max` 为 `null`（表示"无上限"）时，粗筛脚本抛 `TypeError: '>' not supported between instances of 'int' and 'NoneType'`
  - **根因**：旧代码 `if "max" in wy_range and wy > wy_range["max"]` 只检查 key 存在，未检查值是否为 None。JSON 语义上 `null` 就是 Python 的 `None`，比较时触发 TypeError
  - **修复**（`rough_screen.py` 行 171-182，净增 3 行）：把 `"key" in dict` 改成 `dict.get("key") is not None`，让 `null` 被正确识别为"无约束"而不是崩溃
  - **回归**：用 `{"min": 1, "max": null}` 测试通过，结果与"删掉 max 字段"版本完全一致（A=138/B=8/C=1/excluded=0/Top 30）
  - **向前兼容**：`{"min": 1, "max": 8}`、`{"min": 1}`、`{}` 等所有历史写法行为不变
  - **覆盖边缘情况**：`{"min": null, "max": null}`、`{"max": null}` 等也一并修正
- 其他脚本（`social_search.py` / `deep_read.py` / `mcp_client.py`）零改动；SKILL.md / interfaces / filters / data / references 文档零改动

---

**v6.1.5 变更**（2026-04-26）：
- **防御 `--rids` 传错场景**（Hunyuan3.0 实战发现）：
  - **SKILL.md 三处零增行措辞加强**：执行流程第 1 步 + 精读前检查第 4 项 + 参数说明表 `--rids` 行，均明确"每批必须传**全部 30 个** rid，切片由 `--offset`/`--limit` 完成"
  - **`deep_read.py` 脚本主动报警**（+10 行）：当 `offset >= len(rids)` 时，输出 `warning` 字段明确告知"你可能只传了本批子集"，避免模型误诊为"stdout 截断"。同时该分支 `json.dumps` 补 `ensure_ascii=False`，中文警告可读。
- 根因溯源：Hunyuan3.0 第一次跑 `--rids 3 个 --offset 0 --limit 3` 恰好凑齐一批，第二次沿用"每批只传本批 rid"的错误范式 → 第二批 `--rids 3 个 --offset 3` 切片越界 → 返回空数组 → 模型把空返回误归因为"stdout 被截断"并得出"减小 --limit"的错误结论
- **SKILL.md**：811 行 → 811 行（零增行）；**`deep_read.py`**：+10 行
- 其他脚本（`social_search.py` / `rough_screen.py` / `mcp_client.py`）零改动

---

**v6.1.4 变更**（2026-04-26）：
- **SKILL.md 文档重构（纯瘦身，零行为改动）**：886 行 → 811 行（-75 行，-8.5%），知识结构更清晰；对小上下文模型（Hunyuan3.0 32k 等）更友好
  - 顶部「版本变更历史」整块迁出至本文件（`CHANGELOG.md`）
  - 阶段 4「🆕 v6.1.1 两段话生成规则」长映射表 + Few-shot 迁至 `references/step4-case-description-rules.md`，SKILL.md 保留精炼版 + 指针
  - 阶段 5 删除「v6.0 核心变化」历史对比表（v5.x vs v6.0+，当前模型无需）
- 所有脚本（`social_search.py` / `rough_screen.py` / `deep_read.py` / `mcp_client.py`）**零改动**；interfaces / filters / data / 现有 references 文档**零改动**
- 知识完整保留，只换位置

---

**v6.1.3 变更**（2026-04-26）：
- **精读回归"不落盘"设计**（纠正 v6.0.0-v6.1.2 实操中的偏差）：
  - `deep_read.py` 的 JSON **直接作为 `execute_command` 返回值**给模型读，**禁止 `>`、`2>&1`、`| tee`、`| head`、`| jq` 等任何重定向/管道**
  - stdout（JSON）走工具返回值，stderr（进度日志）实时打到用户屏幕 → **进度可见性自动恢复**
  - 不再产生 `batchN.json` 中间产物，workspace 保持干净
- **`--limit` 自适应**：按模型上下文推荐 5/3/2/1，SKILL.md 阶段 5 新增选择表；Hunyuan3.0 等 32k 模型建议 `--limit 3`
- 说明：`deep_read.py` 脚本本身**无代码改动**（stdout+stderr 分离设计一直是正确的，问题出在之前命令模板给模型留了歧义）

---

**v6.1.2 变更**（2026-04-26）：
- **`top_rids.json` 输出瘦身**：兼容小上下文模型（如 Hunyuan3.0 的 `read_file` 100k 字符上限）。`rough_screen.py` 分档输出——前 10 条保留 `highLightOthers`（去 `allContent`，`shortContent` 截断 150 字符，取前 3 条）+ `score_breakdown` 的 hits 摘要；11-30 条只保留基础身份字段。文件体积从 ~242k 字符降至 ~10k 字符（减小 **96%**）。完整 30 条原始数据通过 `--dump rough_audit.json` 可选落盘，审计能力不丢。

---

**v6.1.1 变更**（2026-04-26）：
- **`must.companies` 语义明确 + 全链路闭环**：
  - **搜索端**：`search_params.json` 的 `common_params` 新增宏指令 `mustCompanies`（`social_search.py` 自动下发到每条 route 的 `allCompany`，与原有 `allCompany` 并集）。MCP 后端据此按简历**全部工作经历**做命中。
  - **粗筛端**：删除 `must.companies` 硬过滤（`rough_screen.py` 只能看 `lastEmployerName`，会误杀早年待过目标公司但最近跳槽的候选人）；公司硬约束由搜索端 `mustCompanies` 兜底。
  - **精读端**：不再做公司核对（搜索端已保证），腾出打分权重给粗筛看不到的维度（技能深度、项目量级、职级、论文/比赛等）。
- **阶段 4 文案升级**：Top 10 快速概览后，要求模型根据当前 profile **case-by-case 生成两段话**——"粗筛做了什么" + "精读要重点评估什么"，让用户明白粗筛局限性再决定是否进入精读。

---

**v6.1.0 变更**（2026-04-26）：
- **【方案 1】城市字段双子请求**：API 实测证明 `location` 和 `expectLocation` 是 AND 关系。`social_search.py` 在 `location` 非空时自动拆为"当前城市路 + 期望城市路"两个子请求并发查询后按 rid 合并，达成 OR 语义。**Q1 实测召回 22 → 68 (3.09×)**
- **【方案 1】`supportNoExpectCity` 用户决策位**：阶段 1 新增城市口径确认，用户决定是否纳入"期望城市为空"的候选。搜索端（仅期望城市子请求）+ 粗筛端（`rough_screen.py` 新增分支）双重生效。**Q1 启用后 68 → 84 (3.82×)**
- **【方案 2】粗筛打分升级为四维加权**：`score_candidate()` 从纯 highlight 计数升级为 `highlight(1.0) + company(2.5) + title(2.0) + keyword(1.5)` 加权，`profile.bonus` 全字段生效。分档阈值 A≥8/B≥3/C<3。**Q2 实测 Top10 合格候选排名：候选人 A 6→2，候选人 B 10→5**
- **【方案 3】公司锚定路**：泛行业场景（游戏/直播/金融/电商/医疗/汽车/教育/出海/文娱）强制加 path 4，`allCompany` 含 10-20 家领头公司。`data/tier1-companies-by-domain.json` 扩充到每领域 20 家。**Q1 全方案实测 22 → 191 (8.68×)，Top15 行业对口率 40% → 100%**

---

**v6.0.1 变更**（2026-04-26）：
- **修复文档与代码不一致**：`slim_search_result` 字段统一小写驼峰（与接口原始字段一致）；step5 / getresume-with-detail 文档对齐 v6.0 deep_read.py 调用方式
- **搜索参数外部化**：`social_search.py` 改用 `--params search_params.json` 必传，不再硬编码 MMO 业务参数
- **清理历史残留**：删除根目录 5 个运行产物 + `data/scoring-rules.json` / `data/seniority-keywords.json` / `references/report_template.md` 3 个无人引用的死文件
- **文档精简**：step6 删除无依据的 4 个 shortage_reason 枚举；troubleshooting 升级 v6 精读排查场景

---

**v6.0.0 变更**（2026-04-24）：
- **精读脚本化**：新增 `scripts/deep_read.py`，用 Python 脚本批量调 MCP 获取详情
- **字段过滤**：脚本内置字段白名单，过滤掉不需要的字段，大幅减少模型上下文 Token
- **不落盘**：精读结果直接输出到 stdout，不生成本地文件
- **简化流程**：一次脚本调用获取全部精简详情，模型一次性评估
