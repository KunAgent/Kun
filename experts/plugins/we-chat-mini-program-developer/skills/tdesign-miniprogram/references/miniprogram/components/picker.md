# Picker 选择器

## 示例

## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-picker": "tdesign-miniprogram/picker/picker",
"t-picker-item": "tdesign-miniprogram/picker-item/picker-item",
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/T7yFwMmi8O57)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 组件类型

#### 基础选择器

单项和多选选择

**WXML** (`html`):
```html
<t-cell class="mb-16" title="选择城市" arrow hover note="{{cityText}}" bind:click="onCityPicker" />

<t-cell class="mb-16" title="选择时间" arrow hover note="{{dateText}}" bind:click="onSeasonPicker" />

<t-picker
visible="{{cityVisible}}"
value="{{cityValue}}"
data-key="city"
title="选择城市"
cancelBtn="取消"
confirmBtn="确认"
usingCustomNavbar
bindchange="onPickerChange"
bindpick="onColumnChange"
bindcancel="onPickerCancel"
>
<t-picker-item options="{{citys}}" format="{{formatter}}">
<block wx:for="{{citys}}" wx:key="index" wx:for-item="option">
<view wx:if="{{option.tag}}" slot="label-suffix--{{index}}" class="label-suffix">
<t-tag size="small" theme="primary">{{option.tag}}</t-tag>
</view>
</block>
</t-picker-item>
</t-picker>

<t-picker
visible="{{dateVisible}}"
value="{{dateValue}}"
data-key="date"
title="选择时间"
cancelBtn="取消"
confirmBtn="确认"
usingCustomNavbar
bindchange="onPickerChange"
bindpick="onColumnChange"
bindcancel="onPickerCancel"
>
<t-picker-item options="{{years}}"></t-picker-item>
<t-picker-item options="{{seasons}}"></t-picker-item>
</t-picker>

```

**JS** (`javascript`):
```javascript
Component({
data: {
cityText: '',
cityValue: [],
dateText: '',
dateValue: [],
citys: [
{ label: '北京市', value: '北京市', icon: 'home', tag: '合' },
{ label: '上海市', value: '上海市', tag: '合' },
{ label: '广州市', value: '广州市' },
{ label: '深圳市', value: '深圳市' },
{ label: '成都市', value: '成都市' },
],
years: [
{ label: '2021年', value: '2021' },
{ label: '2020年', value: '2020' },
{ label: '2019年', value: '2019' },
],
seasons: [
{ label: '春', value: '春' },
{ label: '夏', value: '夏' },
{ label: '秋', value: '秋' },
{ label: '冬', value: '冬' },
],
formatter(item) {
const { value, label } = item;
if (value === '北京市') {
return {
...item,
value,
label: label.substring(0, 2),
};
}
return item;
},
},

methods: {
onColumnChange(e) {
console.log('picker pick:', e);
},

onPickerChange(e) {
const { key } = e.currentTarget.dataset;
const { value } = e.detail;

console.log('picker change:', e.detail);
this.setData({
[`${key}Visible`]: false,
[`${key}Value`]: value,
[`${key}Text`]: value.join(' '),
});
},

onPickerCancel(e) {
const { key } = e.currentTarget.dataset;
console.log(e, '取消');
console.log('picker1 cancel:');
this.setData({
[`${key}Visible`]: false,
});
},

onCityPicker() {
this.setData({ cityVisible: true });
},

onSeasonPicker() {
this.setData({ dateVisible: true });
},
},
});

```

**CSS** (`css`):
```css
.mb-16 {
margin-bottom: 32rpx;
}

.label-suffix {
--td-tag-small-height: 32rpx;

display: flex;
align-items: center;
justify-content: center;
margin-left: 12rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-cell-group": "tdesign-miniprogram/cell-group/cell-group",
"t-cell": "tdesign-miniprogram/cell/cell",
"t-picker": "tdesign-miniprogram/picker/picker",
"t-picker-item": "tdesign-miniprogram/picker-item/picker-item",
"t-tag": "tdesign-miniprogram/tag/tag"
}
}

```

#### 地区选择器

支持省市区切换，支持数据联动

