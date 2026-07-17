# 信息库检索步骤与示例

通过 curl + grep 检索业务、接口、最佳实践、数据结构。入口与结构见 SKILL.md「信息库」节。

## 发现业务

确定对应的 tccli 服务名（如 cvm、cbs）。

```sh
curl -s https://cloudcache.tencentcs.com/capi/refs/services.md | grep 云服务器
```

参考输出：

```
[cvm](service/cvm/index.md) | 云服务器 | 2017-03-12 | ...
```

## 检索业务最佳实践

优先检索是否有匹配当前场景的最佳实践。

```sh
curl -s https://cloudcache.tencentcs.com/capi/refs/service/cvm/practices.md | grep 重装
```

## 检索接口

若最佳实践未覆盖，在业务接口列表中检索（接口名即 tccli 的 &lt;Action&gt;）。

```sh
curl -s https://cloudcache.tencentcs.com/capi/refs/service/cvm/actions.md | grep "扩容\|磁盘"
```

## 阅读接口文档

确认参数、地域、版本（tccli 一般自动匹配版本）：

```sh
curl -s https://cloudcache.tencentcs.com/capi/refs/service/cvm/action/ResizeInstanceDisks.md
```

## 阅读数据结构

文档中涉及的数据结构可进一步查看：

```sh
curl -s https://cloudcache.tencentcs.com/capi/refs/service/cvm/model/SystemDisk.md
```
