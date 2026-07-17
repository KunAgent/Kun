---
name: tsa-risk
description: 腾讯云智能顾问架构风险巡检分析报告生成工具。用于分析用户在腾讯云智能顾问产品下的架构图风险巡检情况，从API拉取数据并生成移动端友好的HTML可视化报告，最终将HTML转换为PNG图片输出。当用户提到智能顾问架构巡检、风险分析、巡检报告、架构图风险、腾讯云巡检等关键词时或对当前报告内容修改时，请务必使用此插件。
argument-hint: [ArchId]
allowed-tools: Bash, Read, Grep, Write
---

# 腾讯云智能顾问 — 架构风险巡检分析报告

本 skill 用于分析用户在腾讯云智能顾问产品下的架构图风险巡检情况，自动拉取数据并生成可视化报告。

## 接口约束

> **重要**：本 skill 仅允许调用以下 `references/` 中定义的 4 个智能顾问接口，不得调用任何 references 之外的接口：

| # | Action | 说明 | 文档 |
|---|--------|------|------|
| 1 | `DescribeArchScanReportLastInfo` | 获取最新巡检报告ID | `{baseDir}/references/api/DescribeArchScanReportLastInfo.md` |
| 2 | `DescribeArchScanOverviewInfo` | 查询巡检概览信息 | `{baseDir}/references/api/DescribeArchScanOverviewInfo.md` |
| 3 | `DescribeArchRiskTrendInfo` | 查询风险趋势信息 | `{baseDir}/references/api/DescribeArchRiskTrendInfo.md` |
| 4 | `DescribeScanPluginRiskTrendListInfo` | 查询风险明细列表 | `{baseDir}/references/api/DescribeScanPluginRiskTrendListInfo.md` |

所有接口统一通过 `{baseDir}/scripts/tcloud_api.py` 调用，服务名 `advisor`，API 版本 `2020-07-21`。

> **路径约定**：下文使用 `{pluginDir}` 表示 `{baseDir}/references/plugins/tas-risk`，插件专用脚本（数据拉取、报告生成、截图转换）位于 `{pluginDir}/scripts/`，公用脚本（环境检查、API调用、免密登录等）位于 `{baseDir}/scripts/`。

> **辅助脚本说明**：`{baseDir}/scripts/login_url.py` 和 `{baseDir}/scripts/setup_role.py` 为可选辅助脚本，使用 STS/CAM 通用服务接口（非智能顾问业务接口），仅用于免密登录链接生成和角色配置，不在核心数据流程中。

## 前置条件

- 系统需安装 `python3`（3.6 及以上版本）
- 需配置腾讯云 API 密钥环境变量：`TENCENTCLOUD_SECRET_ID`、`TENCENTCLOUD_SECRET_KEY`

## 工作流程

### 第一步：获取用户输入

- **ArchId**（必填）：架构图 ID，如 `arch-xxxxx`

> **注意**：ResultId 无需用户提供，系统会自动通过 `DescribeArchScanReportLastInfo` 接口获取最新的报告 ID。

### 第二步：环境检查

```bash
python3 {baseDir}/check_env.py
```

### 第三步：拉取数据

```bash
python3 {pluginDir}/scripts/risk_fetch_data.py <ArchId>
```

