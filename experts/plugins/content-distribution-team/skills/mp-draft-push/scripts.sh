#!/bin/bash
# 微信公众号草稿箱发布工具 - 辅助脚本
# 使用方法: source scripts.sh

# 通过环境变量提供（推荐：使用 .env + `set -a; source .env; set +a`）

require_cmd() {
    command -v "$1" >/dev/null 2>&1 || {
        echo "ERROR: missing command: $1" >&2
        return 1
    }
}

require_env() {
    local name=$1
    local val
    eval "val=\${${name}:-}"
    if [[ -z "$val" ]]; then
        echo "ERROR: missing env var: ${name}" >&2
        return 1
    fi
}

# ============ 公众号 API ============

# 获取 access_token
# 用法: get_wechat_token
get_wechat_token() {
    require_cmd curl || return 1
    require_cmd jq   || return 1
    require_env WECHAT_APPID  || return 1
    require_env WECHAT_SECRET || return 1
    curl -s "https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${WECHAT_APPID}&secret=${WECHAT_SECRET}" \
        | jq -r '.access_token'
}

# 上传图片到公众号永久素材库（封面图专用）
# 用法: upload_wechat_image <token> <image_path>
# 返回: JSON，含 media_id 字段
upload_wechat_image() {
    require_cmd curl || return 1
    local token=$1
    local image_path=$2
    curl -s -X POST \
        "https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${token}&type=image" \
        -F "media=@${image_path}"
}

# 创建草稿
# 用法: create_draft <token> <json_file>
# 返回: JSON，含 media_id 字段（草稿 ID）
create_draft() {
    require_cmd curl || return 1
    local token=$1
    local json_file=$2
    curl -s -X POST \
        "https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${token}" \
        -H "Content-Type: application/json" \
        -d @"${json_file}"
}

echo "脚本已加载。可用函数:"
echo "  get_wechat_token     - 获取公众号 access_token"
echo "  upload_wechat_image  - 上传封面图到素材库，返回 media_id"
echo "  create_draft         - 创建草稿，返回草稿 media_id"
