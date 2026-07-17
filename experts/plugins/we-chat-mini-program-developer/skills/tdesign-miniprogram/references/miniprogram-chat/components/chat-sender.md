# ChatSender 对话输入

## 示例

## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-chat-sender": "tdesign-miniprogram/chat-sender/chat-sender"
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/1b3SQumy8n4O)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 01组件类型

#### 基础类型

**WXML** (`html`):
```html
<view class="demo-base-container">
<!-- 聊天发送器组件 -->
<view class="chat-sender-demo-wrapper">
<view class="chat-sender-height-limit">
<view class="chat-sender-height-left-limit"> </view>
<view class="chat-sender-height-right-limit"> </view>
</view>
<view class="chat-sender-placeholder"> 高度限制：最大高度为132px </view>
<view class="chat-sender-wrapper">
<t-chat-sender
value="{{value}}"
loading="{{loading}}"
disabled="{{disabled}}"
placeholder="{{placeholder}}"
textareaProps="{{textareaProps}}"
fileList="{{fileList}}"
attachmentsProps="{{attachmentsProps}}"
renderPresets="{{renderPresets}}"
visible="{{visible}}"
bind:send="onSend"
bind:stop="onStop"
bind:focus="onFocus"
bind:blur="onBlur"
bind:change="onChange"
bind:uploadClick="onUploadClick"
bind:fileClick="onFileClick"
bind:fileDelete="onFileDelete"
bind:fileChange="onFileChange"
bind:fileAdd="onFileAdd"
bind:fileSelect="onFileSelect"
bind:updateVisible="onUpdateVisible"
bind:keyboardheightchange="onKeyboardHeightChange"
>
<view slot="footer-prefix" class="demo-footer-prefix">
<view class="deep-think-block {{deepThinkActive ? 'active' : ''}}" bind:tap="onDeepThinkTap">
<t-icon name="system-sum" size="40rpx" />
<text class="deep-think-text">深度思考</text>
</view>
<view class="net-search-block {{ netSearchActive ? 'active' : '' }}" bind:tap="onNetSearchTap">
<t-icon name="internet" size="40rpx" />
</view>
</view>
</t-chat-sender>
</view>
<view class="demo-footer"> 内容由AI生成，仅供参考 </view>
</view>
</view>

```

**JS** (`javascript`):
```javascript
Page({
data: {
value: '',
loading: false,
disabled: false,
fileList: [],
visible: false,
placeholder: '请输入消息...',
textareaProps: {
autosize: {
maxHeight: 264,
minHeight: 48, // 设置为0时，用自动计算height的高度
}, // 默认为false
},
attachmentsProps: {
items: [],
removable: true,
imageViewer: true,
addable: false,
},
renderPresets: [
{
name: 'send',
type: 'icon',
},
],
deepThinkActive: false,
netSearchActive: false,
},

// 发送消息
onSend(e) {
const { value } = e.detail;
console.log('发送消息:', value);

if (!value.trim()) {
wx.showToast({
title: '请输入消息内容',
icon: 'none',
});
return;
}

// 模拟发送状态
this.setData({ loading: true });

setTimeout(() => {
if (this.data.loading) {
this.setData({
loading: false,
value: '', // 清空输入框
});
wx.showToast({
title: '发送成功',
icon: 'success',
});
}
}, 3000);
},

// 停止发送
onStop(e) {
const { value } = e.detail;
console.log('停止发送:', value);

this.setData({ loading: false });
wx.showToast({
title: '已停止发送',
icon: 'none',
});
},

// 输入框聚焦
onFocus(e) {
const { value, context } = e.detail;
console.log('输入框聚焦:', value, context);
},

// 输入框失焦
onBlur(e) {
const { value, context } = e.detail;
console.log('输入框失焦:', value, context);
},

// 输入内容变化
onChange(e) {
const { value } = e.detail;
console.log('输入内容变化:', value);
this.setData({ value });
},

// 点击上传按钮
onUploadClick() {
console.log('点击上传按钮');
},

// 点击文件
onFileClick(e) {
const { file } = e.detail;
console.log('点击文件:', file);
wx.showToast({
title: `点击了文件: ${file.name}`,
icon: 'none',
});
},

// 删除文件
onFileDelete(e) {
const { file } = e.detail;
console.log('删除文件:', file);
wx.showToast({
title: '文件删除成功',
icon: 'success',
});
},

// 文件列表变化
onFileChange(e) {
console.log(e, 'e----');

const { files } = e.detail;
console.log('文件列表变化:', files);
this.setData({ fileList: files });
},

// 添加文件
onFileAdd() {
console.log('添加文件');
},

// 选择文件
onFileSelect(e) {
const { name, files } = e.detail;
console.log('选择文件:', name, files);

wx.showToast({
title: `选择了${files.length}个文件`,
icon: 'success',
});
},

// 上传面板显示状态变化
onUpdateVisible(e) {
const visible = e.detail;
console.log('上传面板显示状态:', visible);
this.setData({ visible });
},

// 键盘高度变化
onKeyboardHeightChange(e) {
console.log('键盘高度变化:', e.detail);
},

// 切换禁用状态
toggleDisabled() {
this.setData({ disabled: !this.data.disabled });
},

// 切换加载状态
toggleLoading() {
this.setData({ loading: !this.data.loading });
},

// 清空输入框
clearInput() {
this.setData({ value: '' });
},

onDeepThinkTap() {
this.setData({ deepThinkActive: !this.data.deepThinkActive });
},

onNetSearchTap() {
this.setData({ netSearchActive: !this.data.netSearchActive });
},
});

```

