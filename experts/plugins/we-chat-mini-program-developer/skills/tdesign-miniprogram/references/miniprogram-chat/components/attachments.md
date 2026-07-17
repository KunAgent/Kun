# Attachments 文件附件

## 示例

## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-attachments": "tdesign-miniprogram/attachments/attachments"
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/nsYgGtm58k4g)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 01组件类型

#### 图片类型

**WXML** (`html`):
```html
<view class="chat-example">
<view class="chat-example-block">
<t-attachments items="{{items}}" bind:fileClick="onFileClick" bind:remove="onRemove" bind:add="onAdd" />
</view>
</view>

```

**JS** (`javascript`):
```javascript
Page({
data: {
items: [
{
fileType: 'image',
name: 'sample-image.jpg',
url: 'https://tdesign.gtimg.com/site/avatar.jpg',
size: 1024,
status: 'success',
},
],
},

onFileClick(e) {
const { item } = e.detail;
console.log('点击文件:', item);
wx.showToast({
title: `点击了${item.name}`,
icon: 'none',
});
},

onRemove(e) {
const { item, index } = e.detail;
console.log('删除文件:', e, item, '索引:', index);

// 从列表中移除文件
const newItems = [...this.data.items];
newItems.splice(index, 1);

this.setData({
items: newItems,
});

wx.showToast({
title: '删除成功',
icon: 'success',
});
},

onAdd() {
console.log('点击添加按钮');
wx.showToast({
title: '点击了添加按钮',
icon: 'none',
});

// 模拟添加新文件
const newFile = {
fileType: 'txt',
name: `新文件${this.data.items.length + 1}.txt`,
url: 'https://example.com/newfile.txt',
size: 256,
status: 'success',
};

this.setData({
items: [...this.data.items, newFile],
});
},
});

```

**CSS** (`css`):
```css
.chat-example-block {
padding: 32rpx;
background-color: var(--td-bg-color-container);
}

```

**JSON** (`javascript`):
```javascript
{
"usingComponents": {
"t-attachments": "tdesign-miniprogram/attachments/attachments"
}
}

```

#### 文件类型

**WXML** (`html`):
```html
<view class="chat-example">
<!-- 有效的示例，呈现效果为 单行滚动 -->
<!-- <view class="chat-example-block">
<t-attachments items="{{items}}" bind:fileClick="onFileClick" bind:remove="onRemove" bind:add="onAdd" />
</view> -->

<view class="chat-example-block" wx:for="{{items}}" wx:for-item="item" wx:key="url">
<t-attachments items="{{[item]}}" bind:fileClick="onFileClick" bind:remove="onRemove" bind:add="onAdd" />
</view>
</view>

```

**JS** (`javascript`):
```javascript
Page({
data: {
items: [
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

onFileClick(e) {
const { item } = e.detail;
console.log('点击文件:', item);
wx.showToast({
title: `点击了${item.name}`,
icon: 'none',
});
},

onRemove(e) {
const { item, index } = e.detail;
console.log('删除文件:', e, item, '索引:', index);

// 从列表中移除文件
const newItems = [...this.data.items];
newItems.splice(index, 1);

this.setData({
items: newItems,
});

wx.showToast({
title: '删除成功',
icon: 'success',
});
},

onAdd() {
console.log('点击添加按钮');
wx.showToast({
title: '点击了添加按钮',
icon: 'none',
});

// 模拟添加新文件
const newFile = {
fileType: 'txt',
name: `新文件${this.data.items.length + 1}.txt`,
url: 'https://example.com/newfile.txt',
size: 256,
status: 'success',
};

this.setData({
items: [...this.data.items, newFile],
});
},
});

```

**CSS** (`css`):
```css
.chat-example {
padding: 32rpx;
box-sizing: border-box;
background-color: var(--td-bg-color-container);
}

.chat-example-block {
display: inline-flex;
width: 336rpx;
margin-bottom: 26rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"styleIsolation": "isolated",
"usingComponents": {
"t-attachments": "tdesign-miniprogram/attachments/attachments"
}
}

```

### 02组件状态

#### 图片类型加载状态

**WXML** (`html`):
```html
<view class="chat-example">
<view class="chat-example-block">
<t-attachments items="{{items}}" bind:fileClick="onFileClick" bind:remove="onRemove" bind:add="onAdd" />
</view>
</view>

```

