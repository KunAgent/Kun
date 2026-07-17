# Cascader 级联选择器

## 示例

该组件于 0.23.0 版本上线，请留意版本。
## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-cascader": "tdesign-miniprogram/cascader/cascader"
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/WOWeTNmJ8X5B)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 基础用法

**WXML** (`html`):
```html
<t-cell title="地址" note="{{note}}" bind:click="showCascader" arrow />

<t-cascader
visible="{{visible}}"
value="{{value}}"
options="{{options}}"
title="请选择地址"
bind:change="onChange"
bind:pick="onPick"
/>

```

**JS** (`javascript`):
```javascript
const data = {
areaList: [
{
label: '北京市',
value: '110000',
children: [
{
value: '110100',
label: '北京市',
children: [
{ value: '110101', label: '东城区' },
{ value: '110102', label: '西城区' },
{ value: '110105', label: '朝阳区' },
{ value: '110106', label: '丰台区' },
{ value: '110107', label: '石景山区' },
{ value: '110108', label: '海淀区' },
{ value: '110109', label: '门头沟区' },
{ value: '110111', label: '房山区' },
{ value: '110112', label: '通州区' },
{ value: '110113', label: '顺义区' },
{ value: '110114', label: '昌平区' },
{ value: '110115', label: '大兴区' },
{ value: '110116', label: '怀柔区' },
{ value: '110117', label: '平谷区' },
{ value: '110118', label: '密云区' },
{ value: '110119', label: '延庆区' },
],
},
],
},
{
label: '天津市',
value: '120000',
children: [
{
value: '120100',
label: '天津市',
children: [
{ value: '120101', label: '和平区' },
{ value: '120102', label: '河东区' },
{ value: '120103', label: '河西区' },
{ value: '120104', label: '南开区' },
{ value: '120105', label: '河北区' },
{ value: '120106', label: '红桥区' },
{ value: '120110', label: '东丽区' },
{ value: '120111', label: '西青区' },
{ value: '120112', label: '津南区' },
{ value: '120113', label: '北辰区' },
{ value: '120114', label: '武清区' },
{ value: '120115', label: '宝坻区' },
{ value: '120116', label: '滨海新区' },
{ value: '120117', label: '宁河区' },
{ value: '120118', label: '静海区' },
{ value: '120119', label: '蓟州区' },
],
},
],
},
],
};

Component({
data: {
options: data.areaList,
note: '请选择地址',
visible: false,
value: '',
},
methods: {
showCascader() {
this.setData({ visible: true });
},
onPick(e) {
console.log(e.detail);
},
onChange(e) {
const { selectedOptions, value } = e.detail;

this.setData({
value,
note: selectedOptions.map((item) => item.label).join('/'),
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
"t-cell": "tdesign-miniprogram/cell/cell",
"t-cascader": "tdesign-miniprogram/cascader/cascader"
}
}

```

### 选项卡风格

**WXML** (`html`):
```html
<t-cell title="地址" note="{{note}}" bind:click="showCascader" arrow></t-cell>

<t-cascader
visible="{{visible}}"
theme="tab"
options="{{options}}"
title="请选择地址"
bind:change="onChange"
></t-cascader>

```

**JS** (`javascript`):
```javascript
const data = {
areaList: [
{
label: '北京市',
value: '110000',
children: [
{
value: '110100',
label: '北京市',
children: [
{ value: '110101', label: '东城区' },
{ value: '110102', label: '西城区' },
{ value: '110105', label: '朝阳区' },
{ value: '110106', label: '丰台区' },
{ value: '110107', label: '石景山区' },
{ value: '110108', label: '海淀区' },
{ value: '110109', label: '门头沟区' },
{ value: '110111', label: '房山区' },
{ value: '110112', label: '通州区' },
{ value: '110113', label: '顺义区' },
{ value: '110114', label: '昌平区' },
{ value: '110115', label: '大兴区' },
{ value: '110116', label: '怀柔区' },
{ value: '110117', label: '平谷区' },
{ value: '110118', label: '密云区' },
{ value: '110119', label: '延庆区' },
],
},
],
},
{
label: '天津市',
value: '120000',
children: [
{
value: '120100',
label: '天津市',
children: [
{ value: '120101', label: '和平区' },
{ value: '120102', label: '河东区' },
{ value: '120103', label: '河西区' },
{ value: '120104', label: '南开区' },
{ value: '120105', label: '河北区' },
{ value: '120106', label: '红桥区' },
{ value: '120110', label: '东丽区' },
{ value: '120111', label: '西青区' },
{ value: '120112', label: '津南区' },
{ value: '120113', label: '北辰区' },
{ value: '120114', label: '武清区' },
{ value: '120115', label: '宝坻区' },
{ value: '120116', label: '滨海新区' },
{ value: '120117', label: '宁河区' },
{ value: '120118', label: '静海区' },
{ value: '120119', label: '蓟州区' },
],
},
],
},
],
};

Component({
data: {
options: data.areaList,
note: '请选择地址',
visible: false,
},
methods: {
showCascader() {
this.setData({ visible: true });
},
onChange(e) {
const { selectedOptions } = e.detail;

this.setData({
note: selectedOptions.map((item) => item.label).join('/'),
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
"t-cell": "tdesign-miniprogram/cell/cell",
"t-cascader": "tdesign-miniprogram/cascader/cascader"
}
}

```

