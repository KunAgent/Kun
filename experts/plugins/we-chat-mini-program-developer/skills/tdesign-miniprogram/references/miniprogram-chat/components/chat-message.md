# ChatMessage 对话消息体

## 示例

## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-chat-message": "tdesign-miniprogram/chat-message/chat-message"
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/TqXIftmF8c4G)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 01组件类型

#### 基础类型

**WXML** (`html`):
```html
<view class="chat-example">
<view class="chat-example-block">
<t-chat-message content="{{userMessage.content}}" role="{{userMessage.role}}"></t-chat-message>
</view>
</view>

```

**JS** (`javascript`):
```javascript
Component({
properties: {
userMessage: {
type: Object,
value: {
role: 'user',
content: [
{
type: 'text',
data: '牛顿第一定律是否适用于所有参考系？',
},
],
},
},
},
});

```

**CSS** (`css`):
```css
.chat-example {
display: flex;
flex-direction: column;
gap: 32rpx;
}

.chat-example-block {
background-color: var(--td-bg-color-container);
padding: 32rpx 32rpx 0 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-chat-message": "tdesign-miniprogram/chat-message/chat-message",
"t-chat-actionbar": "tdesign-miniprogram/chat-actionbar/chat-actionbar"
}
}

```

#### 可配置昵称、头像、对齐方式

支持`avatar`，`name`插槽自定义

**WXML** (`html`):
```html
<view class="chat-example">
<view class="chat-example-block">
<t-chat-message datetime="16:38" name="张三" content="{{message.content}}" role="{{message.role}}"></t-chat-message>
</view>
<view class="chat-example-block">
<t-chat-message
avatar="https://tdesign.gtimg.com/site/chat-avatar.png"
datetime="16:38"
name="TDesignAI"
content="{{message.content}}"
role="{{message.role}}"
></t-chat-message>
</view>
<view class="chat-example-block">
<t-chat-message
avatar="https://tdesign.gtimg.com/site/chat-avatar.png"
datetime="16:38"
name="TDesignAI"
content="{{message.content}}"
role="{{message.role}}"
placement="right"
></t-chat-message>
</view>
<view class="chat-example-block">
<t-chat-message content="{{message.content}}" role="{{message.role}}" datetime="16:38">
<view slot="name" class="name-block">
<image src="https://tdesign.gtimg.com/site/chat-avatar.png" />
<view>Canxuan</view>
</view>
</t-chat-message>
</view>
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
message: {
role: 'system',
content: [
{
type: 'text',
data: '牛顿第一定律是否适用于所有参考系？',
},
],
},
},
});

```

**CSS** (`css`):
```css
.chat-example {
display: flex;
flex-direction: column;
gap: 32rpx;
}

.chat-example-block {
background-color: var(--td-bg-color-container);
padding: 32rpx 32rpx 0 32rpx;
}

.name-block {
display: flex;
align-items: center;
margin-right: 16rpx;
}

.name-block image {
margin-right: 16rpx;
width: 40rpx;
height: 40rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-chat-message": "tdesign-miniprogram/chat-message/chat-message",
"t-chat-actionbar": "tdesign-miniprogram/chat-actionbar/chat-actionbar",
"t-divider": "tdesign-miniprogram/divider/divider"
}
}

```

#### 配置消息属性

支持`content`插槽自定义, `content`插槽使用建议：渲染聊天消息统一用 `t-chat-content`；仅在需要“单独使用 Markdown 组件”时使用 `t-chat-markdown`。也支持别的 markdown 渲染组件，选择其他 markdown 渲染库由用户自行安装。