**JS** (`javascript`):
```javascript
Page({
data: {
items: [
{
fileType: 'image',
name: 'sample-image.jpg',
url: 'https://tdesign.gtimg.com/site/avatar.jpg',
size: 1024,
status: 'pending',
},
],
},

onFileClick(e) {
const { item } = e.detail;
console.log('点击文件:', item);
wx.showToast({
title: `点击了${item.name}`,
icon: 'none',
});
},

onRemove(e) {
const { item, index } = e.detail;
console.log('删除文件:', e, item, '索引:', index);

// 从列表中移除文件
const newItems = [...this.data.items];
newItems.splice(index, 1);

this.setData({
items: newItems,
});

wx.showToast({
title: '删除成功',
icon: 'success',
});
},

onAdd() {
console.log('点击添加按钮');
wx.showToast({
title: '点击了添加按钮',
icon: 'none',
});

// 模拟添加新文件
const newFile = {
fileType: 'txt',
name: `新文件${this.data.items.length + 1}.txt`,
url: 'https://example.com/newfile.txt',
size: 256,
status: 'success',
};

this.setData({
items: [...this.data.items, newFile],
});
},
});

```

**CSS** (`css`):
```css
.chat-example-block {
padding: 32rpx;
background-color: var(--td-bg-color-container);
}

```

**JSON** (`javascript`):
```javascript
{
"usingComponents": {
"t-attachments": "tdesign-miniprogram/attachments/attachments"
}
}

```

#### 文件类型加载状态

**WXML** (`html`):
```html
<view class="chat-example">
<view class="chat-example-block">
<t-attachments items="{{items}}" bind:fileClick="onFileClick" bind:remove="onRemove" bind:add="onAdd" />
</view>
</view>

```

**JS** (`javascript`):
```javascript
Page({
data: {
items: [
{
fileType: 'doc',
name: 'word-file.doc',
url: 'https://example.com/word-file.doc',
size: 222859,
status: 'pending',
},
],
},

onFileClick(e) {
const { item } = e.detail;
console.log('点击文件:', item);
wx.showToast({
title: `点击了${item.name}`,
icon: 'none',
});
},

onRemove(e) {
const { item, index } = e.detail;
console.log('删除文件:', e, item, '索引:', index);

// 从列表中移除文件
const newItems = [...this.data.items];
newItems.splice(index, 1);

this.setData({
items: newItems,
});

wx.showToast({
title: '删除成功',
icon: 'success',
});
},

onAdd() {
console.log('点击添加按钮');
wx.showToast({
title: '点击了添加按钮',
icon: 'none',
});

// 模拟添加新文件
const newFile = {
fileType: 'txt',
name: `新文件${this.data.items.length + 1}.txt`,
url: 'https://example.com/newfile.txt',
size: 256,
status: 'success',
};

this.setData({
items: [...this.data.items, newFile],
});
},
});

```

**CSS** (`css`):
```css
.chat-example-block {
padding: 32rpx;
background-color: var(--td-bg-color-container);
}

```

**JSON** (`javascript`):
```javascript
{
"usingComponents": {
"t-attachments": "tdesign-miniprogram/attachments/attachments"
}
}

```

## API

### AttachmentsProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| addable | Boolean | true | 【讨论中】是否显示添加按钮 | N |
| image-viewer | Boolean | true | 是否启用图片预览功能 | N |
| items | Array | [] | 必需。附件列表。TS 类型：`FileItem[]``interface FileItem { fileType: 'image'\|'video'\|'audio'\|'pdf'\|'doc'\|'ppt'\|'txt'; name: string; url: string; size: number; status?: 'success'\|'fail'\|'pending'\|'error'; progress?: number; errorMessage?: string; fileIcon?: string; width?: number; height?: number; mode?: 'aspectFit' \| 'aspectFill' \| 'widthFix' \| 'heightFix' \| 'scaleToFill'}`。详细类型定义 | Y |
| removable | Boolean | true | 是否显示删除按钮 | N |

### AttachmentsEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| add | - | 点击添加按钮时触发 |
| file-click | `(item: FileItem)` | 点击文件时触发 |
| remove | `(item: FileItem, index: number)` | 点击删除按钮时触发 |