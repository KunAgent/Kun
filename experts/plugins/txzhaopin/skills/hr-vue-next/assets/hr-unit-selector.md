# HrUnitSelector 组织选择器

## 组件说明

用于选择组织，涉及的数据源均为远程数据。提供2种方式选择组织，用 Tag 展示已选组织：
1. 输入关键字搜索，使用下拉菜单展示筛选后的组织
2. 点击右侧按钮打开弹窗，懒加载组织树

> 提醒: 请避免在选择后动态改变选择器的宽度，这会造成 Tag 区域样式显示问题

## 基础用法

适用广泛的基础选择，提供2种方式选择组织，用 Tag 展示已选组织。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
    <span class="demonstration">单选模式</span>
    <hr-unit-selector v-model="value1" selectClass="selectClass" modalClass="modalClass" showFullTag />
  </div>
  <div class="block">
    <span class="demonstration">多选模式</span>
    <hr-unit-selector multiple v-model="value2" @change="change"/>
  </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
const value1 = ref('');
const value2 = ref([]);
const change = (val) =>  {
  console.log(val)
}
</script>

<style lang="less" scoped>

</style>
```

## 设置初始选中项

由于选择器所需的组织选项至少需要包含 `unitId`、`unitName`、`unitFullName` 等属性，而本地没有完整的组织数据，因此不能简单通过修改 `v-model` 值来设置初始选择项。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <hr-unit-selector ref="selector1" v-model="value1" multiple />
    </div>
    <div class="block">
      <hr-unit-selector ref="selector2" v-model="value2" :props="myProps" multiple />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
const value1 = ref([]);
const value2 = ref([]);
const selector1 = ref(null);
const selector2 = ref(null);
const myProps = ref({
  unitName: 'name',
  unitId: 'id',
  unitFullName: 'fullName',
});
const change = (val) => {
  console.log(val, value1.value);
};
onMounted(() => {
  const initial1 = [{ unitName: '企业综合部', unitId: 24704, unitFullName: 'TEG技术工程事业群/企业综合部' }];
  selector1.value.setSelected(initial1);
  const initial2 = [{ name: '企业综合部', id: 24704, fullName: 'TEG技术工程事业群/企业综合部' }];
  selector2.value.setSelected(initial2);
});
</script>

<style lang="scss" scoped></style>
```

## 设置根组织

通过设置 `unitId` 属性可指定根组织。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <hr-unit-selector multiple :unitId="unitId" :defaultExpandedKeys="[4791]" v-model="value" />
    </div>
    <div class="block">
      <hr-unit-selector multiple :unitId="[0]" :defaultExpandedKeys="[0]" v-model="value2" />
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
const unitId = ref([4791]);
const value = ref([]);
const value2 = ref([]);
</script>

<style lang="less" scoped></style>
```

## 限制组织选择范围

可通过设置 `includeUnitSortIds` 数组属性来限制组织选择范围。
可通过设置 `isLimitUnitExpand` 属性来设置是否限制展开范围中最小级别的组织，默认 `true`。

> 注意：受目前接口限制，模糊搜索时需要输入比较完整的名称，故暂不建议使用

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <span class="demonstration">限制展开范围</span>
      <hr-unit-selector multiple :includeUnitSortIds="includeUnitSortIds" v-model="value" />
    </div>
    <div class="block">
      <span class="demonstration">不限制展开范围</span>
      <hr-unit-selector multiple :includeUnitSortIds="includeUnitSortIds" :isLimitUnitExpand="false" v-model="value2" />
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
const value = ref([]);
const includeUnitSortIds = ref([6, 1]);
const value2 = ref([]);
</script>

<style lang="less" scoped></style>
```

## 禁用组织操作

可通过设置 `disabledUnitIdList` 数组属性来设置禁用组织操作。

