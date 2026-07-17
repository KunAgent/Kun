# Rate 评分

## 示例

## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
{
"usingComponents": {
"t-rate": "tdesign-miniprogram/rate/rate"
}
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/V8zRWMm68h5w)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 组件类型

实心评分

**WXML** (`html`):
```html
<view class="demo-rate">
<view class="demo-rate__title">实心评分</view>

<t-rate value="{{value}}" bind:change="onChange" />
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
value: 3,
},
methods: {
onChange(e) {
const { value } = e.detail;
this.setData({
value,
});
},
},
});

```

**CSS** (`css`):
```css
.demo-rate {
background-color: var(--bg-color-demo);
color: var(--td-text-color-primary);
height: 96rpx;
display: flex;
align-items: center;
justify-content: space-between;
padding: 0 32rpx;
margin-top: 32rpx;
margin-bottom: 32rpx;
}

.demo-rate__title {
width: 200rpx;
}

.demo-rate__transparent {
background-color: transparent;
padding-left: 32rpx;
border: 0;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-rate": "tdesign-miniprogram/rate/rate"
}
}

```

自定义评分

**WXML** (`html`):
```html
<view class="demo-rate">
<view class="demo-rate__title">自定义评分</view>
<t-rate value="{{value}}" icon="thumb-up" bind:change="onChange" />
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
value: 3,
},
methods: {
onChange(e) {
const { value } = e.detail;
this.setData({
value,
});
},
},
});

```

**CSS** (`css`):
```css
.demo-rate {
background-color: var(--bg-color-demo);
color: var(--td-text-color-primary);
height: 96rpx;
display: flex;
align-items: center;
justify-content: space-between;
padding: 0 32rpx;
margin-top: 32rpx;
margin-bottom: 32rpx;
}

.demo-rate__title {
width: 200rpx;
}

.demo-rate__transparent {
background-color: transparent;
padding-left: 32rpx;
border: 0;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-rate": "tdesign-miniprogram/rate/rate"
}
}

```

自定义评分数量

**WXML** (`html`):
```html
<view class="demo-rate">
<view class="demo-rate__title">自定义评分数量</view>
<!-- 自定义评分数量，设置属性：count-->
<t-rate value="{{value}}" count="{{3}}" bind:change="onChange" />
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
value: 2,
},

methods: {
onChange(e) {
const { value } = e.detail;
this.setData({
value,
});
},
},
});

```

**CSS** (`css`):
```css
.demo-rate {
background-color: var(--bg-color-demo);
color: var(--td-text-color-primary);
height: 96rpx;
display: flex;
align-items: center;
justify-content: space-between;
padding: 0 32rpx;
margin-top: 32rpx;
margin-bottom: 32rpx;
}

.demo-rate__transparent {
background-color: transparent;
padding-left: 32rpx;
border: 0;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-rate": "tdesign-miniprogram/rate/rate"
}
}

```

带描述评分

**WXML** (`html`):
```html
<view class="demo-rate">
<view class="demo-rate__title">带描述评分</view>
<!-- 自定义带描述评分，设置属性：texts -->
<t-rate value="{{value[0]}}" data-index="{{0}}" bind:change="onChange" showText="{{true}}" texts="{{texts}}" />
</view>
<view class="demo-rate">
<view class="demo-rate__title">带描述评分</view>
<!-- 带描述评分，设置属性：showText-->
<t-rate value="{{value[1]}}" data-index="{{1}}" bind:change="onChange" showText="{{true}}" />
</view>

<view class="demo-rate">
<view class="demo-rate__title">带描述评分</view>
<t-rate value="{{value[2]}}" data-index="{{2}}" bind:change="onChange" showText="{{true}}" />
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
value: [3, 3, 0],
texts: ['1分', '2分', '3分', '4分', '5分'],
},

methods: {
onChange(e) {
const { index } = e.currentTarget.dataset;
const { value } = e.detail;
this.setData({
[`value[${index}]`]: value,
});
},
},
});

```

**CSS** (`css`):
```css
.demo-rate {
background-color: var(--bg-color-demo);
color: var(--td-text-color-primary);
height: 96rpx;
display: flex;
align-items: center;
justify-content: space-between;
padding: 0 32rpx;
margin-top: 32rpx;
margin-bottom: 32rpx;
}

.demo-rate__title {
width: 200rpx;
}

.demo-rate__transparent {
background-color: transparent;
padding-left: 32rpx;
border: 0;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-rate": "tdesign-miniprogram/rate/rate"
}
}

```

### 组件状态

**WXML** (`html`):
```html
<view class="demo-desc">只可选全星时</view>

<view class="demo-rate">
<view class="demo-rate__title">点击或滑动</view>
<t-rate value="{{value}}" bind:change="onChange" />
</view>

<view class="demo-desc">只可选半星时</view>

<view class="demo-rate">
<view class="demo-rate__title">点击或滑动</view>
<t-rate default-value="{{3}}" allowHalf />
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
value: 3.5,
},
methods: {
onChange(e) {
const { value } = e.detail;
this.setData({
value,
});
},
},
});

```

**CSS** (`css`):
```css
.demo-rate {
background-color: var(--bg-color-demo);
color: var(--td-text-color-primary);
height: 96rpx;
display: flex;
align-items: center;
justify-content: space-between;
padding: 0 32rpx;
margin-top: 32rpx;
margin-bottom: 32rpx;
}

.demo-rate__transparent {
background-color: transparent;
padding-left: 32rpx;
border: 0;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"styleIsolation": "apply-shared",
"usingComponents": {
"t-rate": "tdesign-miniprogram/rate/rate"
}
}

```

### 组件样式

评分大小