**WXML** (`html`):
```html
<view class="chat-example">
<!-- 附件消息 -->
<view class="chat-example-block">
<t-chat-message
content="{{pic2.content}}"
role="{{pic2.role}}"
chatContentProps="{{chatContentProps}}"
></t-chat-message>
</view>
<view class="chat-example-block">
<t-chat-message
content="{{pic3.content}}"
role="{{pic3.role}}"
placement="right"
chatContentProps="{{chatContentProps}}"
></t-chat-message>
</view>
<view class="chat-example-block">
<t-chat-message
content="{{fileMessage.content}}"
role="{{fileMessage.role}}"
chatContentProps="{{chatContentProps}}"
></t-chat-message>
</view>
<view class="chat-example-block">
<t-chat-message
content="{{fileMessage.content}}"
role="{{fileMessage.role}}"
placement="right"
chatContentProps="{{chatContentProps}}"
></t-chat-message>
</view>
<!-- 思考过程消息 -->
<view class="chat-example-block">
<t-chat-message
content="{{aiMessage.content}}"
role="{{aiMessage.role}}"
status="{{aiMessage.status}}"
variant="text"
>
<t-chat-actionbar slot="actionbar" />
</t-chat-message>
</view>
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
aiMessage: {
role: 'assistant',
status: 'complete',
content: [
{
type: 'thinking',
data: {
title: '已完成思考（耗时3秒）',
text: '好的，我现在需要回答用户关于对比近3年当代偶像爱情剧并总结创作经验的问题\n查询网络信息中...\n根据网络搜索结果，成功案例包括《春色寄情人》《要久久爱》《你也有今天》等，但缺乏具体播放数据，需要结合行业报告总结共同特征。2022-2024年偶像爱情剧的创作经验主要集中在题材创新、现实元素融入、快节奏叙事等方面。结合行业报告和成功案例，总结出以下创作经验。',
},
},
{
type: 'text',
data: '不，牛顿第一定律并不适用于所有参考系。它只适用于惯性参考系。',
},
],
},
pic1: {
role: 'user',
name: '张三',
avatar: 'https://tdesign.gtimg.com/site/avatar.jpg',
content: [
{
type: 'attachment',
data: [
{
fileType: 'image',
name: 'avatar.jpg',
size: 234234,
url: 'https://tdesign.gtimg.com/demo/demo-image-1.png',
width: 1920, // 图片实际宽度
height: 1080, // 图片实际高度
},
],
},
{
type: 'text',
data: '分析以下内容，总结一篇广告策划方案',
},
],
},
pic3: {
role: 'user',
content: [
{
type: 'attachment',
data: [
{
fileType: 'image',
name: 'avatar.jpg',
size: 234234,
url: 'https://tdesign.gtimg.com/demo/demo-image-1.png',
width: 1920, // 图片实际宽度
height: 1080, // 图片实际高度
},
],
},
{
type: 'text',
data: '分析以下',
},
],
},
pic2: {
role: 'user',
content: [
{
type: 'attachment',
data: [
{
fileType: 'image',
name: 'avatar.jpg',
size: 234234,
url: 'https://tdesign.gtimg.com/demo/demo-image-1.png',
width: 1920, // 为了更好的适配不同尺寸图片建议传入宽高，不传也有兜底尺寸
height: 1080, // 为了更好的适配不同尺寸图片建议传入宽高，不传也有兜底尺寸
},
{
fileType: 'image',
name: 'avatar2.jpg',
size: 234234,
url: 'https://tdesign.gtimg.com/demo/demo-image-1.png',
width: 1920, // 图片实际宽度
height: 1080, // 图片实际高度
},
],
},
{
type: 'text',
data: '分析以下内容，总结一篇广告策划方案',
},
],
},
fileMessage: {
role: 'user',
content: [
{
type: 'attachment',
data: [
{
fileType: 'doc',
name: 'word-file.doc',
url: 'https://example.com/word-file.doc',
size: 222859,
status: 'success',
},
{
fileType: 'excel',
name: 'excel-file.xlsx',
url: 'https://example.com/excel-file.xlsx',
size: 222859,
status: 'success',
},
{
fileType: 'pdf',
name: 'pdf-file.pdf',
url: 'https://example.com/pdf-file.pdf',
size: 222859,
status: 'success',
},
{
fileType: 'ppt',
name: 'ppt-file.pptx',
url: 'https://example.com/ppt-file.pptx',
size: 222859,
status: 'success',
},
{
fileType: 'video',
name: 'video-file.mp4',
url: 'https://example.com/video-file.mp4',
size: 222859,
status: 'success',
},
{
fileType: 'file',
name: 'file',
url: 'https://example.com/audio-file.mp3',
size: 222859,
status: 'success',
},
],
},
{
type: 'text',
data: '不，牛顿第一定律并不适用于所有参考系。它只适用于惯性参考系。',
},
],
},
},
});

```

**CSS** (`css`):
```css
.chat-example {
display: flex;
flex-direction: column;
gap: 32rpx;
}

.chat-example-block {
background-color: var(--td-bg-color-container);
padding: 32rpx 32rpx 0 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-chat-message": "tdesign-miniprogram/chat-message/chat-message",
"t-chat-actionbar": "tdesign-miniprogram/chat-actionbar/chat-actionbar",
"t-avatar": "tdesign-miniprogram/avatar/avatar"
}
}
```

### 02组件状态

#### 加载状态

**WXML** (`html`):
```html
<view class="chat-example">
<view class="chat-example-block">
<t-chat-message
avatar="https://tdesign.gtimg.com/site/chat-avatar.png"
content="{{message.content}}"
role="{{message.role}}"
animation="gradient"
status="{{message.status}}"
></t-chat-message>
</view>
<view class="chat-example-block">
<t-chat-message
avatar="https://tdesign.gtimg.com/site/chat-avatar.png"
content="{{message.content}}"
role="{{message.role}}"
animation="skeleton"
status="{{message.status}}"
></t-chat-message>
</view>
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
message: {
role: 'assistant',
status: 'pending',
content: [
{
type: 'text',
data: '牛顿第一定律并不适用于所有参考系，它只适用于惯性参考系。在质点不受外力作用时，能够判断出质点静止或作匀速直线运动的参考系一定是惯性参考系，因此只有在惯性参考系中牛顿第一定律才适用。',
},
],
},
},
});

```

