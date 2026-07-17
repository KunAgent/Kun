# SideBar 侧边栏

## 示例

该组件于 0.25.0 版本上线，请留意版本。
## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
{
"usingComponents": {
"t-side-bar": "tdesign-miniprogram/side-bar/side-bar",
"t-side-bar-item": "tdesign-miniprogram/side-bar-item/side-bar-item",
}
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/CoD8wNmL8s5h)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 锚点用法

**WXML** (`html`):
```html
<view class="custom-navbar">
<t-navbar class="demo-navbar" title="TDesign" leftArrow placeholder zIndex="{{99}}" />
</view>

<view class="side-bar-wrapper" style="height: calc(100vh - {{navbarHeight}}px)">
<t-side-bar value="{{sideBarIndex}}" bind:change="onSideBarChange">
<t-side-bar-item
wx:for="{{categories}}"
wx:key="label"
value="{{item.value || index}}"
label="{{item.label}}"
badge-props="{{item.badgeProps}}"
/>
</t-side-bar>
<scroll-view class="content" scroll-y scroll-with-animation scroll-top="{{scrollTop}}" bind:scroll="onScroll">
<view wx:for="{{categories}}" wx:key="index" class="section">
<view class="title">{{item.title || item.label}}</view>
<t-grid column="{{3}}" border="{{false}}">
<block wx:for="{{item.items}}" wx:key="index" wx:for-item="cargo">
<t-grid-item
t-class-image="image"
text="{{cargo.label}}"
image="{{cargo.image}}"
image-props="{{ { shape: 'round', lazy: true } }}"
>
</t-grid-item>
</block>
</t-grid>
</view>
</scroll-view>
</view>

```

**JS** (`javascript`):
```javascript
const image = 'https://tdesign.gtimg.com/mobile/demos/example2.png';
const items = new Array(12).fill().map((_, index) => ({
label: index % 3 === 2 ? '最多六个文字' : '标题文字',
image: image,
}));

Page({
offsetTopList: [],
lastScrollTop: 0,
data: {
sideBarIndex: 1,
scrollTop: 0,
categories: [
{
label: '选项一',
title: '标题一',
badgeProps: {},
items,
},
{
label: '选项二',
title: '标题二',
badgeProps: {
dot: true,
},
items: items.slice(0, 9),
},
{
label: '选项三',
title: '标题三',
badgeProps: {},
items: items.slice(0, 9),
},
{
label: '选项四',
title: '标题四',
badgeProps: {
count: 6,
},
items: items.slice(0, 6),
},
{
label: '选项五',
title: '标题五',
badgeProps: {},
items: items.slice(0, 3),
},
],
navbarHeight: 0,
},
onLoad() {
const query = wx.createSelectorQuery().in(this);
const { sideBarIndex } = this.data;
query.selectAll('.title').boundingClientRect();
query.select('.custom-navbar').boundingClientRect();
query.exec((res) => {
const [rects, { height: navbarHeight }] = res;
this.offsetTopList = rects.map((item) => item.top - navbarHeight);
this.setData({ navbarHeight, scrollTop: this.offsetTopList[sideBarIndex] });
});
},

onSideBarChange(e) {
const { value } = e.detail;

this.setData({ sideBarIndex: value, scrollTop: this.offsetTopList[value] });
},
onScroll(e) {
const { scrollTop } = e.detail;
const threshold = 50; // 下一个标题与顶部的距离
const direction = scrollTop > this.lastScrollTop ? 'down' : 'up';
this.lastScrollTop = scrollTop;

// 动态调整阈值：向下滚动时增大阈值，向上时减小
const dynamicThreshold = direction === 'down' ? threshold * 1.5 : threshold * 0.8;

// 使用二分查找优化查找效率
const findNearestIndex = (arr, target) => {
let left = 0;
let right = arr.length - 1;
let result = 0;
while (left <= right) {
const mid = Math.floor((left + right) / 2);
if (arr[mid] <= target + dynamicThreshold) {
result = mid;
left = mid + 1;
} else {
right = mid - 1;
}
}
return result;
};

const newIndex = findNearestIndex(this.offsetTopList, scrollTop);

if (newIndex !== this.data.sideBarIndex) {
this.setData({ sideBarIndex: newIndex });
}
},
});

```

