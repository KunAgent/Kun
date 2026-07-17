#!/bin/bash
# 腾讯云 RUM MCP Skill 配置脚本
# 通过 SecretId + SecretKey 完成鉴权

set -e

echo "🚀 正在配置腾讯云 RUM MCP Skill..."
echo ""

# 1. 检查 mcporter
MCPORTER_VERSION="0.9.0"
if ! command -v mcporter &> /dev/null; then
    echo "⚠️  未检测到 mcporter，正在安装 v${MCPORTER_VERSION}..."
    npm install -g "mcporter@${MCPORTER_VERSION}"
    echo "✅ mcporter v${MCPORTER_VERSION} 已安装"
fi

# 2. 检查环境变量
if [ -z "$RUM_TOKEN" ]; then
    echo "⚠️  未检测到 RUM_TOKEN 环境变量"
    echo ""
    echo "📋 请先配置环境变量："
    echo "   export RUM_TOKEN=\"YourSecretId:YourSecretKey\""
    echo ""
    echo "   格式：SecretId 与 SecretKey 用英文冒号（:）分隔"
    echo ""
    echo "🔗 获取凭证：访问 https://console.cloud.tencent.com/cam/capi 获取 SecretId 和 SecretKey"
    echo ""
    echo "   如果在 OpenClaw 中使用，请在 API Key 输入框中填入 SecretId:SecretKey"
    exit 1
fi

# 3. 解析 RUM_TOKEN（格式：SecretId:SecretKey）
RUM_SECRET_ID="${RUM_TOKEN%%:*}"
RUM_SECRET_KEY="${RUM_TOKEN#*:}"

if [ -z "$RUM_SECRET_ID" ] || [ -z "$RUM_SECRET_KEY" ] || [ "$RUM_SECRET_ID" = "$RUM_TOKEN" ]; then
    echo "❌ RUM_TOKEN 格式错误。请使用 SecretId:SecretKey 的格式（以英文冒号分隔）"
    exit 1
fi

echo "✅ SecretId 与 SecretKey 解析成功"

# 4. 添加 MCP 配置
echo "🔧 正在配置 mcporter..."

# 如果存在旧配置，先清除
mcporter config remove rum --scope home 2>/dev/null || true

# 写入 mcporter 配置文件，确保两个 header 都正确传递
MCPORTER_CONFIG="$HOME/.mcporter/mcporter.json"
mkdir -p "$HOME/.mcporter"

# 使用 node 安全地写入/合并配置（SecretId/SecretKey 通过环境变量传递）
RUM_SID="$RUM_SECRET_ID" RUM_SKEY="$RUM_SECRET_KEY" MCPORTER_CFG="$MCPORTER_CONFIG" node -e "
const fs = require('fs');
const cfgPath = process.env.MCPORTER_CFG;
let config = {};
try { config = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch(e) {}
if (!config.mcpServers) config.mcpServers = {};
config.mcpServers.rum = {
  url: 'https://app.rumt-zh.com/sse',
  transportType: 'sse',
  headers: {
    SecretId: process.env.RUM_SID,
    SecretKey: process.env.RUM_SKEY
  }
};
fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2));
"

echo "✅ 配置已写入 $MCPORTER_CONFIG"

echo ""
echo "✅ 配置完成！"
echo ""

# 5. 校验配置
echo "🧪 正在校验配置..."
if mcporter list 2>&1 | grep -q "rum"; then
    echo "✅ 配置校验成功！"
    echo ""
    mcporter list | grep -A 1 "rum" || true
else
    echo "⚠️  配置校验失败。请检查网络或 RUM_TOKEN（格式：SecretId:SecretKey）"
    echo ""
    echo "🔗 获取 SecretId/SecretKey：https://console.cloud.tencent.com/cam/capi"
fi

echo ""
echo "─────────────────────────────────────"
echo "🎉 配置完成！"
echo ""
echo "📖 用法："
echo "   mcporter call \"rum.QueryRumWebProjects()\""
echo "   mcporter call \"rum.QueryRumWebMetric(ProjectId:'123456', Metric:'exception', GroupBy:['level'], Limit:100)\""
echo ""
echo "📖 更多信息见 SKILL.md"
echo ""
echo "📚 第一次接触腾讯云 RUM？"
echo "   控制台：  https://console.cloud.tencent.com/rum"
echo "   Demo：    https://console.cloud.tencent.com/rum/web/demo"
echo "   文档：    https://cloud.tencent.com/document/product/1464/61930"
echo ""
