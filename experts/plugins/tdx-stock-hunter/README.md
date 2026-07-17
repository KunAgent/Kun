# Tdx Stock Hunter

基于通达信 MCP 数据的 A 股智能选股专家。

## 类型

Agent 型（单个 AI 专家）

## 功能

将用户的自然语言选股意图转化为多维筛选条件，从 5000+ A 股中按基本面、技术面、资金面、估值等维度进行横向分析与综合评分（满分 100 分），输出结构化选股结果，供用户自行判断与决策参考。

## 使用示例

- 帮我筛选半导体行业中 PE<1000、ROE>5% 且近期资金关注度高的标的
- 帮我找出 MACD 金叉且主力净流入的股票
- 有哪些股票符合巴菲特选股模型？

## 头像

头像已自动生成在 `avatars/` 目录下。如需替换为自定义头像，要求：
- 格式：PNG（推荐）或 JPG
- 尺寸：512×512 px
- 大小：单张不超过 500KB

## MCP 依赖

本专家依赖通达信官方 MCP 服务，使用以下工具获取数据：

| 工具 | 用途 |
|------|------|
| `tdx_screener` | 自然语言条件选股（涨停/连板/主力净流入等） |
| `tdx_quotes` | 实时行情（最新价/涨跌幅/PE/市值） |
| `tdx_indicator_select` | PE/PB/ROE 等估值指标 |
| `tdx_kline` | K 线历史数据 |

使用前请确保已在 WorkBuddy 环境中授权连接通达信 MCP。

## 安装

将专家包目录放到以下路径：

```
~/.workbuddy/plugins/marketplaces/my-experts/plugins/tdx-stock-hunter/
```

安装后专家将在 WorkBuddy 中自动可见。

## 打包分享

```bash
zip -r tdx-stock-hunter.zip tdx-stock-hunter/
```