**CSS** (`css`):
```css
page {
background-color: var(--td-bg-color-container);
}

page .round-image {
border-radius: 12rpx;
}

.side-bar-wrapper {
display: flex;
height: 100vh;

--td-grid-item-text-font: var(--td-font-body-small);
}

.side-bar-wrapper .content {
flex: 1;
}

.side-bar-wrapper .section {
padding: 32rpx 0;
}

.side-bar-wrapper .title {
padding-left: 40rpx;
margin-bottom: 8rpx;
font-size: 28rpx;
line-height: 44rpx;
color: var(--td-text-color-primary);
}

.side-bar-wrapper .image {
width: 96rpx;
height: 96rpx;
position: relative;
}

.side-bar-wrapper .image::before {
content: ' ';
position: absolute;
top: 0;
left: 0;
width: 200%;
height: 200%;
border-radius: 24rpx;
border: 2rpx solid var(--td-gray-color-4);
transform-origin: 0 0;
transform: scale(0.5);
}

```

**JSON** (`javascript`):
```javascript
{
"navigationBarBackgroundColor": "#fff",
"usingComponents": {
"t-side-bar": "tdesign-miniprogram/side-bar/side-bar",
"t-side-bar-item": "tdesign-miniprogram/side-bar-item/side-bar-item",
"t-grid": "tdesign-miniprogram/grid/grid",
"t-grid-item": "tdesign-miniprogram/grid-item/grid-item"
}
}

```

### 切页用法

**WXML** (`html`):
```html
<view class="custom-navbar">
<t-navbar class="demo-navbar" title="TDesign" leftArrow placeholder zIndex="{{99}}" />
</view>

<view class="side-bar-wrapper" style="height: calc(100vh - {{navbarHeight}}px)">
<t-side-bar value="{{sideBarIndex}}" bind:change="onSideBarChange">
<t-side-bar-item
wx:for="{{categories}}"
wx:key="label"
value="{{item.value || index}}"
label="{{item.label}}"
disabled="{{item.disabled}}"
badge-props="{{item.badgeProps}}"
/>
</t-side-bar>
<view class="content" style="transform: translateY(-{{sideBarIndex * 100}}%)">
<scroll-view
wx:for="{{categories}}"
wx:key="label"
class="section"
scroll-y
scroll-top="{{scrollTop}}"
scroll-with-animation
show-scrollbar="{{false}}"
>
<view class="title">{{item.title || item.label}}</view>
<t-cell-group>
<block wx:for="{{item.items}}" wx:key="index" wx:for-item="cargo">
<t-cell t-class-left="cell" title="{{cargo.label}}{{index}}">
<t-image shape="round" src="{{cargo.image}}" slot="image" lazy t-class="image" />
</t-cell>
</block>
</t-cell-group>
</scroll-view>
</view>
</view>

```

**JS** (`javascript`):
```javascript
const image = 'https://tdesign.gtimg.com/mobile/demos/example2.png';
const items = new Array(12).fill({ label: '标题文字', image }, 0, 12);

Page({
offsetTopList: [],
data: {
sideBarIndex: 1,
scrollTop: 0,
categories: [
{
label: '选项一',
title: '标题一',
badgeProps: {},
items,
},
{
label: '选项二',
title: '标题二',
badgeProps: {
dot: true,
},
items: items.slice(0, 10),
},
{
label: '选项三',
title: '标题三',
badgeProps: {},
items: items.slice(0, 6),
},
{
label: '选项四',
title: '标题四',
badgeProps: {
count: 8,
},
items: items.slice(0, 8),
},
{
label: '选项五',
title: '标题五',
badgeProps: {},
disabled: true,
items: items.slice(0, 8),
},
],
navbarHeight: 0,
},
onLoad() {
this.getCustomNavbarHeight();
},

getCustomNavbarHeight() {
const query = wx.createSelectorQuery();
query.select('.custom-navbar').boundingClientRect();
query.exec((res) => {
const { height = 0 } = res[0] || {};
this.setData({ navbarHeight: height });
});
},

onSideBarChange(e) {
const { value } = e.detail;
console.log('---', value);
this.setData({ sideBarIndex: value, scrollTop: 0 });
},
});

```

**CSS** (`css`):
```css
page {
background-color: var(--td-bg-color-container);
}

page .round-image {
border-radius: 12rpx;
}

.side-bar-wrapper {
display: flex;
height: 100vh;
overflow: hidden;
}

.side-bar-wrapper .content {
flex: 1;
transition: transform 0.3s ease;
}

.side-bar-wrapper .section {
padding: 32rpx 0;
box-sizing: border-box;
height: 100%;
}

.side-bar-wrapper .title {
padding-left: 40rpx;
margin-bottom: 8rpx;
font: var(--td-font-body-medium);
color: var(--td-text-color-primary);
}

.side-bar-wrapper .image {
width: 96rpx;
height: 96rpx;

position: relative;
}

.side-bar-wrapper .cell {
margin-right: 32rpx !important;
}

.side-bar-wrapper .image::before {
content: ' ';
position: absolute;
top: 0;
left: 0;
width: 200%;
height: 200%;
border-radius: 24rpx;
border: 2rpx solid var(--td-gray-color-4);
transform-origin: 0 0;
transform: scale(0.5);
}

```