**WXML** (`html`):
```html
<t-cell title="选择地区" arrow hover note="{{areaText}}" bind:click="onAreaPicker" />

<t-picker
visible="{{areaVisible}}"
value="{{areaValue}}"
title="选择地区"
cancelBtn="取消"
confirmBtn="确认"
usingCustomNavbar
bindchange="onPickerChange"
bindpick="onColumnChange"
bindcancel="onPickerCancel"
>
<t-picker-item options="{{provinces}}"></t-picker-item>
<t-picker-item options="{{cities}}"></t-picker-item>
<t-picker-item options="{{counties}}"></t-picker-item>
</t-picker>

```

**JS** (`javascript`):
```javascript
const areaList = {
provinces: {
110000: '北京市',
440000: '广东省',
},
cities: {
110100: '北京市',
440100: '广州市',
440200: '韶关市',
440300: '深圳市',
440400: '珠海市',
440500: '汕头市',
440600: '佛山市',
},
counties: {
110101: '东城区',
110102: '西城区',
110105: '朝阳区',
110106: '丰台区',
110107: '石景山区',
110108: '海淀区',
110109: '门头沟区',
110111: '房山区',
110112: '通州区',
110113: '顺义区',
110114: '昌平区',
110115: '大兴区',
110116: '怀柔区',
110117: '平谷区',
110118: '密云区',
110119: '延庆区',
440103: '荔湾区',
440104: '越秀区',
440105: '海珠区',
440106: '天河区',
440111: '白云区',
440112: '黄埔区',
440113: '番禺区',
440114: '花都区',
440115: '南沙区',
440117: '从化区',
440118: '增城区',
440203: '武江区',
440204: '浈江区',
440205: '曲江区',
440222: '始兴县',
440224: '仁化县',
440229: '翁源县',
440232: '乳源瑶族自治县',
440233: '新丰县',
440281: '乐昌市',
440282: '南雄市',
440303: '罗湖区',
440304: '福田区',
440305: '南山区',
440306: '宝安区',
440307: '龙岗区',
440308: '盐田区',
440309: '龙华区',
440310: '坪山区',
440311: '光明区',
440402: '香洲区',
440403: '斗门区',
440404: '金湾区',
440507: '龙湖区',
440511: '金平区',
440512: '濠江区',
440513: '潮阳区',
440514: '潮南区',
440515: '澄海区',
440523: '南澳县',
440604: '禅城区',
440605: '南海区',
440606: '顺德区',
440607: '三水区',
440608: '高明区',
},
};

// 使用这份数据可以模拟大量数据场景
// // 生成广东省1000个城市
// const generateCities = () => {
//   const cities = {
//     110100: '北京市',
//   };
//
//   // 生成广东省1000个城市
//   for (let i = 1; i <= 1000; i++) {
//     const cityCode = 440000 + i * 100;
//     cities[cityCode] = `广东城市${i}`;
//   }
//
//   return cities;
// };
//
// // 生成广州市10000个地区
// const generateCounties = () => {
//   const counties = {
//     110101: '东城区',
//     110102: '西城区',
//     110105: '朝阳区',
//     110106: '丰台区',
//     110107: '石景山区',
//     110108: '海淀区',
//     110109: '门头沟区',
//     110111: '房山区',
//     110112: '通州区',
//     110113: '顺义区',
//     110114: '昌平区',
//     110115: '大兴区',
//     110116: '怀柔区',
//     110117: '平谷区',
//     110118: '密云区',
//     110119: '延庆区',
//   };
//
//   // 生成广州市(440100)10000个地区
//   for (let i = 1; i <= 10000; i++) {
//     const countyCode = 44010000 + i;
//     counties[countyCode] = `广州地区${i}`;
//   }
//
//   return counties;
// };
//
// const areaList = {
//   provinces: {
//     110000: '北京市',
//     440000: '广东省',
//   },
//   cities: generateCities(),
//   counties: generateCounties(),
// };

const getOptions = (obj, filter) => {
const res = Object.keys(obj).map((key) => ({ value: key, label: obj[key] }));

if (filter) {
return res.filter(filter);
}

return res;
};

const match = (v1, v2, size) => v1.toString().slice(0, size) === v2.toString().slice(0, size);

Component({
data: {
areaText: '',
areaValue: [],
provinces: getOptions(areaList.provinces),
cities: [],
counties: [],
},

lifetimes: {
ready() {
this.init();
},
},

methods: {
init() {
const { provinces } = this.data;
const { cities, counties } = this.getCities(provinces[0].value);

this.setData({ cities, counties });
},

onColumnChange(e) {
console.log('pick:', e.detail);
const { column, index } = e.detail;
const { provinces, cities } = this.data;

if (column === 0) {
// 更改省份
const { cities, counties } = this.getCities(provinces[index].value);

this.setData({ cities, counties });
}

if (column === 1) {
// 更改城市
const counties = this.getCounties(cities[index].value);

this.setData({ counties });
}

if (column === 2) {
// 更改区县
}
},

getCities(provinceValue) {
const cities = getOptions(areaList.cities, (city) => match(city.value, provinceValue, 2));
const counties = this.getCounties(cities[0].value);

return { cities, counties };
},

getCounties(cityValue) {
return getOptions(areaList.counties, (county) => match(county.value, cityValue, 4));
},

onPickerChange(e) {
const { value, label } = e.detail;

console.log('picker confirm:', e.detail);
this.setData({
areaVisible: false,
areaValue: value,
areaText: label.join(' '),
});
},

onPickerCancel(e) {
console.log('picker cancel', e.detail);
this.setData({
areaVisible: false,
});

if (this.data.areaValue.length) return;
this.init();
},

onAreaPicker() {
this.setData({ areaVisible: true });
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
"t-cell-group": "tdesign-miniprogram/cell-group/cell-group",
"t-cell": "tdesign-miniprogram/cell/cell",
"t-picker": "tdesign-miniprogram/picker/picker",
"t-picker-item": "tdesign-miniprogram/picker-item/picker-item"
}
}

```

