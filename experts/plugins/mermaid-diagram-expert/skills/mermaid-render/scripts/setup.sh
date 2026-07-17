#!/bin/bash
# Mermaid 渲染引擎环境安装脚本
# 首次使用前执行一次即可

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "🔧 正在安装 Mermaid 渲染引擎..."

# 检查 Node.js 版本
if ! command -v node &> /dev/null; then
  echo "❌ 未找到 Node.js。请安装 Node.js 18+ 后重试。"
  exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "❌ Node.js 版本过低（当前 v${NODE_VERSION}）。需要 Node.js 18+。"
  exit 1
fi

echo "   Node.js 版本: $(node -v) ✓"

# 进入脚本目录安装依赖
cd "$SCRIPT_DIR"

# 如果没有 package.json，创建一个
if [ ! -f "package.json" ]; then
  echo "   初始化 package.json..."
  cat > package.json << 'EOF'
{
  "name": "mermaid-render-scripts",
  "version": "1.0.0",
  "private": true,
  "description": "Mermaid diagram rendering scripts",
  "type": "commonjs"
}
EOF
fi

# 安装渲染引擎
echo "   安装渲染引擎..."
npm install beautiful-mermaid --save --silent 2>/dev/null || npm install beautiful-mermaid --save

echo ""
echo "✅ 安装完成！"
echo ""
echo "📝 使用方式:"
echo "   SVG 渲染:   node ${SCRIPT_DIR}/render-svg.js input.mmd output.svg [主题名]"
echo "   ASCII 渲染: node ${SCRIPT_DIR}/render-ascii.js input.mmd"
echo "   查看主题:   node ${SCRIPT_DIR}/list-themes.js"