**JSON** (`javascript`):
```javascript
{
"navigationBarBackgroundColor": "#fff",
"usingComponents": {
"t-side-bar": "tdesign-miniprogram/side-bar/side-bar",
"t-side-bar-item": "tdesign-miniprogram/side-bar-item/side-bar-item",
"t-cell-group": "tdesign-miniprogram/cell-group/cell-group",
"t-cell": "tdesign-miniprogram/cell/cell",
"t-image": "tdesign-miniprogram/image/image"
}
}

```

### 带图标侧边导航

**WXML** (`html`):
```html
<view class="custom-navbar">
<t-navbar class="demo-navbar" title="TDesign" leftArrow placeholder zIndex="{{99}}" />
</view>

<view class="side-bar-wrapper" style="height: calc(100vh - {{navbarHeight}}px)">
<t-side-bar value="{{sideBarIndex}}" bind:change="onSideBarChange">
<t-side-bar-item
wx:for="{{categories}}"
wx:key="label"
value="{{item.value || index}}"
label="{{item.label}}"
icon="{{item.icon}}"
badge-props="{{item.badgeProps}}"
/>
</t-side-bar>
<scroll-view class="content" scroll-y scroll-with-animation scroll-top="{{scrollTop}}" bind:scroll="onScroll">
<view wx:for="{{categories}}" wx:key="label" class="section">
<view class="title">{{item.title || item.label}}</view>
<t-grid column="{{3}}" border="{{false}}">
<block wx:for="{{item.items}}" wx:key="index" wx:for-item="cargo">
<t-grid-item
t-class-image="image"
text="{{cargo.label}}"
image="{{cargo.image}}"
image-props="{{ { shape: 'round', lazy: true } }}"
>
</t-grid-item>
</block>
</t-grid>
</view>
</scroll-view>
</view>

```

**JS** (`javascript`):
```javascript
const image = 'https://tdesign.gtimg.com/mobile/demos/example2.png';
const items = new Array(12).fill().map((_, index) => ({
label: index % 3 === 2 ? '最多六个文字' : '标题文字',
image: image,
}));

Page({
offsetTopList: [],
lastScrollTop: 0,
data: {
sideBarIndex: 1,
scrollTop: 0,
categories: [
{
label: '选项一',
title: '标题一',
icon: 'app',
badgeProps: {},
items,
},
{
label: '选项二',
title: '标题二',
icon: 'app',
badgeProps: {
dot: true,
},
items: items.slice(0, 9),
},
{
label: '选项三',
title: '标题三',
icon: 'app',
badgeProps: {},
items: items.slice(0, 9),
},
{
label: '选项四',
title: '标题四',
icon: 'app',
badgeProps: {
count: 6,
},
items: items.slice(0, 6),
},
{
label: '选项五',
title: '标题五',
icon: 'app',
badgeProps: {},
items: items.slice(0, 3),
},
],
navbarHeight: 0,
},
onLoad() {
const query = wx.createSelectorQuery().in(this);
const { sideBarIndex } = this.data;
query.selectAll('.title').boundingClientRect();
query.select('.custom-navbar').boundingClientRect();
query.exec((res) => {
const [rects, { height: navbarHeight = 0 }] = res;
this.offsetTopList = rects.map((item) => item.top - navbarHeight);
this.setData({ navbarHeight, scrollTop: this.offsetTopList[sideBarIndex] });
});
},
onSideBarChange(e) {
const { value } = e.detail;

this.setData({ sideBarIndex: value, scrollTop: this.offsetTopList[value] });
},
onScroll(e) {
const { scrollTop } = e.detail;
const threshold = 50; // 下一个标题与顶部的距离
const direction = scrollTop > this.lastScrollTop ? 'down' : 'up';
this.lastScrollTop = scrollTop;

// 动态调整阈值：向下滚动时增大阈值，向上时减小
const dynamicThreshold = direction === 'down' ? threshold * 1.5 : threshold * 0.8;

// 使用二分查找优化查找效率
const findNearestIndex = (arr, target) => {
let left = 0;
let right = arr.length - 1;
let result = 0;
while (left <= right) {
const mid = Math.floor((left + right) / 2);
if (arr[mid] <= target + dynamicThreshold) {
result = mid;
left = mid + 1;
} else {
right = mid - 1;
}
}
return result;
};

const newIndex = findNearestIndex(this.offsetTopList, scrollTop);

if (newIndex !== this.data.sideBarIndex) {
this.setData({ sideBarIndex: newIndex });
}
},
});

```

