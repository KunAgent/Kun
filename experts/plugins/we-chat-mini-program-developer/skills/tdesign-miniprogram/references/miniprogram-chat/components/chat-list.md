# ChatList 对话列表

## 示例

## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-chat": "tdesign-miniprogram/chat-list/chat-list"
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/Cl1guumx824W)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 组件类型

#### 基础使用

**WXML** (`html`):
```html
<view class="chat-box" style="height: {{contentHeight}};">
<t-chat id="chatList" bindscroll="onScroll">
<block wx:for="{{chatList}}" wx:key="index">
<t-chat-message
avatar="{{item.avatar || ''}}"
name="{{item.name || ''}}"
datetime="{{item.datetime || ''}}"
content="{{item.content}}"
role="{{item.role}}"
placement="{{item.role === 'user' ? 'right' : 'left'}}"
status="{{item.status || ''}}"
>
<t-chat-actionbar
wx:if="{{chatIndex !== chatList.length - 1 && item.status === 'complete' && item.role === 'assistant'}}"
slot="actionbar"
placement="end"
bind:actions="handleAction"
/>
</t-chat-message>
</block>
<view slot="footer">
<t-chat-sender
value="{{value}}"
loading="{{loading}}"
disabled="{{disabled}}"
autoRiseWithKeyboard="{{true}}"
renderPresets="{{renderPresets}}"
bind:send="onSend"
bind:stop="onStop"
bind:focus="onFocus"
/>
</view>
</t-chat>
<!-- 内置虚拟列表优化性能仅在data属性中使用 -->
<!-- <t-chat id="chatList" bindscroll="onScroll" data="{{chatList}}"></t-chat> -->
</view>
<t-toast id="t-toast" />

```

**JS** (`javascript`):
```javascript
import Toast from 'tdesign-miniprogram/toast';
import { getNavigationBarHeight } from '../../../utils/utils';

const mockData = `南极的自动提款机并没有一个特定的专属名称，但历史上确实有一台ATM机曾短暂存在于南极的**麦克默多站**（McMurdo Station）。这台ATM由美国**富兰克林国家银行**（Wells Fargo）于1998年安装，主要供驻扎在该站的科研人员使用。不过，由于南极的极端环境和极低的人口密度，这台ATM机并未长期运行，最终被移除。

**背景补充：**
- **麦克默多站**是美国在南极最大的科研基地，夏季人口可达约1,000人，冬季约200人。
- 该ATM机更多是作为一种象征性服务存在，实际使用频率极低，因为南极科考人员通常依靠预支资金或电子支付。
- 目前南极已无长期运行的ATM机，现代科考站更多依赖非现金交易方式。

南极作为非主权领土，其基础设施以科研和生活支持为主，商业金融服务非常有限。若有类似设施，通常是临时或实验性质的。`;

const sleep = (ms) => {
return new Promise((resolve) => setTimeout(resolve, ms));
};

const fetchStream = async (str, options) => {
const { success, complete, delay = 100 } = options;

const arr = str.split('');

for (let i = 0; i < arr.length; i += 1) {
// eslint-disable-next-line no-await-in-loop
await sleep(delay);
success(arr[i]);
}

complete();
};

Component({
options: {
styleIsolation: 'shared',
},
data: {
renderPresets: [{ name: 'send', type: 'icon' }],
chatList: [
{
avatar: 'https://tdesign.gtimg.com/site/chat-avatar.png',
role: 'assistant',
status: 'complete',
content: [
{
type: 'text',
data: '它叫 McMurdo Station ATM，是美国富国银行安装在南极洲最大科学中心麦克默多站的一台自动提款机。',
},
],
},
{
role: 'user',
content: [
{
type: 'text',
data: '牛顿第一定律是否适用于所有参考系？',
},
],
},
],
value: '', // 输入框的值
loading: false, // 加载状态
disabled: false, // 禁用状态
inputStyle: '', // 输入框样式
contentHeight: '100vh', // 内容高度
animation: 'dots',
},

methods: {
// 调用chatList的滚动到底部方法
scrollToBottom() {
const chatListComponent = this.selectComponent('#chatList');
if (chatListComponent && typeof chatListComponent.scrollToBottom === 'function') {
chatListComponent.scrollToBottom();
}
},
onScroll(e) {
console.log('监听滚动', e);
},
// 发送消息事件处理
onSend(e) {
const { value } = e.detail;
if (!value || value.trim() === '') return;

// 创建用户消息对象
const userMessage = {
role: 'user',
content: [
{
type: 'text',
data: value.trim(),
},
],
};

// 将用户消息插入到chatList的开头（因为reverse为true，所以用unshift）
this.setData({
chatList: [userMessage, ...this.data.chatList],
value: '', // 清空输入框
});

// 模拟助手回复（可选）
this.simulateAssistantReply(value.trim());
},

// 停止事件处理
onStop() {
this.setData({
loading: false,
});
},

// 聚焦事件处理
onFocus() {
console.log('输入框聚焦');
},
// 获取当前时间
getCurrentTime() {
const now = new Date();
const hours = now.getHours().toString().padStart(2, '0');
const minutes = now.getMinutes().toString().padStart(2, '0');
return `${hours}:${minutes}`;
},

// 模拟助手回复
simulateAssistantReply() {
this.setData({ loading: true});
// 请求中
const assistantMessage = {
role: 'assistant',
content: [
{
type: 'markdown',
data: '',
},
],
avatar: 'https://tdesign.gtimg.com/site/chat-avatar.png',
status: 'pending',
};
this.setData({
chatList: [assistantMessage, ...this.data.chatList],
});
const that = this;
wx.nextTick(() => {
fetchStream(mockData, {
success(result) {
// 生文中
that.data.chatList[0].status = 'streaming';
if (!that.data.loading) return;
that.data.chatList[0].content[0].data += result;
that.setData({
chatList: that.data.chatList,
});
},
complete() {
that.data.chatList[0].status = 'complete';
that.setData({
chatList: that.data.chatList,
});
that.setData({
loading: false,
});
},
});
});
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
},
lifetimes: {
attached: function () {
/**
* 计算内容区域高度
* 生成CSS calc表达式：calc(100vh - 96rpx - 导航高度 - 底部安全区域高度)
*/
try {
// 获取当前的导航栏高度和安全区域高度
const navigationBarHeight = getNavigationBarHeight() || 0;

// 生成CSS calc表达式字符串
const contentHeight = `calc(100vh - 96rpx - ${navigationBarHeight}px)`;

this.setData({
contentHeight: contentHeight,
});

console.log('内容区域高度CSS表达式:', contentHeight);
} catch (error) {
console.error('生成内容高度表达式失败:', error);
this.setData({
contentHeight: 'calc(100vh - 96rpx)',
});
}
},
},
});

```

