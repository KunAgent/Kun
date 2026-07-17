#!/bin/bash
# pack.sh
# 用途：把 skill 当前 main 分支（默认 WorkBuddy 版，frontend_ext.skill_name 后缀写死 -workbuddy）
#       打包成两份独立的 zip：WorkBuddy 版 + SkillHub 版，分别用于两个分发平台或外部测试机。
# 用法：在 skill 根目录运行：bash pack.sh
# 不会改动你本地工作区的任何文件，所有替换都在临时目录里完成。

set -e

SKILL_NAME="gaokao-zhiyuan-assistant"
ROOT_DIR=$(cd "$(dirname "$0")" && pwd)
STAMP=$(date +%Y%m%d-%H%M%S)

# 通用：把 skill 拷到临时目录、（可选）替换平台后缀、打 zip、清理
# 参数 1: 平台名（workbuddy / skillhub）
# 参数 2: 是否需要把 -workbuddy 替换为 -skillhub（true/false）
build_one() {
  local PLATFORM="$1"
  local NEED_REPLACE="$2"

  local TMP_DIR
  TMP_DIR=$(mktemp -d)
  local TARGET_DIR="$TMP_DIR/$SKILL_NAME"

  echo ""
  echo "📦 [$PLATFORM] 复制 skill 到临时目录：$TARGET_DIR"
  mkdir -p "$TARGET_DIR"
  # 排除 .git / node_modules / 已有 zip / macOS 元数据 / 点文件（.gitignore 等会被 SkillHub 校验拒绝）/ 打包脚本自身
  rsync -a \
    --exclude='.git' \
    --exclude='.gitignore' \
    --exclude='.gitattributes' \
    --exclude='node_modules' \
    --exclude='*.zip' \
    --exclude='.DS_Store' \
    --exclude='pack.sh' \
    "$ROOT_DIR/" "$TARGET_DIR/"

  if [ "$NEED_REPLACE" = "true" ]; then
    echo "🔧 [$PLATFORM] 替换平台标识：-workbuddy → -skillhub"
    # macOS sed 兼容写法：-i ''
    find "$TARGET_DIR" -type f \( -name "*.md" -o -name "*.sh" -o -name "*.toml" -o -name "*.txt" \) -exec \
      sed -i '' 's/gaokao-zhiyuan-assistant-workbuddy/gaokao-zhiyuan-assistant-skillhub/g' {} +

    local LEFT
    local NEW
    LEFT=$(grep -r "gaokao-zhiyuan-assistant-workbuddy" "$TARGET_DIR" 2>/dev/null | wc -l | tr -d ' ')
    NEW=$(grep -r "gaokao-zhiyuan-assistant-skillhub"  "$TARGET_DIR" 2>/dev/null | wc -l | tr -d ' ')
    echo "    替换后：剩余 -workbuddy 引用 $LEFT 处，新增 -skillhub 引用 $NEW 处"
    if [ "$LEFT" -ne 0 ]; then
      echo "⚠️  [$PLATFORM] 警告：仍有 -workbuddy 引用未替换，请手动检查临时目录：$TARGET_DIR"
    fi
  else
    # WorkBuddy 版：自检本地源码就是 -workbuddy 后缀
    local WB_COUNT
    WB_COUNT=$(grep -r "gaokao-zhiyuan-assistant-workbuddy" "$TARGET_DIR" 2>/dev/null | wc -l | tr -d ' ')
    echo "🔧 [$PLATFORM] 无需替换，自检 -workbuddy 引用：$WB_COUNT 处"
    if [ "$WB_COUNT" -eq 0 ]; then
      echo "⚠️  [$PLATFORM] 警告：源码里居然没找到 -workbuddy 标识，埋点字段可能未按规范写入，请检查 SKILL.md 12.3 节"
    fi
  fi

  echo "📁 [$PLATFORM] 打包 zip"
  local ZIP_NAME="${SKILL_NAME}-${PLATFORM}-${STAMP}.zip"
  ( cd "$TMP_DIR" && zip -qr "$ZIP_NAME" "$SKILL_NAME" )
  mv "$TMP_DIR/$ZIP_NAME" "$ROOT_DIR/"

  echo "🧹 [$PLATFORM] 清理临时目录"
  rm -rf "$TMP_DIR"

  echo "✅ [$PLATFORM] 完成：$ROOT_DIR/$ZIP_NAME"
}

echo "============================================"
echo "  双平台打包脚本启动"
echo "  根目录：$ROOT_DIR"
echo "  时间戳：$STAMP"
echo "============================================"

# 1) WorkBuddy 版（不替换，源码本身就是 -workbuddy）
build_one "workbuddy" "false"

# 2) SkillHub 版（替换 -workbuddy → -skillhub）
build_one "skillhub" "true"

echo ""
echo "============================================"
echo "🎉 全部完成，已生成 2 个 zip："
ls -lh "$ROOT_DIR"/${SKILL_NAME}-*-${STAMP}.zip 2>/dev/null | awk '{print "   - " $NF "  (" $5 ")"}'
echo ""
echo "下一步："
echo "  · WorkBuddy 测试 → 把 *-workbuddy-*.zip 解压到外部测试机的 .codebuddy/skills/ 下"
echo "  · SkillHub  测试 → 把 *-skillhub-*.zip  解压到外部测试机的 .codebuddy/skills/ 下"
echo "  · 在两台测试机分别跑一遍 skill，回来用 source3=skill_gaokao 看上报数据，"
echo "    GROUP BY frontend_ext.skill_name 应能拆出 -workbuddy / -skillhub 两组。"
echo "============================================"
