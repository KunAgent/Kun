# Indexes 索引

## 示例

IndexesAnchor 索引锚点组件于 0.32.0 版本上线，请留意版本。
## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-indexes": "tdesign-miniprogram/indexes/indexes",
"t-indexes-anchor": "tdesign-miniprogram/indexes-anchor/indexes-anchor"
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/iz0F6Om38d5t)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 基础索引

**WXML** (`html`):
```html
<view class="custom-navbar">
<t-navbar title="TDesign" leftArrow />
</view>
<t-indexes
current="{{current}}"
index-list="{{indexList}}"
sticky-offset="{{stickyOffset}}"
bind:select="onSelect"
bind:change="onChange"
>
<block wx:for="{{list}}" wx:key="index">
<t-indexes-anchor index="{{item.index}}" />
<t-cell-group>
<t-cell wx:for="{{item.children}}" wx:key="city" wx:for-item="city" title="{{city}}" aria-role="button" />
</t-cell-group>
</block>
</t-indexes>

```

**JS** (`javascript`):
```javascript
Page({
data: {
current: 'B',
indexList: [],
list: [
{
index: 'A',
children: ['阿坝', '阿拉善', '阿里', '安康', '安庆', '鞍山', '安顺', '安阳', '澳门'],
},
{
index: 'B',
children: [
'北京',
'白银',
'保定',
'宝鸡',
'保山',
'包头',
'巴中',
'北海',
'蚌埠',
'本溪',
'毕节',
'滨州',
'百色',
'亳州',
],
},
{
index: 'C',
children: [
'重庆',
'成都',
'长沙',
'长春',
'沧州',
'常德',
'昌都',
'长治',
'常州',
'巢湖',
'潮州',
'承德',
'郴州',
'赤峰',
'池州',
'崇左',
'楚雄',
'滁州',
'朝阳',
],
},
{
index: 'D',
children: [
'大连',
'东莞',
'大理',
'丹东',
'大庆',
'大同',
'大兴安岭',
'德宏',
'德阳',
'德州',
'定西',
'迪庆',
'东营',
],
},
{
index: 'E',
children: ['鄂尔多斯', '恩施', '鄂州'],
},
{
index: 'F',
children: ['福州', '防城港', '佛山', '抚顺', '抚州', '阜新', '阜阳'],
},
{
index: 'G',
children: ['广州', '桂林', '贵阳', '甘南', '赣州', '甘孜', '广安', '广元', '贵港', '果洛'],
},
{
index: 'J',
children: ['揭阳', '吉林', '晋江', '吉安', '胶州', '嘉兴', '济南', '鸡西', '荆州', '江门', '基隆'],
},
{
index: 'K',
children: ['昆明', '开封', '康定', '喀什'],
},
],
stickyOffset: 0,
},

onLoad() {
this.getCustomNavbarHeight();
},

onReady() {
this.setData({
indexList: this.data.list.map((item) => item.index),
});
},

onChange(e) {
const { index } = e.detail;
this.setData({
current: index,
});
console.log('change:', index);
},

onSelect(e) {
const { index } = e.detail;

console.log('select:', index);
},

getCustomNavbarHeight() {
const query = wx.createSelectorQuery();
query.select('.custom-navbar').boundingClientRect();
query.exec((res) => {
const { height = 0 } = res[0] || {};
this.setData({ stickyOffset: height });
});
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
"t-indexes": "tdesign-miniprogram/indexes/indexes",
"t-indexes-anchor": "tdesign-miniprogram/indexes-anchor/indexes-anchor",
"t-cell-group": "tdesign-miniprogram/cell-group/cell-group",
"t-cell": "tdesign-miniprogram/cell/cell"
}
}

```

### 自定义索引

**WXML** (`html`):
```html
<view class="custom-navbar">
<t-navbar title="TDesign" leftArrow />
</view>
<view class="indexes">
<t-indexes bind:change="onChange" index-list="{{indexList}}" sticky-offset="{{stickyOffset + 8}}" t-class="wrapper">
<block wx:for="{{list}}" wx:key="index">
<t-indexes-anchor index="{{item.index}}" t-class="anchor-wrapper">
<view class="capsule{{curIndex == item.index ? ' capsule--active' : ''}}">{{item.index}}</view>
</t-indexes-anchor>
<t-cell-group>
<t-cell
wx:for="{{item.children}}"
wx:key="city"
wx:for-item="city"
title="{{city}}"
bordered="{{item.children.length - 1 != index}}"
/>
</t-cell-group>
</block>
</t-indexes>
</view>

```

**JS** (`javascript`):
```javascript
const children = new Array(5).fill('列表内容');

const list = [
{
index: 1,
children,
},
{
index: 3,
children,
},
{
index: 5,
children,
},
{
index: 7,
children,
},
{
index: 8,
children,
},
{
index: 10,
children,
},
{
index: '#',
children,
},
];

Page({
data: {
list,
indexList: list.map((item) => item.index),
curIndex: '',
stickyOffset: 0,
},

onLoad() {
this.getCustomNavbarHeight();
},

onChange(e) {
const { index } = e.detail;

console.log(index);
this.setData({
curIndex: index,
});
},

getCustomNavbarHeight() {
const query = wx.createSelectorQuery();
query.select('.custom-navbar').boundingClientRect();
query.exec((res) => {
const { height = 0 } = res[0] || {};
this.setData({ stickyOffset: height });
});
},
});

```