**CSS** (`css`):
```css
.demo-base-container {
padding: 56rpx 0 0 0;
background-color: var(--td-bg-color-container);
height: 488rpx;
position: relative;
}

/* 聊天发送器包装器 */
.chat-sender-demo-wrapper {
margin-bottom: 32rpx;
/* border: 2rpx solid #e5e5e5; */
border-radius: 8rpx;
overflow: hidden;
}

.chat-sender-height-limit {
height: 72rpx;
padding: 0 24rpx;
display: flex;
justify-content: space-between;
align-items: center;
}

.chat-sender-height-left-limit {
height: 70rpx;
width: 70rpx;
border-top: 1px var(--td-component-stroke) dashed;
border-left: 1px var(--td-component-stroke) dashed;
border-top-left-radius: 32rpx;
}
.chat-sender-height-right-limit {
height: 70rpx;
width: 70rpx;
border-top: 1px var(--td-component-stroke) dashed;
border-right: 1px var(--td-component-stroke) dashed;
border-top-right-radius: 32rpx;
}
.chat-sender-placeholder {
font-size: 32rpx;
font-weight: 600;
color: var(--demo-chat-sender-placeholder);
text-align: center;
height: 48rpx;
}

.chat-sender-wrapper {
position: absolute;
width: 100%;
bottom: 0rpx;
background-color: var(--td-bg-color-container);
}

.demo-footer {
height: 32rpx;
width: 100%;
text-align: center;
font-size: 20rpx;
line-height: 32rpx;
color: var(--td-text-color-placeholder);
position: absolute;
bottom: 32rpx;
}

.demo-footer-prefix {
display: flex;
align-items: center;
}

.deep-think-block {
padding: 0 24rpx;
height: 60rpx;
margin-right: 16rpx;
}

.deep-think-text {
margin-left: 8rpx;
}

.deep-think-block,
.net-search-block {
color: var(--td-text-color-primary);
border-radius: 200rpx;
border: 2rpx solid var(--td-component-border);
display: flex;
justify-content: center;
align-items: center;
}

.net-search-block {
width: 64rpx;
height: 60rpx;
}

.active {
border-color: var(--td-brand-color-light-active);
color: var(--td-brand-color);
background-color: var(--td-brand-color-light);
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"styleIsolation": "shared",
"usingComponents": {
"t-navbar": "tdesign-miniprogram/navbar/navbar",
"t-chat-sender": "tdesign-miniprogram/chat-sender/chat-sender"
}
}

```

#### 上传文件

支持选择附件及展示附件列表，受控进行文件数据管理，示例中模拟了文件上传流程