```vue
<template>
    <div class="example_flex_box">
      <div class="block">
      <span class="demonstration">单选禁用操作</span>
      <hr-unit-selector v-model="value" :disabledUnitIdList="disabledUnitIdList" ref="selector1" />
    </div>
    <div class="block">
      <span class="demonstration">多选禁用操作</span>
      <hr-unit-selector multiple v-model="value2" :disabledUnitIdList="disabledUnitIdList" ref="selector2"/>
    </div>
    </div>
  </template>
  
  <script setup>
  import { ref, onMounted } from 'vue';
  const value = ref('');
  const value2 = ref([]);
  const disabledUnitIdList = ref([953, 1, 1263]);
  const selector1 = ref(null)
  const selector2 = ref(null)
  onMounted(() => {
    const initial = [{ unitName: '总办', unitId: 1, unitFullName: '总办' }];
    selector1.value.setSelected(initial)
    selector2.value.setSelected(initial)
  })
  </script>
  
  <style lang="less" scoped>
  
  </style>
```

## 文本域

用于多行展示被选择的组织，通过设置 `textarea` 属性启用, 也可通过设置 `textareaModel` 属性启用。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <hr-unit-selector v-model="value" :height="170" textarea multiple placeholder="请选择" />
    </div>
    <div class="block">
      <hr-unit-selector v-model="value2" :height="170" textareaModel multiple placeholder="请选择" />
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
const value = ref();
const value2 = ref([]);
</script>

<style lang="less" scoped></style>
```

## 尺寸

```vue
<template>
  <div class="example_flex_box">
    <div class="block size-block">
      <span class="demonstration">默认尺寸</span>
      <hr-unit-selector v-model="value1" />
    </div>
    <div class="block size-block">
      <span class="demonstration">中等尺寸</span>
      <hr-unit-selector size="medium" v-model="value2" />
    </div>
    <div class="block size-block">
      <span class="demonstration">较小尺寸</span>
      <hr-unit-selector size="small" v-model="value3" />
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
const value1 = ref('');
const value2 = ref('');
const value3 = ref('');
</script>

<style lang="less" scoped></style>
```

## 弹窗插入到body中

```vue
<template>
  <div class="example_init_box">
    <hr-unit-selector v-model="value" modalAppendToBody />
  </div>
</template>

<script setup>
import { ref } from 'vue';
const value = ref('');
</script>

<style lang="less" scoped></style>
```

## 数据源

自定义数据源，通过 `getDataList` 和 `getTreeData` 方法自定义获取数据的逻辑。

```vue
<template>
  <div class="example_init_box">
    <hr-unit-selector
      v-model="value"
      multiple
      modalWidth="1000px"
      :getDataList="customGetDataList"
      :getTreeData="customGetTreeData"
    />
  </div>
</template>

<script setup>
import { ref } from 'vue';
const value = ref([]);

/**
 * @method 模糊搜索对应的组织列表
 * @param {String} name 关键字字符串
 * @returns 返回带有组织列表数据的promise
 */
const customGetDataList = (name) => {
  // 这里是模拟后端处理
  return new Promise((resolve, reject) => {
    const remoteData = [
      { unitName: 'TEG技术工程事业群', unitId: 958, unitFullName: 'TEG技术工程事业群' },
      { unitName: '企业综合部', unitId: 24704, unitFullName: 'TEG技术工程事业群/企业综合部' },
      { unitName: 'CDG企业发展事业群', unitId: 18051, unitFullName: 'CDG企业发展事业群' },
      { unitName: 'CDG职业发展委员会', unitId: 18163, unitFullName: 'CDG企业发展事业群/CDG职业发展委员会' },
      {
        unitName: 'CDG通道决策委员会',
        unitId: 18164,
        unitFullName: 'CDG企业发展事业群/CDG职业发展委员会/CDG通道决策委员会',
      },
    ];
    let data = [];
    data = remoteData.filter((item) => item.unitName.indexOf(name) !== -1);
    resolve(data);
  });
};
/**
 * @method 根据组织Id获取该组织下的子级组织列表
 * @param {String} unitId 组织Id
 * @returns 返回带有组织列表数据的promise
 */
const customGetTreeData = (unitId) => {
  return new Promise((resolve, reject) => {
    // 这里是模拟后端处理
    let data = [];
    if (unitId === 0) {
      data = [
        { unitName: 'TEG技术工程事业群', unitId: 958, unitFullName: 'TEG技术工程事业群' },
        { unitName: 'CDG企业发展事业群', unitId: 18051, unitFullName: 'CDG企业发展事业群' },
      ];
    }
    if (unitId === 958) {
      data = [{ unitName: '企业综合部', unitId: 24704, unitFullName: 'TEG技术工程事业群/企业综合部' }];
    }
    if (unitId === 18051) {
      data = [{ unitName: 'CDG职业发展委员会', unitId: 18163, unitFullName: 'CDG企业发展事业群/CDG职业发展委员会' }];
    }
    if (unitId === 18163) {
      data = [
        {
          unitName: 'CDG通道决策委员会',
          unitId: 18164,
          unitFullName: 'CDG企业发展事业群/CDG职业发展委员会/CDG通道决策委员会',
        },
      ];
    }
    resolve(data);
  });
};
</script>

