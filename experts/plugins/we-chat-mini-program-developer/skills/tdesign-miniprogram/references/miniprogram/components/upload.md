# Upload 上传

## 示例

## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-upload": "tdesign-miniprogram/upload/upload",
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/uXEjPNm68y52)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 单选上传图片

图片上传有两种方式：

1 选择完所有图片之后，统一上传，因此选择完就直接展示

2 每次选择图片都上传，展示每次上传图片的进度

**WXML** (`html`):
```html
<view class="wrapper">
<t-upload
disabled
mediaType="{{['video','image']}}"
max="{{1}}"
files="{{fileList}}"
bind:add="handleAdd"
bind:remove="handleRemove"
>
</t-upload>
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
fileList: [],
},
methods: {
handleAdd(e) {
const { fileList } = this.data;
const { files } = e.detail;

// 方法1：选择完所有图片之后，统一上传，因此选择完就直接展示
this.setData({
fileList: [...fileList, ...files], // 此时设置了 fileList 之后才会展示选择的图片
});

// 方法2：每次选择图片都上传，展示每次上传图片的进度
// files.forEach(file => this.uploadFile(file))
},
onUpload(file) {
const { fileList } = this.data;

this.setData({
fileList: [...fileList, { ...file, status: 'loading' }],
});
const { length } = fileList;

const task = wx.uploadFile({
url: 'https://example.weixin.qq.com/upload', // 仅为示例，非真实的接口地址
filePath: file.url,
name: 'file',
formData: { user: 'test' },
success: () => {
this.setData({
[`fileList[${length}].status`]: 'done',
});
},
});
task.onProgressUpdate((res) => {
this.setData({
[`fileList[${length}].percent`]: res.progress,
});
});
},
handleRemove(e) {
const { index } = e.detail;
const { fileList } = this.data;

fileList.splice(index, 1);
this.setData({
fileList,
});
},
},
});

```

**CSS** (`css`):
```css

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-upload": "tdesign-miniprogram/upload/upload"
}
}

```

### 多选上传图片

**WXML** (`html`):
```html
<view class="wrapper">
<t-upload
disabled
media-type="{{['video','image']}}"
files="{{originFiles}}"
gridConfig="{{gridConfig}}"
removeBtn="{{false}}"
bind:success="handleSuccess"
bind:remove="handleRemove"
bind:click="handleClick"
bind:sort-end="handleSortEnd"
/>
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
originFiles: [
{
url: 'https://tdesign.gtimg.com/mobile/demos/example4.png',
name: 'uploaded1.png',
type: 'image',
removeBtn: true,
},
{
url: 'https://tdesign.gtimg.com/mobile/demos/example6.png',
name: 'uploaded2.png',
type: 'image',
removeBtn: true,
},
{
url: 'https://tdesign.gtimg.com/mobile/demos/example5.png',
name: 'uploaded3.png',
type: 'image',
removeBtn: true,
},
],
gridConfig: {
column: 4,
width: 160,
height: 160,
},
config: {
count: 1,
},
},
methods: {
handleSuccess(e) {
const { files } = e.detail;
this.setData({
originFiles: files,
});
},
handleRemove(e) {
const { index } = e.detail;
const { originFiles } = this.data;
originFiles.splice(index, 1);
this.setData({
originFiles,
});
},
handleClick(e) {
console.log(e.detail.file);
},
},
});

```

**CSS** (`css`):
```css

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-upload": "tdesign-miniprogram/upload/upload"
}
}

```

### 长按拖拽排序图片

**WXML** (`html`):
```html
<view class="wrapper">
<t-upload
draggable
disabled
media-type="{{['video','image']}}"
files="{{originFiles}}"
gridConfig="{{gridConfig}}"
bind:success="handleSuccess"
bind:remove="handleRemove"
bind:click="handleClick"
bind:drop="handleDrop"
/>
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
originFiles: [
{
url: 'https://tdesign.gtimg.com/mobile/demos/example4.png',
name: 'uploaded1.png',
type: 'image',
},
{
url: 'https://tdesign.gtimg.com/mobile/demos/example6.png',
name: 'uploaded2.png',
type: 'image',
},
{
url: 'https://tdesign.gtimg.com/mobile/demos/example5.png',
name: 'uploaded3.png',
type: 'image',
},
],
gridConfig: {
column: 4,
width: 160,
height: 160,
},
config: {
count: 1,
},
},
methods: {
handleSuccess(e) {
const { files } = e.detail;
this.setData({
originFiles: files,
});
},
handleRemove(e) {
const { index } = e.detail;
const { originFiles } = this.data;
originFiles.splice(index, 1);
this.setData({
originFiles,
});
},
handleClick(e) {
console.log(e.detail.file);
},

handleDrop(e) {
const { files } = e.detail;
this.setData({
originFiles: files,
});
},
},
});

```

**CSS** (`css`):
```css

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-upload": "tdesign-miniprogram/upload/upload"
}
}

```

### 加载状态

支持多种状态：`loading`、`reload`、`failed`；

其中 `loading` 还可以通过传入 `percent` 来区分是否展示进度。

