---
name: mp-draft-push
description: 将现成的文章内容发布到微信公众号草稿箱。当用户说"发布文章"、"发布到草稿箱"、"publish to draft"、"推送到公众号"时触发。
homepage: https://github.com/bbwdadfg/wechat-ai-publisher
metadata: {"openclaw":{"emoji":"📤","requires":{"bins":["bash","curl","jq"]}}}
---

# mp-draft-push

## 功能说明

接收调用方提供的文章内容，上传封面图（可选），并将文章发布到微信公众号草稿箱。

**不负责**：内容采集、AI 写作、图片生成。

---

## 所需参数

调用方（用户或其他 Skill）需要提供：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `title` | string | ✅ | 文章标题（不超过 64 字节，约 21 个中文字符） |
| `digest` | string | ✅ | 文章摘要（显示在分享卡片上） |
| `content_html` | string | ✅ | 文章正文 HTML（使用内联样式） |
| `cover_image_path` | string | ❌ | 封面图本地路径（如不提供则用兜底 URL 或无封面） |

---

## 执行流程

```
1. 接收参数
       ↓
2. 获取 access_token
       ↓
3. 上传封面图到微信素材库（获取 thumb_media_id）
       ↓
4. 创建草稿（发布到草稿箱）
       ↓
5. 提示用户前往后台检查
```

---

## 配置信息

- **AppID**: `WECHAT_APPID`（通过环境变量配置）
- **AppSecret**: `WECHAT_SECRET`（通过环境变量配置）
- **作者**: `WECHAT_AUTHOR`（可选，默认 `koo AI`）

**获取 AppID 和 AppSecret**：
1. 前往 [微信开发者平台](https://developers.weixin.qq.com/platform/)，微信扫码登录
2. 点击 [「我的业务 → 公众号/服务号」](https://developers.weixin.qq.com/platform/apps/subscription)，进入对应账号详情页
3. 在详情页即可查看 AppID 和 AppSecret（也可在此重置）

> ⚠️ 平台**不保存** AppSecret，需自行妥善保管。忘记只能重置生成新的。
> 若提示需要实名/认证，前往 [微信公众平台 → 设置与开发](https://mp.weixin.qq.com) 完成认证。

---

## Step 1: 接收参数

**不要主动提问**，等待调用方传入上述参数。

若调用方没有提供 `cover_image_path`，按以下优先级处理封面图：
1. **优先使用 `gen_image` 工具生成封面图**：根据文章标题和主题，调用 `gen_image` 生成一张适合公众号封面的图片（建议尺寸 900×383 或 2.35:1 比例，风格简洁醒目），保存到 `/tmp/wechat_cover_generated.png`，然后作为封面上传
2. 若 `gen_image` 不可用，检查环境变量 `DEFAULT_COVER_URL`：有值则下载到 `/tmp/wechat_cover_default.png` 再上传
3. 以上均不可用：`thumb_media_id` 留空（草稿不含封面）

---

## Step 2 & 3: 上传封面图并创建草稿

加载脚本：

```bash
source ./scripts.sh
```

### 获取 access_token

```bash
TOKEN=$(get_wechat_token)
```

### 上传封面图（如有）

```bash
MEDIA_RESPONSE=$(upload_wechat_image "$TOKEN" "$cover_image_path")
THUMB_MEDIA_ID=$(echo "$MEDIA_RESPONSE" | jq -r '.media_id')
```

### 构建草稿 JSON 并创建草稿

`content_html` 注意事项：
- 所有样式必须内联（`style="..."`），微信会过滤 `<style>` 标签
- 图片只能使用 `mmbiz.qpic.cn` 域名（如有文章内图片，需提前上传到微信）
- JSON 序列化必须使用 `ensure_ascii=False`，否则中文乱码

```bash
DRAFT_JSON="/tmp/draft_$(date +%Y%m%d%H%M%S).json"
jq -n \
    --arg title "$title" \
    --arg author "${WECHAT_AUTHOR:-koo AI}" \
    --arg digest "$digest" \
    --arg content "$content_html" \
    --arg thumb_media_id "$THUMB_MEDIA_ID" \
    '{
        articles: [{
            title: $title,
            author: $author,
            digest: $digest,
            content: $content,
            thumb_media_id: $thumb_media_id,
            need_open_comment: 1,
            only_fans_can_comment: 0
        }]
    }' > "$DRAFT_JSON"

DRAFT_RESPONSE=$(create_draft "$TOKEN" "$DRAFT_JSON")
DRAFT_MEDIA_ID=$(echo "$DRAFT_RESPONSE" | jq -r '.media_id')
rm -f "$DRAFT_JSON"
```

若 `DRAFT_MEDIA_ID` 为空或 `null`，说明创建失败，打印 `DRAFT_RESPONSE` 排查。

---

## Step 4: 提示用户检查

发布完成后输出：

```
✅ 草稿发布成功！

📝 文章信息
- 标题：{title}
- 摘要：{digest}
- 草稿 media_id：{DRAFT_MEDIA_ID}

📌 前往公众号后台查看并发布：
   https://mp.weixin.qq.com （登录后点击「内容管理」→「草稿箱」）

⚠️ 检查要点：
1. 图片是否正常显示
2. 排版是否正确
3. 标题和摘要是否合适
4. 确认无误后点击"发布"
```

> 注意：微信草稿 API 不返回可直接跳转的文章链接，草稿需在后台确认后才生成正式链接。上方输出中直接给出后台草稿箱的导航路径，用户点击即可到达。

---

## HTML 内联样式参考

```html
<section style="font-family: -apple-system, sans-serif; line-height: 1.8; color: #333; padding: 15px;">
  <p style="margin-bottom: 20px;">段落内容</p>

  <h2 style="border-bottom: 1px solid #eee; padding-bottom: 8px;">标题</h2>

  <p style="text-align: center; margin: 25px 0;">
    <img src="{mmbiz_img_url}" style="max-width: 100%; border-radius: 6px;">
  </p>

  <blockquote style="background: #f6f8fa; border-left: 4px solid #ddd; padding: 12px 16px;">
    引用内容
  </blockquote>
</section>
```

---

## 注意事项

1. **中文编码**：JSON 必须用 `ensure_ascii=False`，`jq` 默认已处理
2. **标题长度**：最多 64 字节（约 21 个中文字符）
3. **access_token**：有效期 2 小时，每次需重新获取
4. **图片域名**：文章内图片只能使用微信返回的 `mmbiz.qpic.cn` URL