**CSS** (`css`):
```css
.chat-box {
padding-top: 32rpx;
box-sizing: border-box;
}

.t-chat__list {
padding: 0 0 0 32rpx;
box-sizing: border-box;
}

.t-chat-message {
padding: 0 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"styleIsolation": "shared",
"usingComponents": {
"t-chat-message": "tdesign-miniprogram/chat-message/chat-message",
"t-chat-content": "tdesign-miniprogram/chat-content/chat-content",
"t-chat": "tdesign-miniprogram/chat-list/chat-list",
"t-chat-sender": "tdesign-miniprogram/chat-sender/chat-sender",
"t-chat-actionbar": "tdesign-miniprogram/chat-actionbar/chat-actionbar",
"t-toast": "tdesign-miniprogram/toast/toast"
}
}

```

**MOCK** (`javascript`):
```javascript
// file test

```

#### 组合式用法

**WXML** (`html`):
```html
<view class="chat-box" style="height: {{contentHeight}};">
<t-chat>
<block wx:for="{{chatList}}" wx:key="index">
<t-chat-message
avatar="{{item.avatar || ''}}"
name="{{item.name || ''}}"
datetime="{{item.datetime || ''}}"
content="{{item.message.content}}"
role="{{item.message.role}}"
placement="{{item.message.role === 'user' ? 'right' : 'left'}}"
>
<t-chat-actionbar
wx:if="{{chatIndex !== chatList.length - 1 && item.message.status === 'complete' && item.message.role === 'assistant'}}"
slot="actionbar"
placement="end"
bind:actions="handleAction"
/>
</t-chat-message>
</block>
<view slot="footer">
<t-chat-sender
value="{{value}}"
loading="{{loading}}"
disabled="{{disabled}}"
renderPresets="{{renderPresets}}"
bind:send="onSend"
bind:stop="onStop"
bind:focus="onFocus"
autoRiseWithKeyboard="{{true}}"
/>
</view>
</t-chat>
</view>
<t-toast id="t-toast" />

```

**JS** (`javascript`):
```javascript
import Toast from 'tdesign-miniprogram/toast';
import { getNavigationBarHeight } from '../../../utils/utils';

const mockData = {
avatar: 'https://tdesign.gtimg.com/site/chat-avatar.png',
message: {
role: 'assistant',
content: [
{
type: 'thinking',
status: 'complete',
data: {
title: '思考中',
text: '',
},
},
],
},
};

const mockData1 =
'嗯，用户问的是南极的自动提款机叫什么名字。这个问题有点有趣，因为南极是一个极端寒冷的地方，而且大部分地区都是无人居住的科研站。\n';

const mockData2 =
'\n\n南极的自动提款机并没有一个特定的专属名称，但历史上确实有一台ATM机曾短暂存在于南极的**麦克默多站**（McMurdo Station）。这台ATM由美国**富兰克林国家银行**（Wells Fargo）于1998年安装，主要供驻扎在该站的科研人员使用。不过，由于南极的极端环境和极低的人口密度，这台ATM机并未长期运行，最终被移除。\n\n**背景补充：**\n- **麦克默多站**是美国在南极最大的科研基地，夏季人口可达约1,000人，冬季约200人。\n- 该ATM机更多是作为一种象征性服务存在，实际使用频率极低，因为南极科考人员通常依靠预支资金或电子支付。\n- 目前南极已无长期运行的ATM机，现代科考站更多依赖非现金交易方式。\n\n南极作为非主权领土，其基础设施以科研和生活支持为主，商业金融服务非常有限。若有类似设施，通常是临时或实验性质的。';

const sleep = (ms) => {
return new Promise((resolve) => setTimeout(resolve, ms));
};

const fetchStream = async (str, options) => {
const { success, complete, delay = 100 } = options;

const arr = str.split('');

for (let i = 0; i < arr.length; i += 1) {
// eslint-disable-next-line no-await-in-loop
await sleep(delay);
success(arr[i]);
}

complete();
};

Component({
properties: {
isActive: {
type: Boolean,
value: false,
observer: function (v) {
this.setData({
value: v ? '南极的自动提款机叫什么名字' : '', // 输入框的值
});
},
},
},
data: {
renderPresets: [
{
name: 'send',
type: 'icon',
},
],
chatList: [
{
avatar: 'https://tdesign.gtimg.com/site/chat-avatar.png',
message: {
status: 'complete',
role: 'assistant',
content: [
{
type: 'text',
data: '它叫 McMurdo Station ATM，是美国富国银行安装在南极洲最大科学中心麦克默多站的一台自动提款机。',
},
],
},
},
{
message: {
role: 'user',
content: [
{
type: 'text',
data: '牛顿第一定律是否适用于所有参考系？',
},
],
},
},
],

value: '',
loading: false, // 加载状态
disabled: false, // 禁用状态
inputStyle: '', // 动态样式
contentHeight: '100vh', // 内容高度
},

methods: {
// 发送消息事件处理
onSend(e) {
const { value } = e.detail;
if (!value || value.trim() === '') return;

// 创建用户消息对象
const userMessage = {
message: {
role: 'user',
content: [
{
type: 'text',
data: value.trim(),
},
],
},
};

// 将用户消息插入到chatList的开头（因为reverse为true，所以用unshift）
this.setData({
chatList: [userMessage, ...this.data.chatList],
value: '', // 清空输入框
});

// 模拟助手回复（可选）
this.simulateAssistantReply(value.trim());
},

// 停止事件处理
onStop() {
console.log('停止发送');
this.setData({
loading: false,
});
},

// 聚焦事件处理
onFocus() {
console.log('输入框聚焦');
},

// 获取当前时间
getCurrentTime() {
const now = new Date();
const hours = now.getHours().toString().padStart(2, '0');
const minutes = now.getMinutes().toString().padStart(2, '0');
return `${hours}:${minutes}`;
},

// 模拟助手回复
simulateAssistantReply() {
this.setData({ loading: true });

const assistantMessage = mockData;

this.setData({
chatList: [assistantMessage, ...this.data.chatList],
});

const that = this;
wx.nextTick(async () => {
await fetchStream(mockData1, {
success(result) {
if (!that.data.loading) return;
that.data.chatList[0].message.content[0].data.text += result;
that.setData({
chatList: that.data.chatList,
});
},
complete() {
that.data.chatList[0].message.content[0].data.title = '思考完成';
that.setData({
chatList: that.data.chatList,
});
},
});

if (!that.data.loading) return;

that.data.chatList[0].message.content.push({
type: 'markdown',
data: '',
});
that.setData({
chatList: that.data.chatList,
});

await fetchStream(mockData2, {
success(result) {
if (!that.data.loading) return;
that.data.chatList[0].message.content[1].data += result;
that.setData({
chatList: that.data.chatList,
});
},
complete() {
that.data.chatList[0].message.status = 'complete';
that.setData({
chatList: that.data.chatList,
});
that.setData({
loading: false,
});
},
});
});
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
},
lifetimes: {
attached: function () {
console.log('-----attached----');
/**
* 计算内容区域高度
* 生成CSS calc表达式：calc(100vh - 96rpx - 导航高度 - 底部安全区域高度)
*/
try {
// 获取当前的导航栏高度和安全区域高度
const navigationBarHeight = getNavigationBarHeight() || 0;

// 生成CSS calc表达式字符串
const contentHeight = `calc(100vh - 96rpx - ${navigationBarHeight}px)`;

this.setData({
contentHeight: contentHeight,
});

console.log('内容区域高度CSS表达式:', contentHeight);
} catch (error) {
console.error('生成内容高度表达式失败:', error);
this.setData({
contentHeight: 'calc(100vh - 96rpx)',
});
}
},
},
});

```