**WXML** (`html`):
```html
<view class="demo-attachments-container {{showUploadMenu ? 'show-upload-menu' : ''}}">
<view class="chat-sender-demo-wrapper">
<view class="chat-sender-height-limit">
<view class="chat-sender-height-left-limit"> </view>
<view class="chat-sender-height-right-limit"> </view>
</view>
<view class="chat-sender-placeholder"> 高度限制：最大高度为132px </view>
<view class="chat-sender-wrapper" style="{{showUploadMenu ? 'bottom:32rpx;' : ''}}">
<t-chat-sender
value="{{value}}"
loading="{{loading}}"
disabled="{{disabled}}"
placeholder="{{placeholder}}"
textareaProps="{{textareaProps}}"
fileList="{{fileList}}"
attachmentsProps="{{attachmentsProps}}"
renderPresets="{{renderPresets}}"
visible="{{visible}}"
bind:send="onSend"
bind:stop="onStop"
bind:focus="onFocus"
bind:blur="onBlur"
bind:change="onChange"
bind:uploadClick="onUploadClick"
bind:fileClick="onFileClick"
bind:fileDelete="onFileDelete"
bind:fileChange="onFileChange"
bind:fileAdd="onFileAdd"
bind:fileSelect="onFileSelect"
bind:updateVisible="onUpdateVisible"
bind:keyboardheightchange="onKeyboardHeightChange"
>
<view slot="footer-prefix" class="demo-footer-prefix">
<view class="deep-think-block {{deepThinkActive ? 'active' : ''}}" bind:tap="onDeepThinkTap">
<t-icon name="system-sum" size="40rpx" />
<text class="deep-think-text">深度思考</text>
</view>
<view class="net-search-block {{ netSearchActive ? 'active' : '' }}" bind:tap="onNetSearchTap">
<t-icon name="internet" size="40rpx" />
</view>
</view>
</t-chat-sender>
</view>
<view wx:if="{{!visible}}" class="demo-attachments-footer"> 内容由AI生成，仅供参考 </view>
</view>
</view>
<t-toast id="t-toast" />

```

**JS** (`javascript`):
```javascript
import Toast from 'tdesign-miniprogram/toast';

Page({
data: {
value: '',
loading: false,
disabled: false,
fileList: [
{
fileType: 'image',
name: '图片1.png',
url: 'https://tdesign.gtimg.com/site/square.png',
},
{
fileType: 'pdf',
name: '文档.pdf',
url: 'https://example.com/document.pdf',
size: 3072,
status: 'pending',
},
],
visible: true,
placeholder: '请输入消息...',
textareaProps: {
autosize: {
maxHeight: 264,
minHeight: 48, // 设置为0时，用自动计算height的高度
}, // 默认为false
},
attachmentsProps: {
items: [
{
fileType: 'image',
name: '图片1.png',
url: 'https://tdesign.gtimg.com/site/square.png',
},
{
fileType: 'pdf',
name: '文档.pdf',
url: 'https://example.com/document.pdf',
size: 3072,
status: 'pending',
},
],
removable: true,
imageViewer: true,
addable: false,
},
renderPresets: [
{
name: 'upload',
presets: ['uploadCamera', 'uploadImage', 'uploadAttachment'],
type: 'bottom',
status: '',
},
{
name: 'send',
type: 'icon',
},
],
deepThinkActive: false,
netSearchActive: false,
showUploadMenu: true,
},

// 发送消息
onSend(e) {
const { value } = e.detail;
console.log('发送消息:', value);

if (!value.trim()) {
wx.showToast({
title: '请输入消息内容',
icon: 'none',
});
return;
}

// 模拟发送状态
this.setData({ loading: true });

setTimeout(() => {
if (this.data.loading) {
this.setData({
loading: false,
value: '', // 清空输入框
});
wx.showToast({
title: '发送成功',
icon: 'success',
});
}
}, 3000);
},

// 停止发送
onStop(e) {
const { value } = e.detail;
console.log('停止发送:', value);

this.setData({ loading: false });
wx.showToast({
title: '已停止发送',
icon: 'none',
});
},

// 输入框聚焦
onFocus(e) {
const { value, context } = e.detail;
console.log('输入框聚焦:', value, context);
},

// 输入框失焦
onBlur(e) {
const { value, context } = e.detail;
console.log('输入框失焦:', value, context);
},

// 输入内容变化
onChange(e) {
const { value } = e.detail;
console.log('输入内容变化:', value);
this.setData({ value });
},

// 点击上传按钮
onUploadClick() {
console.log('点击上传按钮');
},

// 点击文件
onFileClick(e) {
const { file } = e.detail;
console.log('点击文件:', file);
wx.showToast({
title: `点击了文件: ${file.name}`,
icon: 'none',
});
},

// 删除文件
onFileDelete(e) {
const { file } = e.detail;
console.log('删除文件:', file);
wx.showToast({
title: '文件删除成功',
icon: 'success',
});
},

// 文件列表变化
onFileChange(e) {
const { files } = e.detail;
console.log('文件列表变化:', files);
this.setData({ attachmentsProps: { ...this.data.attachmentsProps, items: files } });
this.setData({ fileList: files });
},

// 添加文件
onFileAdd() {
console.log('添加文件');
},

// 选择文件
onFileSelect(e) {
const { name, files } = e.detail;
console.log('选择文件:', name, files);

wx.showToast({
title: `选择了${files.length}个文件`,
icon: 'success',
});
},

// 上传面板显示状态变化
onUpdateVisible() {
Toast({
context: this,
selector: '#t-toast',
message: '暂不可操作',
});
},

// 键盘高度变化
onKeyboardHeightChange(e) {
console.log('键盘高度变化:', e.detail);
},

// 切换禁用状态
toggleDisabled() {
this.setData({ disabled: !this.data.disabled });
},

// 切换加载状态
toggleLoading() {
this.setData({ loading: !this.data.loading });
},

// 清空输入框
clearInput() {
this.setData({ value: '' });
},

onDeepThinkTap() {
this.setData({ deepThinkActive: !this.data.deepThinkActive });
},

onNetSearchTap() {
this.setData({ netSearchActive: !this.data.netSearchActive });
},
});

```