**CSS** (`css`):
```css
.capsule {
margin: 0 8px;
height: 30px;
border-radius: 15px;
background-color: var(--td-bg-color-secondarycontainer, #f3f3f3);
padding-left: 32rpx;
display: flex;
align-items: center;
font-size: 14px;
box-sizing: border-box;
}

.capsule--active {
border: 1px solid var(--td-border-level-1-color, #e7e7e7);
}

.wrapper {
padding-top: 8px;
height: 100%;
}

.indexes,
.capsule--active,
.anchor-wrapper {
background: var(--td-bg-color-container, #ffffff);
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-indexes": "tdesign-miniprogram/indexes/indexes",
"t-indexes-anchor": "tdesign-miniprogram/indexes-anchor/indexes-anchor",
"t-cell-group": "tdesign-miniprogram/cell-group/cell-group",
"t-cell": "tdesign-miniprogram/cell/cell"
}
}

```

## FAQ

### 在滚动元素中，Indexes索引组件失效（#3746）？

`Indexes` 组件自 `0.32.0` 版本开始移除了对 `scroll-view` 的依赖，组件内部使用 [wx.pageScrollTo](https://developers.weixin.qq.com/miniprogram/dev/api/ui/scroll/wx.pageScrollTo.html) 滚动到指定位置，因此只支持页面级滚动，不支持在滚动元素中嵌套使用，包括 overflow: scroll、 scroll-view 等。

## API

### IndexesProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| current | String / Number | - | `1.9.7`。索引列表的激活项，默认首项 | N |
| default-current | String / Number | undefined | `1.9.7`。索引列表的激活项，默认首项。非受控属性 | N |
| index-list | Array | - | `0.32.0`。索引字符列表。不传默认`A-Z`。TS 类型：`Array<string \| number>` | N |
| list | Array | [] | 已废弃。索引列表的列表数据。每个元素包含三个子元素，index(string)：索引值，例如1，2，3，...或A，B，C等；title(string): 索引标题，可不填将默认设为索引值；children(Array<{title: string}>): 子元素列表，title为子元素的展示文案。TS 类型：`ListItem[] ``interface ListItem { title: string;  index: string;  children: { title: string; [key: string]: any} [] }`。详细类型定义 | N |
| sticky | Boolean | true | 索引是否吸顶，默认为true。TS 类型：`Boolean` | N |
| sticky-offset | Number | 0 | `1.0.0`。锚点吸顶时与顶部的距离 | N |

### IndexesEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| change | `(index: string \| number)` | `0.34.0`。索引发生变更时触发事件 |
| select | `(index: string \| number)` | 点击侧边栏时触发事件 |

### IndexesSlots

| 名称 | 描述 |
| --- | --- |
| - | 默认插槽，自定义内容区域内容 |

### IndexesAnchorProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| index | String / Number | - | 索引字符 | N |

### IndexesAnchorSlots

| 名称 | 描述 |
| --- | --- |
| - | 默认插槽，自定义内容区域内容 |

### IndexesAnchorExternalClasses

| 类名 | 描述 |
| --- | --- |
| t-class | 根节点样式类 |
| t-class-sidebar | 侧边栏样式类 |
| t-class-sidebar-item | 侧边栏选项样式类 |

### CSSVariables

组件提供了下列 CSS 变量，可用于自定义样式。

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| --td-indexes-sidebar-active-bg-color | @brand-color | - |
| --td-indexes-sidebar-active-color | @text-color-anti | - |
| --td-indexes-sidebar-color | @text-color-primary | - |
| --td-indexes-sidebar-font | @font-body-small | - |
| --td-indexes-sidebar-item-size | 40rpx | - |
| --td-indexes-sidebar-right | 16rpx | - |
| --td-indexes-sidebar-tips-bg-color | @brand-color-light | - |
| --td-indexes-sidebar-tips-color | @brand-color | - |
| --td-indexes-sidebar-tips-font | @font-title-extraLarge | - |
| --td-indexes-sidebar-tips-right | calc(100% + 32rpx) | - |
| --td-indexes-sidebar-tips-size | 96rpx | - |
| --td-indexes-anchor-active-bg-color | @bg-color-container | - |
| --td-indexes-anchor-active-color | @brand-color | - |
| --td-indexes-anchor-active-font-weight | 600 | - |
| --td-indexes-anchor-bg-color | @bg-color-secondarycontainer | - |
| --td-indexes-anchor-border-color | @component-border | - |
| --td-indexes-anchor-color | @text-color-primary | - |
| --td-indexes-anchor-font | @font-body-medium | - |
| --td-indexes-anchor-padding | 8rpx 32rpx | - |
| --td-indexes-anchor-top | 0 | - |