**CSS** (`css`):
```css
.chat-box {
padding-top: 32rpx;
box-sizing: border-box;
}

.t-chat__list {
padding: 0 0 0 32rpx;
box-sizing: border-box;
}

.t-chat-message {
padding: 0 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"styleIsolation": "shared",
"usingComponents": {
"t-chat-message": "tdesign-miniprogram/chat-message/chat-message",
"t-chat-content": "tdesign-miniprogram/chat-content/chat-content",
"t-chat": "tdesign-miniprogram/chat-list/chat-list",
"t-chat-sender": "tdesign-miniprogram/chat-sender/chat-sender",
"t-chat-actionbar": "tdesign-miniprogram/chat-actionbar/chat-actionbar",
"t-toast": "tdesign-miniprogram/toast/toast"
}
}

```

#### 自定义

`t-chat-message`支持`content`自定义，使用建议：渲染聊天消息统一用 `t-chat-content`；仅在需要“单独使用 Markdown 组件”或自定义管线时使用 `t-chat-markdown`。也支持别的 markdown 渲染组件，选择其他 markdown 渲染库由用户自行安装。

**WXML** (`html`):
```html
<view class="chat-box chart-chat" style="height: {{contentHeight}};">
<t-chat>
<block wx:for="{{chatList}}" wx:key="index" wx:for-index="chatIndex">
<t-chat-message
class="{{item.message.role}}"
avatar="{{item.avatar || ''}}"
name="{{item.name || ''}}"
datetime="{{item.datetime || ''}}"
role="{{item.message.role || 'assistant'}}"
placement="{{item.message.role === 'user' ? 'right' : 'left'}}"
>
<view slot="content">
<block
wx:for="{{item.message.content}}"
wx:for-item="contentItem"
wx:for-index="contentIndex"
wx:key="contentIndex"
>
<t-chat-content
content="{{contentItem}}"
wx:if="{{contentItem.type === 'text' || contentItem.type === 'markdown'}}"
/>
<!-- 封装的图表组件见源码 -->
<chart-component wx:if="{{contentItem.type === 'chart'}}" el="normalLine" options="{{contentItem}}" />
</block>
</view>
<t-chat-actionbar
wx:if="{{chatIndex !== chatList.length - 1 && item.message.status === 'complete' && item.message.role === 'assistant'}}"
slot="actionbar"
placement="end"
bind:actions="handleAction"
/>
</t-chat-message>
</block>
<view slot="footer">
<t-chat-sender
value="{{value}}"
loading="{{loading}}"
disabled="{{disabled}}"
renderPresets="{{renderPresets}}"
bind:send="onSend"
bind:stop="onStop"
bind:focus="onFocus"
autoRiseWithKeyboard="{{true}}"
/>
</view>
</t-chat>
</view>
<t-toast id="t-toast" />

```

**JS** (`javascript`):
```javascript
import Toast from 'tdesign-miniprogram/toast';
import { getNavigationBarHeight } from '../../../utils/utils';

const sleep = (ms) => {
return new Promise((resolve) => setTimeout(resolve, ms));
};

const fetchStream = async (str, options) => {
const { success, complete, delay = 100 } = options;

const arr = str.split('');

for (let i = 0; i < arr.length; i += 1) {
// eslint-disable-next-line no-await-in-loop
await sleep(delay);
success(arr[i]);
}

complete();
};

Component({
properties: {
isActive: {
type: Boolean,
value: false,
observer: function (v) {
this.setData({
value: v ? '南极的自动提款机叫什么名字' : '', // 输入框的值
});
},
},
},

options: {
styleIsolation: 'shared',
},
data: {
renderPresets: [
{
name: 'send',
type: 'icon',
},
],
chatList: [
{
avatar: 'https://tdesign.gtimg.com/site/chat-avatar.png',
message: {
role: 'assistant',
content: [
{
type: 'text',
data: '欢迎使用TDesign智能图表分析助手，请输入你的问题',
},
],
},
},
],
value: '', // 输入框的值
loading: false, // 加载状态
disabled: false, // 禁用状态
inputStyle: '', // 动态样式
contentHeight: '100vh', // 内容高度
},
methods: {
// 发送消息事件处理
onSend(e) {
const { value } = e.detail;
if (!value || value.trim() === '') return;

// 创建用户消息对象
const userMessage = {
message: {
role: 'user',
content: [
{
type: 'text',
data: value.trim(),
},
],
},
};

// 将用户消息插入到chatList的开头（因为reverse为true，所以用unshift）
this.setData({
chatList: [userMessage, ...this.data.chatList],
value: '', // 清空输入框
});

// 模拟助手回复（可选）
this.simulateAssistantReply(value.trim());
},

// 停止事件处理
onStop() {
console.log('停止发送');
this.setData({
loading: false,
});
},

// 聚焦事件处理
onFocus() {
console.log('输入框聚焦');
},

// 获取当前时间
getCurrentTime() {
const now = new Date();
const hours = now.getHours().toString().padStart(2, '0');
const minutes = now.getMinutes().toString().padStart(2, '0');
return `${hours}:${minutes}`;
},

// 模拟助手回复
simulateAssistantReply() {
this.setData({ loading: true });

const assistantMessage = {
avatar: 'https://tdesign.gtimg.com/site/chat-avatar.png',
message: {
role: 'assistant',
content: [
{
type: 'markdown',
data: '',
},
],
},
};

const list = [assistantMessage, ...this.data.chatList];

this.setData({
chatList: list,
});

const that = this;
wx.nextTick(async () => {
await fetchStream(
'今日上午北京道路车辆通行状况9:00的峰值（1320),可能显示早高峰拥堵最严重时段10:00后缓慢回落，可以得出如下折线图：',
{
success(result) {
if (!that.data.loading) return;
that.data.chatList[0].message.content[0].data += result;
that.setData({
chatList: that.data.chatList,
});
},
complete() {},
},
);

if (!that.data.loading) return;

that.data.chatList[0].message.content.push(
{
type: 'chart',
data: {
id: 8379.117942106575,
chartType: 'line',
options: {
xAxis: {
boundaryGap: true,
type: 'category',
data: ['0:00', '1:00', '2:00', '3:00', '4:00', '5:00', '6:00'],
},
yAxis: {
type: 'value',
},
series: [
{
data: [500, 401, 382, 433, 560, 630, 720],
type: 'line',
},
],
},
},
},
{
type: 'markdown',
data: '',
},
);
that.setData({
chatList: that.data.chatList,
});

await fetchStream(
'今日晚上北京道路车辆通行状况18:00的峰值（1322),可能显示早高峰拥堵最严重时段21:00后缓慢回落，可以得出如下折线图：',
{
success(result) {
if (!that.data.loading) return;
that.data.chatList[0].message.content[2].data += result;
that.setData({
chatList: that.data.chatList,
});
},
complete() {},
},
);

if (!that.data.loading) return;

that.data.chatList[0].message.content.push({
type: 'chart',
data: {
id: 9954.694158956194,
chartType: 'line',
options: {
xAxis: {
boundaryGap: true,
type: 'category',
data: ['0:00', '1:00', '2:00', '3:00', '4:00', '5:00', '6:00'],
},
yAxis: {
type: 'value',
},
series: [
{
data: [500, 401, 382, 433, 560, 630, 720],
type: 'line',
},
],
},
},
strategy: 'append',
status: 'complete',
});
that.data.chatList[0].message.status = 'complete';
that.setData({
chatList: that.data.chatList,
loading: false,
});
});
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
},
lifetimes: {
attached: function () {
/**
* 计算内容区域高度
* 生成CSS calc表达式：calc(100vh - 96rpx - 导航高度 - 底部安全区域高度)
*/
try {
// 获取当前的导航栏高度和安全区域高度
const navigationBarHeight = getNavigationBarHeight() || 0;

// 生成CSS calc表达式字符串
const contentHeight = `calc(100vh - 96rpx - ${navigationBarHeight}px)`;

this.setData({
contentHeight: contentHeight,
});

console.log('内容区域高度CSS表达式:', contentHeight);
} catch (error) {
console.error('生成内容高度表达式失败:', error);
this.setData({
contentHeight: 'calc(100vh - 96rpx)',
});
}
},
},
});

```

