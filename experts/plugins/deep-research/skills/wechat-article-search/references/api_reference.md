# 搜狗微信搜索接口文档

## 1. 搜索文章接口

### 请求信息

- **URL**: `https://weixin.sogou.com/weixin`
- **方法**: GET

### 请求参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| type | int | 是 | 搜索类型：1=公众号，2=文章 |
| query | string | 是 | 搜索关键词（需URL编码） |
| page | int | 否 | 页码，默认1 |
| ie | string | 否 | 编码，固定 `utf8` |

### 请求示例

```
GET https://weixin.sogou.com/weixin?type=2&query=codex%20app&page=1&ie=utf8
```

### 响应说明

返回 HTML 页面，包含文章列表，每条结果包含：
- 文章标题
- 公众号名称
- 发布时间
- 搜狗临时链接

---

## 2. 搜索公众号接口

### 请求示例

```
GET https://weixin.sogou.com/weixin?type=1&query=人民日报&page=1&ie=utf8
```

### 响应说明

返回 HTML 页面，包含公众号列表，每条结果包含：
- 公众号名称
- 微信号
- 简介
- 二维码

---

## 3. 文章跳转链接

搜狗返回的文章链接格式：
```
https://weixin.sogou.com/link?url=dn9a_-gY295K0Rci_xozVXfdMkSQTLW6...
```

访问该链接后，页面通过 JavaScript 拼接真实微信文章 URL：
```javascript
var url = '';
url += 'https://mp.';
url += 'weixin.qq.c';
url += 'om/s?src=11';
// ...
window.location.replace(url);
```

解析后得到微信文章永久链接：
```
https://mp.weixin.qq.com/s?src=11&timestamp=...&signature=...
```

---

## 4. 微信文章页面结构

### 标题
```html
<h1 class="rich_media_title">文章标题</h1>
```

### 公众号名称
```html
<a id="js_name">公众号名称</a>
```

### 发布时间
```html
<em id="publish_time">2026年2月3日</em>
```

### 正文内容
```html
<div class="rich_media_content" id="js_content">
  <!-- 文章正文 -->
</div>
```

---

## 5. 注意事项

1. **临时链接有效期**: 搜狗返回的链接约几小时后失效
2. **频率限制**: 频繁请求会触发验证码
3. **请求间隔**: 建议 2-3 秒
4. **User-Agent**: 需要模拟浏览器
5. **Referer**: 获取文章内容时需要设置 Referer