**CSS** (`css`):
```css
.chat-example {
display: flex;
flex-direction: column;
gap: 32rpx;
}

.chat-example-block {
background-color: var(--td-bg-color-container);
padding: 32rpx 32rpx 0 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-chat-message": "tdesign-miniprogram/chat-message/chat-message",
"t-chat-actionbar": "tdesign-miniprogram/chat-actionbar/chat-actionbar"
}
}

```

#### 出错状态

**WXML** (`html`):
```html
<view class="chat-example">
<view class="chat-example-block">
<t-chat-message
avatar="https://tdesign.gtimg.com/site/chat-avatar.png"
content="{{message.content}}"
role="{{message.role}}"
status="error"
></t-chat-message>
</view>
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
message: {
role: 'assistant',
status: 'error',
content: [
{
type: 'text',
data: '´• •`!!!请求出错',
},
],
},
},
});

```

**CSS** (`css`):
```css
.chat-example {
display: flex;
flex-direction: column;
gap: 32rpx;
}

.chat-example-block {
background-color: var(--td-bg-color-container);
padding: 32rpx 32rpx 0 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-chat-message": "tdesign-miniprogram/chat-message/chat-message",
"t-chat-actionbar": "tdesign-miniprogram/chat-actionbar/chat-actionbar"
}
}

```

### 03组件样式

#### 气泡样式

**WXML** (`html`):
```html
<view class="chat-example">
<view class="chat-example-block"
><t-chat-message content="{{userMessage.content}}" role="{{userMessage.role}}" variant="text"></t-chat-message
></view>
<view class="chat-example-block"
><t-chat-message content="{{userMessage.content}}" role="{{userMessage.role}}" variant="base"></t-chat-message
></view>
<view class="chat-example-block"
><t-chat-message content="{{userMessage.content}}" role="{{userMessage.role}}" variant="outline"></t-chat-message
></view>
</view>

```

**JS** (`javascript`):
```javascript
Component({
properties: {
userMessage: {
type: Object,
value: {
role: 'user',
content: [
{
type: 'text',
data: '牛顿第一定律是否适用于所有参考系？',
},
],
},
},
},
});

```

**CSS** (`css`):
```css
.chat-example {
display: flex;
flex-direction: column;
gap: 32rpx;
}

.chat-example-block {
background-color: var(--td-bg-color-container);
padding: 32rpx 32rpx 0 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"styleIsolation": "shared",
"usingComponents": {
"t-chat-message": "tdesign-miniprogram/chat-message/chat-message",
"t-chat-actionbar": "tdesign-miniprogram/chat-actionbar/chat-actionbar"
}
}

```

## API

### ChatMessageProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| animation | String | skeleton | 动画效果。可选项：skeleton/moving/gradient/dots | N |
| avatar | String | - | 自定义的头像配置 | N |
| chat-content-props | Object | - | 聊天内容组件的属性。TS 类型：`ChatContentProps`，ChatContent API Documents。详细类型定义 | N |
| chat-id | String | - | 聊天消息的唯一标识 | N |
| content | Array | - | 消息内容，数组中的每一项为一个消息内容对象。TS 类型：`ChatMessageContent[] ``type ChatMessageContent = TextContent \| MarkdownContent \| ThinkingContent \| AttachmentContent`` type AttachmentContent = ChatBaseContent<'attachment', FileItem[]>``type ThinkingContent = ChatBaseContent<'thinking', ThinkingContentData>``type MarkdownContent = ChatBaseContent<'markdown', string>``type TextContent = ChatBaseContent<'text', string>``interface ThinkingContentData {title?: string; text: string}``interface ChatBaseContent<T extends ChatContentType, TData> {type: T; data: TData}``type ChatMessageStatus = 'pending' \| 'streaming' \| 'complete' \| 'stop' \| 'error'``type ChatContentType = \| 'text' \| 'markdown' \| 'thinking' \| 'attachment'`，Attachments API Documents。详细类型定义 | N |
| datetime | String | - | 对话单元的时间配置 | N |
| name | String | - | 自定义的昵称 | N |
| placement | String | - | 消息显示位置。可选项：left/right | N |
| role | String | user | 消息角色。可选项：user/assistant/system | N |
| status | String | - | 消息状态。可选项：pending/streaming/complete/stop/error | N |
| variant | String | base | 气泡框样式，支持基础、线框、文字三种类型。可选项：base/outline/text | N |

### ChatMessageEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| longpress | `(detail: { id: string })` | - |

### ChatMessageSlots

| 名称 | 描述 |
| --- | --- |
| avatar | 自定义`avatar`显示内容 |
| content | 自定义消息内容 |
| name | 自定义`name`显示内容 |