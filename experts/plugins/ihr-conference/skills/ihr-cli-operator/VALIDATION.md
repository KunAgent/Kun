# ihr-cli-operator Validation Report

## 验证对象

- 技能：`ihr-cli-operator`
- 路径：`customer-facing/ihr-cli/skills/ihr-cli-operator`
- 类型：复制后更新
- 日期：`2026-06-16`
- 验证人：`Codex`
- 关联提交：`未提交`
- 验收证据引用：`未建立`
- 认证信息：`当前会话未提供 IHR360_BASE_URL / IHR360_API_TOKEN；未记录明文凭证`

## 本次结论摘要

- `通过`：8
- `未通过`：2
- `无法验证`：4
- `风险提示`：3
- 私有验收记录：`未建立`
- 交付门禁：`失败`
- 结论：已把 skill 迁移到 `customer-facing/ihr-cli/skills/ihr-cli-operator` 并按新标准补齐认证前置、云端环境变量、请求头要求、安装路径检查、可移植路径示例、`metadata.toml` 与本报告；但当前会话缺少真实可用认证信息，未执行业务接口 live 调用，未拿到非空业务数据，因此禁止发布。
- 本次补充：已把 AI 面谈/会议发起接口的正确路径、错误路径、`sourceType="IHR360"` 必填要求和 HTTP 200 空响应陷阱回写到 `references/conference.md`；同时把安装策略修正为通过 `https://cdn-txtoqiniu.ihr360.com/ihr-cli/install.sh` 安装最新版，不再固定历史版本。该补充来自用户提供的实操复盘，本轮未执行 live 写操作。

## 通过

- 检查项：目标目录
  现状：已迁移到 `customer-facing/ihr-cli/skills/ihr-cli-operator`
  证据：目录内存在 `SKILL.md`、`agents/openai.yaml`、`references/`、`scripts/`

- 检查项：基础 skill 结构
  现状：`SKILL.md` frontmatter 通过 quick validate
  证据：`quick_validate.py` 输出 `Skill is valid!`

- 检查项：展示名同步
  现状：`metadata.toml` 的 `display_name` 与 `agents/openai.yaml` 的 `interface.display_name` 均为 `iHR CLI 操作器`
  证据：`metadata.toml`、`agents/openai.yaml`

- 检查项：云端必需 env
  现状：`agents/openai.yaml` 只声明 `IHR360_BASE_URL` 与 `IHR360_API_TOKEN`
  证据：`agents/openai.yaml`

- 检查项：业务接口主路径
  现状：文档要求通过 `ihr-cli interface +get/+post` 调用业务接口
  证据：`SKILL.md`、`references/interface.md`

- 检查项：本机 CLI 可用性
  现状：本机存在 `ihr-cli`，版本 `1.0.5`，路径位于用户本地 bin 目录
  证据：`command -v ihr-cli`、`ihr-cli version`、`ls -l "$(command -v ihr-cli)"`

- 检查项：AI 面谈发起经验回写
  现状：`references/conference.md` 已补充正确接口 `/gateway/ai/conference/v1/analysis/conference/launchConference`、错误旧路径 `/gateway/ai/conference/v1/launchConference`、`sourceType="IHR360"` 必填要求，以及“HTTP 200 但响应体为空不算成功”的校验规则。
  证据：`references/conference.md`

- 检查项：CLI 安装版本策略
  现状：`references/cli-install-auth.md` 已要求使用 `curl --http1.1 -fsSL https://cdn-txtoqiniu.ihr360.com/ihr-cli/install.sh | bash -s -- --yes` 安装最新版，不再使用固定版本路径或 `--version` 参数；同时要求使用 `latest.json` 与 `ihr-cli version` 检查更新。
  证据：`references/cli-install-auth.md`

## 未通过

- 检查项：真实认证信息
  现状：当前会话未设置 `IHR360_BASE_URL` 与 `IHR360_API_TOKEN`
  证据：环境变量检查结果为 missing
  影响：无法执行 `ihr-cli auth verify`，也无法进行业务接口 live 验证
  建议修正：提供当前会话可直接执行、能通过 `ihr-cli auth verify` 的真实运行时值

- 检查项：业务接口 live 验证
  现状：未对目标 skill 可调用的业务接口执行逐接口 live 调用，未拿到非空业务数据
  证据：缺少真实认证信息，未进入接口调用
  影响：不满足接口类 skill 交付门禁，禁止发布
  建议修正：提供认证信息后，按用户具体业务请求选定接口，逐接口执行 `ihr-cli interface +get/+post` 并记录非空业务数据证明

## 无法验证

- 检查项：`ihr-cli auth verify`
  缺失条件：缺少 `IHR360_BASE_URL` 与 `IHR360_API_TOKEN`
  当前判断：无法验证认证是否真实可用
  后续建议：设置环境变量后执行认证检查和必要的 stdin 登录