<style lang="less" scoped></style>
```

## API

### 属性 (Props)

| 参数 | 说明 | 类型 | 可选值 | 默认值 |
| --- | --- | --- | --- | --- |
| v-model / modelValue | 绑定值 | String / Number / Array | — | — |
| unitId | 根组织Id | Number / Array | — | — |
| multiple | 是否多选 | Boolean | — | false |
| width | 输入框宽度 | String / Number | — | — |
| size | 输入框尺寸 | String | medium / small | — |
| search | 是否模糊搜索 | Boolean | — | true |
| disabled | 是否禁用 | Boolean | — | false |
| textarea | 文本框 (上下布局) | Boolean | — | false |
| textareaModel | 文本框 (左右布局) | Boolean | — | false |
| height | 文本框高度 | Number / String | — | 130 |
| showTotal | 多选且非textarea模式下，是否显示后置的已选数量 | Boolean | — | true |
| placeholder | 占位符 | String | — | — |
| selectClass | 选择框自定义类名 | String | — | — |
| modalClass | 弹窗自定义类名 | String | — | — |
| modalWidth | 弹窗自定义宽度 | String | 参考Modal弹窗组件width | '750px' |
| modalAppendToBody | 弹窗自身是否插入至 body 元素上 | Boolean | — | false |
| showLastLevels | 是否只展示最后一级 | Boolean | — | true |
| showFullTag | 是否在输入框中展示完整的tag | Boolean | — | false |
| filterEnableFlag | 是否只包含有效组织 | Boolean | — | true |
| includeVirtualUnit | 是否包含虚拟组织 | Boolean | — | false |
| includeUnitSortIds | 限制组织选择范围 | Number Array | 0-公司、6-bg、8-线、1-部门、7-中心、2-组 | - |
| isLimitUnitExpand | 是否限制展开范围中最小级别的组织, 仅限制组织选择范围时有效 | Boolean | — | true |
| disabledUnitIdList | 禁用组织选项的操作 | Array | — | [] |
| defaultExpandedKeys | 一级默认展开的节点的unitId的数组 | Array | — | [] |
| props | 数据字段别名，具体见下表 | Object | — | — |
| getDataList | 通过关键字获取对应组织的方法 | Function | — | — |
| getTreeData | 通过组织标识获取其子组织的方法 | Function | — | — |
| titleTip | 弹窗标题旁提示文字 | String | — | — |

### props 字段别名配置

| 参数 | 说明 | 类型 | 可选值 | 默认值 |
| --- | --- | --- | --- | --- |
| unitId | 组织Id字段名 | String | — | 'unitId' |
| unitName | 组织名称字段名 | String | — | 'unitName' |
| unitFullName | 组织完整名称字段名 | String | — | 'unitFullName' |
| unitOwnershipTypeId | 组织管理归属类型Id字段名 | String | — | 'unitOwnershipTypeId' |
| unitOwnershipTypeNameCn | 组织管理归属类型名称-中文字段名 | String | — | 'unitOwnershipTypeNameCn' |
| unitOwnershipTypeNameEn | 组织管理归属类型名称-英文字段名 | String | — | 'unitOwnershipTypeNameEn' |
| unitIdPath | 完整组织Id路径 | String | — | 'unitIdPath' |
| unitLocationCode | 完整组织code编码 | String | — | 'unitLocationCode' |

### 事件 (Events)

| 事件名称 | 说明 | 回调参数 |
| --- | --- | --- |
| change | 选中项发生变化时触发 | 目前的选中项 |

### 方法 (Methods)

| 方法名 | 说明 | 参数 |
| --- | --- | --- |
| setSelected | 用于外部直接设置选中项 | 包含unitName、unitId、unitFullName属性的对象或其组成的数组 |
| clearSelected | 用于清空选中项 | — |