**CSS** (`css`):
```css
.chat-box {
padding-top: 32rpx;
box-sizing: border-box;
}

.t-chat__list {
padding: 0 0 0 32rpx;
box-sizing: border-box;
}

.t-chat-message {
padding: 0 32rpx;
}

.chart-chat .assistant .t-chat__detail {
width: 100%;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"styleIsolation": "shared",
"usingComponents": {
"t-toast": "tdesign-miniprogram/toast/toast",
"t-chat-message": "tdesign-miniprogram/chat-message/chat-message",
"t-chat-content": "tdesign-miniprogram/chat-content/chat-content",
"t-chat": "tdesign-miniprogram/chat-list/chat-list",
"t-chat-sender": "tdesign-miniprogram/chat-sender/chat-sender",
"t-chat-actionbar": "tdesign-miniprogram/chat-actionbar/chat-actionbar",
"chart-component": "../chart-component"
}
}

```

#### 文案助手

**WXML** (`html`):
```html
<view class="chat-box" style="height: {{contentHeight}};">
<t-chat>
<block wx:for="{{chatList}}" wx:key="index" wx:for-index="chatIndex">
<t-chat-message
avatar="{{item.avatar || ''}}"
name="{{item.name || ''}}"
datetime="{{item.datetime || ''}}"
content="{{item.message.content}}"
role="{{item.message.role}}"
chatContentProps="{{chatContentProps}}"
placement="{{item.message.role === 'user' ? 'right' : 'left'}}"
>
<t-chat-actionbar
wx:if="{{chatIndex !== chatList.length - 1 && item.message.status === 'complete' && item.message.role === 'assistant'}}"
slot="actionbar"
actionBar="{{customActionBar}}"
bind:actions="handleAction"
/>
</t-chat-message>
</block>
<view slot="footer">
<t-chat-sender
value="{{value}}"
loading="{{loading}}"
disabled="{{disabled}}"
bind:send="onSend"
fileList="{{fileList}}"
bind:stop="onStop"
bind:focus="onFocus"
bind:keyboardheightchange="onkeyboardheightchange"
bind:updateVisible="onUpdateVisible"
bind:fileDelete="onFileDelete"
bind:fileChange="onFileChange"
attachmentsProps="{{attachmentsProps}}"
renderPresets="{{renderPresets}}"
autoRiseWithKeyboard="{{true}}"
visible="{{visible}}"
/>
</view>
</t-chat>
</view>
<t-toast id="t-toast" />

```

