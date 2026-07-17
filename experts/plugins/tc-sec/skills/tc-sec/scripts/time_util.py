#!/usr/bin/env python3
"""时间工具 - 用于 tccli 命令中的时间参数计算"""

import sys
import argparse
from datetime import datetime, timedelta

FMT = "%Y-%m-%d %H:%M:%S"


def now():
    print(datetime.now().strftime(FMT))


def today():
    print(datetime.now().strftime("%Y-%m-%d"))


def ago(value, unit):
    units = {"m": "minutes", "h": "hours", "d": "days", "w": "weeks"}
    if unit not in units:
        print(f"Error: unit must be one of {list(units.keys())}", file=sys.stderr)
        sys.exit(1)
    dt = datetime.now() - timedelta(**{units[unit]: value})
    print(dt.strftime(FMT))


def offset(value, unit):
    units = {"m": "minutes", "h": "hours", "d": "days", "w": "weeks"}
    if unit not in units:
        print(f"Error: unit must be one of {list(units.keys())}", file=sys.stderr)
        sys.exit(1)
    dt = datetime.now() + timedelta(**{units[unit]: value})
    print(dt.strftime(FMT))


def range_cmd(value, unit):
    units = {"m": "minutes", "h": "hours", "d": "days", "w": "weeks"}
    if unit not in units:
        print(f"Error: unit must be one of {list(units.keys())}", file=sys.stderr)
        sys.exit(1)
    end = datetime.now()
    start = end - timedelta(**{units[unit]: value})
    print(f"{start.strftime(FMT)}\n{end.strftime(FMT)}")


def date_range(value, unit):
    units = {"m": "minutes", "h": "hours", "d": "days", "w": "weeks"}
    if unit not in units:
        print(f"Error: unit must be one of {list(units.keys())}", file=sys.stderr)
        sys.exit(1)
    end = datetime.now()
    start = end - timedelta(**{units[unit]: value})
    print(f"{start.strftime('%Y-%m-%d')}\n{end.strftime('%Y-%m-%d')}")


def start_of(scope):
    n = datetime.now()
    if scope == "day":
        dt = n.replace(hour=0, minute=0, second=0)
    elif scope == "week":
        dt = (n - timedelta(days=n.weekday())).replace(hour=0, minute=0, second=0)
    elif scope == "month":
        dt = n.replace(day=1, hour=0, minute=0, second=0)
    else:
        print(f"Error: scope must be day/week/month", file=sys.stderr)
        sys.exit(1)
    print(dt.strftime(FMT))


def fmt(timestamp):
    try:
        ts = int(timestamp)
        print(datetime.fromtimestamp(ts).strftime(FMT))
    except ValueError:
        print("Error: invalid unix timestamp", file=sys.stderr)
        sys.exit(1)


def ts(time_str=None):
    try:
        if time_str:
            dt = datetime.strptime(time_str, FMT)
        else:
            dt = datetime.now()
        print(int(dt.timestamp()))
    except ValueError:
        print(f"Error: expected format '{FMT}'", file=sys.stderr)
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="时间计算工具")
    sub = parser.add_subparsers(dest="cmd")

    sub.add_parser("now", help="当前时间")
    sub.add_parser("today", help="今天日期")

    p = sub.add_parser("ago", help="N 单位之前的时间")
    p.add_argument("value", type=int)
    p.add_argument("unit", choices=["m", "h", "d", "w"])

    p = sub.add_parser("offset", help="N 单位之后的时间")
    p.add_argument("value", type=int)
    p.add_argument("unit", choices=["m", "h", "d", "w"])

    p = sub.add_parser("range", help="输出起止时间对(过去N单位到现在)")
    p.add_argument("value", type=int)
    p.add_argument("unit", choices=["m", "h", "d", "w"])

    p = sub.add_parser("date-range", help="输出起止日期对(纯日期格式,适用于TCSS等需要date类型的API)")
    p.add_argument("value", type=int)
    p.add_argument("unit", choices=["m", "h", "d", "w"])

    p = sub.add_parser("start-of", help="某周期的起始时间")
    p.add_argument("scope", choices=["day", "week", "month"])

    p = sub.add_parser("fmt", help="Unix 时间戳转可读格式")
    p.add_argument("timestamp")

    p = sub.add_parser("ts", help="可读时间转 Unix 时间戳")
    p.add_argument("time_str", nargs="?", default=None)

    args = parser.parse_args()

    if args.cmd == "now":
        now()
    elif args.cmd == "today":
        today()
    elif args.cmd == "ago":
        ago(args.value, args.unit)
    elif args.cmd == "offset":
        offset(args.value, args.unit)
    elif args.cmd == "range":
        range_cmd(args.value, args.unit)
    elif args.cmd == "date-range":
        date_range(args.value, args.unit)
    elif args.cmd == "start-of":
        start_of(args.scope)
    elif args.cmd == "fmt":
        fmt(args.timestamp)
    elif args.cmd == "ts":
        ts(args.time_str)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