**CSS** (`css`):
```css
.demo-attachments-container {
padding: 56rpx 0 0 0;
background-color: var(--td-bg-color-container);
height: 608rpx;
position: relative;
transition: all 0.3s;
}

.show-upload-menu {
height: 780rpx;
}

.demo-attachments-footer {
height: 32rpx;
width: 100%;
text-align: center;
font-size: 20rpx;
line-height: 32rpx;
color: rgba(0, 0, 0, 0.4);
position: absolute;
bottom: 32rpx;
}

/* 聊天发送器包装器 */
.chat-sender-wrapper {
/* border: 2rpx solid #e5e5e5; */
border-radius: 8rpx;
overflow: hidden;
background-color: var(--td-bg-color-container);
}

.demo-footer-prefix {
display: flex;
align-items: center;
}

.deep-think-block {
padding: 0 24rpx;
height: 60rpx;
margin-right: 16rpx;
}

.deep-think-text {
margin-left: 8rpx;
}

.deep-think-block,
.net-search-block {
color: var(--td-text-color-primary);
border-radius: 200rpx;
border: 2rpx solid var(--td-component-border);
display: flex;
justify-content: center;
align-items: center;
}

.net-search-block {
width: 64rpx;
height: 60rpx;
}

.active {
border-color: var(--td-brand-color-light-active);
color: var(--td-brand-color);
background-color: var(--td-brand-color-light);
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"styleIsolation": "shared",
"usingComponents": {
"t-navbar": "tdesign-miniprogram/navbar/navbar",
"t-chat-sender": "tdesign-miniprogram/chat-sender/chat-sender",
"t-toast": "tdesign-miniprogram/toast/toast"
}
}

```

#### 内容引用

输入框顶部区域 `header` ，输入框底部左侧区域 `footer-prefix` ，输入框底部操作区域 `suffix`

**WXML** (`html`):
```html
<view class="demo-content-citation-container">
<view class="chat-sender-demo-wrapper">
<view class="chat-sender-height-limit">
<view class="chat-sender-height-left-limit"> </view>
<view class="chat-sender-height-right-limit"> </view>
</view>
<view class="chat-sender-placeholder"> 高度限制：最大高度为132px </view>
<view class="chat-sender-wrapper">
<t-chat-sender
value="{{value}}"
loading="{{loading}}"
disabled="{{disabled}}"
placeholder="{{placeholder}}"
textareaProps="{{textareaProps}}"
fileList="{{fileList}}"
attachmentsProps="{{attachmentsProps}}"
renderPresets="{{renderPresets}}"
visible="{{visible}}"
bind:send="onSend"
bind:stop="onStop"
bind:focus="onFocus"
bind:blur="onBlur"
bind:change="onChange"
bind:uploadClick="onUploadClick"
bind:fileClick="onFileClick"
bind:fileDelete="onFileDelete"
bind:fileChange="onFileChange"
bind:fileAdd="onFileAdd"
bind:fileSelect="onFileSelect"
bind:updateVisible="onUpdateVisible"
bind:keyboardheightchange="onKeyboardHeightChange"
>
<view slot="header" class="demo-header" wx:if="{{headerText}}">
<view style="padding: 4rpx; height: 40rpx; color: var(--td-text-color-disabled)">
<t-icon name="enter" size="40rpx" style="transform: scaleX(-1)" />
</view>
<view class="header-content"> {{headerText}} </view>
<view style="padding: 4rpx; height: 40rpx; margin-left: auto; color: var(--td-text-color-placeholder)">
<t-icon name="close" size="40rpx" bind:tap="handleCLoseCite" />
</view>
</view>
<view slot="footer-prefix" class="demo-footer-prefix">
<view class="deep-think-block {{deepThinkActive ? 'active' : ''}}" bind:tap="onDeepThinkTap">
<t-icon name="system-sum" size="40rpx" />
<text class="deep-think-text">深度思考</text>
</view>
<view class="net-search-block {{ netSearchActive ? 'active' : '' }}" bind:tap="onNetSearchTap">
<t-icon name="internet" size="40rpx" />
</view>
</view>
</t-chat-sender>
</view>
<view class="demo-content-citation-footer"> 内容由AI生成，仅供参考 </view>
</view>
</view>

```

