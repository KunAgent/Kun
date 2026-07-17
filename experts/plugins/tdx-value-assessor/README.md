# Tdx Value Assessor

基于格雷厄姆-巴菲特价值体系的 A 股价值评估专家。

## 类型

Agent 型（单个 AI 专家）

## 功能

秉承格雷厄姆-巴菲特价值投资理念，运用 15+ 内置估值模型（PE/PB/PEG/DCF/巴菲特模型/格雷厄姆模型等），通过定性护城河评估 + 定量多维估值 + 安全边际计算三层分析法，对 A 股上市公司进行内在价值评估与安全边际评级，输出颜色评级（🟢显著低估/🟡合理偏低/⚪合理/🔴明显高估）的专业价值分析报告。

## 使用示例

- 帮我用价值投资方法评估贵州茅台的内在价值和安全边际
- 哪些大盘蓝筹股目前被低估？
- 帮我用巴菲特模型分析一下招商银行

## 头像

头像已自动生成在 `avatars/` 目录下。如需替换为自定义头像，要求：
- 格式：PNG（推荐）或 JPG
- 尺寸：512×512 px
- 大小：单张不超过 500KB

## MCP 依赖

本专家依赖通达信官方 MCP 服务，使用以下工具获取数据：

| 工具 | 用途 |
|------|------|
| `tdx_quotes` | 实时行情（最新价/PE/PB/市值） |
| `tdx_indicator_select` | PE/PB/ROE/PEG 等估值指标 |
| `tdx_api_data` | 资产负债表/利润表/现金流量表（80+ preset） |
| `tdx_kline` | K 线历史数据 |
| `wenda_news_query` | 个股资讯 |
| `wenda_notice_query` | 公司公告 |
| `wenda_report_query` | 券商研报 |
| `wenda_macro_query` | 宏观经济数据 |

使用前请确保已在 WorkBuddy 环境中授权连接通达信 MCP。

## 安装

将专家包目录放到以下路径：

```
~/.workbuddy/plugins/marketplaces/my-experts/plugins/tdx-value-assessor/
```

安装后专家将在 WorkBuddy 中自动可见。

## 打包分享

```bash
zip -r tdx-value-assessor.zip tdx-value-assessor/
```
