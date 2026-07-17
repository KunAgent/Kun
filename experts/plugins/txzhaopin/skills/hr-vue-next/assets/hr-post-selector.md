# HrPostSelector 岗位选择器

## 组件说明

用于选择岗位，涉及的数据源均为远程数据。提供2种方式选择岗位，用 Tag 展示已选岗位：

1. 输入关键字搜索，使用下拉菜单展示筛选后的岗位
2. 点击右侧按钮打开弹窗，懒加载岗位树

> 提醒: 请避免在选择后动态改变选择器的宽度，这会造成 Tag 区域样式显示问题

## 基础用法

适用广泛的基础选择，提供2种方式选择岗位，用 Tag 展示已选岗位。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <span class="demonstration">单选模式</span>
      <hr-post-selector v-model="value1" showFullTag showPostId></hr-post-selector>
    </div>
    <div class="block">
      <span class="demonstration">多选模式</span>
      <hr-post-selector multiple v-model="value2"></hr-post-selector>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
const value1 = ref('');
const value2 = ref([]);
</script>

<style lang="less" scoped></style>
```

## 设置初始选中项

由于选择器所需的岗位选项至少需要包含 `postId`、`postName`、`postFullName` 等属性，而本地没有完整的岗位数据，因此不能简单通过修改 `v-model` 值来设置初始选择项。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <hr-post-selector ref="selector1" v-model="value1" multiple></hr-post-selector>
    </div>
    <div class="block">
      <hr-post-selector ref="selector2" v-model="value2" :props="myProps" multiple></hr-post-selector>
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
  postId: 'id',
  postName: 'name',
  postFullName: 'fullName',
});
onMounted(() => {
  const initial1 = [{ postId: 11, postName: '总经理', postFullName: 'TEG技术工程事业群/企业IT部/总经理' }];
  selector1.value.setSelected(initial1);
  const initial2 = [{ id: 11, name: '总经理', fullName: 'TEG技术工程事业群/企业IT部/总经理' }];
  selector2.value.setSelected(initial2);
});
</script>

<style lang="scss" scoped></style>
```

## 限制选项范围

用于仅提供某组织下的岗位选择。

> 提醒: 动态切换组织时，已有选项需手动调用方法清空（考虑与组织选择器联动和数据回显等场景，选择器不会主动对已有选项做处理）

```vue
<template>
  <div class="example_init_box">
    <hr-post-selector
      v-model="value"
      :range="range"
      placeholder="请选择"
      :defaultExpandedKeys="[953]"
      @change="change"
    ></hr-post-selector>
  </div>
</template>

<script setup>
import { ref } from 'vue';
const value = ref([]);
const range = ref({
  unitId: [953, 29294, 956, 29292, 958, 14129, 78, 2233, 2234],
  isContainSubUnit: true,
  notContainVirtualUnit: true,
});
const change = (val) => {
  console.log(val);
};
</script>

<style lang="less" scoped></style>
```

## 文本域

用于多行展示被选择的岗位，通过设置 `textarea` 属性启用, 也可通过设置 `textareaModel` 属性启用。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <hr-post-selector v-model="value" :height="170" textarea multiple placeholder="请选择"></hr-post-selector>
    </div>
    <div class="block">
      <hr-post-selector v-model="value2" :height="170" textareaModel multiple placeholder="请选择"></hr-post-selector>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
const value = ref([]);
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
      <hr-post-selector v-model="value1"></hr-post-selector>
    </div>
    <div class="block size-block">
      <span class="demonstration">中等尺寸</span>
      <hr-post-selector size="medium" v-model="value2"></hr-post-selector>
    </div>
    <div class="block size-block">
      <span class="demonstration">较小尺寸</span>
      <hr-post-selector size="small" v-model="value3" disabled></hr-post-selector>
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
    <hr-post-selector v-model="value" modalAppendToBody modalClass="customClass" />
  </div>
</template>

<script setup>
import { ref } from 'vue';
const value = ref('');
</script>

<style lang="less" scoped></style>
```

## 数据源

岗位数据均从远程服务器获取，内置了3个默认数据源接口方法满足选择器的功能需求。用户如需替换自己的数据源，需按规范定义接口方法和数据结构，通过3个对应的属性传入 `Function`。

每个 `Function` 接受一个输入参数用于指明需获取的岗位数据，返回一个 `Promise` 对象。除 `getTreeData` 以外，完成状态的结果值为包含**岗位对象**的**数组**，**岗位对象**至少包含 `{ postName, postId, postFullName }` 三个属性。

```vue
<template>
  <div class="example_init_box">
    <hr-post-selector
      v-model="value"
      multiple
      modalWidth="1000px"
      :getDataList="customGetDataList"
      :getTreeData="customGetTreeData"
      :getChildrenData="customGetChildrenData"
    >
    </hr-post-selector>
  </div>
</template>

<script setup>
import { ref } from 'vue';
const value = ref([]);