**JS** (`javascript`):
```javascript
Page({
data: {
value: '',
loading: false,
disabled: false,
fileList: [],
visible: false,
placeholder: '请输入消息...',
textareaProps: {
autosize: {
maxHeight: 264,
minHeight: 48, // 设置为0时，用自动计算height的高度
}, // 默认为false
},
attachmentsProps: {
items: [],
removable: true,
imageViewer: true,
addable: false,
},
renderPresets: [
{
name: 'send',
type: 'icon',
},
],
deepThinkActive: false,
netSearchActive: false,
headerText:
'牛顿第一定律并不适用于所有参考系，它只适用于惯性参考系。在质点不受外力作用时，能够判断出质点静止或作匀速直线运动的参考系一定是惯性参考系，因此只有在惯性参考系中牛顿第一定律才适用。',
},

// 发送消息
onSend(e) {
const { value } = e.detail;
console.log('发送消息:', value);

if (!value.trim()) {
wx.showToast({
title: '请输入消息内容',
icon: 'none',
});
return;
}

// 模拟发送状态
this.setData({ loading: true });

setTimeout(() => {
if (this.data.loading) {
this.setData({
loading: false,
value: '', // 清空输入框
});
wx.showToast({
title: '发送成功',
icon: 'success',
});
}
}, 3000);
},

// 停止发送
onStop(e) {
const { value } = e.detail;
console.log('停止发送:', value);

this.setData({ loading: false });
wx.showToast({
title: '已停止发送',
icon: 'none',
});
},

// 输入框聚焦
onFocus(e) {
const { value, context } = e.detail;
console.log('输入框聚焦:', value, context);
},

// 输入框失焦
onBlur(e) {
const { value, context } = e.detail;
console.log('输入框失焦:', value, context);
},

// 输入内容变化
onChange(e) {
const { value } = e.detail;
console.log('输入内容变化:', value);
this.setData({ value });
},

// 点击上传按钮
onUploadClick() {
console.log('点击上传按钮');
},

// 点击文件
onFileClick(e) {
const { file } = e.detail;
console.log('点击文件:', file);
wx.showToast({
title: `点击了文件: ${file.name}`,
icon: 'none',
});
},

// 删除文件
onFileDelete(e) {
const { file } = e.detail;
console.log('删除文件:', file);
wx.showToast({
title: '文件删除成功',
icon: 'success',
});
},

// 文件列表变化
onFileChange(e) {
console.log(e, 'e----');

const { files } = e.detail;
console.log('文件列表变化:', files);
this.setData({ fileList: files });
},

// 添加文件
onFileAdd() {
console.log('添加文件');
},

// 选择文件
onFileSelect(e) {
const { name, files } = e.detail;
console.log('选择文件:', name, files);

wx.showToast({
title: `选择了${files.length}个文件`,
icon: 'success',
});
},

// 上传面板显示状态变化
onUpdateVisible(e) {
const visible = e.detail;
console.log('上传面板显示状态:', visible);
this.setData({ visible });
},

// 键盘高度变化
onKeyboardHeightChange(e) {
console.log('键盘高度变化:', e.detail);
},

// 切换禁用状态
toggleDisabled() {
this.setData({ disabled: !this.data.disabled });
},

// 切换加载状态
toggleLoading() {
this.setData({ loading: !this.data.loading });
},

// 清空输入框
clearInput() {
this.setData({ value: '' });
},

onDeepThinkTap() {
this.setData({ deepThinkActive: !this.data.deepThinkActive });
},

onNetSearchTap() {
this.setData({ netSearchActive: !this.data.netSearchActive });
},

handleCLoseCite() {
this.setData({ headerText: '' });
},
});

```

