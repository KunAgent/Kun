# ChatMarkdown Markdown内容

## 示例

## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-chat-markdown": "tdesign-miniprogram/chat-markdown/chat-markdown"
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/tpXWatmU8P44)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 01基础Markdown样式

#### 标题与文本

**WXML** (`html`):
```html
<view class="chat-example-block">
<t-chat-markdown content="{{markdownContent}}" bind:click="handleLinkTap" />
</view>

```

**JS** (`javascript`):
```javascript
import markdownData from './mock.js';
// 内置marked处理
Page({
data: {
markdownContent: markdownData,
},
handleLinkTap(e) {
// 打开链接
console.log('监听点击', e);
wx.navigateTo({
url: e.detail.node.href,
});
},
});

```

**CSS** (`css`):
```css
.chat-example-block {
background-color: var(--td-bg-color-container);
padding: 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"usingComponents": {
"t-chat-markdown": "tdesign-miniprogram/chat-markdown/chat-markdown"
}
}

```

**MOCK** (`javascript`):
```javascript
const mockMarkdownData = `
# 一级标题

## 二级标题

### 三级标题

#### 四级标题

##### 五级标题

###### 六级标题

正文

**加粗正文**

~~删除线~~

行内代码: \`console.log('Hello')\`
`;

export default mockMarkdownData;

```

#### 列表

**WXML** (`html`):
```html
<view class="chat-example-block">
<t-chat-markdown content="{{markdownContent}}" bind:click="handleLinkTap" />
</view>

```

**JS** (`javascript`):
```javascript
import markdownData from './mock.js';
// 内置marked处理
Page({
data: {
markdownContent: markdownData,
},
handleLinkTap(e) {
// 打开链接
console.log('监听点击', e);
wx.navigateTo({
url: e.detail.node.href,
});
},
});

```

**CSS** (`css`):
```css
.chat-example-block {
background-color: var(--td-bg-color-container);
padding: 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"usingComponents": {
"t-chat-markdown": "tdesign-miniprogram/chat-markdown/chat-markdown"
}
}

```

**MOCK** (`javascript`):
```javascript
const mockMarkdownData = `
- 无序列表
- 无序列表
- 嵌套列表
- 嵌套列表

1. 有序列表
2. 有序列表
`;

export default mockMarkdownData;

```

### 02代码块与表格

#### 代码块

**WXML** (`html`):
```html
<view class="chat-example-block">
<t-chat-markdown content="{{markdownContent}}" bind:click="handleLinkTap" />
</view>

```

**JS** (`javascript`):
```javascript
import markdownData from './mock.js';
// 内置marked处理
Page({
data: {
markdownContent: markdownData,
},
handleLinkTap(e) {
// 打开链接
console.log('监听点击', e);
wx.navigateTo({
url: e.detail.node.href,
});
},
});

```

**CSS** (`css`):
```css
.chat-example-block {
background-color: var(--td-bg-color-container);
padding: 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"usingComponents": {
"t-chat-markdown": "tdesign-miniprogram/chat-markdown/chat-markdown"
}
}

```

**MOCK** (`javascript`):
```javascript
const mockMarkdownData = `
\`\`\`TDesign-登录表单.jsx
import { Form, Input, Button, Message } from 'tdesign-react';
const LoginForm = () => { const [loading, setLoading] = useState(false);
\`\`\`
`;

export default mockMarkdownData;

```

#### 表格

**WXML** (`html`):
```html
<view class="chat-example-block">
<t-chat-markdown content="{{markdownContent}}" bind:click="handleLinkTap" />
</view>

```

**JS** (`javascript`):
```javascript
import markdownData from './mock.js';
// 内置marked处理
Page({
data: {
markdownContent: markdownData,
},
handleLinkTap(e) {
// 打开链接
console.log('监听点击', e);
wx.navigateTo({
url: e.detail.node.href,
});
},
});

```

**CSS** (`css`):
```css
.chat-example-block {
background-color: var(--td-bg-color-container);
padding: 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"usingComponents": {
"t-chat-markdown": "tdesign-miniprogram/chat-markdown/chat-markdown"
}
}

```

**MOCK** (`javascript`):
```javascript
const mockMarkdownData = `
| 左对齐     | 居中对齐 | 右对齐 | 内容 |
| :--------- | :------: | -----: | ----- |
| 单元格     |  单元格  | 单元格 | 单元格 |
| 长文本示例| 长文本示例长文本示例长文本示例 |   $100 | 文本内容 |
| 文本示例 | 文本内容 | $100 |  文本内容 |
`;

export default mockMarkdownData;

```

### 03图片与超链接

支持监听链接的点击事件

**WXML** (`html`):
```html
<view class="chat-example-block">
<t-chat-markdown content="{{markdownContent}}" bind:click="handleLinkTap" />
</view>

```

**JS** (`javascript`):
```javascript
import markdownData from './mock.js';
// 内置marked处理
Page({
data: {
markdownContent: markdownData,
},
handleLinkTap(e) {
// 打开链接
console.log('监听点击', e);
wx.navigateTo({
url: e.detail.node.href,
});
},
});

```

**CSS** (`css`):
```css
.demo-container {
padding: 32rpx;
background-color: #fff;
}

.text {
margin-left: 10rpx;
margin-bottom: 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"usingComponents": {
"t-chat-markdown": "tdesign-miniprogram/chat-markdown/chat-markdown"
}
}

```

**MOCK** (`javascript`):
```javascript
const mockMarkdownData = `
![示例](https://tdesign.gtimg.com/demo/demo-image-1.png "示例")
这是一个链接 [Markdown语法](https://markdown.com.cn)。
`;

export default mockMarkdownData;

```

### 04引用

**WXML** (`html`):
```html
<view class="chat-example-block">
<t-chat-markdown content="{{markdownContent}}" bind:click="handleLinkTap" />
</view>

```

**JS** (`javascript`):
```javascript
import markdownData from './mock.js';
// 内置marked处理
Page({
data: {
markdownContent: markdownData,
},
handleLinkTap(e) {
// 打开链接
console.log('监听点击', e);
wx.navigateTo({
url: e.detail.node.href,
});
},
});

```

**CSS** (`css`):
```css
.chat-example-block {
background-color: var(--td-bg-color-container);
padding: 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"usingComponents": {
"t-chat-markdown": "tdesign-miniprogram/chat-markdown/chat-markdown"
}
}

```

**MOCK** (`javascript`):
```javascript
const mockMarkdownData = `
下面是引用示例

> TDesign distills Tencent's years of design experience into professional design guideline, providing universal design solutions that assist product managers, designers, developers, and other roles in efficiently completing the design and development of enterprise-level products, while maintaining consistent design language and style to meet user experience requirements.
`;

export default mockMarkdownData;

```

## API

### ChatMarkdownProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| content | String | - | 必需。markdown 内容文本 | Y |
| options | Object |  | Markdown 解析器基础配置。TS 类型：`TdChatContentMDOptions ``interface TdChatContentMDOptions {gfm?: boolean; pedantic?: boolean; smartLists?: boolean; breaks?: boolean}`。详细类型定义 | N |

### ChatMarkdownEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| click | `(detail: {detail:{event, node}, currentTarget, target})` | 点击链接时触发 |