/**
 * @method 模糊搜索对应的岗位
 * @param {String} name 关键字字符串
 * @returns 返回带有岗位列表数据的promise
 */
const customGetDataList = (name) => {
  // 这里是模拟后端处理
  return new Promise((resolve, reject) => {
    const remoteData = [
      { postId: 11, postName: '总经理', postFullName: 'TEG技术工程事业群/企业IT部/总经理' },
      { postId: 12, postName: '副总经理', postFullName: 'TEG技术工程事业群/企业IT部/副总经理' },
      { postId: 13, postName: '秘书', postFullName: 'TEG技术工程事业群/企业IT部/秘书' },
      { postId: 14, postName: '业务合作伙伴', postFullName: 'TEG技术工程事业群/企业IT部/业务合作伙伴' },
      { postId: 15, postName: '公司副总裁', postFullName: 'TEG技术工程事业群/公司副总裁' },
      { postId: 21, postName: '高级副总裁', postFullName: 'CDG企业发展事业群/高级副总裁' },
      { postId: 22, postName: 'CSO', postFullName: 'CDG企业发展事业群/CSO' },
      { postId: 23, postName: '公司副总裁', postFullName: 'CDG企业发展事业群/公司副总裁' },
      {
        postId: 31,
        postName: '业务合作伙伴',
        postFullName: 'S3职能系统－HR与管理线/人力资源平台部/业务合作伙伴',
      },
      { postId: 32, postName: '高级管理顾问', postFullName: 'S3职能系统－HR与管理线/高级管理顾问' },
    ];
    resolve(remoteData.filter((item) => item.postFullName.indexOf(name) !== -1));
  });
};
/**
 * @method 根据组织Id获取该组织下的子级组织、子级岗位列表
 * @param {String} unitId 组织Id
 * @returns 返回带有组织、岗位列表数据的promise
 */
const customGetTreeData = (unitId) => {
  // 这里是模拟后端处理
  return new Promise((resolve, reject) => {
    let data = [];
    if (unitId === 0) {
      data = {
        unit: [
          { unitId: 1, unitName: 'TEG技术工程事业群' },
          { unitId: 2, unitName: 'CDG企业发展事业群' },
          { unitId: 3, unitName: 'S3职能系统－HR与管理线' },
        ],
      };
    }
    if (unitId === 1) {
      data = {
        post: [{ postId: 15, postName: '公司副总裁', postFullName: 'TEG技术工程事业群/公司副总裁' }],
        unit: [{ unitId: 4, unitName: '企业IT部' }],
      };
    }
    if (unitId === 2) {
      data = {
        post: [
          { postId: 21, postName: '高级副总裁', postFullName: 'CDG企业发展事业群/高级副总裁' },
          { postId: 22, postName: 'CSO', postFullName: 'CDG企业发展事业群/CSO' },
          { postId: 23, postName: '公司副总裁', postFullName: 'CDG企业发展事业群/公司副总裁' },
        ],
      };
    }
    if (unitId === 3) {
      data = {
        post: [{ postId: 32, postName: '高级管理顾问', postFullName: 'S3职能系统－HR与管理线/高级管理顾问' }],
        unit: [{ unitId: 5, unitName: '人力资源平台部' }],
      };
    }
    if (unitId === 4) {
      data = {
        post: [
          { postId: 11, postName: '总经理', postFullName: 'TEG技术工程事业群/企业IT部/总经理' },
          { postId: 12, postName: '副总经理', postFullName: 'TEG技术工程事业群/企业IT部/副总经理' },
          { postId: 13, postName: '秘书', postFullName: 'TEG技术工程事业群/企业IT部/秘书' },
          { postId: 14, postName: '业务合作伙伴', postFullName: 'TEG技术工程事业群/企业IT部/业务合作伙伴' },
        ],
      };
    }
    if (unitId === 5) {
      data = {
        post: [
          {
            postId: 31,
            postName: '业务合作伙伴',
            postFullName: 'S3职能系统－HR与管理线/人力资源平台部/业务合作伙伴',
          },
        ],
      };
    }
    resolve(data);
  });
};
/**
 * @method 根据组织Id获取该组织下子级岗位列表
 * @param {String} unitId 组织Id
 * @returns 返回带有岗位列表数据的promise
 */