**WXML** (`html`):
```html
<view class="wrapper">
<t-upload
disabled
media-type="{{['video','image']}}"
files="{{originFiles}}"
gridConfig="{{gridConfig}}"
bind:success="handleSuccess"
bind:remove="handleRemove"
bind:click="handleClick"
/>
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
originFiles: [
{
url: 'https://tdesign.gtimg.com/mobile/demos/example4.png',
name: 'uploaded1.png',
type: 'image',
status: 'loading',
},
{
url: 'https://tdesign.gtimg.com/mobile/demos/example5.png',
name: 'uploaded2.png',
type: 'image',
percent: 68,
status: 'loading',
},
{
url: 'https://tdesign.gtimg.com/mobile/demos/example6.png',
name: 'uploaded3.png',
type: 'image',
status: 'reload',
},
{
url: 'https://tdesign.gtimg.com/mobile/demos/example5.png',
name: 'uploaded4.png',
type: 'image',
status: 'failed',
},
],
gridConfig: {
column: 4,
width: 160,
height: 160,
},
config: {
count: 1,
},
},
methods: {
handleSuccess(e) {
const { files } = e.detail;
this.setData({
originFiles: files,
});
},
handleRemove(e) {
const { index } = e.detail;
const { originFiles } = this.data;
originFiles.splice(index, 1);
this.setData({
originFiles,
});
},
handleClick(e) {
console.log(e.detail.file);
},
},
});

```

**CSS** (`css`):
```css

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-upload": "tdesign-miniprogram/upload/upload"
}
}

```

### 从聊天记录上选

使用 `wx.chooseMessageFile` 实现，需要基础版本库 `2.5.0+`

**WXML** (`html`):
```html
<view class="wrapper">
<t-upload
disabled
mediaType="{{['video','image']}}"
files="{{originFiles}}"
gridConfig="{{gridConfig}}"
config="{{config}}"
source="messageFile"
bind:success="handleSuccess"
bind:remove="handleRemove"
>
</t-upload>
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
originFiles: [
{
url: 'https://tdesign.gtimg.com/mobile/demos/example4.png',
name: 'uploaded1.png',
type: 'image',
},
],
gridConfig: {
column: 4,
width: 160,
height: 160,
},
config: {
count: 1,
},
},
methods: {
handleSuccess(e) {
const { files } = e.detail;
this.setData({
originFiles: files,
});
},
handleRemove(e) {
const { index } = e.detail;
const { originFiles } = this.data;
originFiles.splice(index, 1);
this.setData({
originFiles,
});
},
},
});

```

**CSS** (`css`):
```css

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-upload": "tdesign-miniprogram/upload/upload"
}
}

```

## FAQ

### 为什么Upload外层使用display:flex时会造成组件样式混乱？

`Upload` 是基于 `TGrid` 宫格实现，当外层使用 `display: flex` ，子元素会默认加上 `flex-grow: 0`，造成 `Upload` 组件整体宽度不足。可以通过给 `Upload` 组件节点加上 `flex-grow: 1` 处理。

## API

### UploadProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| add-btn | Boolean | true | 添加按钮 | N |
| add-content | String | - | 添加按钮内容 | N |
| allow-upload-duplicate-file | Boolean | false | `暂不支持`。是否允许重复上传相同文件名的文件 | N |
| config | Object | - | 图片上传配置，视频上传配置，文件上传配置等，包含图片尺寸、图片来源、视频来源、视频拍摄最长时间等。更多细节查看小程序官网。图片上传。视频上传。TS 类型：`UploadMpConfig``type UploadMpConfig = ImageConfig \| VideoConfig``interface ImageConfig { count?: number; sizeType?: Array<SizeTypeValues>; sourceType?: Array<SourceTypeValues> }``type SizeTypeValues = 'original' \| 'compressed'``type SourceTypeValues = 'album' \| 'camera'``interface VideoConfig { sourceType?: Array<SourceTypeValues>; compressed?: boolean; maxDuration?: number; camera?: 'back' \| 'front' }`。详细类型定义 | N |
| disabled | Boolean | undefined | 是否禁用组件 | N |
| draggable | Boolean / Object | - | 是否支持拖拽排序。长按时是否振动，碰撞时是否振动。示例一：`true`。示例二：`{ vibrate: true, collisionVibrate: true }`。TS 类型：`boolean \| {vibrate?: boolean; collisionVibrate?: boolean}` | N |
| files | Array | - | 已上传文件列表。TS 类型：`Array<UploadFile>``interface UploadFile { url: string; name?: string; size?: number; type?: 'image' \| 'video'; percent?: number; status: 'loading' \| 'reload' \| 'failed' \| 'done' }`。详细类型定义 | N |
| default-files | Array | undefined | 已上传文件列表。非受控属性。TS 类型：`Array<UploadFile>``interface UploadFile { url: string; name?: string; size?: number; type?: 'image' \| 'video'; percent?: number; status: 'loading' \| 'reload' \| 'failed' \| 'done' }`。详细类型定义 | N |
| grid-config | Object | - | upload组件每行上传图片列数以及图片的宽度和高度。TS 类型：`{column?: number;  width?: number; height?: number;}` | N |
| gutter | Number | 16 | 预览窗格的`gutter`大小，单位 rpx | N |
| image-props | Object | - | 透传 Image 组件全部属性。TS 类型：`ImageProps`，Image API Documents。详细类型定义 | N |
| max | Number | 0 | 用于控制文件上传数量，值为 0 则不限制 | N |
| media-type | Array | ['image', 'video'] | 支持上传的文件类型，图片或视频。TS 类型：`Array<MediaType>``type MediaType = 'image' \| 'video'`。详细类型定义 | N |
| preview | Boolean | true | `1.9.5`。是否支持图片预览，文件没有预览 | N |
| remove-btn | Boolean | true | 移除按钮 | N |
| request-method | Function | - | 自定义上传方法 | N |
| size-limit | Number / Object | - | 图片文件大小限制，默认单位 KB。可选单位有：`'B' \| 'KB' \| 'MB' \| 'GB'`。示例一：`1000`。示例二：`{ size: 2, unit: 'MB', message: '图片大小不超过 {sizeLimit} MB' }`。TS 类型：`number \| SizeLimitObj``interface SizeLimitObj { size: number; unit: SizeUnit ; message?: string }``type SizeUnitArray = ['B', 'KB', 'MB', 'GB']``type SizeUnit = SizeUnitArray[number]`。详细类型定义 | N |
| source | String | media | 来源。可选项：media/messageFile | N |
| transition | Object |  | 拖拽位置移动时的过渡参数,`duration`单位为ms。TS 类型：`Transition``interface Transition { backTransition?: boolean, duration?: number, timingFunction?: string }`。详细类型定义 | N |

### UploadEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| add | `(files: MediaContext)` | 选择后触发，仅包含本次选择的照片；`url`表示选定视频的临时文件路径 (本地路径)。`duration`表示选定视频的时间长度。`size`选定视频的数据量大小。更多描述参考 wx.chooseMedia 小程序官网描述。详细类型定义。<br>`type MediaContext = VideoContext[] \| ImageContext[]`<br><br>`interface VideoContext { name?: string; type?: string; url?: string; duration?: number; size?: number; width?: number; height?: number; thumb: string; progress: number }`<br><br>`interface ImageContext { name: string; type: string; url: string;  size: number; width: number; height: number; progress: number  }`<br> |
| click | `(index: number; file: VideoContext \| ImageContext)` | 点击已选文件时触发；常用于重新上传 |
| complete | - | 上传成功或失败后触发 |
| drop | `(files: MediaContext) ` | 拖拽结束后触发，包含所有上传的文件（拖拽后的文件顺序）；`url`表示选定视频的临时文件路径 (本地路径)。`duration`表示选定视频的时间长度。`size`选定视频的数据量大小。更多描述参考 wx.chooseMedia 小程序官网描述。详细类型定义。<br>`type MediaContext = VideoContext[] \| ImageContext[]; interface VideoContext { name?: string; type?: string; url?: string; duration?: number; size?: number; width?: number; height?: number; thumb: string; progress: number }; interface ImageContext { name: string; type: string; url: string;  size: number; width: number; height: number; progress: number}`<br> |
| fail | - | 上传失败后触发 |
| remove | `(index: number; file: UploadFile)` | 移除文件时触发 |
| select-change | `(files: MediaContext[]; currentSelectedFiles: MediaContext[])` | 选择文件或图片之后，上传之前，触发该事件。<br>`files`表示之前已经上传完成的文件列表。<br>`currentSelectedFiles`表示本次上传选中的文件列表 |
| success | `(files: MediaContext)` | 上传成功后触发，包含所有上传的文件；`url`表示选定视频的临时文件路径 (本地路径)。`duration`表示选定视频的时间长度。`size`选定视频的数据量大小。更多描述参考 wx.chooseMedia 小程序官网描述。详细类型定义。<br>`type MediaContext = VideoContext[] \| ImageContext[]`<br><br>`interface VideoContext { name?: string; type?: string; url?: string; duration?: number; size?: number; width?: number; height?: number; thumb: string; progress: number }`<br><br>`interface ImageContext { name: string; type: string; url: string;  size: number; width: number; height: number; progress: number  }`<br> |

### UploadSlots

| 名称 | 描述 |
| --- | --- |
| add-content | 自定义`add-content`显示内容 |

### CSSVariables

组件提供了下列 CSS 变量，可用于自定义样式。

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| --td-upload-add-bg-color | @bg-color-secondarycontainer | - |
| --td-upload-add-color | @text-color-placeholder | - |
| --td-upload-add-disabled-bg-color | @bg-color-component-disabled | - |
| --td-upload-add-icon-disabled-color | @text-color-disabled | - |
| --td-upload-add-icon-size | 56rpx | - |
| --td-upload-disabled-mask | rgba(0, 0.6) | - |
| --td-upload-drag-transition-duration | --td-upload-drag-transition-duration | - |
| --td-upload-drag-transition-timing-function | --td-upload-drag-transition-timing-function | - |
| --td-upload-drag-z-index | 999 | - |
| --td-upload-radius | @radius-default | - |