**WXML** (`html`):
```html
<view class="demo-rate">
<view class="demo-rate__title">大尺寸 24</view>
<t-rate value="{{value[0]}}" data-index="{{0}}" bind:change="onChange" />
</view>
<view class="demo-rate">
<view class="demo-rate__title">小尺寸 20</view>
<t-rate value="{{value[1]}}" data-index="{{1}}" bind:change="onChange" size="{{20}}" />
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
value: [3, 3],
},
methods: {
onChange(e) {
const { index } = e.currentTarget.dataset;
const { value } = e.detail;
this.setData({
[`value[${index}]`]: value,
});
},
},
});

```

**CSS** (`css`):
```css
.demo-rate {
background-color: var(--bg-color-demo);
color: var(--td-text-color-primary);
height: 96rpx;
display: flex;
align-items: center;
justify-content: space-between;
padding: 0 32rpx;
margin-top: 32rpx;
margin-bottom: 32rpx;
}

.demo-rate__title {
width: 200rpx;
}

.demo-rate__transparent {
background-color: transparent;
padding-left: 32rpx;
border: 0;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-rate": "tdesign-miniprogram/rate/rate"
}
}

```

设置评分颜色

**WXML** (`html`):
```html
<view class="demo-rate custom-color">
<view class="demo-rate__title">填充评分</view>
<t-rate default-value="{{3}}" allowHalf />
</view>
<view class="demo-rate">
<view class="demo-rate__title">线描评分</view>
<t-rate default-value="{{3}}" icon="{{ ['star-filled', 'star'] }}" color="#00a870" />
</view>

```

**JS** (`javascript`):
```javascript
Component({});

```

**CSS** (`css`):
```css
.custom-color {
--td-rate-selected-color: #f96102;
--td-rate-unselected-color: #bbbbbb;
}

.demo-rate {
background-color: var(--bg-color-demo);
color: var(--td-text-color-primary);
height: 96rpx;
display: flex;
align-items: center;
justify-content: space-between;
padding: 0 32rpx;
margin-top: 32rpx;
margin-bottom: 32rpx;
}

.demo-rate__title {
width: 200rpx;
}

.demo-rate__transparent {
background-color: transparent;
padding-left: 32rpx;
border: 0;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-rate": "tdesign-miniprogram/rate/rate"
}
}

```

### 特殊样式

竖向带描述评分

**WXML** (`html`):
```html
<view class="demo-rate">
<view class="rate-wrapper">
<t-rate value="{{value}}" size="60rpx" bind:change="onChange" texts="{{texts}}" />
</view>
<view class="desc desc--{{value > 3 ? 'active' : ''}}">{{texts[value - 1]}}</view>
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
value: 4,
texts: ['非常糟糕', '有些糟糕', '可以尝试', '可以前往', '推荐前往'],
},
methods: {
onChange(e) {
const { value } = e.detail;
this.setData({
value,
});
},
},
});

```

**CSS** (`css`):
```css
.demo-rate {
background-color: var(--bg-color-demo);
color: var(--td-text-color-primary);
padding: 32rpx;
margin-top: 32rpx;
margin-bottom: 32rpx;
}

.rate-wrapper {
display: flex;
justify-content: center;
}

.desc {
text-align: center;
margin-top: 24rpx;
}

.desc--active {
color: #ed7b2f;
font-weight: 600;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-rate": "tdesign-miniprogram/rate/rate"
}
}

```

自定义图片前缀

{{iconPrefix}}

## API

### RateProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| allow-half | Boolean | false | 是否允许半选 | N |
| color | String / Array | '#ED7B2F' | `0.30.0`。评分图标的颜色，样式中默认为 #ED7B2F。一个值表示设置选中高亮的五角星颜色，示例：[选中颜色]。数组则表示分别设置 选中高亮的五角星颜色 和 未选中暗灰的五角星颜色，[选中颜色，未选中颜色]。示例：['#ED7B2F', '#E3E6EB']。TS 类型：`string \| Array<string>` | N |
| count | Number | 5 | 评分的数量 | N |
| disabled | Boolean | undefined | 是否禁用评分 | N |
| gap | String / Number | 8 | 评分图标的间距 | N |
| icon | String / Array | - | `0.30.0`。自定义评分图标，[选中图标，未选中图标]。TS 类型：`string \| string[]` | N |
| icon-prefix | String | undefined | 定义图标前缀 | N |
| placement | String | top | 选择评分弹框的位置，值为空字符表示不显示评分弹框。可选项：top / bottom / '' | N |
| show-text | Boolean | false | 是否显示对应的辅助文字 | N |
| size | String | 24px | 评分图标的大小 | N |
| texts | Array | [] | 评分等级对应的辅助文字。组件内置默认值为：['极差', '失望', '一般', '满意', '惊喜']。自定义值示例：['1分', '2分', '3分', '4分', '5分']。TS 类型：`Array<string>` | N |
| value | Number | 0 | 选择评分的值 | N |
| default-value | Number | undefined | 选择评分的值。非受控属性 | N |
| variant | String | outline | 已废弃。形状类型，有描边类型和填充类型两种。可选项：outline/filled | N |

### RateEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| change | `(value: number)` | 评分数改变时触发 |

### RateExternalClasses

| 类名 | 描述 |
| --- | --- |
| t-class | 根节点样式类 |
| t-class-icon | 图标样式类 |
| t-class-text | 文本样式类 |

### CSSVariables

组件提供了下列 CSS 变量，可用于自定义样式。

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| --td-rate-icon-scale | 1.33 | - |
| --td-rate-selected-color | @warning-color | - |
| --td-rate-text-active-color | @text-color-primary | - |
| --td-rate-text-active-font-weight | 600 | - |
| --td-rate-text-color | @text-color-disabled | - |
| --td-rate-text-font-size | @font-size-m | - |
| --td-rate-unselected-color | @component-border | - |