**CSS** (`css`):
```css
.demo-content-citation-container {
padding: 56rpx 0 0 0;
background-color: var(--td-bg-color-container);
height: 568rpx;
position: relative;
}

.demo-content-citation-footer {
height: 32rpx;
width: 100%;
text-align: center;
font-size: 20rpx;
line-height: 32rpx;
color: var(--td-text-color-placeholder);
position: absolute;
bottom: 32rpx;
}

/* 聊天发送器包装器 */

.chat-sender-wrapper {
/* border: 2rpx solid #e5e5e5; */
border-radius: 8rpx;
overflow: hidden;
background-color: var(--td-bg-color-container);
}

.demo-footer-prefix {
display: flex;
align-items: center;
}

.deep-think-block {
padding: 0 24rpx;
height: 60rpx;
margin-right: 16rpx;
}

.deep-think-text {
margin-left: 8rpx;
}

.deep-think-block,
.net-search-block {
color: var(--td-text-color-primary);
border-radius: 200rpx;
border: 2rpx solid var(--td-component-border);
display: flex;
justify-content: center;
align-items: center;
}

.net-search-block {
width: 64rpx;
height: 60rpx;
}

.active {
border-color: var(--td-brand-color-light-active);
color: var(--td-brand-color);
background-color: var(--td-brand-color-light);
}

.demo-header {
display: flex;
width: calc(100% - 48rpx);
margin-left: 24rpx;
height: 62rpx;
border-bottom: 2rpx solid var(--td-component-stroke);
}

.header-content {
padding: 2rpx 24rpx;
box-sizing: border-box;
white-space: nowrap;
overflow: hidden;
text-overflow: ellipsis;
font-size: var(--td-font-size-body-medium);
line-height: 44rpx;
color: var(--td-text-color-placeholder);
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"styleIsolation": "shared",
"usingComponents": {
"t-navbar": "tdesign-miniprogram/navbar/navbar",
"t-chat-sender": "tdesign-miniprogram/chat-sender/chat-sender"
}
}

```

#### 文件引用

输入框顶部区域 `header` ，输入框底部左侧区域 `footer-prefix` ，输入框底部操作区域 `suffix`

**WXML** (`html`):
```html
<view class="demo-content-citation-container">
<view class="chat-sender-demo-wrapper">
<view class="chat-sender-height-limit">
<view class="chat-sender-height-left-limit"> </view>
<view class="chat-sender-height-right-limit"> </view>
</view>
<view class="chat-sender-placeholder"> 高度限制：最大高度为132px </view>
<view class="chat-sender-wrapper">
<t-chat-sender
value="{{value}}"
loading="{{loading}}"
disabled="{{disabled}}"
placeholder="{{placeholder}}"
textareaProps="{{textareaProps}}"
fileList="{{fileList}}"
attachmentsProps="{{attachmentsProps}}"
renderPresets="{{renderPresets}}"
visible="{{visible}}"
bind:send="onSend"
bind:stop="onStop"
bind:focus="onFocus"
bind:blur="onBlur"
bind:change="onChange"
bind:uploadClick="onUploadClick"
bind:fileClick="onFileClick"
bind:fileDelete="onFileDelete"
bind:fileChange="onFileChange"
bind:fileAdd="onFileAdd"
bind:fileSelect="onFileSelect"
bind:updateVisible="onUpdateVisible"
bind:keyboardheightchange="onKeyboardHeightChange"
>
<view slot="header" class="demo-header" wx:if="{{headerText}}">
<view style="padding: 4rpx; height: 40rpx; color: var(--td-text-color-disabled)">
<t-icon name="enter" size="40rpx" style="transform: scaleX(-1)" />
</view>
<view class="header-content-wrapper">
<t-icon
name="file-word-filled"
color="var(--td-brand-color)"
size="32rpx"
style="margin-top: 8rpx; margin-right: 16rpx"
/>
<view class="header-file-content" hover-class="none" hover-stop-propagation="false"> {{headerText}} </view>
</view>
<view style="padding: 4rpx; height: 40rpx; margin-left: auto; color: var(--td-text-color-placeholder)">
<t-icon name="close" size="40rpx" bind:tap="handleCLoseCite" />
</view>
</view>
<view slot="footer-prefix" class="demo-footer-prefix">
<view class="deep-think-block {{deepThinkActive ? 'active' : ''}}" bind:tap="onDeepThinkTap">
<t-icon name="system-sum" size="40rpx" />
<text class="deep-think-text">深度思考</text>
</view>
<view class="net-search-block {{ netSearchActive ? 'active' : '' }}" bind:tap="onNetSearchTap">
<t-icon name="internet" size="40rpx" />
</view>
</view>
</t-chat-sender>
</view>
<view class="demo-file-citation-footer"> 内容由AI生成，仅供参考 </view>
</view>
</view>

```