### 组件样式

是否带标题

**WXML** (`html`):
```html
<t-cell class="mb-16" title="带标题选择器" arrow hover note="{{cityText}}" bind:click="onTitlePicker" />

<t-cell title="无标题选择器" arrow hover note="{{city2Text}}" bind:click="onWithoutTitlePicker" />

<t-picker
visible="{{cityVisible}}"
value="{{cityValue}}"
data-key="city"
title="{{cityTitle}}"
cancelBtn="取消"
confirmBtn="确认"
usingCustomNavbar
bindchange="onPickerChange"
bindpick="onColumnChange"
bindcancel="onPickerCancel"
>
<t-picker-item options="{{citys}}"></t-picker-item>
</t-picker>

<t-picker
visible="{{city2Visible}}"
value="{{city2Value}}"
data-key="city2"
title="{{city2Title}}"
cancelBtn="取消"
confirmBtn="确认"
usingCustomNavbar
bindchange="onPickerChange"
bindpick="onColumnChange"
bindcancel="onPickerCancel"
>
<t-picker-item options="{{citys}}"></t-picker-item>
</t-picker>

```

**JS** (`javascript`):
```javascript
Component({
data: {
cityText: '',
city2Text: '',
cityValue: [],
city2Value: [],
cityTitle: '',
city2Title: '',
citys: [
{ label: '北京市', value: '北京市' },
{ label: '上海市', value: '上海市' },
{ label: '广州市', value: '广州市' },
{ label: '深圳市', value: '深圳市' },
{ label: '成都市', value: '成都市' },
],
},

methods: {
onColumnChange(e) {
console.log('picker pick:', e);
},

onPickerChange(e) {
const { key } = e.currentTarget.dataset;
const { value } = e.detail;

console.log('picker change:', e.detail);
this.setData({
[`${key}Visible`]: false,
[`${key}Value`]: value,
[`${key}Text`]: value.join(' '),
});
},

onPickerCancel(e) {
const { key } = e.currentTarget.dataset;
console.log(e, '取消');
console.log('picker1 cancel:');
this.setData({
[`${key}Visible`]: false,
});
},

onTitlePicker() {
this.setData({ cityVisible: true, cityTitle: '选择城市' });
},

onWithoutTitlePicker() {
this.setData({ city2Visible: true, city2Title: '' });
},
},
});

```