### 进阶

#### 带初始值

**WXML** (`html`):
```html
<t-cell title="地址" note="{{note}}" bind:click="showCascader" arrow></t-cell>

<t-cascader
visible="{{visible}}"
value="120119"
options="{{options}}"
title="请选择地址"
bind:change="onChange"
></t-cascader>

```

**JS** (`javascript`):
```javascript
const data = {
areaList: [
{
label: '北京市',
value: '110000',
children: [
{
value: '110100',
label: '北京市',
children: [
{ value: '110101', label: '东城区' },
{ value: '110102', label: '西城区' },
{ value: '110105', label: '朝阳区' },
{ value: '110106', label: '丰台区' },
{ value: '110107', label: '石景山区' },
{ value: '110108', label: '海淀区' },
{ value: '110109', label: '门头沟区' },
{ value: '110111', label: '房山区' },
{ value: '110112', label: '通州区' },
{ value: '110113', label: '顺义区' },
{ value: '110114', label: '昌平区' },
{ value: '110115', label: '大兴区' },
{ value: '110116', label: '怀柔区' },
{ value: '110117', label: '平谷区' },
{ value: '110118', label: '密云区' },
{ value: '110119', label: '延庆区' },
],
},
],
},
{
label: '天津市',
value: '120000',
children: [
{
value: '120100',
label: '天津市',
children: [
{ value: '120101', label: '和平区' },
{ value: '120102', label: '河东区' },
{ value: '120103', label: '河西区' },
{ value: '120104', label: '南开区' },
{ value: '120105', label: '河北区' },
{ value: '120106', label: '红桥区' },
{ value: '120110', label: '东丽区' },
{ value: '120111', label: '西青区' },
{ value: '120112', label: '津南区' },
{ value: '120113', label: '北辰区' },
{ value: '120114', label: '武清区' },
{ value: '120115', label: '宝坻区' },
{ value: '120116', label: '滨海新区' },
{ value: '120117', label: '宁河区' },
{ value: '120118', label: '静海区' },
{ value: '120119', label: '蓟州区' },
],
},
],
},
],
};

Component({
data: {
options: data.areaList,
note: '请选择地址',
visible: false,
},
methods: {
showCascader() {
this.setData({ visible: true });
},
onChange(e) {
const { selectedOptions } = e.detail;

this.setData({
note: selectedOptions.map((item) => item.label).join('/'),
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
"t-cell": "tdesign-miniprogram/cell/cell",
"t-cascader": "tdesign-miniprogram/cascader/cascader"
}
}

```

#### 自定义keys

**WXML** (`html`):
```html
<t-cell title="地址" note="{{note}}" bind:click="showCascader" arrow></t-cell>

<t-cascader
class="demo"
visible="{{visible}}"
keys="{{keys}}"
options="{{options}}"
title="请选择地址"
placeholder="未选中时的提示文案"
bind:change="onChange"
></t-cascader>

```