该脚本自动完成以下工作：
1. **自动获取 ResultId**：首先调用 `DescribeArchScanReportLastInfo` 接口，通过 ArchId 获取最新的报告 ID
   - 如果接口调用失败（报错），**中断整个流程**，脚本会输出错误信息，需向用户提示异常原因
   - 如果 ResultId 为空，说明该架构图尚未进行过巡检，**中断整个流程**，需提示用户前往 [腾讯云智能顾问控制台](https://console.cloud.tencent.com/advisor?archId={{ArchId}}) 发起巡检
2. 依次调用三个数据接口并将数据合并为 JSON 文件，输出到 `./output/data_<ArchId>.json`（当前工作目录下）

**数据拉取特性**：
- `DescribeScanPluginRiskTrendListInfo` 接口使用 **Limit=200（最大分页）** 并自动分页遍历，确保获取全部风险明细数据
- 所有分页数据合并后统一写入 JSON，`TotalCount` 为实际获取的总条数
- 其他接口单次调用即可

> 使用接口前，**必须先加载对应的接口文档**：`{baseDir}/references/api/<Action>.md`

### 第四步：生成 HTML 报告

数据来源：`./output/data_<ArchId>.json`

#### 4a. 默认方案（无特殊样式要求）

**脚本优先级机制**：系统优先加载 `generate_report_custom.py`，不存在时回退到 `generate_report_default.py`。

> **规则**：
> - `generate_report_custom.py` **不预置**，仓库中只有 `generate_report_default.py` 作为基线版本
> - 当用户自定义报告需求通过 `--template` 模板配置**无法满足**、需要修改生成逻辑（如布局、模块增删、图表样式、数据处理等）时，先将 `generate_report_default.py` **复制为 `generate_report_custom.py`**，再在副本上修改
> - 一旦 `generate_report_custom.py` 存在，后续所有生成都自动使用它；`generate_report_default.py` 始终保持不变作为基线

```bash
# 如需修改生成逻辑，先创建自定义副本（仅首次）
if [ ! -f "{pluginDir}/scripts/generate_report_custom.py" ]; then
  cp {pluginDir}/scripts/generate_report_default.py {pluginDir}/scripts/generate_report_custom.py
fi

# 自动选择脚本（优先 _custom 版本）
GEN_SCRIPT="{pluginDir}/scripts/generate_report_custom.py"
if [ ! -f "$GEN_SCRIPT" ]; then
  GEN_SCRIPT="{pluginDir}/scripts/generate_report_default.py"
fi
python3 "$GEN_SCRIPT" ./output/data_<ArchId>.json --theme random
```

可指定主题：`--theme ocean|sunset|forest|lavender|coral|slate`

#### 4b. 使用自定义模板

如果用户之前保存过自定义模板，可通过 `--template` 指定模板目录：

```bash
# 同样优先使用 _custom 版本
python3 "$GEN_SCRIPT" ./output/data_<ArchId>.json --template <自定义模板名>
```

#### 4c. 保存自定义模板

当用户对主题有自定义修改需求时：
1. 复制 `{pluginDir}/template/default/` 下对应主题 JSON 文件
2. 按用户需求修改颜色、阈值、布局等配置
3. 使用 `--save-template` 保存为新模板（会在 `template/<名称>/` 下创建）：

```bash
python3 "$GEN_SCRIPT" ./output/data_<ArchId>.json --theme ocean --save-template my-custom
```

#### 4d. 列出可用模板

```bash
python3 "$GEN_SCRIPT" --list-templates
```

#### 4e. 定制方案（用户有特殊样式需求且模板无法满足）

不使用脚本，而是：
1. 读取 `./output/data_<ArchId>.json` 数据
2. 参考 `{pluginDir}/ReportDesignSpec.md` 了解报告模块与样式规范
3. 根据用户样式要求直接生成自定义 HTML 报告
4. 输出到 `./output/report_<ArchId>.html`

### 第五步（可选）：AI 报告分析

> **此步骤默认不启用**。仅当用户明确要求生成 AI 分析摘要（如提到"分析一下"、"总结报告"、"AI 解读"等关键词）时才执行此步骤。默认流程直接从第四步跳到第六步。

如果用户要求启用 AI 分析，在生成 HTML 后、转 PNG 前，对巡检数据进行分析：

1. 读取 `./output/data_<ArchId>.json` 中的关键数据
2. 生成简洁专业的中文分析文本（200-400字），具体要求参见 `{pluginDir}/ReportDesignSpec.md`
3. 保存到 `./output/summary_<ArchId>.txt`
4. 重新生成报告（附带分析）：

```bash
python3 "$GEN_SCRIPT" ./output/data_<ArchId>.json --theme random --summary ./output/summary_<ArchId>.txt
```

> 也可同时指定自定义模板：`--template <模板名> --summary ...`

### 第六步：HTML 转 PNG

```bash
python3 {pluginDir}/scripts/html_to_png.py ./output/report_<ArchId>.html
```

最终输出 PNG 到 `./output/report_<ArchId>.png`。



### 第七步：生成报告的结果处理

> **⚠️ 核心原则：报告图片优先！** 无论何种场景，都必须 **优先尝试发送/展示报告图片**，只有在确认图片无法发送时才降级。

报告生成完毕后，按以下优先级策略处理：

#### 策略 A：IM 回复场景（Web端、企微、飞书等在线对话）

1. **优先发送报告图片**（必须！）
   - 调用 `read_image` 工具读取 `./output/report_<ArchId>.png`，让图片 **直接内联显示** 在对话消息中
   - 发送图片后，附上文字提示（见下方模板）

2. **降级方案：仅当图片确实无法发送时**（如 `read_image` 工具不可用、图片文件生成失败、PNG 转换全部失败等）
   - 读取 `./output/data_<ArchId>.json` 数据，将报告内容解读为 **Markdown 格式文本** 发送
   - **必须在消息开头添加降级说明**，格式如下：
   ```
   > ⚠️ 图片报告未能发送（原因：{{具体原因，如"PNG截图工具均不可用"或"read_image工具调用失败"等}}），以下为文本版报告：
   ```
   - 然后输出 Markdown 格式的报告内容
   - 在末尾补充提示：`💡 建议：升级至最新版 CLAW 客户端以获得图片报告的最佳体验`

#### 策略 B：本地 CLAW 场景（qclaw 等本地客户端）

如果检测到当前运行环境为本地 CLAW（如 qclaw）且不支持在对话中发送/内联图片：

1. **直接在本地打开报告图片**：
   ```bash
   # macOS
   open ./output/report_<ArchId>.png
   # Linux
   xdg-open ./output/report_<ArchId>.png
   # Windows
   start ./output/report_<ArchId>.png
   ```
2. 在对话中回复：`📷 报告图片已在本地打开，请查看。`
3. 如果本地打开也失败，则降级为 Markdown 文本（同策略 A 的降级方案）

#### 文字提示模板

发送图片后（或降级文本报告后），参考下面文字提示模板补充提示：
```
<简洁总结报告>
若需修改可以直接发送修改意见
🔗 查看更多： 如需查看完整架构详情、历史报告及更多风险分析，请前往 [腾讯云智能顾问控制台](https://console.cloud.tencent.com/advisor?archId={{ArchId}}&plugin=cloud-inspection-sdk)
```

> **⚠️ 重要**： [腾讯云智能顾问控制台] 对应链接为免密登录链接**每次都必须重新生成**，不可缓存或复用之前生成的链接。每次向用户展示时，都必须重新调用 `scripts/login_url.py` 生成新的链接。

---


## 注意事项与安全规范

### 密钥安全

1. **严禁**将 AK/SK 硬编码在代码中，必须通过环境变量传入
2. 建议使用子账号密钥，仅授予 `QcloudAdvisorReadOnlyAccess` 权限
3. 生产环境推荐使用 STS 临时密钥，设置 `TENCENTCLOUD_TOKEN`

### API 限制

- 所有接口限制 20 次/秒（维度：API + 接入地域 + 子账号）
- 地域默认 `ap-guangzhou`，Region 为可选参数

### 平台兼容性

- 所有脚本均为 Python 实现，跨平台兼容 macOS、Linux 和 Windows

### 免密链接

- 默认有效期 30 分钟，可通过 `TENCENTCLOUD_STS_DURATION` 调整（最大 7200 秒）
- 当返回结果包含架构图时，只需为**第一张架构图**生成免密登录控制台链接
- 以 `[腾讯云智能顾问控制台](免密登录URL)` 超链接形式展示，严禁直接展示完整 URL
- **每次展示都必须重新调用 `login_url.py` 生成新链接，不可缓存或复用**

## 错误处理

- 如果某个接口调用失败，报告中对应模块显示"数据获取失败"提示，不影响其他模块
- HTML 转 PNG 依赖 Python 截图能力，可能需要安装额外依赖

## 参考资料（按需加载）

| 文档 | 说明 |
|------|------|
| `{baseDir}/references/api/DescribeArchScanReportLastInfo.md` | 获取最新报告ID接口 |
| `{baseDir}/references/api/DescribeArchScanOverviewInfo.md` | 巡检概览接口 |
| `{baseDir}/references/api/DescribeArchRiskTrendInfo.md` | 风险趋势接口 |
| `{baseDir}/references/api/DescribeScanPluginRiskTrendListInfo.md` | 风险明细列表接口 |
| `{pluginDir}/ReportDesignSpec.md` | 报告内容与样式规范 |