**JS** (`javascript`):
```javascript
import Toast from 'tdesign-miniprogram/toast';
import { getNavigationBarHeight } from '../../../utils/utils';

const mockData1 =
'🌼宝子们，春天来啦，这些户外郊游打卡地你必须知道👏\n\n🌟郊野公园\n这里有大片的草地和各种花卉，随便一拍都是大片既视感📷。还能放风筝、野餐，享受惬意的春日时光。\n\n🌳植物园\n各种珍稀植物汇聚于此，仿佛置身于绿色的海洋。漫步其中，感受大自然的神奇与美丽。\n\n💧湖边湿地\n湖水清澈，周围生态环境优越。能看到很多候鸟和水生植物，是亲近自然的好去处。\n\n宝子们，赶紧收拾行囊，去这些地方打卡吧😜。\n\n#春天郊游 #打卡目的地 #户外之旅 #春日美景';

const sleep = (ms) => {
return new Promise((resolve) => setTimeout(resolve, ms));
};

const fetchStream = async (str, options) => {
const { success, complete, delay = 100 } = options;

const arr = str.split('');

for (let i = 0; i < arr.length; i += 1) {
// eslint-disable-next-line no-await-in-loop
await sleep(delay);
success(arr[i]);
}

complete();
};

Component({
properties: {
isActive: {
type: Boolean,
value: false,
observer: function (v) {
// 延迟 30ms，避免 hidden 场景下， value 变更无法触发 textarea 的自动换行
// 代码片段（iOS 真机可复现）：https://developers.weixin.qq.com/s/7UoAYgmr8G4k
setTimeout(() => {
this.setData({
value: v ? '根据所提供的材料总结一篇文章，推荐春天户外郊游打卡目的地，需要符合小红书平台写作风格' : '', // 输入框的值
});
}, 30);
},
},
},
data: {
customActionBar: ['copy', 'good', 'bad'],
chatList: [
{
avatar: 'https://tdesign.gtimg.com/site/chat-avatar.png',
message: {
role: 'assistant',
content: [
{
type: 'text',
data: '欢迎使用TDesign文案写作助手，可以先上传你需要参考的文件，输入你要撰写的主题~',
},
],
},
},
],
value: '', // 输入框的值
loading: false, // 加载状态
disabled: false, // 禁用状态
inputStyle: '', // 动态样式
attachmentsProps: {
items: [],
removable: true,
imageViewer: true,
addable: false,
},
renderPresets: [
{
name: 'upload',
presets: ['uploadCamera', 'uploadImage', 'uploadAttachment'],
status: '',
},
{
name: 'send',
type: 'icon',
},
],
fileList: [],
visible: false, // 是否显示选择文件面板
chatContentProps: {
thinking: { maxHeight: 100, collapsed: true },
},
contentHeight: '100vh', // 内容高度
},

methods: {
// 发送消息事件处理
onSend(e) {
const { value } = e.detail;
if (!value || value.trim() === '') return;

// 创建用户消息对象
const content = [
{
type: 'text',
data: value.trim(),
},
];
const attachments = this.data.attachmentsProps.items.map((item) => {
return {
...item,
status: 'success',
};
});
content.unshift({
type: 'attachment',
data: attachments,
});
this.setData({
attachmentsProps: {
...this.data.attachmentsProps,
items: [],
},
fileList: [],
});
const userMessage = {
message: {
role: 'user',
content,
},
};

// 将用户消息插入到chatList的开头（因为reverse为true，所以用unshift）
this.setData({
chatList: [userMessage, ...this.data.chatList],
value: '', // 清空输入框
});

// 模拟助手回复（可选）
this.simulateAssistantReply(value.trim());
},

// 停止事件处理
onStop() {
console.log('停止发送');
this.setData({
loading: false,
});
},

// 聚焦事件处理
onFocus() {
console.log('输入框聚焦');
},

// 打开选择文件界面
onUpdateVisible(e) {
const visible = e.detail;
console.log('上传面板显示状态:', visible);
this.setData({ visible });
},

onFileDelete() {
this.setData({
attachmentsProps: {
...this.data.attachmentsProps,
items: [],
},
});
},

onFileChange(e) {
const { files } = e.detail;
this.setData({ attachmentsProps: { ...this.data.attachmentsProps, items: files } });
this.setData({ fileList: files });
},

// 模拟助手回复
simulateAssistantReply() {
this.setData({ loading: true });

const assistantMessage = {
avatar: 'https://tdesign.gtimg.com/site/chat-avatar.png',
message: {
role: 'assistant',
content: [
{
type: 'markdown',
data: '',
},
],
},
};

this.setData({
chatList: [assistantMessage, ...this.data.chatList],
});

const that = this;
wx.nextTick(() => {
fetchStream(mockData1, {
success(result) {
if (!that.data.loading) return;
that.data.chatList[0].message.content[0].data += result;
that.setData({
chatList: that.data.chatList,
});
},
complete() {
that.data.chatList[0].message.status = 'complete';
that.setData({
chatList: that.data.chatList,
});
that.setData({
loading: false,
});
},
});
});
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
},
lifetimes: {
attached: function () {
/**
* 计算内容区域高度
* 生成CSS calc表达式：calc(100vh - 96rpx - 导航高度 - 底部安全区域高度)
*/
try {
// 获取当前的导航栏高度和安全区域高度
const navigationBarHeight = getNavigationBarHeight() || 0;

// 生成CSS calc表达式字符串
const contentHeight = `calc(100vh - 96rpx - ${navigationBarHeight}px)`;

this.setData({
contentHeight: contentHeight,
});

console.log('内容区域高度CSS表达式:', contentHeight);
} catch (error) {
console.error('生成内容高度表达式失败:', error);
this.setData({
contentHeight: 'calc(100vh - 96rpx)',
});
}
},
},
});

```

**CSS** (`css`):
```css
.chat-box {
padding-top: 32rpx;
box-sizing: border-box;
}

.t-chat__list {
padding: 0 0 0 32rpx;
box-sizing: border-box;
}

.t-chat-message {
padding: 0 32rpx;
}

.preview {
padding: 16rpx;
display: flex;
justify-content: space-between;
border: 1px solid black;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"styleIsolation": "shared",
"usingComponents": {
"t-chat-message": "tdesign-miniprogram/chat-message/chat-message",
"t-chat-content": "tdesign-miniprogram/chat-content/chat-content",
"t-chat": "tdesign-miniprogram/chat-list/chat-list",
"t-chat-sender": "tdesign-miniprogram/chat-sender/chat-sender",
"t-chat-actionbar": "tdesign-miniprogram/chat-actionbar/chat-actionbar",
"t-toast": "tdesign-miniprogram/toast/toast"
}
}

```

#### 图像生成

**WXML** (`html`):
```html
<view class="chat-box image-chat" style="height: {{contentHeight}};">
<t-chat>
<block wx:for="{{chatList}}" wx:key="index" wx:for-index="chatIndex">
<t-chat-message
avatar="{{item.avatar || ''}}"
name="{{item.name || ''}}"
datetime="{{item.datetime || ''}}"
role="{{item.message.role}}"
placement="{{item.message.role === 'user' ? 'right' : 'left'}}"
>
<view wx:if="{{item.message.role === 'user'}}" slot="content">
<block
wx:for="{{item.message.content}}"
wx:for-item="contentItem"
wx:for-index="contentIndex"
wx:key="contentIndex"
>
<t-chat-content
content="{{contentItem}}"
wx:if="{{contentItem.type === 'text' || contentItem.type === 'markdown'}}"
/>
</block>
</view>
<view wx:else style="width: 100%" slot="content">
<block
wx:for="{{item.message.content}}"
wx:for-item="contentItem"
wx:for-index="contentIndex"
wx:key="contentIndex"
>
<t-chat-content
content="{{contentItem}}"
wx:if="{{contentItem.type === 'text' || contentItem.type === 'markdown'}}"
/>
<view wx:else class="attachment-slide">
<t-attachments items="{{contentItem.data}}" inChat="{{true}}" removable="{{false}}" />
</view>
</block>
</view>
<t-chat-actionbar
wx:if="{{chatIndex !== chatList.length - 1 && item.message.status === 'complete' && item.message.role === 'assistant'}}"
slot="actionbar"
placement="end"
bind:actions="handleAction"
/>
</t-chat-message>
</block>
<view slot="footer">
<t-chat-sender
value="{{value}}"
loading="{{loading}}"
disabled="{{disabled}}"
renderPresets="{{renderPresets}}"
bind:send="onSend"
bind:stop="onStop"
bind:focus="onFocus"
autoRiseWithKeyboard="{{true}}"
/>
</view>
</t-chat>
</view>
<t-toast id="t-toast" />

```