**JS** (`javascript`):
```javascript
const data = {
areaList: [
{
name: '北京市',
id: '110000',
sub: [
{
id: '110100',
name: '北京市',
sub: [
{ id: '110101', name: '东城区' },
{ id: '110102', name: '西城区' },
{ id: '110105', name: '朝阳区' },
{ id: '110106', name: '丰台区' },
{ id: '110107', name: '石景山区' },
{ id: '110108', name: '海淀区' },
{ id: '110109', name: '门头沟区' },
{ id: '110111', name: '房山区' },
{ id: '110112', name: '通州区' },
{ id: '110113', name: '顺义区' },
{ id: '110114', name: '昌平区' },
{ id: '110115', name: '大兴区' },
{ id: '110116', name: '怀柔区' },
{ id: '110117', name: '平谷区' },
{ id: '110118', name: '密云区' },
{ id: '110119', name: '延庆区' },
],
},
],
},
{
name: '天津市',
id: '120000',
sub: [
{
id: '120100',
name: '天津市',
sub: [
{ id: '120101', name: '和平区' },
{ id: '120102', name: '河东区' },
{ id: '120103', name: '河西区' },
{ id: '120104', name: '南开区' },
{ id: '120105', name: '河北区' },
{ id: '120106', name: '红桥区' },
{ id: '120110', name: '东丽区' },
{ id: '120111', name: '西青区' },
{ id: '120112', name: '津南区' },
{ id: '120113', name: '北辰区' },
{ id: '120114', name: '武清区' },
{ id: '120115', name: '宝坻区' },
{ id: '120116', name: '滨海新区' },
{ id: '120117', name: '宁河区' },
{ id: '120118', name: '静海区' },
{ id: '120119', name: '蓟州区' },
],
},
],
},
],
};

Component({
data: {
options: data.areaList,
note: '请选择地址',
visible: false,
keys: {
label: 'name',
value: 'id',
children: 'sub',
},
},
methods: {
showCascader() {
this.setData({ visible: true });
},
onChange(e) {
const { selectedOptions } = e.detail;

this.setData({
note: selectedOptions.map((item) => item.name).join('/'),
});
},
},
});

```

**CSS** (`css`):
```css
page .demo {
--td-cascader-active-color: green;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-cell": "tdesign-miniprogram/cell/cell",
"t-cascader": "tdesign-miniprogram/cascader/cascader"
}
}

```

#### 使用次级标题

**WXML** (`html`):
```html
<t-cell title="地址" note="{{note}}" bind:click="showCascader" arrow></t-cell>

<t-cascader
visible="{{visible}}"
options="{{options}}"
title="请选择地址"
sub-titles="{{subTitles}}"
bind:change="onChange"
></t-cascader>

```

**JS** (`javascript`):
```javascript
const data = {
areaList: [
{
label: '北京市',
value: '110000',
children: [
{
value: '110100',
label: '北京市',
children: [
{ value: '110101', label: '东城区' },
{ value: '110102', label: '西城区' },
{ value: '110105', label: '朝阳区' },
{ value: '110106', label: '丰台区' },
{ value: '110107', label: '石景山区' },
{ value: '110108', label: '海淀区' },
{ value: '110109', label: '门头沟区' },
{ value: '110111', label: '房山区' },
{ value: '110112', label: '通州区' },
{ value: '110113', label: '顺义区' },
{ value: '110114', label: '昌平区' },
{ value: '110115', label: '大兴区' },
{ value: '110116', label: '怀柔区' },
{ value: '110117', label: '平谷区' },
{ value: '110118', label: '密云区' },
{ value: '110119', label: '延庆区' },
],
},
],
},
{
label: '天津市',
value: '120000',
children: [
{
value: '120100',
label: '天津市',
children: [
{ value: '120101', label: '和平区' },
{ value: '120102', label: '河东区' },
{ value: '120103', label: '河西区' },
{ value: '120104', label: '南开区' },
{ value: '120105', label: '河北区' },
{ value: '120106', label: '红桥区' },
{ value: '120110', label: '东丽区' },
{ value: '120111', label: '西青区' },
{ value: '120112', label: '津南区' },
{ value: '120113', label: '北辰区' },
{ value: '120114', label: '武清区' },
{ value: '120115', label: '宝坻区' },
{ value: '120116', label: '滨海新区' },
{ value: '120117', label: '宁河区' },
{ value: '120118', label: '静海区' },
{ value: '120119', label: '蓟州区' },
],
},
],
},
],
};

Component({
data: {
options: data.areaList,
note: '请选择地址',
visible: false,
subTitles: ['请选择省份', '请选择城市', '请选择区/县'],
},
methods: {
showCascader() {
this.setData({ visible: true });
},
onChange(e) {
const { selectedOptions } = e.detail;

this.setData({
note: selectedOptions.map((item) => item.label).join('/'),
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
"t-cell": "tdesign-miniprogram/cell/cell",
"t-cascader": "tdesign-miniprogram/cascader/cascader"
}
}

```

#### 选择任意一项

**WXML** (`html`):
```html
<t-cell title="地址" note="{{note}}" bind:click="showCascader" arrow />

<t-cascader
close-btn="{{false}}"
check-strictly="{{true}}"
visible="{{visible}}"
value="{{value}}"
options="{{options}}"
title="请选择地址"
bind:change="onChange"
bind:pick="onPick"
>
<text class="confirm-btn" slot="close-btn">确定</text>
</t-cascader>

```

