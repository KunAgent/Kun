#!/usr/bin/env bash
# setup-mcp.sh — 安装广告平台 MCP Server 到 ~/.workbuddy/mcp-servers/
# 用法:
#   bash setup-mcp.sh          # 安装全部5个平台
#   bash setup-mcp.sh baidu    # 只安装百度
#   bash setup-mcp.sh 360      # 只安装360
#   bash setup-mcp.sh tencent  # 只安装腾讯广告
#   bash setup-mcp.sh google   # 只安装Google Ads
#   bash setup-mcp.sh microsoft # 只安装Microsoft Ads

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MCP_DIR="$HOME/.workbuddy/mcp-servers"
PLATFORM="${1:-all}"

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
ok()    { echo -e "${GREEN}[OK]${NC} $1"; }

# ─────────────────────────────────────────────
# 百度营销 MCP
# ─────────────────────────────────────────────
install_baidu() {
  info "安装 baidu-ads-mcp..."
  local TARGET="$MCP_DIR/baidu-ads-mcp"
  mkdir -p "$TARGET"

  cp "$SCRIPT_DIR/baidu-ads-mcp/index.mjs" "$TARGET/index.mjs"
  cp "$SCRIPT_DIR/baidu-ads-mcp/refresh-tokens.mjs" "$TARGET/refresh-tokens.mjs"
  cp "$SCRIPT_DIR/baidu-ads-mcp/package.json" "$TARGET/package.json"

  # 不覆盖已有配置
  if [ ! -f "$TARGET/accounts.json" ]; then
    cp "$SCRIPT_DIR/baidu-ads-mcp/accounts.json.template" "$TARGET/accounts.json"
    warn "已创建 accounts.json，请填入你的百度营销凭证"
  else
    info "accounts.json 已存在，跳过"
  fi

  cd "$TARGET" && npm install --production
  ok "baidu-ads-mcp 安装完成"
}

# ─────────────────────────────────────────────
# 360点睛 MCP
# ─────────────────────────────────────────────
install_360() {
  info "安装 360-ads-mcp..."
  local TARGET="$MCP_DIR/360-ads-mcp"
  mkdir -p "$TARGET"

  cp "$SCRIPT_DIR/360-ads-mcp/index.mjs" "$TARGET/index.mjs"
  cp "$SCRIPT_DIR/360-ads-mcp/package.json" "$TARGET/package.json"

  if [ ! -f "$TARGET/accounts.json" ]; then
    cp "$SCRIPT_DIR/360-ads-mcp/accounts.json.template" "$TARGET/accounts.json"
    warn "已创建 accounts.json，请填入你的360点睛凭证"
  else
    info "accounts.json 已存在，跳过"
  fi

  cd "$TARGET" && npm install --production
  ok "360-ads-mcp 安装完成"
}

# ─────────────────────────────────────────────
# 腾讯广告 MCP
# ─────────────────────────────────────────────
install_tencent() {
  info "安装 tencent-ad-mcp..."
  local TARGET="$MCP_DIR/tencent-ad-mcp"
  mkdir -p "$TARGET"

  cp -R "$SCRIPT_DIR/tencent-ad-mcp/dist" "$TARGET/"
  cp "$SCRIPT_DIR/tencent-ad-mcp/package.json" "$TARGET/package.json"

  cd "$TARGET" && npm install --production
  ok "tencent-ad-mcp 安装完成"
  warn "请在 mcp.json 中配置环境变量: TENCENT_AD_CLIENT_ID, TENCENT_AD_CLIENT_SECRET 等"
}

# ─────────────────────────────────────────────
# Google Ads MCP
# ─────────────────────────────────────────────
install_google() {
  info "安装 google-ads-mcp..."
  local TARGET="$MCP_DIR/google-ads-mcp"
  mkdir -p "$TARGET"

  cp "$SCRIPT_DIR/google-ads-mcp/package.json" "$TARGET/package.json"

  cd "$TARGET" && npm install --production
  ok "google-ads-mcp 安装完成"
  warn "请在 mcp.json 中配置环境变量: GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_DEVELOPER_TOKEN 等"
}

# ─────────────────────────────────────────────
# Microsoft Ads (Bing) MCP
# ─────────────────────────────────────────────
install_microsoft() {
  info "安装 microsoft-ads-mcp..."
  local TARGET="$MCP_DIR/microsoft-ads-mcp"
  mkdir -p "$TARGET"

  cp "$SCRIPT_DIR/microsoft-ads-mcp/server.py" "$TARGET/server.py"
  cp "$SCRIPT_DIR/microsoft-ads-mcp/requirements.txt" "$TARGET/requirements.txt"

  # 创建 Python venv 并安装依赖
  if [ ! -d "$TARGET/.venv" ]; then
    python3 -m venv "$TARGET/.venv"
  fi
  "$TARGET/.venv/bin/pip" install -r "$TARGET/requirements.txt"

  ok "microsoft-ads-mcp 安装完成"
  warn "请在 mcp.json 中配置环境变量: MICROSOFT_ADS_DEVELOPER_TOKEN, MICROSOFT_ADS_CLIENT_ID 等"
}

# ─────────────────────────────────────────────
# 执行安装
# ─────────────────────────────────────────────
echo ""
echo "========================================="
echo "  广告平台 MCP Server 安装工具"
echo "========================================="
echo ""

case "$PLATFORM" in
  baidu)     install_baidu ;;
  360)       install_360 ;;
  tencent)   install_tencent ;;
  google)    install_google ;;
  microsoft) install_microsoft ;;
  all)
    install_baidu
    echo ""
    install_360
    echo ""
    install_tencent
    echo ""
    install_google
    echo ""
    install_microsoft
    ;;
  *)
    echo "未知平台: $PLATFORM"
    echo "可选: baidu, 360, tencent, google, microsoft, all"
    exit 1
    ;;
esac

# ─────────────────────────────────────────────
# 打印下一步提示
# ─────────────────────────────────────────────
echo ""
echo "========================================="
echo "  下一步操作"
echo "========================================="
echo ""
echo "1. 填写凭证:"
echo "   - 百度: 编辑 $MCP_DIR/baidu-ads-mcp/accounts.json"
echo "   - 360:  编辑 $MCP_DIR/360-ads-mcp/accounts.json"
echo "   - 腾讯/Google/Microsoft: 在 mcp.json 环境变量中配置"
echo ""
echo "2. 配置 mcp.json:"
echo "   将 MCP Server 添加到 WorkBuddy 的 mcp.json 配置中"
echo "   参考: references/setup-guide.md 中的配置模板"
echo ""
echo "3. 完成 OAuth 授权:"
echo "   - 百度: 通过 oauth_get_auth_url → 浏览器授权 → oauth_exchange_code"
echo "   - 360:  通过 login 工具自动登录"
echo "   - 腾讯: 通过开发者中心 OAuth 页面授权获取 token"
echo "   - Google: 通过 gcloud/OAuth Playground 获取 refresh_token"
echo "   - Microsoft: 通过 complete_auth 工具完成设备码授权"
echo ""
echo "4. 验证安装:"
echo "   在 WorkBuddy 中使用对应 MCP 工具调用 get_account_info 验证连接"
echo ""