**JS** (`javascript`):
```javascript
import Toast from 'tdesign-miniprogram/toast';
import { getNavigationBarHeight } from '../../../utils/utils';

const sleep = (ms) => {
return new Promise((resolve) => setTimeout(resolve, ms));
};

const fetchStream = async (str, options) => {
const { success, complete, delay = 100 } = options;

const arr = str.split('');

for (let i = 0; i < arr.length; i += 1) {
// eslint-disable-next-line no-await-in-loop
await sleep(delay);
success(arr[i]);
}

complete();
};

Component({
properties: {
isActive: {
type: Boolean,
value: false,
observer: function (v) {
this.setData({
value: v ? '请为Tdesign设计三张品牌宣传图' : '', // 输入框的值
});
},
},
},
options: {
styleIsolation: 'shared',
},
data: {
renderPresets: [
{
name: 'send',
type: 'icon',
},
],
customActionBar: ['good', 'bad'],
chatList: [
{
avatar: 'https://tdesign.gtimg.com/site/chat-avatar.png',
message: {
role: 'assistant',
content: [
{
type: 'text',
data: '欢迎使用TDesign智能生图助手，请先写下你的创意，可以试试上传参考图哦～',
},
],
},
},
],
value: '', // 输入框的值
loading: false, // 加载状态
disabled: false, // 禁用状态
inputStyle: '', // 输入框动态样式
attachmentsProps: {
items: [],
removable: true,
imageViewer: true,
addable: false,
},
contentHeight: '100vh', // 内容高度
},

methods: {
// 发送消息事件处理
onSend(e) {
const { value } = e.detail;
if (!value || value.trim() === '') return;

// 创建用户消息对象
const userMessage = {
message: {
role: 'user',
content: [
{
type: 'text',
data: value.trim(),
},
],
},
};

// 将用户消息插入到chatList的开头（因为reverse为true，所以用unshift）
this.setData({
chatList: [userMessage, ...this.data.chatList],
value: '', // 清空输入框
});

// 模拟助手回复（可选）
this.simulateAssistantReply(value.trim());
},

// 停止事件处理
onStop() {
console.log('停止发送');
this.setData({
loading: false,
});
},

// 聚焦事件处理
onFocus() {
console.log('输入框聚焦');
},

// 打开选择文件界面
onUpdateVisible() {
const that = this;
wx.chooseMessageFile({
count: 1,
type: 'file',
success(res) {
const tempFile = res.tempFiles[0];
console.log('选择的文件信息：', tempFile);
const item = {
fileType: 'doc',
name: tempFile.name,
url: tempFile.path,
size: tempFile.size,
status: 'success',
};
that.setData({
attachmentsProps: {
...that.data.attachmentsProps,
items: [item],
},
});
},
fail(err) {
console.error('选择文件失败：', err);
},
});
},

// 模拟助手回复
simulateAssistantReply() {
this.setData({ loading: true });

const assistantMessage = {
avatar: 'https://tdesign.gtimg.com/site/chat-avatar.png',
message: {
role: 'assistant',
content: [
{
type: 'markdown',
data: '',
},
],
},
};

this.setData({
chatList: [assistantMessage, ...this.data.chatList],
});

const that = this;
wx.nextTick(async () => {
await fetchStream('接下来我将生成符合要求的图片', {
success(result) {
if (!that.data.loading) return;
that.data.chatList[0].message.content[0].data += result;
that.setData({
chatList: that.data.chatList,
});
},
complete() {},
});

if (!that.data.loading) return;

that.data.chatList[0].message.content.push({
type: 'imageview',
status: 'complete',
data: [
{
name: 'sample1.png',
url: 'https://tdesign.gtimg.com/site/square.png',
fileType: 'image',
status: 'success',
size: 1032,
width: 128,
height: 128,
},
{
name: 'sample2.png',
url: 'https://tdesign.gtimg.com/site/square.png',
fileType: 'image',
status: 'success',
size: 1032,
width: 128,
height: 128,
},
{
name: 'sample3.png',
url: 'https://tdesign.gtimg.com/site/square.png',
fileType: 'image',
status: 'success',
size: 1032,
width: 128,
height: 128,
},
{
name: 'sample4.png',
url: 'https://tdesign.gtimg.com/site/square.png',
fileType: 'image',
status: 'success',
size: 1032,
width: 128,
height: 128,
},
{
name: 'sample5.png',
url: 'https://tdesign.gtimg.com/site/square.png',
fileType: 'image',
status: 'success',
size: 1032,
width: 128,
height: 128,
},
],
});
that.data.chatList[0].message.status = 'complete';
that.setData({
chatList: that.data.chatList,
loading: false,
});
});
},
handleAction(e) {
const { name, active, data } = e.detail;
console.log('----', name);
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
lifetimes: {
attached: function () {
/**
* 计算内容区域高度
* 生成CSS calc表达式：calc(100vh - 96rpx - 导航高度 - 底部安全区域高度)
*/
try {
// 获取当前的导航栏高度和安全区域高度
const navigationBarHeight = getNavigationBarHeight() || 0;

// 生成CSS calc表达式字符串
const contentHeight = `calc(100vh - 96rpx - ${navigationBarHeight}px)`;

this.setData({
contentHeight: contentHeight,
});

console.log('内容区域高度CSS表达式:', contentHeight);
} catch (error) {
console.error('生成内容高度表达式失败:', error);
this.setData({
contentHeight: 'calc(100vh - 96rpx)',
});
}
},
},
});

```

**CSS** (`css`):
```css
.chat-box {
padding-top: 32rpx;
box-sizing: border-box;
}

.image-chat .t-chat__list {
padding: 0 0 0 0;
box-sizing: border-box;
}

.t-chat-message {
padding: 0 32rpx;
}

.image-chat .t-chat__inner.assistant .t-chat__avatar {
padding-left: 32rpx;
}

.image-chat .assistant,
.image-chat .assistant .t-chat__detail {
width: 100%;
}

.attachment-slide {
height: 274rpx;
width: 100%;
}

.attachment-slide .t-attachments {
padding-right: 32rpx;
padding-top: 24rpx;
box-sizing: border-box;
position: fixed;
z-index: 2;
left: 0;
right: 0;
}

.attachment-slide .t-attachments .t-attachments__files:first-child {
padding-left: 120rpx;
}

.attachment-slide .t-attachments .t-attachments__files:last-child {
padding-right: 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"styleIsolation": "shared",
"usingComponents": {
"t-chat-message": "tdesign-miniprogram/chat-message/chat-message",
"t-chat-content": "tdesign-miniprogram/chat-content/chat-content",
"t-chat": "tdesign-miniprogram/chat-list/chat-list",
"t-chat-sender": "tdesign-miniprogram/chat-sender/chat-sender",
"t-chat-actionbar": "tdesign-miniprogram/chat-actionbar/chat-actionbar",
"t-attachments": "tdesign-miniprogram/attachments/attachments",
"t-toast": "tdesign-miniprogram/toast/toast"
}
}

```

#### 任务规划