- 检查项：接口响应根结构
  缺失条件：未执行 live 业务接口
  当前判断：无法确认各业务接口真实响应根结构、列表字段和总数字段
  后续建议：对每个实际使用的接口落盘脱敏响应摘要，并回写到 references 或本报告

- 检查项：分页覆盖
  缺失条件：未选定具体分页接口且未执行 live 调用
  当前判断：无法给出 `requestedPages`、`rawTotal`、`fetchedCount`、`dedupedCount`
  后续建议：使用具体接口样本验证页码起点、分页字段和全量覆盖

- 检查项：join/map 边界
  缺失条件：当前 skill 是通用 CLI 操作器，未内置具体多数据集 join 逻辑
  当前判断：不适用于通用框架；具体业务任务需要另行验证
  后续建议：当用户请求涉及多数据集关联时，单独验证完全无关联记录、空对象、空数组、未知字段值

## 风险提示

- 风险项：在线文档结构变化
  背景：`extract_ihr_docs.py` 依赖当前文档站 bundle 结构
  建议关注：脚本失败时只作为文档发现失败处理，不要使用旧 bundle hash 猜测接口

- 风险项：通用 interface 能力覆盖面大
  背景：本 skill 不固定单一业务接口，实际接口由用户请求、当前 CLI help 和在线文档共同决定
  建议关注：每次具体业务执行都需要重新确认接口方法、参数、请求头、响应结构和非空业务数据

- 风险项：AI 面谈发起接口业务字段仍需 live 验证
  背景：本次只沉淀了正确路径、错误路径、`sourceType` 固定值和响应体校验规则；候选人或业务对象标识、面谈目的、模板或题纲等字段仍需在真实发起任务中确认。
  建议关注：执行发起会话前必须先从用户输入、当前 CLI 输出或 live 接口证据中取得完整请求体，不得猜测字段名或枚举值。

## 接口证据矩阵

| 接口路径 | 请求方法 | 请求形态 | 认证验证结果 | live 调用证据 | 验收证据引用 | 响应根结构 | 列表字段 | 总数字段 | 分页字段 | 首次请求页码 | 页码证据来源 | 请求页覆盖 | 必要请求头 | 响应关键字段 | 返回摘要 | 是否拿到非空业务数据 | 代码路径检查结果 | 文档回写结果 | 当前结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 具体业务接口待用户请求确定 | `GET/POST` | `ihr-cli interface +get/+post` | `未验证：缺少 IHR360_BASE_URL / IHR360_API_TOKEN` | `未执行` | `未建立` | `无法验证` | `无法验证` | `无法验证` | `无法验证` | `无法验证` | `无法验证` | `requestedPages=unknown, rawTotal=unknown, fetchedCount=0, dedupedCount=0, 无法验证全量` | `IHR-Request-Origin: hrclaw` | `无法验证` | `无 live 返回` | `否` | `文档要求通过 ihr-cli interface 调用` | `已回写认证、请求头、脚本入口和执行前提` | `未通过` |
| `/gateway/ai/conference/v1/analysis/conference/launchConference` | `POST` | `ihr-cli interface +post` JSON body | `未验证：缺少 IHR360_BASE_URL / IHR360_API_TOKEN` | `未执行` | `用户实操复盘，未建立私有验收记录` | `无法验证` | `不适用` | `不适用` | `不适用` | `不适用` | `不适用` | `不适用` | `IHR-Request-Origin: hrclaw` | `sourceType="IHR360"`；会话 ID / 状态 / 链接待 live 验证 | `无 live 返回` | `否` | `文档要求通过 ihr-cli interface 调用` | `已回写到 references/conference.md` | `无法验证` |

## 数据覆盖摘要

- 响应根结构：`无法验证`
- 列表字段：`无法验证`
- 总数字段：`无法验证`
- requestedPages：`unknown`
- rawTotal：`unknown`
- fetchedCount：`0`
- dedupedCount：`0`
- 是否全量覆盖：`无法验证`
- 是否所有接口都拿到非空业务数据：`否`
- 边界样例：`通用操作器未内置具体 join/map；具体业务任务执行时另行验证`

## 技能同步结果

- `SKILL.md`：`已更新`
- `references/`：`已更新`
- `agents/openai.yaml`：`已更新`
- `scripts/`：`未修改`
- `metadata.toml`：`已新增`
- 技能展示名：`metadata.toml display_name 与 agents/openai.yaml interface.display_name 一致`

## 待人工关注

- 提供当前会话真实可用的 `IHR360_BASE_URL` 与 `IHR360_API_TOKEN`
- 选择一个实际业务请求作为验收样本，执行逐接口 live 验证并补充私有验收记录