**JS** (`javascript`):
```javascript
Page({
data: {
value: '',
loading: false,
disabled: false,
fileList: [],
visible: false,
placeholder: '请输入消息...',
textareaProps: {
autosize: {
maxHeight: 264,
minHeight: 48, // 设置为0时，用自动计算height的高度
}, // 默认为false
},
attachmentsProps: {
items: [],
removable: true,
imageViewer: true,
addable: false,
},
renderPresets: [
{
name: 'send',
type: 'icon',
},
],
deepThinkActive: false,
netSearchActive: false,
headerText: 'word文件.docx',
},

// 发送消息
onSend(e) {
const { value } = e.detail;
console.log('发送消息:', value);

if (!value.trim()) {
wx.showToast({
title: '请输入消息内容',
icon: 'none',
});
return;
}

// 模拟发送状态
this.setData({ loading: true });

setTimeout(() => {
if (this.data.loading) {
this.setData({
loading: false,
value: '', // 清空输入框
});
wx.showToast({
title: '发送成功',
icon: 'success',
});
}
}, 3000);
},

// 停止发送
onStop(e) {
const { value } = e.detail;
console.log('停止发送:', value);

this.setData({ loading: false });
wx.showToast({
title: '已停止发送',
icon: 'none',
});
},

// 输入框聚焦
onFocus(e) {
const { value, context } = e.detail;
console.log('输入框聚焦:', value, context);
},

// 输入框失焦
onBlur(e) {
const { value, context } = e.detail;
console.log('输入框失焦:', value, context);
},

// 输入内容变化
onChange(e) {
const { value } = e.detail;
console.log('输入内容变化:', value);
this.setData({ value });
},

// 点击上传按钮
onUploadClick() {
console.log('点击上传按钮');
},

// 点击文件
onFileClick(e) {
const { file } = e.detail;
console.log('点击文件:', file);
wx.showToast({
title: `点击了文件: ${file.name}`,
icon: 'none',
});
},

// 删除文件
onFileDelete(e) {
const { file } = e.detail;
console.log('删除文件:', file);
wx.showToast({
title: '文件删除成功',
icon: 'success',
});
},

// 文件列表变化
onFileChange(e) {
console.log(e, 'e----');

const { files } = e.detail;
console.log('文件列表变化:', files);
this.setData({ fileList: files });
},

// 添加文件
onFileAdd() {
console.log('添加文件');
},

// 选择文件
onFileSelect(e) {
const { name, files } = e.detail;
console.log('选择文件:', name, files);

wx.showToast({
title: `选择了${files.length}个文件`,
icon: 'success',
});
},

// 上传面板显示状态变化
onUpdateVisible(e) {
const visible = e.detail;
console.log('上传面板显示状态:', visible);
this.setData({ visible });
},

// 键盘高度变化
onKeyboardHeightChange(e) {
console.log('键盘高度变化:', e.detail);
},

// 切换禁用状态
toggleDisabled() {
this.setData({ disabled: !this.data.disabled });
},

// 切换加载状态
toggleLoading() {
this.setData({ loading: !this.data.loading });
},

// 清空输入框
clearInput() {
this.setData({ value: '' });
},

onDeepThinkTap() {
this.setData({ deepThinkActive: !this.data.deepThinkActive });
},

onNetSearchTap() {
this.setData({ netSearchActive: !this.data.netSearchActive });
},

handleCLoseCite() {
this.setData({ headerText: '' });
},
});

```