**CSS** (`css`):
```css
.mb-16 {
margin-bottom: 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-cell-group": "tdesign-miniprogram/cell-group/cell-group",
"t-cell": "tdesign-miniprogram/cell/cell",
"t-picker": "tdesign-miniprogram/picker/picker",
"t-picker-item": "tdesign-miniprogram/picker-item/picker-item"
}
}

```

## API

### PickerProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| auto-close | Boolean | true | 自动关闭；在确认、取消、点击遮罩层自动关闭，不需要手动设置 visible | N |
| cancel-btn | String / Boolean | true | 取消按钮文字。TS 类型：`boolean \| string` | N |
| confirm-btn | String / Boolean | true | 确定按钮文字。TS 类型：`boolean \| string` | N |
| header | Boolean | true | 头部内容。值为 true 显示空白头部，值为 false 不显示任何内容 | N |
| item-height | Number | 40 | PickerItem 的子项高度，单位`px` | N |
| keys | Object | - | 用来定义 value / label / icon 在`options`中对应的字段别名。TS 类型：`KeysType`。通用类型定义 | N |
| popup-props | Object | {} | 透传 Popup 组件全部属性。TS 类型：`PopupProps`，Popup API Documents。详细类型定义 | N |
| title | String | '' | 标题 | N |
| use-popup | Boolean | true | 是否使用弹出层包裹 | N |
| using-custom-navbar | Boolean | false | 是否使用了自定义导航栏 | N |
| value | Array | - | 选中值。TS 类型：`Array<PickerValue>``type PickerValue = string \| number`。详细类型定义 | N |
| default-value | Array | undefined | 选中值。非受控属性。TS 类型：`Array<PickerValue>``type PickerValue = string \| number`。详细类型定义 | N |
| visible | Boolean | false | 是否显示 | N |
| visible-item-count | Number | 5 | 可视区域 PickerItem 的子项个数 | N |

### PickerEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| cancel | - | 点击取消按钮时触发 |
| change | `(value: Array<PickerValue>, label: string, columns: Array<{ column: number; index: number; disabled?: boolean; }> )` | 选中变化时候触发，即确认变化时触发 |
| close | `(trigger: TriggerSource)` | `1.0.1`。关闭时触发。详细类型定义。<br>`type TriggerSource = 'overlay' \| 'cancel-btn' \| 'confirm-btn'`<br> |
| confirm | `(value: Array<PickerValue>, label: string, columns: Array<{ column: number; index: number; disabled?: boolean; }> )` | 点击确认按钮时触发 |
| pick | `(value: Array<PickerValue>, label: string, column: number, index: number)` | 任何一列选中都会触发，不同的列参数不同。`column`表示第几列变化，`index`表示变化那一列的选中项下标 |

### PickerSlots

| 名称 | 描述 |
| --- | --- |
| - | 默认插槽，自定义内容 |
| content | 中间内容，介于头部跟内容之间 |
| footer | 底部内容 |
| header | 自定义`header`显示内容 |

### PickerItemProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| format | Function | - | 格式化标签。TS 类型：`(option: PickerItemOption, columnIndex: number) => PickerItemOption` | N |
| options | Array | [] | 数据源。TS 类型：`PickerItemOption[]``interface PickerItemOption { label: string; value: string \| number; icon?: string }`。详细类型定义 | N |

### PickerItemSlots

| 名称 | 描述 |
| --- | --- |
| label-suffix-index | 列表子项后置插槽，用于自定义标签文本之后的内容。 |

### CSSVariables

组件提供了下列 CSS 变量，可用于自定义样式。

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| --td-picker-bg-color | @bg-color-container | - |
| --td-picker-border-radius | 24rpx | - |
| --td-picker-button-font | @font-body-large | - |
| --td-picker-cancel-color | @text-color-secondary | - |
| --td-picker-confirm-color | @brand-color | - |
| --td-picker-indicator-bg-color | @bg-color-secondarycontainer | - |
| --td-picker-indicator-border-radius | 12rpx | - |
| --td-picker-title-color | @text-color-primary | - |
| --td-picker-title-font | @font-title-large | - |
| --td-picker-toolbar-height | 116rpx | - |
| --td-picker-transparent-color | --td-picker-transparent-color | - |
| --td-picker-item-active-color | @text-color-primary | - |
| --td-picker-item-color | @text-color-secondary | - |
| --td-picker-item-font-size | @font-size-m | - |