**CSS** (`css`):
```css
page {
background-color: var(--td-bg-color-container);
}

page .round-image {
border-radius: 12rpx;
}

.side-bar-wrapper {
display: flex;
height: 100vh;

--td-grid-item-text-font: var(--td-font-body-small);
}

.side-bar-wrapper .content {
flex: 1;
}

.side-bar-wrapper .section {
padding: 32rpx 0;
}

.side-bar-wrapper .title {
padding-left: 40rpx;
margin-bottom: 8rpx;
font: var(--td-font-body-medium);
color: var(--td-text-color-primary);
}

.side-bar-wrapper .image {
width: 96rpx;
height: 96rpx;
position: relative;
}

.side-bar-wrapper .image::before {
content: ' ';
position: absolute;
top: 0;
left: 0;
width: 200%;
height: 200%;
border-radius: 24rpx;
border: 2rpx solid var(--td-gray-color-4);
transform-origin: 0 0;
transform: scale(0.5);
}

```

**JSON** (`javascript`):
```javascript
{
"navigationBarBackgroundColor": "#fff",
"usingComponents": {
"t-side-bar": "tdesign-miniprogram/side-bar/side-bar",
"t-side-bar-item": "tdesign-miniprogram/side-bar-item/side-bar-item",
"t-grid": "tdesign-miniprogram/grid/grid",
"t-grid-item": "tdesign-miniprogram/grid-item/grid-item"
}
}

```

### 自定义样式

**WXML** (`html`):
```html
<view class="custom-navbar">
<t-navbar class="demo-navbar" title="TDesign" leftArrow placeholder zIndex="{{99}}" />
</view>

<view class="side-bar-wrapper" style="height: calc(100vh - {{navbarHeight}}px)">
<t-side-bar value="{{sideBarIndex}}" bind:change="onSideBarChange">
<t-side-bar-item
wx:for="{{categories}}"
wx:key="label"
value="{{item.value || index}}"
label="{{item.label}}"
badge-props="{{item.badgeProps}}"
/>
</t-side-bar>
<scroll-view class="content" scroll-y scroll-with-animation scroll-top="{{scrollTop}}" bind:scroll="onScroll">
<view wx:for="{{categories}}" wx:key="index" class="section">
<view class="title">{{item.title || item.label}}</view>
<t-grid column="{{3}}" border="{{false}}">
<block wx:for="{{item.items}}" wx:key="index" wx:for-item="cargo">
<t-grid-item
t-class-image="image"
text="{{cargo.label}}"
image="{{cargo.image}}"
image-props="{{ { shape: 'round', lazy: true } }}"
>
</t-grid-item>
</block>
</t-grid>
</view>
</scroll-view>
</view>

```