**WXML** (`html`):
```html
<view class="chat-box" style="height: {{contentHeight}};">
<t-chat>
<block wx:for="{{chatList}}" wx:key="index" wx:for-index="chatIndex">
<t-chat-message
avatar="{{item.avatar || ''}}"
name="{{item.name || ''}}"
datetime="{{item.datetime || ''}}"
role="{{item.message.role}}"
placement="{{item.message.role === 'user' ? 'right' : 'left'}}"
>
<view slot="content">
<block
wx:for="{{item.message.content}}"
wx:for-item="contentItem"
wx:for-index="contentIndex"
wx:key="contentIndex"
>
<t-chat-content
content="{{contentItem}}"
wx:if="{{contentItem.type === 'text' || contentItem.type === 'markdown'}}"
/>
<view class="step" wx:if="{{contentItem.type === 'agent'}}">
<t-steps layout="vertical" current="{{contentItem.content.steps.length}}">
<t-step-item wx:for="{{contentItem.content.steps}}" wx:key="index" title="{{item.step}}">
<view slot="content" class="step-text-list">
<view
wx:for="{{item.tasks}}"
wx:key="index"
wx:for-item="taskItem"
class="step-text {{taskItem.type}}"
>
<t-icon
wx:if="{{taskItem.type === 'command'}}"
name="control-platform"
size="32rpx"
class="step-icon"
/>
{{taskItem.text}}
</view>
</view>
</t-step-item>
</t-steps>
</view>
</block>
</view>
<t-chat-actionbar
wx:if="{{chatIndex !== chatList.length - 1 && item.message.status === 'complete' && item.message.role === 'assistant'}}"
slot="actionbar"
placement="end"
bind:actions="handleAction"
/>
</t-chat-message>
</block>
<view slot="footer">
<t-chat-sender
value="{{value}}"
loading="{{loading}}"
disabled="{{disabled}}"
renderPresets="{{renderPresets}}"
bind:send="onSend"
bind:stop="onStop"
bind:focus="onFocus"
autoRiseWithKeyboard="{{true}}"
/>
</view>
</t-chat>
</view>
<t-toast id="t-toast" />

```

**JS** (`javascript`):
```javascript
import Toast from 'tdesign-miniprogram/toast';
import { getNavigationBarHeight } from '../../../utils/utils';

const sleep = (ms) => {
return new Promise((resolve) => setTimeout(resolve, ms));
};

const fetchStream = async (str, options) => {
const { success, complete, delay = 100 } = options;

const arr = str.split('');

for (let i = 0; i < arr.length; i += 1) {
// eslint-disable-next-line no-await-in-loop
await sleep(delay);
success(arr[i]);
}

complete();
};

Component({
properties: {
contentHeight: {
type: String,
value: '100vh',
},

isActive: {
type: Boolean,
value: false,
observer: function (v) {
this.setData({
value: v ? '请帮我做一个5岁儿童生日聚会的规划' : '', // 输入框的值
});
},
},
},

options: {
styleIsolation: 'shared',
},
data: {
renderPresets: [
{
name: 'send',
type: 'icon',
},
],
chatList: [
{
avatar: 'https://tdesign.gtimg.com/site/chat-avatar.png',
message: {
role: 'assistant',
content: [
{
type: 'text',
data: '欢迎使用TDesign Agent家庭活动策划助手，请给我布置任务吧～',
},
],
},
},
],
value: '', // 输入框的值
loading: false, // 加载状态
disabled: false, // 禁用状态
inputStyle: '', // 输入框动态样式
},

methods: {
// 发送消息事件处理
onSend(e) {
const { value } = e.detail;
if (!value || value.trim() === '') return;

// 创建用户消息对象
const userMessage = {
message: {
role: 'user',
content: [
{
type: 'text',
data: value.trim(),
},
],
},
};

// 将用户消息插入到chatList的开头（因为reverse为true，所以用unshift）
this.setData({
chatList: [userMessage, ...this.data.chatList],
value: '', // 清空输入框
});

// 模拟助手回复（可选）
this.simulateAssistantReply(value.trim());
},

// 停止事件处理
onStop() {
console.log('停止发送');
this.setData({
loading: false,
});
},

// 聚焦事件处理
onFocus() {
console.log('输入框聚焦');
},

// 模拟助手回复
simulateAssistantReply() {
this.setData({ loading: true });

const assistantMessage = {
avatar: 'https://tdesign.gtimg.com/site/chat-avatar.png',
message: {
role: 'assistant',
content: [
{
type: 'markdown',
data: '',
},
],
},
};

this.setData({
chatList: [assistantMessage, ...this.data.chatList],
});

const that = this;
wx.nextTick(async () => {
await fetchStream('为5岁小朋友准备一场生日派对，我会根据要求准备合适方案，计划从以下几个步骤进行准备：', {
success(result) {
if (!that.data.loading) return;
that.data.chatList[0].message.content[0].data += result;
that.setData({
chatList: that.data.chatList,
});
},
complete() {},
});

if (!that.data.loading) return;

that.data.chatList[0].message.content.push({
type: 'agent',
id: 'task1',
content: {
text: '',
steps: [],
},
});
that.setData({
chatList: that.data.chatList,
});

await fetchStream('生日聚会规划任务已分解为3个执行阶段', {
success(result) {
if (!that.data.loading) return;
that.data.chatList[0].message.content[1].content.text += result;
that.setData({
chatList: that.data.chatList,
});
},
complete() {},
});

if (!that.data.loading) return;

that.data.chatList[0].message.content[1].content.steps.push({
step: '确定派对餐饮方案',
agent_id: 'a1',
tasks: [
{
type: 'command',
text: '',
},
],
status: 'finish',
});
that.setData({
chatList: that.data.chatList,
});

await fetchStream('调用智能搜索工具', {
success(result) {
if (!that.data.loading) return;
that.data.chatList[0].message.content[1].content.steps[0].tasks[0].text += result;
that.setData({
chatList: that.data.chatList,
});
},
complete() {},
});

if (!that.data.loading) return;

that.data.chatList[0].message.content[1].content.steps[0].tasks.push({
type: 'command',
text: '',
});
that.setData({
chatList: that.data.chatList,
});

await fetchStream('已筛选出3种高性价比菜单方案，开始进行营养匹配', {
success(result) {
if (!that.data.loading) return;
that.data.chatList[0].message.content[1].content.steps[0].tasks[1].text += result;
that.setData({
chatList: that.data.chatList,
});
},
complete() {},
});

if (!that.data.loading) return;

that.data.chatList[0].message.content[1].content.steps[0].tasks.push({
type: 'result',
text: '',
});
that.setData({
chatList: that.data.chatList,
});

await fetchStream('主菜是香草烤鸡（无麸质），准备耗时45分钟；', {
success(result) {
if (!that.data.loading) return;
that.data.chatList[0].message.content[1].content.steps[0].tasks[2].text += result;
that.setData({
chatList: that.data.chatList,
});
},
complete() {},
});

if (!that.data.loading) return;

that.data.chatList[0].message.content[1].content.steps.push({
step: '准备派对现场布置',
agent_id: 'a2',
tasks: [
{
type: 'command',
text: '',
},
],
status: 'finish',
});
that.setData({
chatList: that.data.chatList,
});

await fetchStream('调用智能搜索工具，搜索儿童派对用品清单', {
success(result) {
if (!that.data.loading) return;
that.data.chatList[0].message.content[1].content.steps[1].tasks[0].text += result;
that.setData({
chatList: that.data.chatList,
});
},
complete() {},
});

if (!that.data.loading) return;

that.data.chatList[0].message.content[1].content.steps[1].tasks.push({
type: 'result',
text: '',
});
that.setData({
chatList: that.data.chatList,
});

await fetchStream(
'推荐现场布置方案：餐具（一次性纸盘、刀叉套装）、杯子、纸巾、一次性桌布，装饰气球、横幅、礼帽等',
{
success(result) {
if (!that.data.loading) return;
that.data.chatList[0].message.content[1].content.steps[1].tasks[1].text += result;
that.setData({
chatList: that.data.chatList,
});
},
complete() {},
},
);

if (!that.data.loading) return;

that.data.chatList[0].message.content[1].content.steps.push({
step: '策划派对活动',
agent_id: 'a1',
tasks: [
{
type: 'command',
text: '',
},
],
status: 'finish',
});
that.setData({
chatList: that.data.chatList,
});

await fetchStream('搜索儿童派对游戏', {
success(result) {
if (!that.data.loading) return;
that.data.chatList[0].message.content[1].content.steps[2].tasks[0].text += result;
that.setData({
chatList: that.data.chatList,
});
},
complete() {},
});

if (!that.data.loading) return;

that.data.chatList[0].message.content[1].content.steps[2].tasks.push({
type: 'command',
text: '',
});
that.setData({
chatList: that.data.chatList,
});

await fetchStream('整理信息并进行合理性分析，安全性评估', {
success(result) {
if (!that.data.loading) return;
that.data.chatList[0].message.content[1].content.steps[2].tasks[1].text += result;
that.setData({
chatList: that.data.chatList,
});
},
complete() {},
});

if (!that.data.loading) return;

that.data.chatList[0].message.content[1].content.steps[2].tasks.push({
type: 'result',
text: '',
});
that.setData({
chatList: that.data.chatList,
});

await fetchStream(
'派对总时长建议控制在1.5小时，符合5岁儿童注意力持续时间，每位小朋友到达时可以在拍照区留影，可设置一个签到',
{
success(result) {
if (!that.data.loading) return;
that.data.chatList[0].message.content[1].content.steps[2].tasks[2].text += result;
that.setData({
chatList: that.data.chatList,
});
},
complete() {},
},
);
that.data.chatList[0].message.status = 'complete';
that.setData({
chatList: that.data.chatList,
});
that.setData({
loading: false,
});
});
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
},
lifetimes: {
attached: function () {
/**
* 计算内容区域高度
* 生成CSS calc表达式：calc(100vh - 96rpx - 导航高度 - 底部安全区域高度)
*/
try {
// 获取当前的导航栏高度和安全区域高度
const navigationBarHeight = getNavigationBarHeight() || 0;

// 生成CSS calc表达式字符串
const contentHeight = `calc(100vh - 96rpx - ${navigationBarHeight}px)`;

this.setData({
contentHeight: contentHeight,
});

console.log('内容区域高度CSS表达式:', contentHeight);
} catch (error) {
console.error('生成内容高度表达式失败:', error);
this.setData({
contentHeight: 'calc(100vh - 96rpx)',
});
}
},
},
});

```

