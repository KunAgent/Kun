# ChatActionbar 对话操作

## 示例

## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-chat-actionbar": "tdesign-miniprogram/chat-actionbar/chat-actionbar"
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/TfXVvtmM8I4c)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 01组件类型

#### 基础类型

**WXML** (`html`):
```html
<t-toast id="t-toast" />
<view class="container">
<t-chat-actionbar content="{{content}}" bind:actions="handleAction" />
</view>

```

**JS** (`javascript`):
```javascript
import Toast from 'tdesign-miniprogram/toast';

Component({
data: {
content: '这是一段可以被复制的内容，支持markdown格式。\n\n**粗体文本**\n*斜体文本*\n\n- 列表项1\n- 列表项2',
},

methods: {
handleAction(e) {
const { name, active, data } = e.detail;

let message = '';
switch (name) {
case 'replay':
message = '重新生成';
break;
case 'copy':
console.log(data);
message = '复制成功';
break;
case 'good':
message = active ? '点赞成功' : '取消点赞';
break;
case 'bad':
message = active ? '点踩成功' : '取消点踩';
break;
case 'share':
message = '分享功能';
break;
default:
message = `执行了${name}操作`;
}

Toast({
context: this,
selector: '#t-toast',
message,
theme: 'success',
});
},
},
});

```

**CSS** (`css`):
```css
.container {
padding: 32rpx;
background-color: var(--td-bg-color-container);
}

.layout-btn {
margin: 16rpx 0;
padding: 12rpx 24rpx;
background-color: #0052d9;
color: #fff;
border: none;
border-radius: 8rpx;
font-size: 28rpx;
}

.demo-text {
padding: 16rpx 0;
}

.checkbox-group {
display: flex;
flex-wrap: wrap;
gap: 16rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-chat-actionbar": "tdesign-miniprogram/chat-actionbar/chat-actionbar",
"t-toast": "tdesign-miniprogram/toast/toast"
}
}

```

### 02组件状态

#### 手动初始化状态

**WXML** (`html`):
```html
<t-toast id="t-toast" />
<view class="container">
<t-chat-actionbar content="{{content}}" bind:actions="handleAction" comment="{{comment}}" />
</view>

```

**JS** (`javascript`):
```javascript
import Toast from 'tdesign-miniprogram/toast';

Page({
data: {
content: '这是一段可以被复制的内容，支持markdown格式。\n\n**粗体文本**\n*斜体文本*\n\n- 列表项1\n- 列表项2',
comment: 'good',
},

handleAction(e) {
const { name, active, data } = e.detail;

let message = '';
switch (name) {
case 'replay':
message = '重新生成';
break;
case 'copy':
console.log(data);
message = '复制成功';
break;
case 'good':
message = active ? '点赞成功' : '取消点赞';
break;
case 'bad':
message = active ? '点踩成功' : '取消点踩';
break;
case 'share':
message = '分享功能';
break;
default:
message = `执行了${name}操作`;
}

Toast({
context: this,
selector: '#t-toast',
message,
theme: 'success',
});
},
});

```

**CSS** (`css`):
```css
.container {
padding: 32rpx;
background-color: var(--td-bg-color-container);
}

.layout-btn {
margin: 16rpx 0;
padding: 12rpx 24rpx;
background-color: #0052d9;
color: #fff;
border: none;
border-radius: 8rpx;
font-size: 28rpx;
}

.demo-text {
padding: 16rpx 0;
}

.checkbox-group {
display: flex;
flex-wrap: wrap;
gap: 16rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"usingComponents": {
"t-chat-actionbar": "tdesign-miniprogram/chat-actionbar/chat-actionbar",
"t-toast": "tdesign-miniprogram/toast/toast"
}
}

```

## API

### ChatActionbarProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| action-bar | Array | ['replay', 'copy', 'good', 'bad', 'share'] | 操作栏配置。TS 类型：`Array<'replay'\|'copy'\|'good'\|'bad'\|'share'>` | N |
| chat-id | String | - | 【实验】聊天消息的唯一标识 | N |
| comment | String | - | 评价内容 | N |
| content | String | - | 被复制的内容 | N |
| copy-mode | String | markdown | 【实验】复制内容的模式，可选 'markdown'（复制markdown原文）或 'text'（复制纯文本）。可选项：markdown/text | N |
| disabled | Boolean | false | 【讨论中】操作按钮是否可点击 | N |
| placement | String | start | 【实验】操作栏位置。可选项：start/end/space-around/space-between | N |

### ChatActionbarEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| actions | `(detail: {name: string, active: boolean})` | 点击点赞，点踩，复制，分享，重新生成按钮时触发发 |