**CSS** (`css`):
```css
.demo-content-citation-container {
padding: 56rpx 0 0 0;
background-color: var(--td-bg-color-container);
height: 568rpx;
position: relative;
}

.demo-file-citation-footer {
height: 32rpx;
width: 100%;
text-align: center;
font-size: 20rpx;
line-height: 32rpx;
color: var(--td-text-color-placeholder);
position: absolute;
bottom: 32rpx;
}

.chat-sender-wrapper {
/* border: 2rpx solid #e5e5e5; */
border-radius: 8rpx;
overflow: hidden;
background-color: var(--td-bg-color-container);
}

.demo-footer-prefix {
display: flex;
align-items: center;
}

.deep-think-block {
padding: 0 24rpx;
height: 60rpx;
margin-right: 16rpx;
}

.deep-think-text {
margin-left: 8rpx;
}

.deep-think-block,
.net-search-block {
color: var(--td-text-color-primary);
border-radius: 200rpx;
border: 2rpx solid var(--td-component-border);
display: flex;
justify-content: center;
align-items: center;
}

.net-search-block {
width: 64rpx;
height: 60rpx;
}

.active {
border-color: var(--td-brand-color-light-active);
color: var(--td-brand-color);
background-color: var(--td-brand-color-light);
}

.demo-header {
display: flex;
width: calc(100% - 48rpx);
margin-left: 24rpx;
height: 62rpx;
border-bottom: 2rpx solid var(--td-component-stroke);
}

.header-content-wrapper {
padding: 0 24rpx;
display: flex;
}

.header-file-content {
padding: 2rpx 0;
line-height: 44rpx;
white-space: nowrap;
overflow: hidden;
text-overflow: ellipsis;
font-size: var(--td-font-size-body-medium);
color: var(--td-text-color-placeholder);
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"styleIsolation": "shared",
"usingComponents": {
"t-navbar": "tdesign-miniprogram/navbar/navbar",
"t-chat-sender": "tdesign-miniprogram/chat-sender/chat-sender"
}
}

```

## API

### ChatSenderProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| adjust-position | Boolean | false | 默认键盘弹起不会把页面顶起来 | N |
| attachments-props | Object | - | 附件列表属性。TS 类型：`AttachmentsProps`，Attachments API Documents。详细类型定义 | N |
| auto-rise-with-keyboard | Boolean | false | 键盘弹起时自动顶起来输入框 | N |
| disabled | Boolean | false | 是否禁用输入框 | N |
| file-list | Array | [] | 附件文件列表。TS 类型：`FileItem[]` | N |
| loading | Boolean | false | 发送按钮是否处于加载状态 | N |
| placeholder | String | 请输入消息... | 输入框默认文案 | N |
| render-presets | Array | [{name: 'upload', presets: ['uploadCamera', 'uploadImage', 'uploadAttachment'], status: ''},{ name: 'send', type: 'icon'}] | 预设发送区渲染配置，用于灵活配置发送区的上传入口和发送按钮，支持自定义类型、顺序、样式。TS 类型：`ChatActionButtons``type ChatActionButtons = Array<ChatActionButton>``type ChatActionButton = UploadButton \| SendButton``interface UploadButton { name: 'upload'; presets: string[]; status?: string; }``interface SendButton { name: 'send'; type: 'icon' \| 'text';}`。详细类型定义 | N |
| textarea-props | Boolean / Object | { autosize: { maxHeight: 264, minHeight: 48 } } | 透传给 Textarea 组件的属性，autosize数值单位为 rpx | N |
| value | String | - | 输入框的值 | N |
| visible | Boolean | false | 上传面板是否可见 | N |

### ChatSenderEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| blur | `(value:string, context: { e: FocusEvent })` | 输入框聚焦时触发 |
| change | `(value:string, context: { e: InputEvent \| MouseEvent \| KeyboardEvent })` | 输入框值发生变化时触发 |
| file-add | - | 添加附件时触发 |
| file-change | `(file:FileItem)` | 附件列表变化时触发 |
| file-click | `(file:FileItem)` | 点击附件时触发 |
| file-delete | `(file:FileItem)` | 删除附件时触发 |
| file-select | `(detail: {files: FileList, name: UploadActionType})` | 选择文件（图片/微信文件）时触发 |
| focus | `(value:string, context: { e: FocusEvent }) ` | 输入框聚焦时触发 |
| keyboardheightchange | `(detail: {height: number, duration: number})` | 选择文件（图片/微信文件）时触发 |
| send | `(value:string, context: {\| KeyboardEvent })` | 点击消息发送的回调方法 |
| stop | `(value:string)` | 点击消息终止的回调方法 |
| upload-click | - | 【实验】点击上传按钮时触发 |