# Tdx Stock Diagnostician

基于通达信 MCP 数据的 A 股个股 360 度深度诊断专家。

## 类型

Agent 型（单个 AI 专家）

## 功能

像经验丰富的分析师一样，对任意 A 股进行六大模块全方位诊断：基本面体检（估值/盈利/成长/财务健康）、技术面扫描（均线/MACD/KDJ/RSI）、资金面透视（DDX/北向资金/融资融券）、事件催化扫描（业绩预告/股东增减持）、同业对标、综合结论。输出结构清晰、论据充分的专业诊断报告。

## 使用示例

- 帮我全面诊断贵州茅台的投资价值
- 帮我分析宁德时代的基本面和技术面
- 帮我对比一下五粮液和泸州老窖的投资价值

## 头像

头像已自动生成在 `avatars/` 目录下。如需替换为自定义头像，要求：
- 格式：PNG（推荐）或 JPG
- 尺寸：512×512 px
- 大小：单张不超过 500KB

## MCP 依赖

本专家依赖通达信官方 MCP 服务，使用以下工具获取数据：

| 工具 | 用途 |
|------|------|
| `tdx_indicator_select` | PE/PB/ROE 等估值指标 |
| `tdx_api_data` | 资产负债表/利润表/现金流量表（80+ preset） |
| `tdx_kline` | K 线 OHLCV 数据 |
| `tdx_screener` | 资金流向/条件选股 |
| `tdx_quotes` | 实时行情 |
| `wenda_news_query` | 个股资讯 |
| `wenda_notice_query` | 公司公告 |

使用前请确保已在 WorkBuddy 环境中授权连接通达信 MCP。

## 安装

将专家包目录放到以下路径：

```
~/.workbuddy/plugins/marketplaces/my-experts/plugins/tdx-stock-diagnostician/
```

安装后专家将在 WorkBuddy 中自动可见。

## 打包分享

```bash
zip -r tdx-stock-diagnostician.zip tdx-stock-diagnostician/
```