**JS** (`javascript`):
```javascript
const data = {
areaList: [
{
label: '北京市',
value: '110000',
children: [
{
value: '110100',
label: '北京市',
children: [
{ value: '110101', label: '东城区' },
{ value: '110102', label: '西城区' },
{ value: '110105', label: '朝阳区' },
{ value: '110106', label: '丰台区' },
{ value: '110107', label: '石景山区' },
{ value: '110108', label: '海淀区' },
{ value: '110109', label: '门头沟区' },
{ value: '110111', label: '房山区' },
{ value: '110112', label: '通州区' },
{ value: '110113', label: '顺义区' },
{ value: '110114', label: '昌平区' },
{ value: '110115', label: '大兴区' },
{ value: '110116', label: '怀柔区' },
{ value: '110117', label: '平谷区' },
{ value: '110118', label: '密云区' },
{ value: '110119', label: '延庆区' },
],
},
],
},
{
label: '天津市',
value: '120000',
children: [
{
value: '120100',
label: '天津市',
children: [
{ value: '120101', label: '和平区' },
{ value: '120102', label: '河东区' },
{ value: '120103', label: '河西区' },
{ value: '120104', label: '南开区' },
{ value: '120105', label: '河北区' },
{ value: '120106', label: '红桥区' },
{ value: '120110', label: '东丽区' },
{ value: '120111', label: '西青区' },
{ value: '120112', label: '津南区' },
{ value: '120113', label: '北辰区' },
{ value: '120114', label: '武清区' },
{ value: '120115', label: '宝坻区' },
{ value: '120116', label: '滨海新区' },
{ value: '120117', label: '宁河区' },
{ value: '120118', label: '静海区' },
{ value: '120119', label: '蓟州区' },
],
},
],
},
],
};

Component({
data: {
options: data.areaList,
note: '请选择地址',
visible: false,
value: '',
},
methods: {
showCascader() {
this.setData({ visible: true });
},
onPick(e) {
console.log(e.detail);
},
onChange(e) {
const { selectedOptions, value } = e.detail;
console.log(value);
this.setData({
value,
note: selectedOptions.map((item) => item.label).join('/'),
});
},
},
});

```

**CSS** (`css`):
```css
.confirm-btn {
color: #0052d9;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-cell": "tdesign-miniprogram/cell/cell",
"t-cascader": "tdesign-miniprogram/cascader/cascader"
}
}

```

## API

### CascaderProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| check-strictly | Boolean | false | 父子节点选中状态不再关联，可各自选中或取消 | N |
| close-btn | Boolean | true | 关闭按钮 | N |
| keys | Object | - | 用来定义 value / label / children / disabled 在`options`中对应的字段别名。TS 类型：`CascaderKeysType``type CascaderKeysType = TreeKeysType`。通用类型定义。详细类型定义 | N |
| options | Array | [] | 可选项数据源。TS 类型：`Array<CascaderOption>` | N |
| placeholder | String | 选择选项 | 未选中时的提示文案 | N |
| sub-titles | Array | [] | 每级展示的次标题。TS 类型：`Array<string>` | N |
| theme | String | step | 展示风格。可选项：step/tab | N |
| title | String | - | 标题 | N |
| value | String / Number | null | 选项值 | N |
| default-value | String / Number | undefined | 选项值。非受控属性 | N |
| visible | Boolean | false | 是否展示 | N |

### CascaderEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| change | `(value: string \| number, selectedOptions: string[])` | `1.0.1`。值发生变更时触发 |
| close | `(trigger: CascaderTriggerSource)` | `1.0.1`。关闭时触发。详细类型定义。<br>`type CascaderTriggerSource = 'overlay' \| 'close-btn' \| 'finish'`<br> |
| pick | `(value: string \| number, label: string, index: number, level: number)` | `1.0.1`。选择后触发 |

### CascaderSlots

| 名称 | 描述 |
| --- | --- |
| close-btn | 自定义`close-btn`显示内容 |
| header | `1.9.1`。头部 |
| middle-content | 中间内容 |
| title | 自定义`title`显示内容 |

### CSSVariables

组件提供了下列 CSS 变量，可用于自定义样式。

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| --td-cascader-active-color | @brand-color | - |
| --td-cascader-bg-color | @bg-color-container | - |
| --td-cascader-border-color | @component-stroke | - |
| --td-cascader-content-height | 78vh | - |
| --td-cascader-disabled-color | @text-color-disabled | - |
| --td-cascader-options-height | calc(100% - @cascader-step-height) | - |
| --td-cascader-options-title-color | @text-color-placeholder | - |
| --td-cascader-step-arrow-color | @text-color-placeholder | - |
| --td-cascader-step-dot-size | 16rpx | - |
| --td-cascader-step-height | 88rpx | - |
| --td-cascader-title-color | @text-color-primary | - |
| --td-cascader-title-font | @font-title-large | - |
| --td-cascader-title-padding | @spacer-2 | - |