**CSS** (`css`):
```css
.chat-box {
padding-top: 32rpx;
box-sizing: border-box;
}

.t-chat__list {
padding: 0 0 0 32rpx;
box-sizing: border-box;
}
.t-chat-message {
padding: 0 32rpx;
}

.preview {
padding: 16rpx;
display: flex;
justify-content: space-between;
border: 1px solid var(--td-component-border);
}

.step {
padding-top: 24rpx;
}

.step-text-list {
display: flex;
flex-direction: column;
gap: 16rpx;
}

.step-text {
text-align: start;
}

.step-text.command {
padding: 16rpx;
border-radius: 16rpx;
background-color: var(--td-bg-color-secondarycontainer);
display: flex;
font-size: 28rpx;
line-height: 44rpx;
color: var(--td-text-color-secondary);
}

.step-text.result {
font-size: 28rpx;
line-height: 44rpx;
color: var(--td-text-color-primary);
}

.step-icon {
margin-right: 12rpx;
margin-top: 6rpx;
}

.t-steps-item__circle--finish {
background-color: transparent;
color: var(--td-text-color-primary);
border: 1px solid var(--td-text-color-primary);
width: 16px;
height: 16px;
}

.t-steps-item__circle--finish .t-icon {
font-size: 12px;
}

.t-steps-item__line--finish {
background-color: var(--td-component-border);
}

.t-steps-item__title--finish {
color: var(--td-text-color-primary);
font-weight: 600;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"styleIsolation": "shared",
"usingComponents": {
"t-chat-message": "tdesign-miniprogram/chat-message/chat-message",
"t-chat-content": "tdesign-miniprogram/chat-content/chat-content",
"t-chat": "tdesign-miniprogram/chat-list/chat-list",
"t-chat-sender": "tdesign-miniprogram/chat-sender/chat-sender",
"t-chat-actionbar": "tdesign-miniprogram/chat-actionbar/chat-actionbar",
"t-steps": "tdesign-miniprogram/steps/steps",
"t-step-item": "tdesign-miniprogram/step-item/step-item",
"t-icon": "tdesign-miniprogram/icon/icon",
"t-toast": "tdesign-miniprogram/toast/toast"
}
}

```

## API

### ChatListProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| animation | String | skeleton | 动画效果，支持「渐变加载动画」,「闪烁加载动画」, 「骨架屏」三种。可选项：skeleton/moving/gradient/dot | N |
| data | Array | - | 对话列表的数据。TS 类型：`Array<TdChatItemMeta>`` interface TdChatItemMeta { avatar?: string; name?:string; role?:string; datetime?: string; content?: string; status?: string }`。详细类型定义 | N |
| layout | String | both | 对话布局形式，支持两侧对齐与左对齐。使用插槽自定义对话内容时不生效，得用`t-chat-message`的`placement`属性。可选项：both/single | N |
| reverse | Boolean | true | 是否表现为倒序 | N |

### ChatListEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| scroll | `(detail: {scrollLeft, scrollTop, scrollHeight, scrollWidth, deltaX, deltaY})` | 滚动事件的回调 |

### ChatListSlots

| 名称 | 描述 |
| --- | --- |
| actionbar | 自定义操作按钮的插槽 |