**JS** (`javascript`):
```javascript
const image = 'https://tdesign.gtimg.com/mobile/demos/example1.png';
const items = new Array(12).fill().map((_, index) => ({
label: index % 3 === 2 ? '最多六个文字' : '标题文字',
image: image,
}));

Page({
offsetTopList: [],
lastScrollTop: 0,
data: {
sideBarIndex: 1,
scrollTop: 0,
categories: [
{
label: '选项一',
title: '标题一',
badgeProps: {},
items,
},
{
label: '选项二',
title: '标题二',
badgeProps: {
dot: true,
},
items: items.slice(0, 9),
},
{
label: '选项三',
title: '标题三',
badgeProps: {},
items: items.slice(0, 9),
},
{
label: '选项四',
title: '标题四',
badgeProps: {
count: 6,
},
items: items.slice(0, 6),
},
{
label: '选项五',
title: '标题五',
badgeProps: {},
items: items.slice(0, 3),
},
],
navbarHeight: 0,
},
onLoad() {
const query = wx.createSelectorQuery().in(this);
const { sideBarIndex } = this.data;
query.selectAll('.title').boundingClientRect();
query.select('.custom-navbar').boundingClientRect();
query.exec((res) => {
const [rects, { height: navbarHeight }] = res;
this.offsetTopList = rects.map((item) => item.top - navbarHeight);
this.setData({ navbarHeight, scrollTop: this.offsetTopList[sideBarIndex] });
});
},
onSideBarChange(e) {
const { value } = e.detail;

this.setData({ sideBarIndex: value, scrollTop: this.offsetTopList[value] });
},
onScroll(e) {
const { scrollTop } = e.detail;
const threshold = 50; // 下一个标题与顶部的距离
const direction = scrollTop > this.lastScrollTop ? 'down' : 'up';
this.lastScrollTop = scrollTop;

// 动态调整阈值：向下滚动时增大阈值，向上时减小
const dynamicThreshold = direction === 'down' ? threshold * 1.5 : threshold * 0.8;

// 使用二分查找优化查找效率
const findNearestIndex = (arr, target) => {
let left = 0;
let right = arr.length - 1;
let result = 0;
while (left <= right) {
const mid = Math.floor((left + right) / 2);
if (arr[mid] <= target + dynamicThreshold) {
result = mid;
left = mid + 1;
} else {
right = mid - 1;
}
}
return result;
};

const newIndex = findNearestIndex(this.offsetTopList, scrollTop);

if (newIndex !== this.data.sideBarIndex) {
this.setData({ sideBarIndex: newIndex });
}
},
});

```

**CSS** (`css`):
```css
page {
background-color: var(--td-bg-color-container);
}

page .round-image {
border-radius: 12rpx;
}

.side-bar-wrapper {
display: flex;
height: 100vh;

--td-grid-item-text-font: var(--td-font-body-small);
}

.side-bar-wrapper .content {
flex: 1;
}

.side-bar-wrapper .section {
padding: 32rpx 0;
}

.side-bar-wrapper .title {
padding-left: 40rpx;
margin-bottom: 8rpx;
font-size: 28rpx;
line-height: 44rpx;
color: var(--td-text-color-primary);
}

.side-bar-wrapper .image {
width: 96rpx;
height: 96rpx;
position: relative;
}

.side-bar-wrapper .image::before {
content: ' ';
position: absolute;
top: 0;
left: 0;
width: 200%;
height: 200%;
border-radius: 24rpx;
border: 2rpx solid var(--td-gray-color-4);
transform-origin: 0 0;
transform: scale(0.5);
}

page .side-bar-wrapper {
--td-side-bar-border-radius: 6px;
--td-side-bar-active-color: green;
}

```

**JSON** (`javascript`):
```javascript
{
"navigationBarBackgroundColor": "#fff",
"usingComponents": {
"t-side-bar": "tdesign-miniprogram/side-bar/side-bar",
"t-side-bar-item": "tdesign-miniprogram/side-bar-item/side-bar-item",
"t-grid": "tdesign-miniprogram/grid/grid",
"t-grid-item": "tdesign-miniprogram/grid-item/grid-item"
}
}

```

## API

### SideBarProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| value | String / Number | - | 选项值 | N |
| default-value | String / Number | undefined | 选项值。非受控属性 | N |

### SideBarEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| change | `(value: number \| string, label: string)` | 选项值发生变化时触发 |
| click | `(value: number \| string, label: string)` | 点击选项时触发 |

### SideBarSlots

| 名称 | 描述 |
| --- | --- |
| - | 默认插槽，自定义侧边导航栏内容 |

### SideBarItemProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| badge-props | Object | - | 透传至 Badge 组件。TS 类型：`BadgeProps`，Badge API Documents。详细类型定义 | N |
| disabled | Boolean | false | 是否禁用 | N |
| icon | String / Object | - | 图标，传对象则透传至 Icon | N |
| label | String | - | 展示的标签 | N |
| value | String / Number | - | 当前选项的值 | N |

### SideBarItemSlots

| 名称 | 描述 |
| --- | --- |
| - | 默认插槽，自定义侧边导航项内容 |

### CSSVariables

组件提供了下列 CSS 变量，可用于自定义样式。

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| --td-side-bar-bg-color | @bg-color-secondarycontainer | - |
| --td-side-bar-height | 100% | - |
| --td-side-bar-width | 206rpx | - |
| --td-side-bar-active-color | @brand-color | - |
| --td-side-bar-border-radius | 18rpx | - |
| --td-side-bar-color | @text-color-primary | - |
| --td-side-bar-disabled-color | @text-color-disabled | - |
| --td-side-bar-font | @font-body-large | - |
| --td-side-bar-icon-size | 40rpx | - |
| --td-side-bar-item-height | auto | - |