const customGetChildrenData = (unitId) => {
  // 这里是模拟后端处理
  return new Promise((resolve, reject) => {
    let data = [];
    if (unitId === 1) {
      data = [
        // { postId: 11, postName: '总经理', postFullName: 'TEG技术工程事业群/企业IT部/总经理' },
        // { postId: 12, postName: '副总经理', postFullName: 'TEG技术工程事业群/企业IT部/副总经理' },
        // { postId: 13, postName: '秘书', postFullName: 'TEG技术工程事业群/企业IT部/秘书' },
        // { postId: 14, postName: '业务合作伙伴', postFullName: 'TEG技术工程事业群/企业IT部/业务合作伙伴' },
        { postId: 15, postName: '公司副总裁', postFullName: 'TEG技术工程事业群/公司副总裁' },
      ];
    }
    if (unitId === 2) {
      data = [
        { postId: 21, postName: '高级副总裁', postFullName: 'CDG企业发展事业群/高级副总裁' },
        { postId: 22, postName: 'CSO', postFullName: 'CDG企业发展事业群/CSO' },
        { postId: 23, postName: '公司副总裁', postFullName: 'CDG企业发展事业群/公司副总裁' },
      ];
    }
    if (unitId === 3) {
      data = [
        // { postId: 31, postName: '业务合作伙伴', postFullName: 'S3职能系统－HR与管理线/人力资源平台部/业务合作伙伴' },
        { postId: 32, postName: '高级管理顾问', postFullName: 'S3职能系统－HR与管理线/高级管理顾问' },
      ];
    }
    if (unitId === 4) {
      data = [
        { postId: 11, postName: '总经理', postFullName: 'TEG技术工程事业群/企业IT部/总经理' },
        { postId: 12, postName: '副总经理', postFullName: 'TEG技术工程事业群/企业IT部/副总经理' },
        { postId: 13, postName: '秘书', postFullName: 'TEG技术工程事业群/企业IT部/秘书' },
        { postId: 14, postName: '业务合作伙伴', postFullName: 'TEG技术工程事业群/企业IT部/业务合作伙伴' },
      ];
    }
    if (unitId === 5) {
      data = [
        {
          postId: 31,
          postName: '业务合作伙伴',
          postFullName: 'S3职能系统－HR与管理线/人力资源平台部/业务合作伙伴',
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
| multiple | 是否多选 | Boolean | — | false |
| width | 输入框宽度 | String / Number | — | — |
| size | 输入框尺寸 | String | medium / small | — |
| search | 是否模糊搜索 | Boolean | — | true |
| disabled | 是否禁用 | Boolean | — | false |
| textarea | 文本框 (上下布局) | Boolean | — | false |
| textareaModel | 文本框 (左右布局) | Boolean | — | false |
| height | 文本框高度 | Number / String | — | 130 |
| showTotal | 多选且非textarea模式下，是否显示后置的已选数量 | Boolean | — | true |
| showPostId | 筛选时是否展示postId | Boolean | — | false |
| placeholder | 占位符 | String | — | — |
| showLastLevels | 是否只展示最后一级 | Boolean | — | true |
| showFullTag | 是否在输入框中展示完整的tag | Boolean | — | false |
| filterEnableFlag | 是否只包含有效岗位 | Boolean | — | true |
| defaultExpandedKeys | 一级默认展开的节点的unitId的数组 | Array | — | [] |
| range | 限制选项范围，具体见下表 | Object | — | - |
| props | 数据字段别名，具体见下表 | Object | — | — |
| selectClass | 选择框自定义类名 | String | — | — |
| modalClass | 弹窗自定义类名 | String | — | — |
| modalWidth | 弹窗自定义宽度 | String | 参考Modal弹窗组件width | '800px' |
| modalAppendToBody | 弹窗自身是否插入至 body 元素上 | Boolean | — | false |
| getDataList | 通过关键字获取对应岗位的方法 | Function | — | — |
| getTreeData | 通过组织标识获取其子组织、岗位的方法 | Function | — | — |
| getChildrenData | 通过组织标识获取其下所有岗位的方法 | Function | — | — |
| titleTip | 弹窗标题旁提示文字 | String | — | — |

### range 限制选项范围配置

| 参数 | 说明 | 类型 | 可选值 | 默认值 |
| --- | --- | --- | --- | --- |
| unitId | 组织Id, 仅选择该组织下的子级岗位, 会先查对应的组织 | Number / Array | — | - |
| isContainSubUnit | 是否包含子级岗位 | Boolean | — | true |
| notContainVirtualUnit | 是否包含虚拟组织岗位 | Boolean | — | false |
| staffTypeIdList | 员工类型ID | Array | — | - |

### props 字段别名配置

| 参数 | 说明 | 类型 | 可选值 | 默认值 |
| --- | --- | --- | --- | --- |
| postId | 岗位Id字段名 | String | — | 'postId' |
| postName | 岗位名称字段名 | String | — | 'postName' |
| postFullName | 岗位完整名称字段名 | String | — | 'postFullName' |
| unitId | 组织Id字段名 | String | — | 'unitId' |

### 事件 (Events)

| 事件名称 | 说明 | 回调参数 |
| --- | --- | --- |
| change | 选中项发生变化时触发 | 目前的选中项 |

### 方法 (Methods)

| 方法名 | 说明 | 参数 |
| --- | --- | --- |
| setSelected | 用于外部直接设置选中项 | 包含postName、postId、postFullName属性的对象或其组成的数组 |
| clearSelected | 用于清空选中项 | — |
