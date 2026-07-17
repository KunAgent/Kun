# RRULE 速查食谱

RRULE 全称 RFC 5545 Recurrence Rule，是 iCalendar 标准的一部分。
平台 `automation_update` 工具当前支持的 FREQ：`DAILY` / `HOURLY` / `WEEKLY` / `MONTHLY` / `YEARLY`。

---

## 一、字段速记

| 字段 | 含义 | 取值 |
|------|------|------|
| FREQ | 频率 | DAILY / HOURLY / WEEKLY / MONTHLY / YEARLY |
| INTERVAL | 间隔 | 整数，默认 1（每隔几个 FREQ 触发一次） |
| BYHOUR | 几点 | 0-23，多个用逗号 |
| BYMINUTE | 几分 | 0-59，多个用逗号 |
| BYDAY | 周几 | MO/TU/WE/TH/FR/SA/SU，多个用逗号 |
| BYMONTHDAY | 几号 | 1-31，多个用逗号 |
| BYMONTH | 几月 | 1-12，多个用逗号 |
| COUNT | 总次数上限 | 整数，达成后停止 |
| UNTIL | 终止时间 | YYYYMMDDTHHMMSSZ（UTC） |

---

## 二、常见组合

### 每天类
| 描述 | RRULE |
|------|-------|
| 每天 9:00 | `FREQ=DAILY;BYHOUR=9;BYMINUTE=0` |
| 每天 9:00 和 18:00 | `FREQ=DAILY;BYHOUR=9,18;BYMINUTE=0` |
| 每隔 2 天 9:00 | `FREQ=DAILY;INTERVAL=2;BYHOUR=9;BYMINUTE=0` |
| 工作日 9:00 | `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0` |
| 周末 10:00 | `FREQ=WEEKLY;BYDAY=SA,SU;BYHOUR=10;BYMINUTE=0` |

### 每周类
| 描述 | RRULE |
|------|-------|
| 每周一 9:00 | `FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0` |
| 每周五 17:00 | `FREQ=WEEKLY;BYDAY=FR;BYHOUR=17;BYMINUTE=0` |
| 每两周一次（周一 9:00） | `FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;BYHOUR=9;BYMINUTE=0` |

### 每月类
| 描述 | RRULE |
|------|-------|
| 每月 1 号 9:00 | `FREQ=MONTHLY;BYMONTHDAY=1;BYHOUR=9;BYMINUTE=0` |
| 每月 1 号和 15 号 9:00 | `FREQ=MONTHLY;BYMONTHDAY=1,15;BYHOUR=9;BYMINUTE=0` |
| 每月最后一天 18:00 | `FREQ=MONTHLY;BYMONTHDAY=-1;BYHOUR=18;BYMINUTE=0` |
| 每月第一个周一 9:00 | `FREQ=MONTHLY;BYDAY=1MO;BYHOUR=9;BYMINUTE=0` |

### 每小时类
| 描述 | RRULE |
|------|-------|
| 每小时整点 | `FREQ=HOURLY;BYMINUTE=0` |
| 工作时段每小时（9-18） | `FREQ=HOURLY;BYHOUR=9,10,11,12,13,14,15,16,17,18;BYMINUTE=0` |
| 每 2 小时 | `FREQ=HOURLY;INTERVAL=2;BYMINUTE=0` |

### 每年类
| 描述 | RRULE |
|------|-------|
| 每年 1 月 1 日 0:00 | `FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=1;BYHOUR=0;BYMINUTE=0` |
| 每年生日提醒（如 5/20） | `FREQ=YEARLY;BYMONTH=5;BYMONTHDAY=20;BYHOUR=9;BYMINUTE=0` |

---

## 三、有限期 vs 永久

- **永久**：不写 COUNT 也不写 UNTIL，任务持续执行直到用户删除。
- **指定次数**：`...;COUNT=10` 跑满 10 次自动停止。
- **指定截止**：用 `validUntil="2026-12-31"` 字段，比 RRULE 里的 UNTIL 更易读。

---

## 四、一次性任务（不用 RRULE）

| 描述 | 实现 |
|------|------|
| 明天下午 3 点提醒我开会 | `scheduleType="once"`, `scheduledAt="2026-06-10T15:00"` |
| 6 月 30 日提交月报 | `scheduleType="once"`, `scheduledAt="2026-06-30T18:00"` |

---

## 五、生成时的注意点

1. **时区**：`scheduledAt` 默认使用本地时区。如果用户跨时区，明确询问。
2. **冲突检查**：创建前应 `mode=list` 一次，避免和已有任务时间完全重合。
3. **极端频率**：不允许每分钟级别（FREQ=MINUTELY 不在支持列表内）。最快 HOURLY。
4. **历史时间**：`scheduledAt` 不能早于当前时间，应做校验后再写。
