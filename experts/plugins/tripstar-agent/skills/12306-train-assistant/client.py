#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import datetime as dt
import getpass
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import uuid as uuidlib
from pathlib import Path
from shlex import quote as shell_quote
from typing import Any
from urllib.parse import unquote, urlencode, urljoin

import requests

BASE_URL = "https://kyfw.12306.cn"
SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_CACHE_DIR = SCRIPT_DIR / "cache"
DEFAULT_COOKIE_FILE = str(DEFAULT_CACHE_DIR / "kyfw_12306_cookies.json")
DEFAULT_QR_LOGIN_STATE_FILE = str(DEFAULT_CACHE_DIR / "kyfw_12306_qr_login_state.json")
DEFAULT_STATION_CACHE_FILE = str(DEFAULT_CACHE_DIR / "kyfw_12306_station_index.json")
STATION_CACHE_TTL_SECONDS = 3 * 24 * 60 * 60
SM4_KEY = "tiekeyuankp12306"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.3.1 Safari/605.1.15"
)
BROWSER_ACCEPT_LANGUAGE = "zh-CN,zh-Hans;q=0.9"
SEAT_CODE_MAP: dict[str, str] = {
    "business": "9",
    "business_class": "9",
    "商务座": "9",
    "特等座": "P",
    "special_class": "P",
    "premier_class": "P",
    "first_class": "M",
    "一等座": "M",
    "premium_first_class": "D",
    "优选一等座": "D",
    "second_class": "O",
    "二等座": "O",
    "second_class_compartment": "S",
    "二等包座": "S",
    "deluxe_soft_sleeper": "6",
    "高级软卧": "6",
    "advanced_soft_sleeper": "A",
    "advanced_emu_sleeper": "A",
    "高级动卧": "A",
    "soft_sleeper": "4",
    "软卧": "4",
    "first_class_sleeper": "I",
    "一等卧": "I",
    "dynamic_sleeper": "F",
    "动卧": "F",
    "hard_sleeper": "3",
    "硬卧": "3",
    "second_class_sleeper": "J",
    "二等卧": "J",
    "soft_seat": "2",
    "软座": "2",
    "hard_seat": "1",
    "硬座": "1",
    "no_seat": "W",
    "standing": "W",
    "无座": "W",
    "wz": "W",
    "other": "H",
    "其他": "H",
}
PRICE_KEY_LABEL_MAP: dict[str, str] = {
    "9": "商务座",
    "A9": "商务座/特等座",
    "P": "特等座",
    "D": "优选一等座",
    "M": "一等座",
    "O": "二等座",
    "S": "二等包座",
    "6": "高级软卧",
    "A": "高级动卧",
    "4": "软卧",
    "F": "动卧",
    "I": "一等卧",
    "3": "硬卧",
    "J": "二等卧",
    "2": "软座",
    "1": "硬座",
    "W": "无座",
    "WZ": "无座",
}
TRANSFER_SEAT_FIELD_LABELS: list[tuple[str, str]] = [
    ("swz_num", "商务座"),
    ("tz_num", "特等座"),
    ("gg_num", "优选一等座"),
    ("zy_num", "一等座"),
    ("ze_num", "二等座"),
    ("gr_num", "高级软卧"),
    ("rw_num", "软卧"),
    ("srrb_num", "动卧"),
    ("yw_num", "硬卧"),
    ("rz_num", "软座"),
    ("yz_num", "硬座"),
    ("wz_num", "无座"),
    ("qt_num", "其他"),
]
CANDIDATE_SEAT_CONFIG: dict[str, dict[str, str]] = {
    "9": {"row_field": "business", "prefix": "SWZ", "hb_seat_code": "9", "label": "商务座"},
    "P": {"row_field": "special_class", "prefix": "TZ", "hb_seat_code": "P", "label": "特等座"},
    "D": {"row_field": "premium_first_class", "prefix": "GG", "hb_seat_code": "D", "label": "优选一等座"},
    "M": {"row_field": "first_class", "prefix": "ZY", "hb_seat_code": "M", "label": "一等座"},
    "O": {"row_field": "second_class", "prefix": "ZE", "hb_seat_code": "O", "label": "二等座"},
    "6": {"row_field": "deluxe_soft_sleeper", "prefix": "GR", "hb_seat_code": "6", "label": "高级软卧"},
    "4": {"row_field": "soft_sleeper", "prefix": "RW", "hb_seat_code": "4", "label": "软卧"},
    "F": {"row_field": "dynamic_sleeper", "prefix": "SRRB", "hb_seat_code": "F", "label": "动卧"},
    "3": {"row_field": "hard_sleeper", "prefix": "YW", "hb_seat_code": "3", "label": "硬卧"},
    "2": {"row_field": "soft_seat", "prefix": "RZ", "hb_seat_code": "2", "label": "软座"},
    "1": {"row_field": "hard_seat", "prefix": "YZ", "hb_seat_code": "1", "label": "硬座"},
}

FK = [0xA3B1BAC6, 0x56AA3350, 0x677D9197, 0xB27022DC]
CK = [
    0x00070E15,
    0x1C232A31,
    0x383F464D,
    0x545B6269,
    0x70777E85,
    0x8C939AA1,
    0xA8AFB6BD,
    0xC4CBD2D9,
    0xE0E7EEF5,
    0xFC030A11,
    0x181F262D,
    0x343B4249,
    0x50575E65,
    0x6C737A81,
    0x888F969D,
    0xA4ABB2B9,
    0xC0C7CED5,
    0xDCE3EAF1,
    0xF8FF060D,
    0x141B2229,
    0x30373E45,
    0x4C535A61,
    0x686F767D,
    0x848B9299,
    0xA0A7AEB5,
    0xBCC3CAD1,
    0xD8DFE6ED,
    0xF4FB0209,
    0x10171E25,
    0x2C333A41,
    0x484F565D,
    0x646B7279,
]
SBOX = [
    0xD6,
    0x90,
    0xE9,
    0xFE,
    0xCC,
    0xE1,
    0x3D,
    0xB7,
    0x16,
    0xB6,
    0x14,
    0xC2,
    0x28,
    0xFB,
    0x2C,
    0x05,
    0x2B,
    0x67,
    0x9A,
    0x76,
    0x2A,
    0xBE,
    0x04,
    0xC3,
    0xAA,
    0x44,
    0x13,
    0x26,
    0x49,
    0x86,
    0x06,
    0x99,
    0x9C,
    0x42,
    0x50,
    0xF4,
    0x91,
    0xEF,
    0x98,
    0x7A,
    0x33,
    0x54,
    0x0B,
    0x43,
    0xED,
    0xCF,
    0xAC,
    0x62,
    0xE4,
    0xB3,
    0x1C,
    0xA9,
    0xC9,
    0x08,
    0xE8,
    0x95,
    0x80,
    0xDF,
    0x94,
    0xFA,
    0x75,
    0x8F,
    0x3F,
    0xA6,
    0x47,
    0x07,
    0xA7,
    0xFC,
    0xF3,
    0x73,
    0x17,
    0xBA,
    0x83,
    0x59,
    0x3C,
    0x19,
    0xE6,
    0x85,
    0x4F,
    0xA8,
    0x68,
    0x6B,
    0x81,
    0xB2,
    0x71,
    0x64,
    0xDA,
    0x8B,
    0xF8,
    0xEB,
    0x0F,
    0x4B,
    0x70,
    0x56,
    0x9D,
    0x35,
    0x1E,
    0x24,
    0x0E,
    0x5E,
    0x63,
    0x58,
    0xD1,
    0xA2,
    0x25,
    0x22,
    0x7C,
    0x3B,
    0x01,
    0x21,
    0x78,
    0x87,
    0xD4,
    0x00,
    0x46,
    0x57,
    0x9F,
    0xD3,
    0x27,
    0x52,
    0x4C,
    0x36,
    0x02,
    0xE7,
    0xA0,
    0xC4,
    0xC8,
    0x9E,
    0xEA,
    0xBF,
    0x8A,
    0xD2,
    0x40,
    0xC7,
    0x38,
    0xB5,
    0xA3,
    0xF7,
    0xF2,
    0xCE,
    0xF9,
    0x61,
    0x15,
    0xA1,
    0xE0,
    0xAE,
    0x5D,
    0xA4,
    0x9B,
    0x34,
    0x1A,
    0x55,
    0xAD,
    0x93,
    0x32,
    0x30,
    0xF5,
    0x8C,
    0xB1,
    0xE3,
    0x1D,
    0xF6,
    0xE2,
    0x2E,
    0x82,
    0x66,
    0xCA,
    0x60,
    0xC0,
    0x29,
    0x23,
    0xAB,
    0x0D,
    0x53,
    0x4E,
    0x6F,
    0xD5,
    0xDB,
    0x37,
    0x45,
    0xDE,
    0xFD,
    0x8E,
    0x2F,
    0x03,
    0xFF,
    0x6A,
    0x72,
    0x6D,
    0x6C,
    0x5B,
    0x51,
    0x8D,
    0x1B,
    0xAF,
    0x92,
    0xBB,
    0xDD,
    0xBC,
    0x7F,
    0x11,
    0xD9,
    0x5C,
    0x41,
    0x1F,
    0x10,
    0x5A,
    0xD8,
    0x0A,
    0xC1,
    0x31,
    0x88,
    0xA5,
    0xCD,
    0x7B,
    0xBD,
    0x2D,
    0x74,
    0xD0,
    0x12,
    0xB8,
    0xE5,
    0xB4,
    0xB0,
    0x89,
    0x69,
    0x97,
    0x4A,
    0x0C,
    0x96,
    0x77,
    0x7E,
    0x65,
    0xB9,
    0xF1,
    0x09,
    0xC5,
    0x6E,
    0xC6,
    0x84,
    0x18,
    0xF0,
    0x7D,
    0xEC,
    0x3A,
    0xDC,
    0x4D,
    0x20,
    0x79,
    0xEE,
    0x5F,
    0x3E,
    0xD7,
    0xCB,
    0x39,
    0x48,
]


def _u32(x: int) -> int:
    return x & 0xFFFFFFFF


def _rotl(x: int, n: int) -> int:
    return _u32((x << n) | (x >> (32 - n)))


def _tau_transform(a: int) -> int:
    return (
        (SBOX[(a >> 24) & 0xFF] << 24)
        | (SBOX[(a >> 16) & 0xFF] << 16)
        | (SBOX[(a >> 8) & 0xFF] << 8)
        | SBOX[a & 0xFF]
    )


def _t_transform1(z: int) -> int:
    b = _tau_transform(z)
    return b ^ _rotl(b, 2) ^ _rotl(b, 10) ^ _rotl(b, 18) ^ _rotl(b, 24)


def _t_transform2(z: int) -> int:
    b = _tau_transform(z)
    return b ^ _rotl(b, 13) ^ _rotl(b, 23)


def _encrypt_round_keys(key: bytes) -> list[int]:
    if len(key) != 16:
        raise ValueError("SM4 key must be 16 bytes")
    mk = [int.from_bytes(key[i : i + 4], "big") for i in range(0, 16, 4)]
    k = [mk[i] ^ FK[i] for i in range(4)]
    keys: list[int] = []
    for i in range(32):
        nxt = _u32(k[i] ^ _t_transform2(k[i + 1] ^ k[i + 2] ^ k[i + 3] ^ CK[i]))
        k.append(nxt)
        keys.append(nxt)
    return keys


def _pkcs7_padding(data: bytes) -> bytes:
    pad = 16 - (len(data) % 16)
    return data + bytes([pad]) * pad


def encrypt_ecb(plaintext: str, key: str) -> str:
    plain = _pkcs7_padding(plaintext.encode("utf-8"))
    round_keys = _encrypt_round_keys(key.encode("utf-8"))
    cipher = bytearray()
    for block_idx in range(0, len(plain), 16):
        block = plain[block_idx : block_idx + 16]
        x = [int.from_bytes(block[i : i + 4], "big") for i in range(0, 16, 4)]
        for i in range(32):
            x.append(_u32(x[i] ^ _t_transform1(x[i + 1] ^ x[i + 2] ^ x[i + 3] ^ round_keys[i])))
        for v in [x[35], x[34], x[33], x[32]]:
            cipher.extend(v.to_bytes(4, "big"))
    return base64.b64encode(cipher).decode("ascii")


def encrypt_12306_password(raw_password: str) -> str:
    if raw_password.startswith("@"):
        return raw_password
    return "@" + encrypt_ecb(raw_password, SM4_KEY)


def parse_json_response(text: str) -> Any:
    body = (text or "").replace("\ufeff", "").strip()
    if not body:
        return {}
    if body.startswith("{") or body.startswith("["):
        return json.loads(body)
    # Handle jsonp: callback({...});
    match = re.match(r"^[^(]+\((.*)\)\s*;?$", body, re.S)
    if match:
        return json.loads(match.group(1))
    raise ValueError(f"Invalid JSON response: {body[:120]}")


def assert_ok(resp: dict[str, Any], field: str = "result_code") -> None:
    if not isinstance(resp, dict):
        raise RuntimeError(f"Unexpected response: {resp!r}")
    code = str(resp.get(field, ""))
    if code not in {"0", "200"}:
        msg = resp.get("result_message") or resp.get("msg") or resp.get("messages") or resp
        raise RuntimeError(f"Request failed ({field}={code}): {msg}")


def derive_qr_login_state_file(cookie_file: str | None) -> Path:
    if cookie_file:
        base = Path(cookie_file).expanduser()
        return base.with_name(base.name + ".qrlogin.json")
    return Path(DEFAULT_QR_LOGIN_STATE_FILE).expanduser()


def load_qr_login_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(payload, dict):
            return payload
    except Exception:
        return {}
    return {}


def save_qr_login_state(path: Path, payload: dict[str, Any]) -> None:
    path = path.expanduser()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


class KyfwClient:
    def __init__(
        self,
        base_url: str = BASE_URL,
        timeout: int = 15,
        cookie_file: str | None = None,
        browser_headers: bool = True,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.cookie_file = cookie_file
        self.browser_headers = browser_headers
        self.session = requests.Session()
        session_headers = {
            "User-Agent": USER_AGENT,
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "X-Requested-With": "XMLHttpRequest",
        }
        if self.browser_headers:
            session_headers.update(
                {
                    "Accept-Language": BROWSER_ACCEPT_LANGUAGE,
                    "Cache-Control": "no-cache",
                    "Pragma": "no-cache",
                    "If-Modified-Since": "0",
                }
            )
        self.session.headers.update(session_headers)
        self._station_index: dict[str, str] | None = None
        self._station_cache_file = Path(DEFAULT_STATION_CACHE_FILE).expanduser()
        self._station_cache_ttl_seconds = STATION_CACHE_TTL_SECONDS
        self._load_cookies()

    def _load_cookies(self) -> None:
        if not self.cookie_file:
            return
        path = Path(self.cookie_file).expanduser()
        if not path.exists():
            return
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            cookie_items: list[dict[str, Any]]
            if isinstance(payload, dict) and isinstance(payload.get("cookies"), list):
                cookie_items = payload["cookies"]
            elif isinstance(payload, list):
                cookie_items = payload
            else:
                return

            jar = requests.cookies.RequestsCookieJar()
            for item in cookie_items:
                if not isinstance(item, dict):
                    continue
                name = item.get("name")
                value = item.get("value")
                if not name or value is None:
                    continue
                kwargs: dict[str, Any] = {
                    "name": str(name),
                    "value": str(value),
                    "path": item.get("path", "/"),
                    "secure": bool(item.get("secure", False)),
                }
                if item.get("domain"):
                    kwargs["domain"] = item["domain"]
                if item.get("expires") is not None:
                    kwargs["expires"] = int(item["expires"])
                rest = item.get("rest")
                if isinstance(rest, dict):
                    kwargs["rest"] = rest
                jar.set_cookie(requests.cookies.create_cookie(**kwargs))
            self.session.cookies.update(jar)
        except Exception:
            # Cookie file is best-effort.
            return

    def _save_cookies(self) -> None:
        if not self.cookie_file:
            return
        path = Path(self.cookie_file).expanduser()
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            cookie_items: list[dict[str, Any]] = []
            for c in self.session.cookies:
                cookie_items.append(
                    {
                        "name": c.name,
                        "value": c.value,
                        "domain": c.domain,
                        "path": c.path,
                        "secure": bool(c.secure),
                        "expires": c.expires,
                        "rest": dict(getattr(c, "_rest", {}) or {}),
                    }
                )
            payload = {"version": 1, "cookies": cookie_items}
            tmp = path.with_suffix(path.suffix + ".tmp")
            tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
            tmp.replace(path)
        except Exception:
            # Cookie file is best-effort.
            return

    def _url(self, path: str) -> str:
        if path.startswith("http://") or path.startswith("https://"):
            return path
        return f"{self.base_url}{path}"

    def _build_request_headers(self, *, method: str, referer: str | None = None) -> dict[str, str]:
        headers: dict[str, str] = {}
        if self.browser_headers:
            headers.update(
                {
                    "Sec-Fetch-Site": "same-origin",
                    "Sec-Fetch-Mode": "cors",
                    "Sec-Fetch-Dest": "empty",
                }
            )
        if referer:
            headers["Referer"] = self._url(referer)
        if method.upper() == "POST":
            headers["Origin"] = self.base_url
            headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8"
        return headers

    @staticmethod
    def _raise_if_risk_control_redirect(resp: requests.Response) -> None:
        if "error.html" in resp.url:
            raise RuntimeError(
                "12306 返回 error.html，通常是触发了风控或访问限制。"
                "请在可访问 12306 的网络环境重试，或重新登录，或降低请求频率。"
            )

    def _send_request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        data: dict[str, Any] | None = None,
        referer: str | None = None,
        expect_json: bool = True,
    ) -> requests.Response:
        resp = self.session.request(
            method=method.upper(),
            url=self._url(path),
            params=params,
            data=data,
            headers=self._build_request_headers(method=method, referer=referer),
            timeout=self.timeout,
        )
        resp.raise_for_status()
        self._raise_if_risk_control_redirect(resp)
        if expect_json:
            content_type = resp.headers.get("Content-Type", "").lower()
            body = resp.text or ""
            if "html" in content_type and "<!doctype html" in body.lower():
                raise RuntimeError(f"接口返回 HTML 页面而非 JSON: {resp.url}")
        self._save_cookies()
        return resp

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        data: dict[str, Any] | None = None,
        referer: str | None = None,
    ) -> dict[str, Any]:
        resp = self._send_request(
            method,
            path,
            params=params,
            data=data,
            referer=referer,
            expect_json=True,
        )
        return parse_json_response(resp.text)

    def _request_text(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        data: dict[str, Any] | None = None,
        referer: str | None = None,
    ) -> str:
        resp = self._send_request(
            method,
            path,
            params=params,
            data=data,
            referer=referer,
            expect_json=False,
        )
        return resp.text or ""

    @staticmethod
    def _pick_first_non_empty(data: dict[str, Any], keys: tuple[str, ...]) -> Any | None:
        for key in keys:
            if key not in data:
                continue
            value = data.get(key)
            if value is None:
                continue
            if isinstance(value, str):
                value = value.strip()
                if not value:
                    continue
            return value
        return None

    @classmethod
    def _extract_user_profile(cls, payload: Any) -> dict[str, Any]:
        if not isinstance(payload, dict):
            return {}
        data = payload.get("data") if isinstance(payload.get("data"), dict) else None
        sources: list[dict[str, Any]] = []
        if isinstance(data, dict):
            sources.append(data)
        sources.append(payload)

        field_map: dict[str, tuple[str, ...]] = {
            "name": ("name", "real_name", "display_name"),
            "username": ("user_name", "username", "login_name"),
            "email": ("ei_email", "email"),
            "mobile": ("mobile_no", "mobile", "phone", "phone_no"),
            "id_no": ("id_no", "id_card_no"),
            "born_date": ("born_date",),
            "user_status": ("user_status",),
        }
        profile: dict[str, Any] = {}
        for out_key, in_keys in field_map.items():
            for source in sources:
                value = cls._pick_first_non_empty(source, in_keys)
                if value is not None:
                    profile[out_key] = value
                    break
        return profile

    @staticmethod
    def _merge_user_profile(
        base: dict[str, Any] | None,
        incoming: dict[str, Any] | None,
    ) -> dict[str, Any]:
        merged = dict(base or {})
        for key, value in (incoming or {}).items():
            if key not in merged or merged[key] in (None, ""):
                merged[key] = value
        return merged

    def check_login_status(self) -> dict[str, Any]:
        result: dict[str, Any] = {"logged_in": False, "cookie_file": self.cookie_file}
        try:
            conf = self._request(
                "POST",
                "/otn/login/conf",
                referer="/otn/view/index.html",
            )
            result["conf"] = conf
            data = conf.get("data") if isinstance(conf, dict) else None
            if isinstance(data, dict):
                is_login = data.get("is_login")
                if isinstance(is_login, str):
                    result["logged_in"] = is_login.upper() == "Y"
                elif isinstance(is_login, bool):
                    result["logged_in"] = is_login
                elif any(data.get(k) for k in ("born_date", "ei_email", "name", "user_name")):
                    result["logged_in"] = True
            conf_user = self._extract_user_profile(conf)
            if conf_user:
                result["user"] = self._merge_user_profile(
                    result.get("user") if isinstance(result.get("user"), dict) else None,
                    conf_user,
                )
        except Exception as e:  # noqa: BLE001
            result["conf_error"] = str(e)

        if result["logged_in"] and isinstance(result.get("user"), dict) and result["user"]:
            return result

        try:
            info = self._request(
                "POST",
                "/otn/index/initMy12306Api",
                referer="/otn/view/index.html",
            )
            result["initMy12306Api"] = info
            data = info.get("data") if isinstance(info, dict) else None
            if isinstance(data, dict) and data.get("user_status") is not None:
                result["logged_in"] = True
            info_user = self._extract_user_profile(info)
            if info_user:
                result["user"] = self._merge_user_profile(
                    result.get("user") if isinstance(result.get("user"), dict) else None,
                    info_user,
                )
        except Exception as e:  # noqa: BLE001
            result["init_api_error"] = str(e)

        return result

    def check_login_verify(self, username: str) -> dict[str, Any]:
        return self._request(
            "POST",
            "/passport/web/checkLoginVerify",
            data={"username": username, "appid": "otn"},
            referer="/otn/resources/login.html",
        )

    def send_sms_code(self, username: str, id_last4: str) -> dict[str, Any]:
        if not re.fullmatch(r"[0-9Xx]{4}", id_last4):
            raise ValueError("--id-last4 必须是证件号后4位（数字或X）")
        return self._request(
            "POST",
            "/passport/web/getMessageCode",
            data={"appid": "otn", "username": username, "castNum": id_last4.upper()},
            referer="/otn/resources/login.html",
        )

    def create_qr_login(self, *, appid: str = "otn") -> dict[str, Any]:
        appid = (appid or "otn").strip() or "otn"
        self.session.get(self._url("/otn/resources/login.html"), timeout=self.timeout)
        resp = self._request(
            "POST",
            "/passport/web/create-qr64",
            data={"appid": appid},
            referer="/otn/resources/login.html",
        )
        code = str(resp.get("result_code", ""))
        if code != "0":
            raise RuntimeError(f"生成二维码失败(result_code={code}): {self._extract_error_message(resp)}")
        uuid = str(resp.get("uuid") or "").strip()
        image = str(resp.get("image") or "").strip()
        if not uuid or not image:
            raise RuntimeError(f"create-qr64 返回缺少 uuid/image: {resp}")
        return {
            "step": "qr_created",
            "appid": appid,
            "uuid": uuid,
            "image": image,
            "result_code": code,
            "result_message": resp.get("result_message") or "",
            "createQr64": resp,
        }

    def check_qr_login(
        self,
        *,
        uuid: str,
        appid: str = "otn",
        finalize: bool = True,
    ) -> dict[str, Any]:
        uuid = (uuid or "").strip()
        if not uuid:
            raise ValueError("uuid 不能为空")
        appid = (appid or "otn").strip() or "otn"

        check_resp = self._request(
            "POST",
            "/passport/web/checkqr",
            data={"uuid": uuid, "appid": appid},
            referer="/otn/resources/login.html",
        )
        result_code = str(check_resp.get("result_code", ""))
        result_message = str(check_resp.get("result_message") or "")
        qr_status_map = {
            "0": "waiting_scan",
            "1": "waiting_confirm",
            "2": "authorized",
            "3": "expired",
            "5": "error",
        }
        qr_status = qr_status_map.get(result_code, "unknown")
        out: dict[str, Any] = {
            "step": "checked",
            "uuid": uuid,
            "appid": appid,
            "result_code": result_code,
            "result_message": result_message,
            "qr_status": qr_status,
            "checkqr": check_resp,
        }
        if result_code != "2":
            if result_code in {"0", "1"}:
                out["step"] = "pending"
            elif result_code == "3":
                out["step"] = "expired"
            elif result_code == "5":
                out["step"] = "error"
            else:
                out["step"] = "unknown"
            return out

        if not finalize:
            out["step"] = "authorized"
            return out

        # Match browser flow: authorized QR -> passport ticket -> uamtk -> uamauthclient.
        self.session.get(
            self._url("/otn/passport?redirect=/otn/login/userLogin"),
            timeout=self.timeout,
        )
        uamtk_resp = self._request(
            "POST",
            "/passport/web/auth/uamtk",
            data={"appid": appid},
            referer="/otn/passport?redirect=/otn/login/userLogin",
        )
        uamtk_code = str(uamtk_resp.get("result_code", ""))
        if uamtk_code != "0":
            raise RuntimeError(
                "扫码已确认，但 auth/uamtk 未通过: "
                f"result_code={uamtk_code}, message={self._extract_error_message(uamtk_resp)}"
            )
        tk = uamtk_resp.get("newapptk") or uamtk_resp.get("apptk")
        if not tk:
            raise RuntimeError(f"auth/uamtk 返回中缺少 tk: {uamtk_resp}")

        uamauth_resp = self._request(
            "POST",
            "/otn/uamauthclient",
            data={"tk": tk},
            referer="/otn/passport?redirect=/otn/login/userLogin",
        )
        assert_ok(uamauth_resp, "result_code")
        login_status = self.check_login_status()
        out.update(
            {
                "step": "logged_in",
                "uamtk": uamtk_resp,
                "uamauthclient": uamauth_resp,
                "login_status": login_status,
            }
        )
        if not login_status.get("logged_in"):
            out["warning"] = "uamauthclient 已返回成功，但 conf/initMy12306Api 尚未确认登录态。"
        return out

    def login(
        self,
        *,
        username: str,
        password: str,
        id_last4: str | None = None,
        sms_code: str | None = None,
        send_sms: bool = False,
    ) -> dict[str, Any]:
        verify = self.check_login_verify(username)
        if str(verify.get("result_code")) != "0":
            raise RuntimeError(f"checkLoginVerify 失败: {verify}")

        login_check_code = str(verify.get("login_check_code", ""))
        if login_check_code == "3" and send_sms:
            if not id_last4:
                raise RuntimeError("当前账号需要短信验证，请提供 --id-last4")
            sms_resp = self.send_sms_code(username, id_last4)
            if str(sms_resp.get("result_code")) != "0":
                if str(sms_resp.get("result_code")) == "11":
                    raise RuntimeError(
                        "发送短信验证码失败(result_code=11)：用户名与证件后4位不匹配。"
                        "请优先使用12306“登录用户名”（不要用手机号/邮箱别名），"
                        "并确认 --id-last4 是该账号绑定证件号后4位。"
                    )
                raise RuntimeError(f"发送短信验证码失败: {sms_resp}")
            return {
                "step": "sms_sent",
                "message": sms_resp.get("result_message") or "短信验证码已发送，请使用 --sms-code 重试登录。",
                "checkLoginVerify": verify,
                "getMessageCode": sms_resp,
            }
        if send_sms and login_check_code != "3":
            raise RuntimeError(
                f"当前账号登录校验类型为 {login_check_code}，不需要短信验证码发送。"
            )

        if login_check_code == "3":
            if not sms_code:
                raise RuntimeError("当前账号需要短信验证码，请传入 --sms-code（6位）")
            if not re.fullmatch(r"\d{6}", sms_code):
                raise RuntimeError("--sms-code 必须是6位数字")

        if login_check_code in {"1", "2"}:
            raise RuntimeError(
                f"当前账号登录校验类型为 {login_check_code}（滑块或图片验证码），"
                "此脚本暂不自动处理该校验。"
            )

        form_data = {
            "sessionId": "",
            "sig": "",
            "if_check_slide_passcode_token": "",
            "scene": "",
            "checkMode": "0" if login_check_code == "3" else "",
            "randCode": sms_code or "",
            "username": username,
            "password": encrypt_12306_password(password),
            "appid": "otn",
        }
        login_resp = self._request(
            "POST",
            "/passport/web/login",
            data=form_data,
            referer="/otn/resources/login.html",
        )
        assert_ok(login_resp, "result_code")

        uamtk_resp = self._request(
            "POST",
            "/passport/web/auth/uamtk",
            data={"appid": "otn"},
            referer="/otn/passport?redirect=/otn/login/userLogin",
        )
        assert_ok(uamtk_resp, "result_code")
        tk = uamtk_resp.get("newapptk") or uamtk_resp.get("apptk")
        if not tk:
            raise RuntimeError(f"auth/uamtk 返回中缺少 tk: {uamtk_resp}")

        uamauth_resp = self._request(
            "POST",
            "/otn/uamauthclient",
            data={"tk": tk},
            referer="/otn/passport?redirect=/otn/login/userLogin",
        )
        assert_ok(uamauth_resp, "result_code")
        self._save_cookies()

        return {
            "step": "logged_in",
            "checkLoginVerify": verify,
            "login": login_resp,
            "uamtk": uamtk_resp,
            "uamauthclient": uamauth_resp,
        }

    def query_my_order_no_complete(self) -> dict[str, Any]:
        return self._request(
            "POST",
            "/otn/queryOrder/queryMyOrderNoComplete",
            data={"_json_att": ""},
            referer="/otn/view/train_order.html",
        )

    def continue_pay_common_order(self, *, sequence_no: str, arrive_time_str: str) -> dict[str, Any]:
        return self._request(
            "POST",
            "/otn/queryOrder/continuePayNoCompleteMyOrder",
            data={
                "sequence_no": sequence_no,
                "pay_flag": "pay",
                "arrive_time_str": arrive_time_str,
            },
            referer="/otn/view/train_order.html",
        )

    def query_my_order(
        self,
        *,
        query_where: str = "G",
        start_date: str | None = None,
        end_date: str | None = None,
        page_index: int = 0,
        page_size: int = 8,
        query_type: int = 1,
        train_name: str = "",
    ) -> dict[str, Any]:
        today = dt.date.today()
        if end_date is None:
            end = today - dt.timedelta(days=1) if query_where == "H" else today
        else:
            end = dt.date.fromisoformat(end_date)
        if query_where == "H" and end >= today:
            raise ValueError("--where H 时，--end-date 必须早于今天（最大为昨天）")
        start = end - dt.timedelta(days=30) if start_date is None else dt.date.fromisoformat(start_date)
        if start > end:
            raise ValueError("--start-date 不能晚于 --end-date")
        data = {
            "come_from_flag": "my_order",
            "pageIndex": str(page_index),
            "pageSize": str(page_size),
            "query_where": query_where,
            "queryStartDate": start.isoformat(),
            "queryEndDate": end.isoformat(),
            "queryType": str(query_type),
            "sequeue_train_name": train_name,
        }
        return self._request(
            "POST",
            "/otn/queryOrder/queryMyOrder",
            data=data,
            referer="/otn/view/train_order.html",
        )

    def query_candidate_queue(self) -> dict[str, Any]:
        self.session.get(self._url("/otn/view/lineUp_order.html"), timeout=self.timeout)
        data = self._request(
            "POST",
            "/otn/afterNateOrder/queryQueue",
            data={},
            referer="/otn/view/lineUp_order.html",
        )
        self._assert_request_ok(data, context="查询候补排队状态")
        payload = data.get("data")
        if not isinstance(payload, dict):
            raise RuntimeError(f"候补排队返回结构异常: {data}")
        return {
            "queue": {
                "flag": payload.get("flag"),
                "status": payload.get("status"),
                "is_async": payload.get("isAsync"),
            },
            "raw": data,
        }

    def query_candidate_orders(
        self,
        *,
        processed: bool = False,
        page_no: int = 0,
        start_date: str | None = None,
        end_date: str | None = None,
    ) -> dict[str, Any]:
        start = dt.date.today() if start_date is None else dt.date.fromisoformat(start_date)
        end = start + dt.timedelta(days=29) if end_date is None else dt.date.fromisoformat(end_date)
        if start > end:
            raise ValueError("--start-date 不能晚于 --end-date")
        path = (
            "/otn/afterNateOrder/queryProcessedHOrder"
            if processed
            else "/otn/afterNateOrder/queryUnHonourHOrder"
        )

        self.session.get(self._url("/otn/view/lineUp_order.html"), timeout=self.timeout)
        data = self._request(
            "POST",
            path,
            data={
                "page_no": str(max(0, page_no)),
                "query_start_date": start.isoformat(),
                "query_end_date": end.isoformat(),
            },
            referer="/otn/view/lineUp_order.html",
        )
        self._assert_request_ok(data, context="查询候补订单")
        payload = data.get("data")
        rows = payload.get("list") if isinstance(payload, dict) else None
        if not isinstance(rows, list):
            raise RuntimeError(f"候补订单返回结构异常: {data}")

        parsed: list[dict[str, Any]] = []
        for item in rows:
            if not isinstance(item, dict):
                continue
            needs = item.get("needs")
            need = needs[0] if isinstance(needs, list) and needs and isinstance(needs[0], dict) else {}
            passengers = item.get("passengers")
            passenger_names: list[str] = []
            if isinstance(passengers, list):
                for p in passengers:
                    if isinstance(p, dict) and p.get("passenger_name"):
                        passenger_names.append(str(p.get("passenger_name")))
            parsed.append(
                {
                    "reserve_no": item.get("reserve_no"),
                    "sequence_no": item.get("sequence_no"),
                    "status_name": item.get("status_name"),
                    "status_code": item.get("status_code"),
                    "reserve_time": item.get("reserve_time"),
                    "realize_limit_time": item.get("realize_limit_time"),
                    "prepay_amount": item.get("prepay_amount"),
                    "ticket_price": item.get("ticket_price"),
                    "refundable": item.get("refundable"),
                    "train_code": need.get("board_train_code"),
                    "train_date": need.get("train_date"),
                    "from_station": need.get("from_station_name"),
                    "to_station": need.get("to_station_name"),
                    "start_time": need.get("start_time"),
                    "arrive_time": need.get("arrive_time"),
                    "seat_name": need.get("seat_name"),
                    "passengers": passenger_names,
                }
            )
        return {
            "query": {
                "type": "processed" if processed else "unhonour",
                "page_no": str(max(0, page_no)),
                "start_date": start.isoformat(),
                "end_date": end.isoformat(),
            },
            "rows": parsed,
            "raw": data,
        }

    @staticmethod
    def _extract_error_message(resp: dict[str, Any]) -> str:
        if not isinstance(resp, dict):
            return str(resp)
        data = resp.get("data") if isinstance(resp.get("data"), dict) else {}
        for key in ("msg", "errMsg", "message", "result_message"):
            value = data.get(key)
            if value:
                return str(value)
        messages = resp.get("messages")
        if isinstance(messages, list) and messages:
            return str(messages[0])
        result_message = resp.get("result_message")
        if result_message:
            return str(result_message)
        return str(resp)

    @staticmethod
    def _is_request_ok(resp: Any, *, require_status: bool = True) -> bool:
        if not isinstance(resp, dict):
            return False
        if str(resp.get("httpstatus", "200")) != "200":
            return False
        if require_status and resp.get("status") is False:
            return False
        return True

    @classmethod
    def _assert_request_ok(
        cls,
        resp: dict[str, Any],
        *,
        context: str,
        require_status: bool = True,
    ) -> None:
        if not cls._is_request_ok(resp, require_status=require_status):
            raise RuntimeError(f"{context} 失败: {resp}")

    @staticmethod
    def _assert_submit_status(resp: dict[str, Any], *, context: str) -> None:
        data = resp.get("data") if isinstance(resp, dict) else None
        if isinstance(data, dict) and data.get("submitStatus") is False:
            raise RuntimeError(f"{context} 未通过: {resp}")

    def _ensure_check_user(self) -> dict[str, Any]:
        check_user_resp = self.check_user()
        check_user_data = check_user_resp.get("data") if isinstance(check_user_resp, dict) else None
        if (
            not self._is_request_ok(check_user_resp, require_status=True)
            or (isinstance(check_user_data, dict) and check_user_data.get("flag") is False)
        ):
            raise RuntimeError(f"checkUser 失败: {check_user_resp}")
        return check_user_resp

    def submit_candidate_order(
        self,
        *,
        train_date: str,
        from_station: str,
        to_station: str,
        train_code: str,
        seat: str,
        passenger_names: list[str] | None = None,
        purpose_codes: str = "ADULT",
        endpoint: str = "queryG",
        force: bool = False,
        max_wait_seconds: int = 30,
        poll_interval: float = 1.0,
    ) -> dict[str, Any]:
        seat_code = self.resolve_seat_code(seat)
        seat_cfg = CANDIDATE_SEAT_CONFIG.get(seat_code)
        if seat_cfg is None:
            supported = ", ".join(sorted(CANDIDATE_SEAT_CONFIG.keys()))
            raise RuntimeError(
                f"席别 {seat}({seat_code}) 暂不支持候补提交。"
                f"当前支持席别代码: {supported}"
            )

        left_ticket = self.query_left_ticket(
            train_date=train_date,
            from_station=from_station,
            to_station=to_station,
            purpose_codes=purpose_codes,
            endpoint=endpoint,
        )
        train_row = self._find_train_row(left_ticket.get("rows", []), train_code)
        seat_value = str(train_row.get(seat_cfg["row_field"], "--") or "--").strip() or "--"
        if seat_value != "无" and not force:
            raise RuntimeError(
                f"当前车次 {train_code} 的 {seat_cfg['label']} 余票为 {seat_value}，"
                "默认仅在余票为“无”时提交候补。若需强制尝试可加 --force。"
            )
        if str(train_row.get("houbu_train_flag") or "").strip() != "1":
            raise RuntimeError(
                f"车次 {train_code} 当前不支持该席别候补（houbu_train_flag={train_row.get('houbu_train_flag')}）。"
            )
        secret_str = str(train_row.get("secret_str") or "").strip()
        if not secret_str:
            raise RuntimeError("余票数据中缺少 secret_str，无法提交候补。")

        check_user_resp = self._ensure_check_user()

        secret_list = f"{secret_str}#{seat_cfg['hb_seat_code']}|"
        submit = self._request(
            "POST",
            "/otn/afterNate/submitOrderRequest",
            data={"secretList": secret_list},
            referer="/otn/leftTicket/init",
        )

        data = submit.get("data") if isinstance(submit, dict) else None
        if isinstance(data, dict) and data.get("flag"):
            passenger_init = self._request(
                "POST",
                "/otn/afterNate/passengerInitApi",
                data={"_json_att": ""},
                referer="/otn/view/lineUp_toPay.html",
            )
            self._assert_request_ok(passenger_init, context="候补 passengerInitApi")
            passenger_init_data = passenger_init.get("data") if isinstance(passenger_init, dict) else None
            if not isinstance(passenger_init_data, dict):
                raise RuntimeError(f"候补 passengerInitApi 返回结构异常: {passenger_init}")

            if str(passenger_init_data.get("if_check_slide_passcode") or "").strip() == "1":
                return {
                    "step": "slide_check_required",
                    "submission_stage": "submitOrderRequest_only",
                    "train": train_row,
                    "seat_code": seat_code,
                    "seat_name": seat_cfg["label"],
                    "seat_status": seat_value,
                    "secret_list": secret_list,
                    "checkUser": check_user_resp,
                    "submitOrderRequest": submit,
                    "passengerInitApi": passenger_init,
                    "message": "候补提交需要滑块验证，CLI 暂不支持自动处理。",
                }

            passenger_resp = self.query_passengers()
            passenger_rows = passenger_resp.get("passengers") if isinstance(passenger_resp, dict) else None
            if not isinstance(passenger_rows, list) or not passenger_rows:
                raise RuntimeError(f"获取候补乘车人失败: {passenger_resp}")
            requested_names = [x.strip() for x in (passenger_names or []) if x and x.strip()]
            auto_selected_passengers = False
            if requested_names:
                selected_passengers = self._select_passengers(
                    {"data": {"normal_passengers": passenger_rows}},
                    requested_names,
                )
            else:
                selected_passengers = [passenger_rows[0]]
                auto_selected_passengers = True

            sleeper_seat_codes = {"3", "4", "6", "A", "F", "I", "J"}
            sleeper_selected = 1 if seat_cfg["hb_seat_code"] in sleeper_seat_codes else 0
            passenger_info_chunks: list[str] = []
            selected_passenger_names: list[str] = []
            for p in selected_passengers:
                p_type = str(p.get("passenger_type") or "1")
                p_name = str(p.get("passenger_name") or "").strip()
                p_id_type = str(p.get("passenger_id_type_code") or "")
                p_id_no = str(p.get("passenger_id_no") or "")
                p_all_enc = str(p.get("allEncStr") or "").strip()
                if not p_name or not p_id_type or not p_id_no or not p_all_enc:
                    raise RuntimeError(f"乘车人信息不完整，无法提交候补: {p}")
                selected_passenger_names.append(p_name)
                # 与 12306 页面一致：<票种>#<姓名>#<证件类型>#<证件号>#<allEncStr>#<是否优先下铺>
                passenger_info_chunks.append(
                    f"{p_type}#{p_name}#{p_id_type}#{p_id_no}#{p_all_enc}#{sleeper_selected}"
                )
            passenger_info = ",".join(passenger_info_chunks) + ","

            hb_train_list = passenger_init_data.get("hbTrainList")
            if not isinstance(hb_train_list, list) or not hb_train_list:
                raise RuntimeError(f"候补 passengerInitApi 缺少 hbTrainList: {passenger_init}")
            preferred_date = train_date.replace("-", "")
            filtered_hb_items: list[dict[str, Any]] = []
            for item in hb_train_list:
                if not isinstance(item, dict):
                    continue
                same_code = str(item.get("station_train_code") or "").strip().upper() == train_code.upper()
                same_seat = str(item.get("seat_type_code") or "").strip().upper() == seat_cfg["hb_seat_code"]
                item_date = str(item.get("train_date") or "").replace("-", "").strip()
                same_date = item_date == preferred_date if item_date else True
                if same_code and same_seat and same_date:
                    filtered_hb_items.append(item)
            if not filtered_hb_items:
                filtered_hb_items = [x for x in hb_train_list if isinstance(x, dict)]
            hb_train_parts = [str(x.get("train_no") or "").strip() for x in filtered_hb_items]
            hb_train_parts = [x for x in hb_train_parts if x]
            if not hb_train_parts:
                raise RuntimeError(f"候补 passengerInitApi 中缺少可用 train_no: {passenger_init}")
            hb_train = "".join([f"{x}#" for x in hb_train_parts])

            line_up_options = passenger_init_data.get("jzdhDiffSelect")
            realize_limit_time_diff = "360"
            if isinstance(line_up_options, list) and line_up_options:
                realize_limit_time_diff = str(line_up_options[0])
                if "360" in {str(v) for v in line_up_options}:
                    realize_limit_time_diff = "360"

            confirm_hb = self._request(
                "POST",
                "/otn/afterNate/confirmHB",
                data={
                    "passengerInfo": passenger_info,
                    "jzParam": "",
                    "hbTrain": hb_train,
                    "lkParam": "",
                    "sessionId": "",
                    "sig": "",
                    "scene": "",
                    "encryptedData": "",
                    "if_receive_wseat": "N",
                    "realize_limit_time_diff": realize_limit_time_diff,
                    "plans": "",
                    "tmp_train_date": "",
                    "tmp_train_time": "",
                    "add_train_flag": "N",
                    "add_train_seat_type_code": "",
                    "_json_att": "",
                },
                referer="/otn/view/lineUp_toPay.html",
            )
            self._assert_request_ok(confirm_hb, context="候补 confirmHB", require_status=False)
            confirm_hb_data = confirm_hb.get("data") if isinstance(confirm_hb, dict) else None
            if isinstance(confirm_hb_data, dict) and confirm_hb_data.get("msg"):
                raise RuntimeError(f"候补确认失败: {confirm_hb_data.get('msg')}")

            wait_start = time.monotonic()
            last_queue_resp: dict[str, Any] | None = None
            while True:
                queue_resp = self._request(
                    "POST",
                    "/otn/afterNate/queryQueue",
                    data={"_json_att": ""},
                    referer="/otn/view/lineUp_toPay.html",
                )
                self._assert_request_ok(queue_resp, context="候补排队查询", require_status=False)
                last_queue_resp = queue_resp
                queue_data = queue_resp.get("data") if isinstance(queue_resp, dict) else None
                if not isinstance(queue_data, dict):
                    raise RuntimeError(f"候补排队返回结构异常: {queue_resp}")

                if queue_data.get("isAsync"):
                    if not queue_data.get("flag"):
                        raise RuntimeError(
                            f"候补排队失败: {queue_data.get('msg') or self._extract_error_message(queue_resp)}"
                        )
                    status_code = str(queue_data.get("status") or "")
                    if status_code == "1":
                        break
                    if status_code == "-1":
                        raise RuntimeError(f"候补排队失败: {queue_data.get('msg') or 'status=-1'}")
                else:
                    if queue_data.get("flag"):
                        break
                    raise RuntimeError(f"候补排队失败: {queue_data.get('msg') or self._extract_error_message(queue_resp)}")

                if time.monotonic() - wait_start > max_wait_seconds:
                    return {
                        "step": "queue_waiting",
                        "submission_stage": "confirmHB",
                        "train": train_row,
                        "seat_code": seat_code,
                        "seat_name": seat_cfg["label"],
                        "seat_status": seat_value,
                        "selected_passengers": selected_passenger_names,
                        "auto_selected_passengers": auto_selected_passengers,
                        "realize_limit_time_diff": realize_limit_time_diff,
                        "checkUser": check_user_resp,
                        "submitOrderRequest": submit,
                        "passengerInitApi": passenger_init,
                        "confirmHB": confirm_hb,
                        "queryQueue": last_queue_resp,
                        "next_url": self._url("/otn/view/lineUp_order.html"),
                    }
                time.sleep(max(0.3, poll_interval))

            reserve_no: str | None = None
            try:
                orders = self.query_candidate_orders(processed=False, page_no=0)
                rows = orders.get("rows") if isinstance(orders, dict) else None
                if isinstance(rows, list):
                    for row in rows:
                        if not isinstance(row, dict):
                            continue
                        row_train = str(row.get("train_code") or "").strip().upper()
                        row_date = str(row.get("train_date") or "").replace("-", "").strip()
                        if row_train == train_code.upper() and (not row_date or row_date == preferred_date):
                            reserve_no = str(row.get("reserve_no") or "").strip() or None
                            break
            except Exception:
                reserve_no = None

            return {
                "step": "queued",
                "submission_stage": "confirmHB",
                "train": train_row,
                "seat_code": seat_code,
                "seat_name": seat_cfg["label"],
                "seat_status": seat_value,
                "secret_list": secret_list,
                "selected_passengers": selected_passenger_names,
                "auto_selected_passengers": auto_selected_passengers,
                "realize_limit_time_diff": realize_limit_time_diff,
                "reserve_no": reserve_no,
                "checkUser": check_user_resp,
                "submitOrderRequest": submit,
                "passengerInitApi": passenger_init,
                "confirmHB": confirm_hb,
                "queryQueue": last_queue_resp,
                "next_url": self._url("/otn/view/lineUp_order.html"),
            }

        if isinstance(data, dict) and data.get("faceCheck"):
            return {
                "step": "face_check_required",
                "train": train_row,
                "seat_code": seat_code,
                "seat_name": seat_cfg["label"],
                "seat_status": seat_value,
                "secret_list": secret_list,
                "checkUser": check_user_resp,
                "submitOrderRequest": submit,
                "face_check_code": data.get("faceCheck"),
                "is_show_qrcode": data.get("is_show_qrcode"),
            }

        raise RuntimeError(f"提交候补失败: {self._extract_error_message(submit)}")

    def cancel_candidate_order(self, *, reserve_no: str) -> dict[str, Any]:
        reserve_no = reserve_no.strip()
        if not reserve_no:
            raise ValueError("--reserve-no 不能为空")

        self.session.get(self._url("/otn/view/lineUp_order.html"), timeout=self.timeout)
        check_resp = self._request(
            "POST",
            "/otn/afterNateOrder/reserveReturnCheck",
            data={"sequence_no": reserve_no},
            referer="/otn/view/lineUp_order.html",
        )
        check_data = check_resp.get("data") if isinstance(check_resp, dict) else None
        can_reserve_return = isinstance(check_data, dict) and bool(check_data.get("flag"))
        out: dict[str, Any] = {
            "reserve_no": reserve_no,
            "reserveReturnCheck": check_resp,
        }

        if can_reserve_return:
            reserve_return_resp = self._request(
                "POST",
                "/otn/afterNateOrder/reserveReturn",
                data={"sequence_no": reserve_no},
                referer="/otn/view/lineUp_order.html",
            )
            out["reserveReturn"] = reserve_return_resp
            reserve_return_data = (
                reserve_return_resp.get("data") if isinstance(reserve_return_resp, dict) else None
            )
            if isinstance(reserve_return_data, dict) and reserve_return_data.get("flag"):
                out["step"] = "cancelled"
                out["method"] = "reserveReturn"
                return out

        cancel_not_complete_resp = self._request(
            "POST",
            "/otn/afterNateOrder/cancelNotComplete",
            data={"reserve_no": reserve_no},
            referer="/otn/view/lineUp_payConfirm.html",
        )
        out["cancelNotComplete"] = cancel_not_complete_resp
        cancel_not_complete_data = (
            cancel_not_complete_resp.get("data") if isinstance(cancel_not_complete_resp, dict) else None
        )
        if isinstance(cancel_not_complete_data, dict) and cancel_not_complete_data.get("flag"):
            out["step"] = "cancelled"
            out["method"] = "cancelNotComplete"
            return out

        raise RuntimeError(
            "取消候补订单失败: "
            f"{self._extract_error_message(cancel_not_complete_resp)}"
        )

    def continue_pay_candidate_order(self, *, reserve_no: str) -> str:
        reserve_no = reserve_no.strip()
        if not reserve_no:
            raise ValueError("--reserve-no 不能为空")
        return self._request_text(
            "POST",
            "/otn/afterNateOrder/continuePayNoCompleteMyOrder",
            data={"reserve_no": reserve_no},
            referer="/otn/view/lineUp_order.html",
        )

    def init_candidate_pay_order(self) -> dict[str, Any]:
        return self._request(
            "POST",
            "/otn/afterNatePay/payOrderInit",
            data={"_json_att": ""},
            referer="/otn/view/lineUp_payConfirm.html",
        )

    def candidate_pay_check(self) -> dict[str, Any]:
        return self._request(
            "POST",
            "/otn/afterNatePay/paycheck",
            data={"_json_att": ""},
            referer="/otn/view/lineUp_payConfirm.html",
        )

    @staticmethod
    def _extract_html_form(html: str, *, form_name: str = "myform") -> tuple[str, dict[str, str]]:
        form_tag_re = re.compile(r"<form\b[^>]*>", re.I)
        attr_re = re.compile(r'([A-Za-z_:][\w:.-]*)\s*=\s*["\']([^"\']*)["\']')
        matched_tag = None
        for form_match in form_tag_re.finditer(html):
            form_tag = form_match.group(0)
            attrs = {k.lower(): v for k, v in attr_re.findall(form_tag)}
            if attrs.get("name") == form_name:
                matched_tag = form_tag
                break
        if not matched_tag:
            for form_match in form_tag_re.finditer(html):
                form_tag = form_match.group(0)
                attrs = {k.lower(): v for k, v in attr_re.findall(form_tag)}
                if attrs.get("id") == form_name:
                    matched_tag = form_tag
                    break
        if not matched_tag:
            raise RuntimeError(f"未在支付页面中找到表单 {form_name}。")
        form_attrs = {k.lower(): v for k, v in attr_re.findall(matched_tag)}
        action = str(form_attrs.get("action") or "").strip()
        if not action:
            raise RuntimeError(f"支付表单 {form_name} 缺少 action。")

        inputs: dict[str, str] = {}
        for input_match in re.finditer(r"<input\b[^>]*>", html, re.I):
            input_tag = input_match.group(0)
            input_attrs = {k.lower(): v for k, v in attr_re.findall(input_tag)}
            key = str(input_attrs.get("name") or "").strip()
            value = str(input_attrs.get("value") or "")
            if key:
                inputs[key] = value
        return action, inputs

    @staticmethod
    def _extract_first_html_form(html: str) -> tuple[str, str, dict[str, str]] | None:
        form_tag_re = re.compile(r"<form\b[^>]*>", re.I)
        attr_re = re.compile(r'([A-Za-z_:][\w:.-]*)\s*=\s*["\']([^"\']*)["\']')
        matched = form_tag_re.search(html)
        if not matched:
            return None
        form_tag = matched.group(0)
        form_attrs = {k.lower(): v for k, v in attr_re.findall(form_tag)}
        action = str(form_attrs.get("action") or "").strip()
        method = str(form_attrs.get("method") or "post").strip().lower() or "post"
        if not action:
            return None
        inputs: dict[str, str] = {}
        for input_match in re.finditer(r"<input\b[^>]*>", html, re.I):
            input_tag = input_match.group(0)
            input_attrs = {k.lower(): v for k, v in attr_re.findall(input_tag)}
            key = str(input_attrs.get("name") or "").strip()
            value = str(input_attrs.get("value") or "")
            if key:
                inputs[key] = value
        return action, method, inputs

    def resolve_epay_channel_url(
        self,
        *,
        gateway_post_url: str,
        gateway_post_data: dict[str, str],
        bank_id: str,
        business_type: str = "1",
    ) -> dict[str, Any]:
        sess = requests.Session()
        sess.headers.update({"User-Agent": USER_AGENT})

        gateway_resp = sess.post(
            gateway_post_url,
            data=gateway_post_data,
            timeout=self.timeout,
        )
        gateway_resp.raise_for_status()
        html = gateway_resp.text
        action, form_data = self._extract_html_form(html, form_name="myform")
        if not action:
            raise RuntimeError("支付页面未返回可提交的 form action。")

        submit_url = urljoin(str(gateway_resp.url), action)
        submit_payload = dict(form_data)
        submit_payload["bankId"] = bank_id
        submit_payload["businessType"] = business_type

        channel_resp = sess.post(
            submit_url,
            data=submit_payload,
            timeout=self.timeout,
            allow_redirects=False,
        )
        parsed_steps: list[dict[str, Any]] = []

        def _extract_redirect_url(resp: requests.Response) -> str | None:
            location = str(resp.headers.get("Location") or "").strip()
            if location:
                return urljoin(str(resp.url), location)
            body = resp.text or ""
            redirect_patterns = [
                r'location\.href\s*=\s*["\']([^"\']+)["\']',
                r'window\.location\.href\s*=\s*["\']([^"\']+)["\']',
                r'window\.location\s*=\s*["\']([^"\']+)["\']',
                r'location\.replace\(\s*["\']([^"\']+)["\']\s*\)',
                r'top\.location\.href\s*=\s*["\']([^"\']+)["\']',
                r'parent\.location\.href\s*=\s*["\']([^"\']+)["\']',
            ]
            for pattern in redirect_patterns:
                matched = re.search(pattern, body, re.I)
                if matched:
                    return urljoin(str(resp.url), matched.group(1))

            meta_refresh = re.search(
                r'<meta[^>]+http-equiv=["\']refresh["\'][^>]+content=["\'][^"\']*url=([^"\']+)',
                body,
                re.I,
            )
            if meta_refresh:
                return urljoin(str(resp.url), meta_refresh.group(1).strip())
            return None

        current_resp = channel_resp
        for _ in range(3):
            parsed_steps.append({"url": current_resp.url, "status": current_resp.status_code})
            redirect_url = _extract_redirect_url(current_resp)
            if redirect_url:
                return {
                    "channel_submit_url": submit_url,
                    "channel_submit_status": channel_resp.status_code,
                    "channel_redirect_url_raw": redirect_url,
                    "channel_redirect_url": redirect_url,
                    "channel_redirect_chain": [],
                    "resolve_steps": parsed_steps,
                }

            form_info = self._extract_first_html_form(current_resp.text or "")
            if not form_info:
                break
            next_action, next_method, next_data = form_info
            next_url = urljoin(str(current_resp.url), next_action)
            if next_method == "get":
                query = urlencode(next_data)
                final_url = next_url if not query else f"{next_url}?{query}"
                return {
                    "channel_submit_url": submit_url,
                    "channel_submit_status": channel_resp.status_code,
                    "channel_redirect_url_raw": final_url,
                    "channel_redirect_url": final_url,
                    "channel_redirect_chain": [],
                    "resolve_steps": parsed_steps,
                }
            current_resp = sess.post(
                next_url,
                data=next_data,
                timeout=self.timeout,
                allow_redirects=False,
            )

        raise RuntimeError("未解析到第三方支付跳转链接（Location/JS/meta/form）。")

    @staticmethod
    def candidate_pay_channel_to_bank_id(channel: str) -> str:
        normalized = channel.strip().lower()
        mapping = {
            "alipay": "33000010",
            "wechat": "33000020",
            "wx": "33000020",
            "unionpay": "00011000",
        }
        bank_id = mapping.get(normalized)
        if not bank_id:
            raise ValueError("不支持的支付渠道，可选值: alipay / wechat / unionpay")
        return bank_id

    def _load_station_index(self) -> dict[str, str]:
        if self._station_index is not None:
            return self._station_index
        now = int(time.time())
        cached_index: dict[str, str] | None = None
        cached_fetched_at = 0
        try:
            if self._station_cache_file.exists():
                payload = json.loads(self._station_cache_file.read_text(encoding="utf-8"))
                if isinstance(payload, dict):
                    fetched_at_raw = payload.get("fetched_at")
                    if isinstance(fetched_at_raw, (int, float, str)):
                        try:
                            cached_fetched_at = int(float(fetched_at_raw))
                        except Exception:
                            cached_fetched_at = 0
                    raw_index = payload.get("index")
                    if isinstance(raw_index, dict):
                        parsed_cache = {str(k): str(v) for k, v in raw_index.items() if str(k).strip()}
                        if parsed_cache:
                            cached_index = parsed_cache
        except Exception:
            cached_index = None
            cached_fetched_at = 0

        if (
            cached_index
            and cached_fetched_at > 0
            and now - cached_fetched_at <= self._station_cache_ttl_seconds
        ):
            self._station_index = cached_index
            return cached_index

        try:
            url = self._url("/otn/resources/js/framework/station_name.js")
            text = self.session.get(url, timeout=self.timeout).text
            match = re.search(r"var\s+station_names\s*=\s*'([^']+)'", text)
            if not match:
                raise RuntimeError("解析 station_name.js 失败")
            raw = match.group(1).strip("@")

            index: dict[str, str] = {}
            for row in raw.split("@"):
                parts = row.split("|")
                if len(parts) < 3:
                    continue
                station_name = parts[1]
                telecode = parts[2].upper()
                pinyin = parts[3] if len(parts) > 3 else ""
                short = parts[4] if len(parts) > 4 else ""
                index[station_name] = telecode
                index[station_name.lower()] = telecode
                if pinyin:
                    index[pinyin.lower()] = telecode
                if short:
                    index[short.lower()] = telecode
                index[telecode] = telecode
                index[telecode.lower()] = telecode
            self._station_index = index
            try:
                self._station_cache_file.parent.mkdir(parents=True, exist_ok=True)
                payload = {"fetched_at": now, "index": index}
                self._station_cache_file.write_text(
                    json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                    encoding="utf-8",
                )
            except Exception:
                pass
            return index
        except Exception:
            if cached_index:
                self._station_index = cached_index
                return cached_index
            raise

    def station_to_code(self, station: str) -> str:
        if re.fullmatch(r"[A-Za-z]{3}", station.strip()):
            return station.strip().upper()
        index = self._load_station_index()
        key = station.strip()
        if key in index:
            return index[key]
        lower = key.lower()
        if lower in index:
            return index[lower]
        raise RuntimeError(f"未知车站: {station}")

    @staticmethod
    def _seat(fields: list[str], idx: int) -> str:
        if idx < len(fields) and fields[idx]:
            return fields[idx]
        return "--"

    def query_left_ticket(
        self,
        *,
        train_date: str,
        from_station: str,
        to_station: str,
        purpose_codes: str = "ADULT",
        endpoint: str = "queryG",
    ) -> dict[str, Any]:
        dt.date.fromisoformat(train_date)
        from_code = self.station_to_code(from_station)
        to_code = self.station_to_code(to_station)
        # Warm up left-ticket cookies/session before querying API.
        self.session.get(self._url("/otn/leftTicket/init"), timeout=self.timeout)
        data = self._request(
            "GET",
            f"/otn/leftTicket/{endpoint}",
            params={
                "leftTicketDTO.train_date": train_date,
                "leftTicketDTO.from_station": from_code,
                "leftTicketDTO.to_station": to_code,
                "purpose_codes": purpose_codes,
            },
            referer="/otn/leftTicket/init",
        )
        self._assert_request_ok(data, context="查询余票", require_status=False)
        payload = data.get("data", {})
        code_map = payload.get("map", {})
        rows = payload.get("result", [])
        parsed: list[dict[str, Any]] = []
        for row in rows:
            parts = row.split("|")
            if len(parts) < 33:
                continue
            item = {
                "secret_str": parts[0],
                "button_text_info": parts[1] if len(parts) > 1 else "",
                "train_no": parts[2],
                "train_code": parts[3],
                "from_station_code": parts[6],
                "to_station_code": parts[7],
                "from_station": code_map.get(parts[6], parts[6]),
                "to_station": code_map.get(parts[7], parts[7]),
                "start_time": parts[8],
                "arrive_time": parts[9],
                "duration": parts[10],
                "can_web_buy": parts[11],
                "yp_info": parts[12],
                "start_train_date": parts[13],
                "location_code": parts[15],
                "from_station_no": parts[16],
                "to_station_no": parts[17],
                "controlled_train_flag": parts[19] if len(parts) > 19 else "",
                "premium_first_class": self._seat(parts, 20),
                "deluxe_soft_sleeper": self._seat(parts, 21),
                "other": self._seat(parts, 22),
                "business": self._seat(parts, 32),
                "special_class": self._seat(parts, 25),
                "first_class": self._seat(parts, 31),
                "second_class": self._seat(parts, 30),
                "second_class_compartment": self._seat(parts, 27),
                "soft_sleeper": self._seat(parts, 23),
                "dynamic_sleeper": self._seat(parts, 33),
                "hard_sleeper": self._seat(parts, 28),
                "soft_seat": self._seat(parts, 24),
                "hard_seat": self._seat(parts, 29),
                "no_seat": self._seat(parts, 26),
                "yp_ex": parts[34] if len(parts) > 34 else "",
                "seat_types": parts[35] if len(parts) > 35 else "",
                "houbu_train_flag": parts[37] if len(parts) > 37 else "",
                "houbu_seat_limit": parts[38] if len(parts) > 38 else "",
                "yp_info_new": parts[39] if len(parts) > 39 else "",
            }
            price_data = self._parse_ticket_price_from_yp_info(
                str(item.get("yp_info_new") or item.get("yp_info") or "")
            )
            if price_data:
                item["ticket_price"] = price_data
                item["ticket_price_text"] = self._format_ticket_price(price_data)
            parsed.append(item)
        return {
            "query": {
                "date": train_date,
                "from_station": from_station,
                "to_station": to_station,
                "from_code": from_code,
                "to_code": to_code,
                "endpoint": endpoint,
                "purpose_codes": purpose_codes,
            },
            "rows": parsed,
            "raw": data,
        }

    @staticmethod
    def _format_ticket_price(price_data: dict[str, Any]) -> str:
        pairs: list[str] = []
        for key, value in price_data.items():
            if key in {"OT", "train_no"}:
                continue
            if key == "9" and "A9" in price_data:
                continue
            text = str(value or "").strip()
            if not text:
                continue
            if not text.startswith("¥") and re.fullmatch(r"\d+", text):
                text = f"¥{int(text) / 10:.1f}"
            label = PRICE_KEY_LABEL_MAP.get(key, key)
            pairs.append(f"{label}={text}")
        return ", ".join(pairs)

    @staticmethod
    def _parse_ticket_price_from_yp_info(yp_info: str) -> dict[str, str]:
        text = str(yp_info or "").strip()
        if not text:
            return {}
        seat_codes = sorted(
            [code for code in PRICE_KEY_LABEL_MAP if code != "OT"],
            key=len,
            reverse=True,
        )
        prices: dict[str, str] = {}
        idx = 0
        while idx < len(text):
            matched = False
            for seat_code in seat_codes:
                if not text.startswith(seat_code, idx):
                    continue
                seg_start = idx + len(seat_code)
                seg_end = seg_start + 9
                if seg_end > len(text):
                    continue
                seg = text[seg_start:seg_end]
                if not seg.isdigit():
                    continue
                amount_text = seg[:5]
                flag_text = seg[5:]
                normalized_code = "A9" if seat_code == "9" else seat_code
                amount = f"¥{int(amount_text) / 10:.1f}"
                if normalized_code not in prices:
                    prices[normalized_code] = amount
                if normalized_code == "W" and "WZ" not in prices:
                    prices["WZ"] = amount
                # 常见场景: O/1 的 3xxx 标记代表无座价格，补齐 WZ 便于统一展示。
                if flag_text.startswith("3") and normalized_code in {"O", "1"} and "WZ" not in prices:
                    prices["WZ"] = amount
                idx = seg_end
                matched = True
                break
            if not matched:
                idx += 1
        return prices

    @staticmethod
    def _extract_transfer_leg_seats(leg: dict[str, Any]) -> dict[str, str]:
        seats: dict[str, str] = {}
        for field, label in TRANSFER_SEAT_FIELD_LABELS:
            value = str(leg.get(field, "--") or "--").strip() or "--"
            if value == "--":
                continue
            seats[label] = value
        return seats

    @staticmethod
    def _format_transfer_leg_seats(seats: dict[str, str]) -> str:
        if not seats:
            return "--"
        return ", ".join(f"{label}={value}" for label, value in seats.items())

    def query_transfer_ticket(
        self,
        *,
        train_date: str,
        from_station: str,
        to_station: str,
        middle_station: str = "",
        result_index: int = 0,
        can_query: str = "Y",
        is_show_wz: str = "N",
        purpose_codes: str = "00",
        channel: str = "E",
        endpoint: str = "queryG",
    ) -> dict[str, Any]:
        dt.date.fromisoformat(train_date)
        can_query = can_query.strip().upper() or "Y"
        is_show_wz = is_show_wz.strip().upper() or "N"
        if can_query not in {"Y", "N"}:
            raise ValueError("--can-query 仅支持 Y/N")
        if is_show_wz not in {"Y", "N"}:
            raise ValueError("--show-wz 仅支持 Y/N")
        from_code = self.station_to_code(from_station)
        to_code = self.station_to_code(to_station)
        middle_raw = middle_station.strip()
        middle_code = self.station_to_code(middle_raw) if middle_raw else ""

        # Warm up lc-query cookies/session before querying API.
        self.session.get(self._url("/otn/lcQuery/init"), timeout=self.timeout)
        data = self._request(
            "GET",
            f"/lcquery/{endpoint}",
            params={
                "train_date": train_date,
                "from_station_telecode": from_code,
                "to_station_telecode": to_code,
                "middle_station": middle_code,
                "result_index": str(max(0, int(result_index))),
                "can_query": can_query,
                "isShowWZ": is_show_wz,
                "purpose_codes": purpose_codes,
                "channel": channel,
            },
            referer="/otn/lcQuery/init",
        )
        self._assert_request_ok(data, context="查询中转车票")
        payload = data.get("data")
        if not isinstance(payload, dict):
            raise RuntimeError(f"查询中转车票返回结构异常: {data}")

        rows = payload.get("middleList")
        parsed: list[dict[str, Any]] = []
        if isinstance(rows, list):
            for item in rows:
                if not isinstance(item, dict):
                    continue
                full = item.get("fullList")
                legs = [leg for leg in full if isinstance(leg, dict)] if isinstance(full, list) else []
                first_leg = legs[0] if len(legs) > 0 else {}
                second_leg = legs[1] if len(legs) > 1 else {}
                first_leg_seats = self._extract_transfer_leg_seats(first_leg)
                second_leg_seats = self._extract_transfer_leg_seats(second_leg)
                first_leg_price = self._parse_ticket_price_from_yp_info(str(first_leg.get("yp_info") or ""))
                second_leg_price = self._parse_ticket_price_from_yp_info(str(second_leg.get("yp_info") or ""))
                row_item = {
                    "from_station": item.get("from_station_name"),
                    "to_station": item.get("end_station_name"),
                    "start_time": item.get("start_time"),
                    "arrive_time": item.get("arrive_time"),
                    "total_duration": item.get("all_lishi"),
                    "total_duration_minutes": item.get("all_lishi_minutes"),
                    "wait_time": item.get("wait_time"),
                    "wait_time_minutes": item.get("wait_time_minutes"),
                    "middle_station": item.get("middle_station_name"),
                    "middle_station_code": item.get("middle_station_code"),
                    "same_train": item.get("same_train"),
                    "score": item.get("score"),
                    "score_str": item.get("score_str"),
                    "first_leg_train_code": first_leg.get("station_train_code"),
                    "first_leg_start_time": first_leg.get("start_time"),
                    "first_leg_arrive_time": first_leg.get("arrive_time"),
                    "first_leg_second_class": first_leg.get("ze_num", "--"),
                    "first_leg_first_class": first_leg.get("zy_num", "--"),
                    "first_leg_seats": first_leg_seats,
                    "first_leg_seat_text": self._format_transfer_leg_seats(first_leg_seats),
                    "first_leg_ticket_price": first_leg_price,
                    "first_leg_ticket_price_text": self._format_ticket_price(first_leg_price) if first_leg_price else "",
                    "second_leg_train_code": second_leg.get("station_train_code"),
                    "second_leg_start_time": second_leg.get("start_time"),
                    "second_leg_arrive_time": second_leg.get("arrive_time"),
                    "second_leg_second_class": second_leg.get("ze_num", "--"),
                    "second_leg_first_class": second_leg.get("zy_num", "--"),
                    "second_leg_seats": second_leg_seats,
                    "second_leg_seat_text": self._format_transfer_leg_seats(second_leg_seats),
                    "second_leg_ticket_price": second_leg_price,
                    "second_leg_ticket_price_text": self._format_ticket_price(second_leg_price) if second_leg_price else "",
                }
                parsed.append(row_item)

        return {
            "query": {
                "date": train_date,
                "from_station": from_station,
                "to_station": to_station,
                "middle_station": middle_station,
                "from_code": from_code,
                "to_code": to_code,
                "middle_code": middle_code,
                "endpoint": endpoint,
                "purpose_codes": purpose_codes,
                "can_query": can_query,
                "is_show_wz": is_show_wz,
                "channel": channel,
                "result_index": str(max(0, int(result_index))),
            },
            "meta": {
                "flag": payload.get("flag"),
                "result_index": payload.get("result_index"),
                "can_query": payload.get("can_query"),
                "middle_station_list": payload.get("middleStationList"),
            },
            "rows": parsed,
            "raw": data,
        }

    def query_route(
        self,
        *,
        train_no: str,
        train_date: str,
        from_station: str,
        to_station: str,
    ) -> dict[str, Any]:
        dt.date.fromisoformat(train_date)
        train_no = train_no.strip()
        if not train_no:
            raise ValueError("--train-no 不能为空")
        from_code = self.station_to_code(from_station)
        to_code = self.station_to_code(to_station)

        # Warm up lc-query cookies/session before querying API.
        self.session.get(self._url("/otn/lcQuery/init"), timeout=self.timeout)
        data = self._request(
            "GET",
            "/otn/czxx/queryByTrainNo",
            params={
                "train_no": train_no,
                "from_station_telecode": from_code,
                "to_station_telecode": to_code,
                "depart_date": train_date,
            },
            referer="/otn/lcQuery/init",
        )
        self._assert_request_ok(data, context="查询经停站")

        payload = data.get("data")
        rows = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(rows, list):
            raise RuntimeError(f"查询经停站返回结构异常: {data}")

        parsed: list[dict[str, Any]] = []
        for item in rows:
            if not isinstance(item, dict):
                continue
            parsed.append(
                {
                    "station_no": item.get("station_no"),
                    "station_name": item.get("station_name"),
                    "arrive_time": item.get("arrive_time"),
                    "start_time": item.get("start_time"),
                    "stopover_time": item.get("stopover_time"),
                    "is_enabled": bool(item.get("isEnabled")),
                    "station_train_code": item.get("station_train_code"),
                    "start_station_name": item.get("start_station_name"),
                    "end_station_name": item.get("end_station_name"),
                    "train_class_name": item.get("train_class_name"),
                }
            )
        return {
            "query": {
                "train_no": train_no,
                "date": train_date,
                "from_station": from_station,
                "to_station": to_station,
                "from_code": from_code,
                "to_code": to_code,
            },
            "rows": parsed,
            "raw": data,
        }

    def resolve_train_no_by_train_code(
        self,
        *,
        train_date: str,
        from_station: str,
        to_station: str,
        train_code: str,
        endpoint: str = "queryG",
        purpose_codes: str = "ADULT",
    ) -> dict[str, Any]:
        left_ticket = self.query_left_ticket(
            train_date=train_date,
            from_station=from_station,
            to_station=to_station,
            purpose_codes=purpose_codes,
            endpoint=endpoint,
        )
        train_row = self._find_train_row(left_ticket.get("rows", []), train_code)
        train_no = str(train_row.get("train_no", "")).strip()
        if not train_no:
            raise RuntimeError(f"车次 {train_code} 未返回 train_no，无法查询经停站。")
        return {"train_no": train_no, "train": train_row, "left_ticket": left_ticket}

    @staticmethod
    def _extract_with_patterns(text: str, patterns: list[str], field: str) -> str:
        for pattern in patterns:
            matched = re.search(pattern, text, re.S)
            if matched and matched.group(1):
                return matched.group(1)
        raise RuntimeError(f"initDc 页面缺少字段: {field}")

    @classmethod
    def resolve_seat_code(cls, seat: str) -> str:
        raw = seat.strip()
        if re.fullmatch(r"[A-Za-z0-9]{1,2}", raw):
            upper = raw.upper()
            if upper == "WZ":
                return "W"
            return upper
        candidates = [
            raw,
            raw.lower(),
            re.sub(r"\s+", "", raw),
            re.sub(r"\s+", "", raw).lower(),
            re.sub(r"[\s\-]+", "_", raw),
            re.sub(r"[\s\-]+", "_", raw).lower(),
        ]
        for key in candidates:
            if key in SEAT_CODE_MAP:
                return SEAT_CODE_MAP[key]
        supported = ", ".join(sorted(k for k in SEAT_CODE_MAP if k.isascii()))
        raise RuntimeError(
            f"不支持的席别: {seat}。可用示例: {supported}，或直接传席别代码(O/M/9/P/W/1/2/3/4/6/A/D/F/I/J/S/H)。"
        )

    @staticmethod
    def _format_train_date_for_12306(date_value: dt.date) -> str:
        week = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][date_value.weekday()]
        month = [
            "Jan",
            "Feb",
            "Mar",
            "Apr",
            "May",
            "Jun",
            "Jul",
            "Aug",
            "Sep",
            "Oct",
            "Nov",
            "Dec",
        ][date_value.month - 1]
        return f"{week} {month} {date_value.day:02d} {date_value.year} 00:00:00 GMT+0800 (中国标准时间)"

    @staticmethod
    def _find_train_row(rows: list[dict[str, Any]], train_code: str) -> dict[str, Any]:
        normalized = train_code.strip().upper()
        matches = [row for row in rows if str(row.get("train_code", "")).upper() == normalized]
        if not matches:
            sample = ", ".join(sorted({str(row.get("train_code", "")) for row in rows if row.get("train_code")})[:20])
            raise RuntimeError(f"未找到车次 {train_code}。可选车次示例: {sample or '无'}")
        buyable = [row for row in matches if str(row.get("can_web_buy", "")).upper() == "Y"]
        return buyable[0] if buyable else matches[0]

    def init_dc_context(self) -> dict[str, str]:
        html = self._request_text(
            "POST",
            "/otn/confirmPassenger/initDc",
            data={"_json_att": ""},
            referer="/otn/leftTicket/init",
        )
        token = self._extract_with_patterns(
            html,
            [
                r"globalRepeatSubmitToken\s*=\s*'([^']+)'",
                r'globalRepeatSubmitToken\s*=\s*"([^"]+)"',
            ],
            "globalRepeatSubmitToken",
        )
        key_check = self._extract_with_patterns(
            html,
            [
                r"'key_check_isChange'\s*:\s*'([^']+)'",
                r'"key_check_isChange"\s*:\s*"([^"]+)"',
                r"key_check_isChange\s*=\s*'([^']+)'",
            ],
            "key_check_isChange",
        )
        left_ticket_str = self._extract_with_patterns(
            html,
            [
                r"'leftTicketStr'\s*:\s*'([^']+)'",
                r'"leftTicketStr"\s*:\s*"([^"]+)"',
                r"leftTicketStr\s*=\s*'([^']+)'",
            ],
            "leftTicketStr",
        )
        train_location = self._extract_with_patterns(
            html,
            [
                r"'train_location'\s*:\s*'([^']+)'",
                r'"train_location"\s*:\s*"([^"]+)"',
                r"train_location\s*=\s*'([^']+)'",
            ],
            "train_location",
        )
        purpose_codes = "ADULT"
        for pattern in [
            r"'purpose_codes'\s*:\s*'([^']+)'",
            r'"purpose_codes"\s*:\s*"([^"]+)"',
            r"purpose_codes\s*=\s*'([^']+)'",
        ]:
            matched = re.search(pattern, html, re.S)
            if matched and matched.group(1):
                purpose_codes = matched.group(1)
                break
        return {
            "repeat_submit_token": token,
            "key_check_is_change": key_check,
            "left_ticket_str": left_ticket_str,
            "train_location": train_location,
            "purpose_codes": purpose_codes,
        }

    def get_passenger_dtos(
        self,
        repeat_submit_token: str,
        *,
        referer: str = "/otn/confirmPassenger/initDc?N",
    ) -> dict[str, Any]:
        return self._request(
            "POST",
            "/otn/confirmPassenger/getPassengerDTOs",
            data={
                "_json_att": "",
                "REPEAT_SUBMIT_TOKEN": repeat_submit_token,
            },
            referer=referer,
        )

    def query_passengers(self) -> dict[str, Any]:
        errors: list[str] = []

        try:
            self.session.get(self._url("/otn/leftTicket/init"), timeout=self.timeout)
            init_context = self.init_dc_context()
            repeat_submit_token = init_context["repeat_submit_token"]
            resp = self.get_passenger_dtos(repeat_submit_token)
            data = resp.get("data") if isinstance(resp, dict) else None
            rows = data.get("normal_passengers") if isinstance(data, dict) else None
            if isinstance(rows, list):
                return {"source": "confirmPassenger/getPassengerDTOs", "passengers": rows, "raw": resp}
            errors.append(f"getPassengerDTOs 返回结构异常: {resp}")
        except Exception as e:  # noqa: BLE001
            errors.append(f"getPassengerDTOs 路径失败: {e}")

        for method in ("POST", "GET"):
            try:
                req_kwargs: dict[str, Any] = {
                    "referer": "/otn/passengers/init",
                }
                payload = {
                    "pageIndex": "1",
                    "pageSize": "200",
                    "_json_att": "",
                }
                if method == "POST":
                    req_kwargs["data"] = payload
                else:
                    req_kwargs["params"] = payload
                resp = self._request(
                    method,
                    "/otn/passengers/query",
                    **req_kwargs,
                )
                data = resp.get("data") if isinstance(resp, dict) else None
                rows = None
                if isinstance(data, dict):
                    rows = data.get("datas") or data.get("normal_passengers")
                if isinstance(rows, list):
                    return {"source": f"passengers/query ({method})", "passengers": rows, "raw": resp}
                errors.append(f"passengers/query({method}) 返回结构异常: {resp}")
            except Exception as e:  # noqa: BLE001
                errors.append(f"passengers/query({method}) 路径失败: {e}")

        raise RuntimeError("获取乘车人列表失败。详情: " + " | ".join(errors))

    def check_user(self) -> dict[str, Any]:
        return self._request(
            "POST",
            "/otn/login/checkUser",
            data={"_json_att": ""},
            referer="/otn/leftTicket/init",
        )

    @staticmethod
    def _select_passengers(passenger_resp: dict[str, Any], passenger_names: list[str]) -> list[dict[str, Any]]:
        data = passenger_resp.get("data") if isinstance(passenger_resp, dict) else None
        rows = data.get("normal_passengers") if isinstance(data, dict) else None
        if not isinstance(rows, list):
            raise RuntimeError(f"获取乘客列表失败: {passenger_resp}")

        name_map: dict[str, dict[str, Any]] = {}
        for row in rows:
            if not isinstance(row, dict):
                continue
            name = str(row.get("passenger_name", "")).strip()
            if name:
                name_map[name] = row

        selected: list[dict[str, Any]] = []
        missing: list[str] = []
        for requested in passenger_names:
            key = requested.strip()
            if not key:
                continue
            matched = name_map.get(key)
            if matched is None:
                missing.append(key)
                continue
            selected.append(matched)
        if missing:
            available = ", ".join(sorted(name_map.keys())[:30])
            raise RuntimeError(f"乘客不存在: {', '.join(missing)}。当前可选: {available or '无'}")
        if not selected:
            raise RuntimeError("没有可用乘客，请检查 --passengers 参数。")
        return selected

    @staticmethod
    def _build_passenger_payload(selected: list[dict[str, Any]], seat_code: str) -> tuple[str, str]:
        ticket_segments: list[str] = []
        old_segments: list[str] = []
        for item in selected:
            name = str(item.get("passenger_name", "")).strip()
            id_type = str(item.get("passenger_id_type_code", "")).strip()
            id_no = str(item.get("passenger_id_no", "")).strip()
            mobile = str(item.get("mobile_no", "")).strip()
            passenger_type = str(item.get("passenger_type") or "1").strip() or "1"
            all_enc_str = str(item.get("allEncStr") or "").strip()
            if not (name and id_type and id_no):
                raise RuntimeError(f"乘客信息不完整，无法下单: {item}")
            passenger_fields = [
                seat_code,
                "0",
                passenger_type,
                name,
                id_type,
                id_no,
                mobile,
                "N",
            ]
            if all_enc_str:
                passenger_fields.append(all_enc_str)
            ticket_segments.append(",".join(passenger_fields))
            old_segments.append(f"{name},{id_type},{id_no},{passenger_type}_")
        return "_".join(ticket_segments), "".join(old_segments)

    @staticmethod
    def _normalize_choose_seats(raw_choose_seats: str, passenger_count: int) -> str:
        text = (raw_choose_seats or "").strip().upper()
        if not text:
            return ""
        text = text.replace("，", ",").replace("、", ",")

        def normalize_token(token: str, index: int) -> str:
            tok = token.strip().upper()
            if not tok:
                return ""
            if re.fullmatch(r"[A-Z]", tok):
                return f"{index}{tok}"
            if re.fullmatch(r"[1-9][A-Z]", tok):
                return tok
            if re.fullmatch(r"[A-Z][1-9]", tok):
                return f"{tok[1]}{tok[0]}"
            return tok

        if "," in text:
            parts = [p.strip() for p in text.split(",") if p.strip()]
            normalized_parts: list[str] = []
            for idx, part in enumerate(parts, start=1):
                normalized_parts.append(normalize_token(part, idx))
            return "".join(normalized_parts)

        compact = re.sub(r"\s+", "", text)
        if re.fullmatch(r"[A-Z]+", compact):
            if len(compact) == 1:
                return f"1{compact}"
            return "".join(f"{idx}{seat}" for idx, seat in enumerate(compact, start=1))
        if re.fullmatch(r"[A-Z][1-9]", compact):
            return f"{compact[1]}{compact[0]}"
        if re.fullmatch(r"[1-9][A-Z]", compact):
            return compact
        return compact

    def check_order_info(
        self,
        *,
        repeat_submit_token: str,
        passenger_ticket_str: str,
        old_passenger_str: str,
    ) -> dict[str, Any]:
        return self._request(
            "POST",
            "/otn/confirmPassenger/checkOrderInfo",
            data={
                "cancel_flag": "2",
                "bed_level_order_num": "000000000000000000000000000000",
                "passengerTicketStr": passenger_ticket_str,
                "oldPassengerStr": old_passenger_str,
                "tour_flag": "dc",
                "whatsSelect": "1",
                "sessionId": "",
                "sig": "",
                "scene": "nc_login",
                "_json_att": "",
                "REPEAT_SUBMIT_TOKEN": repeat_submit_token,
            },
            referer="/otn/confirmPassenger/initDc?N",
        )

    def get_queue_count(
        self,
        *,
        repeat_submit_token: str,
        train_date: dt.date,
        seat_code: str,
        train_row: dict[str, Any],
        left_ticket_str: str,
        train_location: str,
        purpose_codes: str,
    ) -> dict[str, Any]:
        return self._request(
            "POST",
            "/otn/confirmPassenger/getQueueCount",
            data={
                "train_date": self._format_train_date_for_12306(train_date),
                "train_no": str(train_row.get("train_no", "")),
                "stationTrainCode": str(train_row.get("train_code", "")),
                "seatType": seat_code,
                "fromStationTelecode": str(train_row.get("from_station_code", "")),
                "toStationTelecode": str(train_row.get("to_station_code", "")),
                "leftTicket": left_ticket_str,
                "purpose_codes": purpose_codes,
                "train_location": train_location,
                "_json_att": "",
                "REPEAT_SUBMIT_TOKEN": repeat_submit_token,
            },
            referer="/otn/confirmPassenger/initDc?N",
        )

    def confirm_single_for_queue(
        self,
        *,
        repeat_submit_token: str,
        passenger_ticket_str: str,
        old_passenger_str: str,
        purpose_codes: str,
        key_check_is_change: str,
        left_ticket_str: str,
        train_location: str,
        choose_seats: str = "",
    ) -> dict[str, Any]:
        return self._request(
            "POST",
            "/otn/confirmPassenger/confirmSingleForQueue",
            data={
                "passengerTicketStr": passenger_ticket_str,
                "oldPassengerStr": old_passenger_str,
                "purpose_codes": purpose_codes,
                "key_check_isChange": key_check_is_change,
                "leftTicketStr": left_ticket_str,
                "train_location": train_location,
                "choose_seats": choose_seats,
                "seatDetailType": "000",
                "is_jy": "N",
                "is_cj": "N",
                "encryptedData": "",
                "whatsSelect": "1",
                "roomType": "00",
                "dwAll": "N",
                "_json_att": "",
                "REPEAT_SUBMIT_TOKEN": repeat_submit_token,
            },
            referer="/otn/confirmPassenger/initDc?N",
        )

    def query_order_wait_time(
        self,
        *,
        repeat_submit_token: str,
        tour_flag: str = "dc",
        referer: str = "/otn/confirmPassenger/initDc?N",
    ) -> dict[str, Any]:
        return self._request(
            "GET",
            "/otn/confirmPassenger/queryOrderWaitTime",
            params={
                "random": str(int(time.time() * 1000)),
                "tourFlag": tour_flag,
                "_json_att": "",
                "REPEAT_SUBMIT_TOKEN": repeat_submit_token,
            },
            referer=referer,
        )

    def wait_for_order_id(
        self,
        *,
        repeat_submit_token: str,
        max_wait_seconds: int = 30,
        poll_interval: float = 1.5,
        tour_flag: str = "dc",
        referer: str = "/otn/confirmPassenger/initDc?N",
    ) -> dict[str, Any]:
        started = time.time()
        while True:
            resp = self.query_order_wait_time(
                repeat_submit_token=repeat_submit_token,
                tour_flag=tour_flag,
                referer=referer,
            )
            self._assert_request_ok(resp, context="轮询排队状态")
            data = resp.get("data") if isinstance(resp, dict) else None
            order_id = None
            if isinstance(data, dict):
                order_id = data.get("orderId") or data.get("order_id")
                wait_error = str(data.get("msg") or "").strip()
                if wait_error:
                    raise RuntimeError(f"排队失败: {wait_error}")
            if order_id:
                return {"order_id": str(order_id), "wait_time": data.get("waitTime"), "raw": resp}
            if time.time() - started >= max_wait_seconds:
                raise RuntimeError(f"排队超时（>{max_wait_seconds}s），最后一次响应: {resp}")
            time.sleep(max(0.3, poll_interval))

    def result_order_for_dc_queue(self, *, repeat_submit_token: str, order_id: str) -> dict[str, Any]:
        return self._request(
            "POST",
            "/otn/confirmPassenger/resultOrderForDcQueue",
            data={
                "orderSequence_no": order_id,
                "_json_att": "",
                "REPEAT_SUBMIT_TOKEN": repeat_submit_token,
            },
            referer="/otn/confirmPassenger/initDc?N",
        )

    def init_pay_order(self) -> str:
        random_value = str(int(time.time() * 1000))
        self._request_text(
            "GET",
            "/otn/payOrder/init",
            params={"random": random_value},
            referer="/otn/confirmPassenger/initDc?N",
        )
        return random_value

    def pay_check_new(self, *, init_random: str = "") -> dict[str, Any]:
        referer = "/otn/payOrder/init"
        if init_random:
            referer = f"/otn/payOrder/init?random={init_random}"
        return self._request(
            "POST",
            "/otn/payOrder/paycheckNew",
            data={
                "batch_nos": "",
                "coach_nos": "",
                "seat_nos": "",
                "passenger_id_types": "",
                "passenger_id_nos": "",
                "passenger_names": "",
                "allEncStr": "",
                "insure_price": "0",
                "insure_types": "",
                "if_buy_insure_only": "N",
                "ins_selected_time": "",
                "ins_clause_time": "",
                "ins_notice_time": "",
                "hasBoughtIns": "",
                "ins_id": "1103_PLANA_30",
                "reserver_id_type": "",
                "reserver_id_no": "",
                "reserver_name": "",
                "inschild": "",
                "_json_att": "",
            },
            referer=referer,
        )

    @staticmethod
    def _build_payment_result(pay_check_new_resp: dict[str, Any]) -> dict[str, Any]:
        data = pay_check_new_resp.get("data") if isinstance(pay_check_new_resp, dict) else None
        pay_form = data.get("payForm") if isinstance(data, dict) else None
        if not isinstance(pay_form, dict):
            raise RuntimeError(f"paycheckNew 返回结构异常: {pay_check_new_resp}")

        epayurl = str(pay_form.get("epayurl") or "").strip()
        if not epayurl:
            raise RuntimeError(f"paycheckNew 返回缺少 epayurl: {pay_check_new_resp}")

        pay_query_fields = (
            "payOrderId",
            "interfaceName",
            "interfaceVersion",
            "tranData",
            "merSignMsg",
            "appId",
            "transType",
        )
        pay_params: dict[str, str] = {}
        for key in pay_query_fields:
            value = pay_form.get(key)
            if value is None:
                continue
            text = str(value)
            if text:
                pay_params[key] = text
        pay_url = epayurl
        if pay_params:
            pay_url = f"{epayurl}?{urlencode(pay_params)}"
        gateway_post_data = {"_json_att": "", **pay_params}
        curl_parts = [
            "curl",
            "-sS",
            "-X",
            "POST",
            shell_quote(epayurl),
        ]
        for key, value in gateway_post_data.items():
            curl_parts.extend(["--data-urlencode", shell_quote(f"{key}={value}")])
        gateway_curl = " ".join(curl_parts)
        return {
            "pay_url": pay_url,
            "epayurl": epayurl,
            "pay_params": pay_params,
            "gateway_post_url": epayurl,
            "gateway_post_data": gateway_post_data,
            "gateway_curl": gateway_curl,
            "pay_form": pay_form,
            "paycheckNew": pay_check_new_resp,
        }

    def report_confirm_log(
        self,
        *,
        repeat_submit_token: str,
        log_type: str = "dc",
        referer: str = "/otn/confirmPassenger/initDc?N",
    ) -> dict[str, Any]:
        return self._request(
            "POST",
            "/otn/basedata/log",
            data={
                "type": log_type,
                "_json_att": "",
                "REPEAT_SUBMIT_TOKEN": repeat_submit_token,
            },
            referer=referer,
        )

    def submit_lc_order_request(
        self,
        *,
        secret_str: str,
        from_station_name: str,
        to_station_name: str,
        purpose_codes: str = "ADULT",
    ) -> dict[str, Any]:
        return self._request(
            "POST",
            "/otn/lcQuery/submitOrderRequest",
            data={
                "secretStr": unquote(secret_str),
                "train_date": "undefined",
                "back_train_date": "undefined",
                "tour_flag": "lc",
                "purpose_codes": purpose_codes,
                "query_from_station_name": from_station_name,
                "query_to_station_name": to_station_name,
            },
            referer="/otn/lcQuery/init",
        )

    def init_lc_context(self) -> dict[str, str]:
        html = self._request_text(
            "POST",
            "/otn/lcConfirmPassenger/initLc",
            data={"_json_att": ""},
            referer="/otn/lcQuery/init",
        )
        token = ""
        for pattern in [
            r"globalRepeatSubmitToken\s*=\s*'([^']+)'",
            r'globalRepeatSubmitToken\s*=\s*"([^"]+)"',
            r"globalRepeatSubmitToken\s*=\s*([^;\s]+)",
        ]:
            matched = re.search(pattern, html, re.S)
            if matched and matched.group(1):
                token = matched.group(1).strip().strip("'\"")
                break
        if not token:
            raise RuntimeError("initLc 页面中未找到 globalRepeatSubmitToken。")

        key_check = ""
        for pattern in [
            r"'key_check_isChange'\s*:\s*'([^']+)'",
            r'"key_check_isChange"\s*:\s*"([^"]+)"',
            r"key_check_isChange\s*=\s*'([^']+)'",
            r"key_check_isChange\s*=\s*([^;\s]+)",
        ]:
            matched = re.search(pattern, html, re.S)
            if matched and matched.group(1):
                key_check = matched.group(1).strip().strip("'\"")
                break
        if not key_check:
            raise RuntimeError("initLc 页面中未找到 key_check_isChange。")

        purpose_codes = "00"
        for pattern in [
            r"'purpose_codes'\s*:\s*'([^']+)'",
            r'"purpose_codes"\s*:\s*"([^"]+)"',
            r"purpose_codes\s*=\s*'([^']+)'",
        ]:
            matched = re.search(pattern, html, re.S)
            if matched and matched.group(1):
                purpose_codes = matched.group(1)
                break
        if token.strip().lower() == "null":
            raise RuntimeError("initLc 返回的 globalRepeatSubmitToken 为空，请先确认 submitOrderRequest 是否成功。")
        if key_check.strip().lower() == "null":
            raise RuntimeError("initLc 返回的 key_check_isChange 为空，无法继续提交中转订单。")
        return {
            "repeat_submit_token": token,
            "key_check_is_change": key_check,
            "purpose_codes": purpose_codes,
        }

    def check_lc_order_info(
        self,
        *,
        repeat_submit_token: str,
        passenger_ticket_str: str,
        old_passenger_str: str,
    ) -> dict[str, Any]:
        return self._request(
            "POST",
            "/otn/lcConfirmPassenger/checkOrderInfo",
            data={
                "cancel_flag": "2",
                "bed_level_order_num": "000000000000000000000000000000",
                "passengerTicketStr": passenger_ticket_str,
                "oldPassengerStr": old_passenger_str,
                "tour_flag": "lc",
                "sessionId": "",
                "sig": "",
                "scene": "nc_login",
                "_json_att": "",
                "REPEAT_SUBMIT_TOKEN": repeat_submit_token,
            },
            referer="/otn/lcConfirmPassenger/initLc",
        )

    def get_lc_queue_count(self, *, repeat_submit_token: str, data_str: str) -> dict[str, Any]:
        return self._request(
            "POST",
            "/otn/lcConfirmPassenger/getQueueCount",
            data={
                "dataStr": data_str,
                "_json_att": "",
                "REPEAT_SUBMIT_TOKEN": repeat_submit_token,
            },
            referer="/otn/lcConfirmPassenger/initLc",
        )

    def confirm_lc_for_queue(
        self,
        *,
        repeat_submit_token: str,
        passenger_ticket_str: str,
        old_passenger_str: str,
        purpose_codes: str,
        key_check_is_change: str,
        left_ticket_str: str,
        train_location: str,
        choose_seats: str,
    ) -> dict[str, Any]:
        return self._request(
            "POST",
            "/otn/lcConfirmPassenger/confirmLCForQueue",
            data={
                "passengerTicketStr": passenger_ticket_str,
                "oldPassengerStr": old_passenger_str,
                "purpose_codes": purpose_codes,
                "key_check_isChange": key_check_is_change,
                "leftTicketStr": left_ticket_str,
                "train_location": train_location,
                "choose_seats": choose_seats,
                "is_jy": "N",
                "is_cj": "N",
                "encryptedData": "",
                "seatDetailType": choose_seats,
                "roomType": "00",
                "_json_att": "",
                "REPEAT_SUBMIT_TOKEN": repeat_submit_token,
            },
            referer="/otn/lcConfirmPassenger/initLc",
        )

    @staticmethod
    def _decode_lc_secret_legs(scretstr: str) -> list[dict[str, str]]:
        encoded = unquote(str(scretstr or "").strip())
        if not encoded:
            raise RuntimeError("中转方案缺少 scretstr，无法提交中转订单。")
        padding = "=" * (-len(encoded) % 4)
        decoded = base64.b64decode(encoded + padding).decode("utf-8", "ignore")
        legs: list[dict[str, str]] = []
        for chunk in decoded.split("#:::"):
            fields = chunk.split("#")
            if len(fields) < 15:
                continue
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", fields[0]):
                continue
            train_no = str(fields[5] or "").strip()
            if not train_no:
                continue
            legs.append(
                {
                    "train_date": fields[0].replace("-", ""),
                    "train_code": str(fields[2] or "").strip(),
                    "train_no": train_no,
                    "from_station_code": str(fields[6] or "").strip(),
                    "to_station_code": str(fields[7] or "").strip(),
                    "from_station_name": str(fields[9] or "").strip(),
                    "to_station_name": str(fields[10] or "").strip(),
                    "left_ticket_str": str(fields[13] or "").strip(),
                    "train_location": str(fields[14] or "").strip(),
                }
            )
        if not legs:
            raise RuntimeError("无法从中转 scretstr 中解析到有效车段信息。")
        return legs

    @staticmethod
    def _seat_label_from_code(seat_code: str) -> str:
        normalized = "A9" if seat_code == "9" else seat_code
        return PRICE_KEY_LABEL_MAP.get(normalized, normalized)

    @staticmethod
    def _build_lc_old_passenger_str(legs: list[dict[str, str]], *, seat_code: str, seat_name: str) -> str:
        return "".join(
            f"{leg['train_code']},{seat_code},{seat_name},{leg['train_date']},"
            f"{leg['from_station_code']},{leg['to_station_code']}#"
            for leg in legs
        )

    @staticmethod
    def _build_lc_queue_data_str(
        legs: list[dict[str, str]],
        *,
        seat_code: str,
        seat_name: str,
        purpose_codes: str,
    ) -> str:
        segments = []
        for leg in legs:
            segments.append(
                "|".join(
                    [
                        leg["train_date"],
                        leg["train_no"],
                        leg["train_code"],
                        seat_code,
                        leg["from_station_code"],
                        leg["to_station_code"],
                        leg["left_ticket_str"],
                        purpose_codes,
                        seat_name,
                        leg["train_location"],
                    ]
                )
            )
        return "#".join(segments)

    @staticmethod
    def _build_lc_choose_seats(legs: list[dict[str, str]]) -> str:
        return "".join(f"{leg['train_code']}_*#" for leg in legs)

    def book_transfer_ticket(
        self,
        *,
        train_date: str,
        from_station: str,
        to_station: str,
        seat: str,
        passenger_names: list[str],
        middle_station: str = "",
        result_index: int = 0,
        can_query: str = "Y",
        is_show_wz: str = "N",
        purpose_codes: str = "00",
        channel: str = "E",
        endpoint: str = "queryG",
        plan_index: int = 1,
        max_wait_seconds: int = 30,
        poll_interval: float = 1.5,
        dry_run: bool = False,
    ) -> dict[str, Any]:
        dt.date.fromisoformat(train_date)
        if plan_index < 1:
            raise ValueError("--plan-index 必须 >= 1")
        seat_code = self.resolve_seat_code(seat)
        seat_name = self._seat_label_from_code(seat_code)

        transfer = self.query_transfer_ticket(
            train_date=train_date,
            from_station=from_station,
            to_station=to_station,
            middle_station=middle_station,
            result_index=result_index,
            can_query=can_query,
            is_show_wz=is_show_wz,
            purpose_codes=purpose_codes,
            channel=channel,
            endpoint=endpoint,
        )
        raw_data = transfer.get("raw", {}).get("data") if isinstance(transfer.get("raw"), dict) else None
        middle_list = raw_data.get("middleList") if isinstance(raw_data, dict) else None
        raw_rows = [item for item in middle_list if isinstance(item, dict)] if isinstance(middle_list, list) else []
        if not raw_rows:
            raise RuntimeError("未找到可提交的中转方案。")
        selected_idx = plan_index - 1
        if selected_idx >= len(raw_rows):
            raise RuntimeError(f"--plan-index={plan_index} 超出范围，当前仅有 {len(raw_rows)} 个方案。")
        selected_raw = raw_rows[selected_idx]
        selected_row = transfer.get("rows", [])[selected_idx] if selected_idx < len(transfer.get("rows", [])) else {}
        scretstr = str(selected_raw.get("scretstr") or selected_raw.get("secretStr") or "").strip()
        legs = self._decode_lc_secret_legs(scretstr)
        old_passenger_str = self._build_lc_old_passenger_str(legs, seat_code=seat_code, seat_name=seat_name)
        queue_data_str = self._build_lc_queue_data_str(
            legs,
            seat_code=seat_code,
            seat_name=seat_name,
            purpose_codes=purpose_codes,
        )
        choose_seats = self._build_lc_choose_seats(legs)

        check_user_resp = self._ensure_check_user()

        submit = self.submit_lc_order_request(
            secret_str=scretstr,
            from_station_name=str(selected_raw.get("from_station_name") or from_station),
            to_station_name=str(selected_raw.get("end_station_name") or to_station),
            purpose_codes="ADULT",
        )
        self._assert_request_ok(submit, context="lc submitOrderRequest")

        init_context = self.init_lc_context()
        repeat_submit_token = init_context["repeat_submit_token"]
        passengers_resp = self.get_passenger_dtos(
            repeat_submit_token,
            referer="/otn/lcConfirmPassenger/initLc",
        )
        selected = self._select_passengers(passengers_resp, passenger_names)
        passenger_ticket_str, _ = self._build_passenger_payload(selected, "")

        check_order = self.check_lc_order_info(
            repeat_submit_token=repeat_submit_token,
            passenger_ticket_str=passenger_ticket_str,
            old_passenger_str=old_passenger_str,
        )
        self._assert_request_ok(check_order, context="lc checkOrderInfo")
        self._assert_submit_status(check_order, context="lc checkOrderInfo")

        queue_count = self.get_lc_queue_count(
            repeat_submit_token=repeat_submit_token,
            data_str=queue_data_str,
        )
        self._assert_request_ok(queue_count, context="lc getQueueCount")
        if dry_run:
            return {
                "step": "checked",
                "plan_index": plan_index,
                "seat_code": seat_code,
                "seat_name": seat_name,
                "legs": legs,
                "plan": selected_row,
                "selected_passengers": [p.get("passenger_name") for p in selected],
                "checkUser": check_user_resp,
                "submitOrderRequest": submit,
                "initLcContext": init_context,
                "checkOrderInfo": check_order,
                "getQueueCount": queue_count,
                "lc_data_str": queue_data_str,
                "lc_old_passenger_str": old_passenger_str,
                "lc_choose_seats": choose_seats,
            }

        confirm = self.confirm_lc_for_queue(
            repeat_submit_token=repeat_submit_token,
            passenger_ticket_str=passenger_ticket_str,
            old_passenger_str=old_passenger_str,
            purpose_codes=init_context.get("purpose_codes") or purpose_codes,
            key_check_is_change=init_context["key_check_is_change"],
            left_ticket_str=legs[0]["left_ticket_str"],
            train_location=legs[0]["train_location"],
            choose_seats=choose_seats,
        )
        self._assert_request_ok(confirm, context="confirmLCForQueue")
        self._assert_submit_status(confirm, context="confirmLCForQueue")
        try:
            confirm_log = self.report_confirm_log(
                repeat_submit_token=repeat_submit_token,
                log_type="lc",
                referer="/otn/lcConfirmPassenger/initLc",
            )
        except Exception as e:  # noqa: BLE001
            confirm_log = {"warning": f"basedata/log(type=lc) 失败（不影响下单流程）: {e}"}

        wait_info = self.wait_for_order_id(
            repeat_submit_token=repeat_submit_token,
            max_wait_seconds=max_wait_seconds,
            poll_interval=poll_interval,
            tour_flag="lc",
            referer="/otn/lcConfirmPassenger/initLc",
        )
        order_id = wait_info["order_id"]
        return {
            "step": "ordered",
            "plan_index": plan_index,
            "order_id": order_id,
            "seat_code": seat_code,
            "seat_name": seat_name,
            "legs": legs,
            "plan": selected_row,
            "selected_passengers": [p.get("passenger_name") for p in selected],
            "checkUser": check_user_resp,
            "submitOrderRequest": submit,
            "initLcContext": init_context,
            "checkOrderInfo": check_order,
            "getQueueCount": queue_count,
            "confirmLCForQueue": confirm,
            "basedataLog": confirm_log,
            "queryOrderWaitTime": wait_info["raw"],
        }

    def book_ticket(
        self,
        *,
        train_date: str,
        from_station: str,
        to_station: str,
        train_code: str,
        seat: str,
        passenger_names: list[str],
        purpose_codes: str = "ADULT",
        endpoint: str = "queryG",
        choose_seats: str = "",
        max_wait_seconds: int = 30,
        poll_interval: float = 1.5,
        dry_run: bool = False,
    ) -> dict[str, Any]:
        travel_date = dt.date.fromisoformat(train_date)
        seat_code = self.resolve_seat_code(seat)
        left_ticket = self.query_left_ticket(
            train_date=train_date,
            from_station=from_station,
            to_station=to_station,
            purpose_codes=purpose_codes,
            endpoint=endpoint,
        )
        train_row = self._find_train_row(left_ticket.get("rows", []), train_code)
        if str(train_row.get("can_web_buy", "")).upper() != "Y":
            raise RuntimeError(f"车次 {train_code} 当前不可预订（can_web_buy={train_row.get('can_web_buy')}）。")
        secret_str = str(train_row.get("secret_str", "")).strip()
        if not secret_str:
            raise RuntimeError("余票数据中缺少 secret_str，无法提交预订请求。")

        check_user_resp = self._ensure_check_user()

        submit_back_date = dt.date.today().isoformat()
        submit_from_station_name = str(train_row.get("from_station") or from_station)
        submit_to_station_name = str(train_row.get("to_station") or to_station)
        seat_discount_info = str(train_row.get("yp_info") or "")
        submit = self._request(
            "POST",
            "/otn/leftTicket/submitOrderRequest",
            data={
                "secretStr": unquote(secret_str),
                "train_date": travel_date.isoformat(),
                "back_train_date": submit_back_date,
                "tour_flag": "dc",
                "purpose_codes": purpose_codes,
                "query_from_station_name": submit_from_station_name,
                "query_to_station_name": submit_to_station_name,
                "bed_level_info": "",
                "seat_discount_info": seat_discount_info,
                "undefined": "",
            },
            referer="/otn/leftTicket/init",
        )
        self._assert_request_ok(submit, context="submitOrderRequest")

        init_context = self.init_dc_context()
        repeat_submit_token = init_context["repeat_submit_token"]
        passengers_resp = self.get_passenger_dtos(repeat_submit_token)
        selected = self._select_passengers(passengers_resp, passenger_names)
        passenger_ticket_str, old_passenger_str = self._build_passenger_payload(selected, seat_code)
        normalized_choose_seats = self._normalize_choose_seats(choose_seats, len(selected))

        check_order = self.check_order_info(
            repeat_submit_token=repeat_submit_token,
            passenger_ticket_str=passenger_ticket_str,
            old_passenger_str=old_passenger_str,
        )
        self._assert_request_ok(check_order, context="checkOrderInfo")
        self._assert_submit_status(check_order, context="checkOrderInfo")

        queue_count = self.get_queue_count(
            repeat_submit_token=repeat_submit_token,
            train_date=travel_date,
            seat_code=seat_code,
            train_row=train_row,
            left_ticket_str=init_context["left_ticket_str"],
            train_location=init_context["train_location"],
            purpose_codes=init_context.get("purpose_codes") or purpose_codes,
        )
        self._assert_request_ok(queue_count, context="getQueueCount")
        if dry_run:
            return {
                "step": "checked",
                "seat_code": seat_code,
                "train": train_row,
                "selected_passengers": [p.get("passenger_name") for p in selected],
                "checkUser": check_user_resp,
                "submitOrderRequest": submit,
                "checkOrderInfo": check_order,
                "getQueueCount": queue_count,
            }

        confirm = self.confirm_single_for_queue(
            repeat_submit_token=repeat_submit_token,
            passenger_ticket_str=passenger_ticket_str,
            old_passenger_str=old_passenger_str,
            purpose_codes=init_context.get("purpose_codes") or purpose_codes,
            key_check_is_change=init_context["key_check_is_change"],
            left_ticket_str=init_context["left_ticket_str"],
            train_location=init_context["train_location"],
            choose_seats=normalized_choose_seats,
        )
        self._assert_request_ok(confirm, context="confirmSingleForQueue")
        self._assert_submit_status(confirm, context="confirmSingleForQueue")
        try:
            confirm_log = self.report_confirm_log(repeat_submit_token=repeat_submit_token)
        except Exception as e:  # noqa: BLE001
            confirm_log = {"warning": f"basedata/log 失败（不影响下单流程）: {e}"}

        wait_info = self.wait_for_order_id(
            repeat_submit_token=repeat_submit_token,
            max_wait_seconds=max_wait_seconds,
            poll_interval=poll_interval,
        )
        order_id = wait_info["order_id"]
        result_order = self.result_order_for_dc_queue(
            repeat_submit_token=repeat_submit_token,
            order_id=order_id,
        )
        self._assert_request_ok(result_order, context="resultOrderForDcQueue")
        self._assert_submit_status(result_order, context="resultOrderForDcQueue")

        return {
            "step": "ordered",
            "order_id": order_id,
            "seat_code": seat_code,
            "train": train_row,
            "selected_passengers": [p.get("passenger_name") for p in selected],
            "checkUser": check_user_resp,
            "submitOrderRequest": submit,
            "checkOrderInfo": check_order,
            "getQueueCount": queue_count,
            "confirmSingleForQueue": confirm,
            "basedataLog": confirm_log,
            "queryOrderWaitTime": wait_info["raw"],
            "resultOrderForDcQueue": result_order,
        }


def read_password(args: argparse.Namespace) -> str:
    if args.password:
        return args.password
    env_pwd = os.getenv("KYFW_PASSWORD")
    if env_pwd:
        return env_pwd
    return getpass.getpass("12306 password: ")


def print_orders(resp: dict[str, Any]) -> None:
    data = resp.get("data") or {}
    total = data.get("order_total_number", "0")
    orders = data.get("OrderDTODataList", [])
    print(f"订单总数: {total}, 当前页: {len(orders)}")
    for order in orders:
        from_name = order.get("from_station_name_page")
        to_name = order.get("to_station_name_page")
        if isinstance(from_name, list):
            from_name = ",".join([str(x) for x in from_name if x not in (None, "")]) or "--"
        if isinstance(to_name, list):
            to_name = ",".join([str(x) for x in to_name if x not in (None, "")]) or "--"
        from_name = from_name or "--"
        to_name = to_name or "--"

        order_date = order.get("order_date") or "--"
        # `order_date` 是下单时间，`start_train_date_page` 才是出行日期。
        travel_date = (
            order.get("start_train_date_page")
            or order.get("start_train_date")
            or order.get("train_date")
            or "--"
        )
        print(
            f"- 订单号: {order.get('sequence_no')} | 下单日期: {order_date} | 出行日期: {travel_date} | "
            f"{order.get('train_code_page')} {from_name} -> {to_name} | "
            f"{order.get('start_time_page')} -> {order.get('arrive_time_page')} | 人数: {order.get('ticket_totalnum')}"
        )
        for ticket in order.get("tickets", []):
            passenger = (ticket.get("passengerDTO") or {}).get("passenger_name") or ticket.get("book_user_name")
            ticket_type = ticket.get("ticket_type_name") or ticket.get("ticket_type_code") or "--"
            seat_type = ticket.get("seat_type_name") or ticket.get("seat_type_code") or "--"
            coach_name = ticket.get("coach_name") or ticket.get("coach_no") or "--"
            seat_name = ticket.get("seat_name") or ticket.get("seat_no") or "--"

            price_text = str(ticket.get("str_ticket_price_page") or "").strip()
            if not price_text:
                raw_price = ticket.get("ticket_price")
                if isinstance(raw_price, int):
                    price_text = f"{raw_price / 100:.1f}"
                elif isinstance(raw_price, float):
                    price_text = f"{raw_price:.1f}"
                elif raw_price not in (None, ""):
                    price_text = str(raw_price)
            if price_text and not price_text.endswith("元"):
                price_text = f"{price_text}元"
            if not price_text:
                price_text = "--"

            print(
                f"  乘客: {passenger} | 票种: {ticket_type} | 票价: {price_text} | "
                f"席位: {seat_type}，{coach_name}车{seat_name} | 状态: {ticket.get('ticket_status_name') or '--'}"
            )


def pick_first_no_complete_order(resp: dict[str, Any], *, payable_only: bool = True) -> dict[str, Any] | None:
    data = resp.get("data") if isinstance(resp, dict) else None
    rows = data.get("orderDBList") if isinstance(data, dict) else None
    if not isinstance(rows, list):
        return None
    for item in rows:
        if not isinstance(item, dict):
            continue
        if payable_only and str(item.get("pay_flag") or "").strip().upper() != "Y":
            continue
        return item
    return None


def print_candidate_queue(queue: dict[str, Any]) -> None:
    flag = queue.get("flag")
    status = queue.get("status")
    is_async = queue.get("is_async")
    print("候补查询开关:", "开启" if flag else "关闭")
    print("候补队列状态码:", status)
    print("异步处理:", "是" if is_async else "否")


def print_candidate_orders(rows: list[dict[str, Any]], limit: int) -> None:
    shown = rows[: max(0, limit)]
    print(f"候补订单总数: {len(rows)}, 展示: {len(shown)}")
    for item in shown:
        passengers = ",".join(item.get("passengers") or [])
        print(
            f"- 候补单: {item.get('reserve_no') or '--'} | 状态: {item.get('status_name') or '--'}({item.get('status_code') or '--'}) | "
            f"提交日期: {item.get('reserve_time') or '--'} | 截止兑现: {item.get('realize_limit_time') or '--'}"
        )
        print(
            f"  行程: {item.get('train_date') or '--'} {item.get('train_code') or '--'} "
            f"{item.get('from_station') or '--'} -> {item.get('to_station') or '--'} "
            f"{item.get('start_time') or '--'}->{item.get('arrive_time') or '--'} | "
            f"席别: {item.get('seat_name') or '--'} | 乘客: {passengers or '--'}"
        )
        print(
            f"  金额: 预付款={item.get('prepay_amount') or '--'} | 票款={item.get('ticket_price') or '--'} | 可退={item.get('refundable') or '--'}"
        )


def print_left_tickets(rows: list[dict[str, Any]], limit: int) -> None:
    print(f"共返回车次: {len(rows)}")
    header = "车次   出发->到达   时长   商务 特等 优一 一等 二等 包座 高软 软卧 硬卧 软座 硬座 无座"
    print(header)
    print("-" * len(header))
    for item in rows[:limit]:
        print(
            f"{item['train_code']:<5} "
            f"{item['start_time']}-{item['arrive_time']} "
            f"{item['duration']:<5} "
            f"{item['business']:<3} "
            f"{item['special_class']:<3} "
            f"{item['premium_first_class']:<3} "
            f"{item['first_class']:<3} "
            f"{item['second_class']:<3} "
            f"{item['second_class_compartment']:<3} "
            f"{item['deluxe_soft_sleeper']:<3} "
            f"{item['soft_sleeper']:<3} "
            f"{item['hard_sleeper']:<3} "
            f"{item['soft_seat']:<3} "
            f"{item['hard_seat']:<3} "
            f"{item['no_seat']:<3}"
        )
        price_text = str(item.get("ticket_price_text") or "").strip()
        if price_text:
            print(f"      票价: {price_text}")


def print_transfer_tickets(rows: list[dict[str, Any]], limit: int) -> None:
    shown = rows[: max(0, limit)]
    print(f"共返回中转方案: {len(rows)}, 展示: {len(shown)}")
    header = "序号 换乘站   车次(第一程->第二程)   发时->到时   总耗时   等待"
    print(header)
    print("-" * len(header))
    for idx, item in enumerate(shown, start=1):
        middle_station = str(item.get("middle_station") or "--")
        train_pair = f"{item.get('first_leg_train_code') or '--'}->{item.get('second_leg_train_code') or '--'}"
        time_pair = f"{item.get('start_time') or '--'}->{item.get('arrive_time') or '--'}"
        total_duration = str(item.get("total_duration") or "--")
        wait_time = str(item.get("wait_time") or "--")
        print(
            f"{idx:<4} {middle_station:<8} {train_pair:<24} {time_pair:<13} {total_duration:<8} {wait_time:<8}"
        )
        print(
            f"     第一程坐席: {item.get('first_leg_seat_text') or '--'}"
        )
        print(
            f"     第一程票价: {item.get('first_leg_ticket_price_text') or '--'}"
        )
        print(
            f"     第二程坐席: {item.get('second_leg_seat_text') or '--'}"
        )
        print(
            f"     第二程票价: {item.get('second_leg_ticket_price_text') or '--'}"
        )


def print_route(rows: list[dict[str, Any]], limit: int) -> None:
    shown = rows[: max(0, limit)]
    print(f"共返回经停站: {len(rows)}, 展示: {len(shown)}")
    header = "序号 站序 站名       到达     开车     停留"
    print(header)
    print("-" * len(header))
    for idx, item in enumerate(shown, start=1):
        station_no = str(item.get("station_no") or "--")
        station_name = str(item.get("station_name") or "--")
        arrive_time = str(item.get("arrive_time") or "--")
        start_time = str(item.get("start_time") or "--")
        stopover_time = str(item.get("stopover_time") or "--")
        marker = "*" if item.get("is_enabled") else " "
        print(
            f"{marker}{idx:<3} {station_no:<4} {station_name:<10} {arrive_time:<8} {start_time:<8} {stopover_time:<8}"
        )
    if shown:
        print("* 表示当前查询区间内的站点")


def _mask_middle(value: str, keep_head: int = 3, keep_tail: int = 2) -> str:
    text = (value or "").strip()
    if len(text) <= keep_head + keep_tail:
        return text
    return f"{text[:keep_head]}{'*' * (len(text) - keep_head - keep_tail)}{text[-keep_tail:]}"


def print_passengers(rows: list[dict[str, Any]], limit: int) -> None:
    shown = rows[: max(0, limit)]
    print(f"乘车人总数: {len(rows)}, 展示: {len(shown)}")
    for item in shown:
        name = item.get("passenger_name") or item.get("name") or "--"
        p_type = item.get("passenger_type_name") or item.get("passenger_type") or "--"
        id_type = item.get("passenger_id_type_name") or item.get("passenger_id_type_code") or "--"
        id_no_raw = str(item.get("passenger_id_no") or item.get("identity_no") or "")
        mobile_raw = str(item.get("mobile_no") or item.get("mobile") or "")
        id_no = _mask_middle(id_no_raw, keep_head=3, keep_tail=2) if id_no_raw else "--"
        mobile = _mask_middle(mobile_raw, keep_head=3, keep_tail=2) if mobile_raw else "--"
        print(f"- {name} | 类型: {p_type} | 证件: {id_type} {id_no} | 手机: {mobile}")


def add_auth_args(
    parser: argparse.ArgumentParser,
    *,
    require_username: bool = True,
    allow_send_sms: bool = True,
) -> None:
    parser.add_argument("--username", required=require_username, help="12306 用户名/邮箱/手机号")
    parser.add_argument("--password", help="12306 密码（不传则读取 KYFW_PASSWORD 或交互输入）")
    parser.add_argument("--id-last4", help="证件号后4位（短信验证码模式需要）")
    parser.add_argument("--sms-code", help="短信验证码（6位）")
    if allow_send_sms:
        parser.add_argument("--send-sms", action="store_true", help="仅发送短信验证码，不执行完整登录")


def resolve_qr_state_path(cookie_file: str | None) -> Path:
    return derive_qr_login_state_file(cookie_file)


def build_random_qr_image_path(*, use_tmp: bool = False) -> Path:
    name = f"12306_qr_login_{uuidlib.uuid4().hex[:12]}.png"
    if use_tmp:
        return Path(tempfile.gettempdir()) / name
    return Path(__file__).resolve().parent / name


def decode_qr_image_bytes(image_b64: str) -> bytes:
    text = (image_b64 or "").strip()
    if not text:
        raise ValueError("二维码内容为空")
    padding = "=" * (-len(text) % 4)
    return base64.b64decode(text + padding)


def write_qr_image_file(image_b64: str, *, preferred_path: Path | None = None) -> Path:
    image_bytes = decode_qr_image_bytes(image_b64)
    if preferred_path is not None:
        target = preferred_path.expanduser()
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(image_bytes)
        return target

    image_path = build_random_qr_image_path(use_tmp=True)
    try:
        image_path.parent.mkdir(parents=True, exist_ok=True)
        image_path.write_bytes(image_bytes)
    except OSError:
        image_path = build_random_qr_image_path(use_tmp=False)
        image_path.parent.mkdir(parents=True, exist_ok=True)
        image_path.write_bytes(image_bytes)
    return image_path


def write_payment_qr_image_file(
    payment_url: str,
    *,
    preferred_path: Path | None = None,
) -> Path:
    url = str(payment_url or "").strip()
    if not url:
        raise ValueError("支付链接为空，无法生成二维码。")

    if preferred_path is not None:
        target = preferred_path.expanduser()
        target.parent.mkdir(parents=True, exist_ok=True)
        output_path = target
    else:
        name = f"12306_pay_qr_{uuidlib.uuid4().hex[:12]}.png"
        output_path = Path(tempfile.gettempdir()) / name
        try:
            output_path.parent.mkdir(parents=True, exist_ok=True)
        except OSError:
            output_path = Path(__file__).resolve().parent / name
            output_path.parent.mkdir(parents=True, exist_ok=True)

    # Local QR generation only: do not call any remote QR API.
    qr_errors: list[str] = []

    try:
        import qrcode  # type: ignore

        qr = qrcode.QRCode(
            version=None,
            error_correction=qrcode.constants.ERROR_CORRECT_M,
            box_size=10,
            border=2,
        )
        qr.add_data(url)
        qr.make(fit=True)
        img = qr.make_image(fill_color="black", back_color="white")
        img.save(output_path)
        return output_path
    except Exception as exc:  # noqa: BLE001
        qr_errors.append(f"qrcode: {exc}")

    try:
        import segno  # type: ignore

        qr = segno.make(url, error="m")
        qr.save(str(output_path), scale=10, border=2)
        return output_path
    except Exception as exc:  # noqa: BLE001
        qr_errors.append(f"segno: {exc}")

    py_exec = shell_quote(sys.executable)
    details = "; ".join(qr_errors) if qr_errors else "未知错误"

    raise RuntimeError(
        "本地二维码依赖缺失：请在当前解释器安装依赖。"
        f" 当前解释器: {sys.executable}。"
        f" 可执行: `{py_exec} -m pip install qrcode[pil]` 或 `{py_exec} -m pip install segno`。"
        f" 详细错误: {details}"
    )


def build_arrive_time_str_from_order(order: dict[str, Any]) -> str:
    parts: list[str] = []
    seen: set[tuple[str, str]] = set()
    tickets = order.get("tickets") if isinstance(order, dict) else None
    if isinstance(tickets, list):
        for ticket in tickets:
            if not isinstance(ticket, dict):
                continue
            station_train = ticket.get("stationTrainDTO")
            if not isinstance(station_train, dict):
                continue
            train_code = str(station_train.get("station_train_code") or "").strip()
            arrive_time = str(station_train.get("arrive_time") or "").strip()
            if not (train_code and arrive_time):
                continue
            key = (train_code, arrive_time)
            if key in seen:
                continue
            seen.add(key)
            parts.append(f"{train_code},{arrive_time};")
    if parts:
        return "".join(parts)

    train_code_page = str(order.get("train_code_page") or "").strip()
    arrive_time_page = str(order.get("arrive_time_page") or "").strip()
    if train_code_page and arrive_time_page:
        return f"{train_code_page},{arrive_time_page};"
    raise RuntimeError(f"未完成订单缺少到达时刻信息，无法继续支付: {order}")


def select_order_for_common_payment(no_complete_resp: dict[str, Any]) -> tuple[dict[str, Any], dict[str, str]]:
    data = no_complete_resp.get("data") if isinstance(no_complete_resp, dict) else None
    order_list = data.get("orderDBList") if isinstance(data, dict) else None
    if not isinstance(order_list, list) or not order_list:
        raise RuntimeError(f"未找到待支付普通/中转订单: {no_complete_resp}")

    for item in order_list:
        if not isinstance(item, dict):
            continue
        sequence_no = str(item.get("sequence_no") or "").strip()
        pay_flag = str(item.get("pay_flag") or "").strip().upper()
        if not sequence_no or pay_flag != "Y":
            continue
        arrive_time_str = build_arrive_time_str_from_order(item)
        payload = {
            "sequence_no": sequence_no,
            "pay_flag": "pay",
            "arrive_time_str": arrive_time_str,
        }
        return item, payload

    raise RuntimeError(f"当前未完成订单里没有可支付的普通/中转订单: {no_complete_resp}")


def fetch_common_order_payment(
    client: KyfwClient,
    *,
    pay_channel: str = "",
) -> dict[str, Any]:
    no_complete = client.query_my_order_no_complete()
    selected_order, continue_payload = select_order_for_common_payment(no_complete)
    continue_pay_resp = client.continue_pay_common_order(
        sequence_no=continue_payload["sequence_no"],
        arrive_time_str=continue_payload["arrive_time_str"],
    )
    if continue_pay_resp:
        client._assert_request_ok(continue_pay_resp, context="continuePayNoCompleteMyOrder")
    pay_check_new_resp = client.pay_check_new()
    client._assert_request_ok(pay_check_new_resp, context="paycheckNew")
    pay_data = pay_check_new_resp.get("data") if isinstance(pay_check_new_resp, dict) else None
    if isinstance(pay_data, dict) and pay_data.get("flag") is False:
        raise RuntimeError(f"普通订单支付参数获取失败(flag=false): {pay_check_new_resp}")
    payment = client._build_payment_result(pay_check_new_resp)

    channel_result: dict[str, Any] | None = None
    pay_qr_url = ""
    pay_qr_image_file = ""
    pay_qr_error = ""
    if pay_channel:
        bank_id = client.candidate_pay_channel_to_bank_id(pay_channel)
        gateway_post_url = str(payment.get("gateway_post_url") or "").strip()
        gateway_post_data = payment.get("gateway_post_data")
        if not gateway_post_url or not isinstance(gateway_post_data, dict):
            raise RuntimeError("普通订单支付网关参数不完整，无法生成渠道跳转链接。")
        channel_result = client.resolve_epay_channel_url(
            gateway_post_url=gateway_post_url,
            gateway_post_data={str(k): str(v) for k, v in gateway_post_data.items()},
            bank_id=bank_id,
            business_type="1",
        )
        raw_url = str(channel_result.get("channel_redirect_url_raw") or "").strip()
        final_url = str(channel_result.get("channel_redirect_url") or "").strip()
        pay_qr_url = raw_url or final_url
        if pay_qr_url:
            try:
                qr_path = write_payment_qr_image_file(pay_qr_url)
                pay_qr_image_file = str(qr_path)
            except Exception as qr_err:
                pay_qr_error = str(qr_err)

    return {
        "no_complete": no_complete,
        "selected_order": selected_order,
        "continue_payload": continue_payload,
        "continuePayNoCompleteMyOrder": continue_pay_resp,
        "payment": payment,
        "pay_channel": pay_channel,
        "channel_result": channel_result,
        "pay_qr_url": pay_qr_url,
        "pay_qr_image_file": pay_qr_image_file,
        "pay_qr_error": pay_qr_error,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="12306 API CLI")
    parser.add_argument("--base-url", default=BASE_URL, help="12306 base URL")
    parser.add_argument("--timeout", type=int, default=15, help="请求超时时间（秒）")
    parser.add_argument(
        "--cookie-file",
        default=DEFAULT_COOKIE_FILE,
        help=f"Cookie 持久化文件路径（默认 {DEFAULT_COOKIE_FILE}）",
    )
    parser.add_argument(
        "--no-browser-headers",
        action="store_true",
        help="关闭浏览器风格请求头仿真（默认开启）",
    )
    parser.add_argument("--json", action="store_true", help="输出 JSON")

    sub = parser.add_subparsers(dest="command", required=True)

    login_p = sub.add_parser("login", help="登录")
    add_auth_args(login_p, require_username=True, allow_send_sms=True)

    qr_create_p = sub.add_parser("qr-login-create", help="生成二维码登录图片并自动后台检查（不阻塞）")
    qr_create_p.add_argument("--appid", default="otn", help="二维码登录 appid（默认 otn）")

    order_p = sub.add_parser("orders", help="查询用户车票")
    order_p.add_argument("--where", default="G", choices=["G", "H"], help="G:未出行/近期, H:历史订单")
    order_p.add_argument("--start-date", help="查询起始日期, YYYY-MM-DD")
    order_p.add_argument("--end-date", help="查询结束日期, YYYY-MM-DD（--where H 时必须早于今天）")
    order_p.add_argument("--page-index", type=int, default=0)
    order_p.add_argument("--page-size", type=int, default=8)
    order_p.add_argument(
        "--query-type",
        type=int,
        default=1,
        choices=[1, 2],
        help="查询类型：1=按订票日期，2=按乘车日期",
    )
    order_p.add_argument("--train-name", default="", help="按订单号/车次/姓名过滤（可选）")

    order_no_complete_p = sub.add_parser("order-no-complete", help="查询1条未完成订单（默认待支付）")
    order_no_complete_p.add_argument(
        "--any",
        action="store_true",
        help="返回第一条未完成订单（不过滤 pay_flag）",
    )

    sub.add_parser("candidate-queue", help="查询候补排队状态")

    candidate_orders_p = sub.add_parser("candidate-orders", help="查询候补订单")
    candidate_orders_p.add_argument(
        "--processed",
        action="store_true",
        help="查询已处理候补订单（默认查询进行中的候补订单）",
    )
    candidate_orders_p.add_argument("--page-no", type=int, default=0, help="页码（默认0）")
    candidate_orders_p.add_argument("--start-date", help="查询起始日期 YYYY-MM-DD（默认今天）")
    candidate_orders_p.add_argument("--end-date", help="查询结束日期 YYYY-MM-DD（默认起始日期+29天）")
    candidate_orders_p.add_argument("--limit", type=int, default=20, help="最多展示多少条候补订单")

    candidate_submit_p = sub.add_parser("candidate-submit", help="提交候补订单")
    candidate_submit_p.add_argument("--date", required=True, help="出发日期 YYYY-MM-DD")
    candidate_submit_p.add_argument("--from", dest="from_station", required=True, help="出发站（中文名/拼音/三字码）")
    candidate_submit_p.add_argument("--to", dest="to_station", required=True, help="到达站（中文名/拼音/三字码）")
    candidate_submit_p.add_argument("--train-code", required=True, help="车次，例如 G1234")
    candidate_submit_p.add_argument("--seat", required=True, help="席别，例如 second_class / O / 一等座")
    candidate_submit_p.add_argument("--passengers", default="", help="乘客姓名，多个用逗号分隔；不传默认取首位乘车人")
    candidate_submit_p.add_argument("--purpose", default="ADULT", help="乘客类型，默认 ADULT")
    candidate_submit_p.add_argument(
        "--endpoint",
        default="queryG",
        choices=["queryG", "queryZ"],
        help="余票接口类型",
    )
    candidate_submit_p.add_argument(
        "--force",
        action="store_true",
        help="即使该席别余票不是“无”也尝试提交候补",
    )
    candidate_submit_p.add_argument("--max-wait-seconds", type=int, default=30, help="候补排队轮询最长等待秒数")
    candidate_submit_p.add_argument("--poll-interval", type=float, default=1.0, help="候补排队轮询间隔秒数")

    candidate_cancel_p = sub.add_parser("candidate-cancel", help="取消候补订单")
    candidate_cancel_p.add_argument("--reserve-no", required=True, help="候补单号（reserve_no）")

    candidate_pay_p = sub.add_parser("candidate-pay", help="候补订单支付参数获取")
    candidate_pay_p.add_argument("--reserve-no", help="候补单号（不传则尝试从 candidate-queue 自动读取）")
    candidate_pay_p.add_argument(
        "--pay-channel",
        choices=["alipay", "wechat", "unionpay"],
        help="可选：直接生成对应支付渠道的最终 GET 跳转链接",
    )

    left_p = sub.add_parser("left-ticket", help="查询车次余票")
    left_p.add_argument("--date", required=True, help="出发日期 YYYY-MM-DD")
    left_p.add_argument("--from", dest="from_station", required=True, help="出发站（中文名/拼音/三字码）")
    left_p.add_argument("--to", dest="to_station", required=True, help="到达站（中文名/拼音/三字码）")
    left_p.add_argument("--purpose", default="ADULT", help="乘客类型，默认 ADULT")
    left_p.add_argument("--endpoint", default="queryG", choices=["queryG", "queryZ"], help="余票接口类型")
    left_p.add_argument("--limit", type=int, default=20, help="最多展示多少行")

    transfer_p = sub.add_parser("transfer-ticket", help="查询中转车票")
    transfer_p.add_argument("--date", required=True, help="出发日期 YYYY-MM-DD")
    transfer_p.add_argument("--from", dest="from_station", required=True, help="出发站（中文名/拼音/三字码）")
    transfer_p.add_argument("--to", dest="to_station", required=True, help="到达站（中文名/拼音/三字码）")
    transfer_p.add_argument("--middle", dest="middle_station", default="", help="指定换乘站（可选）")
    transfer_p.add_argument("--result-index", type=int, default=0, help="分页游标（默认0）")
    transfer_p.add_argument("--can-query", default="Y", choices=["Y", "N"], help="是否继续查询更多方案")
    transfer_p.add_argument("--show-wz", action="store_true", help="显示无座方案")
    transfer_p.add_argument("--purpose", default="00", help="乘客类型编码（默认00）")
    transfer_p.add_argument("--channel", default="E", help="渠道参数（默认E）")
    transfer_p.add_argument("--endpoint", default="queryG", choices=["queryG", "queryZ"], help="中转接口类型")
    transfer_p.add_argument("--limit", type=int, default=20, help="最多展示多少行")

    transfer_book_p = sub.add_parser("transfer-book", help="提交中转订单（按中转方案下单）")
    transfer_book_p.add_argument("--date", required=True, help="出发日期 YYYY-MM-DD")
    transfer_book_p.add_argument("--from", dest="from_station", required=True, help="出发站（中文名/拼音/三字码）")
    transfer_book_p.add_argument("--to", dest="to_station", required=True, help="到达站（中文名/拼音/三字码）")
    transfer_book_p.add_argument("--middle", dest="middle_station", default="", help="指定换乘站（可选）")
    transfer_book_p.add_argument("--plan-index", type=int, default=1, help="选择第几个中转方案（从1开始）")
    transfer_book_p.add_argument("--result-index", type=int, default=0, help="分页游标（默认0）")
    transfer_book_p.add_argument("--can-query", default="Y", choices=["Y", "N"], help="是否继续查询更多方案")
    transfer_book_p.add_argument("--show-wz", action="store_true", help="显示无座方案")
    transfer_book_p.add_argument("--seat", required=True, help="席别，例如 second_class / O / 一等座")
    transfer_book_p.add_argument("--passengers", required=True, help="乘客姓名，多个用逗号分隔")
    transfer_book_p.add_argument("--purpose", default="00", help="中转乘客类型编码（默认00）")
    transfer_book_p.add_argument("--channel", default="E", help="渠道参数（默认E）")
    transfer_book_p.add_argument(
        "--endpoint",
        default="queryG",
        choices=["queryG", "queryZ"],
        help="中转接口类型",
    )
    transfer_book_p.add_argument("--max-wait-seconds", type=int, default=30, help="排队轮询最长等待秒数")
    transfer_book_p.add_argument("--poll-interval", type=float, default=1.5, help="排队轮询间隔秒数")
    transfer_book_p.add_argument("--dry-run", action="store_true", help="只走到排队前检查，不执行最终提交")

    route_p = sub.add_parser("route", help="查询经停站")
    route_id = route_p.add_mutually_exclusive_group(required=True)
    route_id.add_argument("--train-no", help="列车内部 train_no（如 760000C95604）")
    route_id.add_argument("--train-code", help="车次号（如 C956 / G1234），会自动解析 train_no")
    route_p.add_argument("--date", required=True, help="出发日期 YYYY-MM-DD")
    route_p.add_argument("--from", dest="from_station", required=True, help="出发站（中文名/拼音/三字码）")
    route_p.add_argument("--to", dest="to_station", required=True, help="到达站（中文名/拼音/三字码）")
    route_p.add_argument("--endpoint", default="queryG", choices=["queryG", "queryZ"], help="解析车次号时使用的余票接口类型")
    route_p.add_argument("--purpose", default="ADULT", help="解析车次号时使用的乘客类型，默认 ADULT")
    route_p.add_argument("--limit", type=int, default=200, help="最多展示多少站")

    book_p = sub.add_parser("book", help="订票（提交订单）")
    book_p.add_argument("--date", required=True, help="出发日期 YYYY-MM-DD")
    book_p.add_argument("--from", dest="from_station", required=True, help="出发站（中文名/拼音/三字码）")
    book_p.add_argument("--to", dest="to_station", required=True, help="到达站（中文名/拼音/三字码）")
    book_p.add_argument("--train-code", required=True, help="车次，例如 G1234")
    book_p.add_argument("--seat", required=True, help="席别，例如 second_class / first_class / O / M / 9")
    book_p.add_argument("--passengers", required=True, help="乘客姓名，多个用逗号分隔")
    book_p.add_argument("--purpose", default="ADULT", help="乘客类型，默认 ADULT")
    book_p.add_argument("--endpoint", default="queryG", choices=["queryG", "queryZ"], help="余票接口类型")
    book_p.add_argument(
        "--choose-seats",
        default="",
        help="选座（可选；示例：D、1D、D1、A,B；其他格式将原样透传）",
    )
    book_p.add_argument("--max-wait-seconds", type=int, default=30, help="排队轮询最长等待秒数")
    book_p.add_argument("--poll-interval", type=float, default=1.5, help="排队轮询间隔秒数")
    book_p.add_argument("--dry-run", action="store_true", help="只走到排队前检查，不执行最终提交")

    order_pay_p = sub.add_parser("order-pay", help="获取普通/中转订单支付参数（不下单）")
    order_pay_p.add_argument(
        "--pay-channel",
        choices=["alipay", "wechat", "unionpay"],
        help="可选：按支付渠道解析跳转并本地生成支付二维码",
    )

    passenger_p = sub.add_parser("passengers", help="查询当前账号乘车人信息")
    passenger_p.add_argument("--limit", type=int, default=200, help="最多展示多少个乘车人")

    sub.add_parser("status", help="查询当前是否已登录（基于 cookie）")

    return parser


def ensure_logged_in(client: KyfwClient) -> None:
    status = client.check_login_status()
    if status.get("logged_in"):
        return
    raise RuntimeError(
        "当前 cookie 未登录或已失效。请先执行 login（或二维码登录）更新 cookie 后重试。"
    )


def run_qr_login_check_worker(client: KyfwClient, *, cookie_file: str, json_output: bool) -> int:
    state_path = resolve_qr_state_path(cookie_file)
    state = load_qr_login_state(state_path)
    uuid = str(state.get("uuid") or "").strip()
    if not uuid:
        raise RuntimeError("状态文件中不存在 uuid。请先执行 qr-login-create。")
    appid = str(state.get("appid") or "otn").strip() or "otn"

    result: dict[str, Any]
    last_qr_status = ""
    while True:
        result = client.check_qr_login(
            uuid=uuid,
            appid=appid,
            finalize=True,
        )
        step = str(result.get("step") or "")
        if step == "pending":
            qr_status = str(result.get("qr_status") or "")
            if not json_output and qr_status != last_qr_status:
                if qr_status == "waiting_scan":
                    print("轮询中: 未扫描")
                elif qr_status == "waiting_confirm":
                    print("轮询中: 已扫描，待 App 确认")
                else:
                    print("轮询中:", qr_status or "pending")
            last_qr_status = qr_status
            time.sleep(1.0)
            continue
        break

    state["uuid"] = uuid
    state["appid"] = appid
    state["last_check"] = {
        "checked_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "step": result.get("step"),
        "result_code": result.get("result_code"),
        "result_message": result.get("result_message"),
        "qr_status": result.get("qr_status"),
    }
    if result.get("step") == "logged_in":
        state["completed_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
    save_qr_login_state(state_path, state)

    if json_output:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0

    step = result.get("step")
    if step == "pending":
        qr_status = result.get("qr_status")
        if qr_status == "waiting_scan":
            print("二维码状态: 未扫描")
        elif qr_status == "waiting_confirm":
            print("二维码状态: 已扫描，待 App 确认")
        else:
            print("二维码状态:", qr_status)
        print("结果消息:", result.get("result_message") or "--")
        return 2
    if step == "expired":
        print("二维码状态: 已失效，请重新执行 qr-login-create。")
        return 2
    if step == "logged_in":
        print("登录成功。")
        login_status = result.get("login_status") or {}
        print("登录状态:", "已登录" if login_status.get("logged_in") else "未确认")
        user = login_status.get("user") if isinstance(login_status, dict) else None
        if isinstance(user, dict):
            name = user.get("name")
            username = user.get("username")
            if name:
                print("姓名:", name)
            if username:
                print("用户名:", username)
        return 0

    print("二维码状态:", result.get("qr_status") or "--")
    print("结果消息:", result.get("result_message") or "--")
    return 1


def main() -> int:
    if "--qr-check-worker" in sys.argv[1:]:
        worker_parser = argparse.ArgumentParser(add_help=False)
        worker_parser.add_argument("--base-url", default=BASE_URL)
        worker_parser.add_argument("--timeout", type=int, default=15)
        worker_parser.add_argument("--cookie-file", default=DEFAULT_COOKIE_FILE)
        worker_parser.add_argument("--no-browser-headers", action="store_true")
        worker_parser.add_argument("--json", action="store_true")
        worker_parser.add_argument("--qr-check-worker", action="store_true")
        worker_args = worker_parser.parse_args()
        worker_client = KyfwClient(
            base_url=worker_args.base_url,
            timeout=worker_args.timeout,
            cookie_file=worker_args.cookie_file,
            browser_headers=not worker_args.no_browser_headers,
        )
        return run_qr_login_check_worker(
            worker_client,
            cookie_file=worker_args.cookie_file,
            json_output=worker_args.json,
        )

    parser = build_parser()
    args = parser.parse_args()
    client = KyfwClient(
        base_url=args.base_url,
        timeout=args.timeout,
        cookie_file=args.cookie_file,
        browser_headers=not args.no_browser_headers,
    )

    try:
        if args.command == "login":
            if args.send_sms:
                password = ""
            else:
                password = read_password(args)
            resp = client.login(
                username=args.username,
                password=password,
                id_last4=args.id_last4,
                sms_code=args.sms_code,
                send_sms=args.send_sms,
            )
            if args.json:
                print(json.dumps(resp, ensure_ascii=False, indent=2))
            else:
                if resp.get("step") == "sms_sent":
                    print(resp.get("message"))
                else:
                    print("登录成功。")
            return 0

        if args.command == "qr-login-create":
            result = client.create_qr_login(appid=args.appid)
            image_path = write_qr_image_file(str(result.get("image") or ""))

            state_path = resolve_qr_state_path(args.cookie_file)
            state = {
                "version": 1,
                "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                "uuid": result.get("uuid"),
                "appid": result.get("appid"),
                "qr_image_file": str(image_path),
                "cookie_file": args.cookie_file,
                "base_url": args.base_url,
                "last_check": None,
            }
            save_qr_login_state(state_path, state)

            uuid = str(result.get("uuid") or "").strip()
            if not uuid:
                raise RuntimeError("二维码创建成功但 uuid 为空，无法自动启动检查进程。")
            checker_log = Path(tempfile.gettempdir()) / f"12306_qr_check_{uuid[:8]}.log"
            cmd = [
                sys.executable,
                str(Path(__file__).resolve()),
                "--base-url",
                str(args.base_url),
                "--timeout",
                str(args.timeout),
                "--cookie-file",
                str(args.cookie_file),
            ]
            if args.no_browser_headers:
                cmd.append("--no-browser-headers")
            cmd.append("--qr-check-worker")
            with checker_log.open("ab") as log_fp:
                proc = subprocess.Popen(
                    cmd,
                    stdin=subprocess.DEVNULL,
                    stdout=log_fp,
                    stderr=subprocess.STDOUT,
                    start_new_session=True,
                )
            checker_pid = proc.pid
            checker_log_file = str(checker_log)

            if args.json:
                out = {
                    "step": "qr_created",
                    "result_message": result.get("result_message"),
                    "qr_image_file": str(image_path),
                    "auto_check_started": True,
                    "auto_check_pid": checker_pid,
                    "auto_check_log_file": checker_log_file,
                    "next_action": "已自动后台启动登录检查，请扫码确认后执行: python3 client.py status",
                    "confirm_login_action": "扫码确认后执行: python3 client.py status",
                }
                print(json.dumps(out, ensure_ascii=False, indent=2))
            else:
                print("二维码已生成。")
                print("二维码图片:", str(image_path))
                print(f"已自动后台启动检查进程（PID: {checker_pid}）。")
                print("检查日志:", checker_log_file)
                print("然后再让用户用 12306 App 扫码并确认。")
                print("扫码确认后可执行以下命令确认是否登录成功：")
                print("  python3 client.py status")
            return 0

        if args.command == "status":
            status = client.check_login_status()
            if args.json:
                print(json.dumps(status, ensure_ascii=False, indent=2))
            else:
                print(f"Cookie 文件: {status.get('cookie_file')}")
                print("登录状态:", "已登录" if status.get("logged_in") else "未登录")
                if status.get("logged_in"):
                    user = status.get("user")
                    if isinstance(user, dict):
                        name = user.get("name")
                        username = user.get("username")
                        email = user.get("email")
                        mobile = user.get("mobile")
                        if any((name, username, email, mobile)):
                            print("用户信息:")
                            if name:
                                print(f"  姓名: {name}")
                            if username:
                                print(f"  用户名: {username}")
                            if email:
                                print(f"  邮箱: {email}")
                            if mobile:
                                print(f"  手机: {mobile}")
            return 0

        if args.command == "passengers":
            ensure_logged_in(client)
            result = client.query_passengers()
            if args.json:
                print(json.dumps(result, ensure_ascii=False, indent=2))
            else:
                rows = result.get("passengers") if isinstance(result, dict) else None
                if not isinstance(rows, list):
                    raise RuntimeError(f"接口返回异常: {result}")
                print("来源接口:", result.get("source"))
                print_passengers(rows, args.limit)
            return 0

        if args.command == "order-no-complete":
            ensure_logged_in(client)
            no_complete = client.query_my_order_no_complete()
            order = pick_first_no_complete_order(no_complete, payable_only=not bool(args.any))
            out = {
                "query_status": no_complete.get("status"),
                "query_httpstatus": no_complete.get("httpstatus"),
                "payable_only": not bool(args.any),
                "order": order,
            }
            if args.json:
                print(json.dumps(out, ensure_ascii=False, indent=2))
            else:
                print("未完成订单接口状态:", no_complete.get("status"), no_complete.get("httpstatus"))
                if not isinstance(order, dict):
                    print("未找到符合条件的未完成订单。")
                else:
                    from_name = order.get("from_station_name_page") or "--"
                    to_name = order.get("to_station_name_page") or "--"
                    if isinstance(from_name, list):
                        from_name = ",".join([str(x) for x in from_name if x not in (None, "")]) or "--"
                    if isinstance(to_name, list):
                        to_name = ",".join([str(x) for x in to_name if x not in (None, "")]) or "--"
                    print("订单号:", order.get("sequence_no") or "--")
                    print("下单日期:", order.get("order_date") or "--")
                    print("车次:", order.get("train_code_page") or "--")
                    print("行程:", f"{from_name} -> {to_name}")
                    print("出发时间:", order.get("start_train_date_page") or "--")
                    print("到达时间:", order.get("arrive_time_page") or "--")
                    print("支付标记:", order.get("pay_flag") or "--")
                    print("人数:", order.get("ticket_totalnum") or "--")
            return 0

        if args.command == "orders":
            ensure_logged_in(client)

            no_complete = client.query_my_order_no_complete()
            orders = client.query_my_order(
                query_where=args.where,
                start_date=args.start_date,
                end_date=args.end_date,
                page_index=args.page_index,
                page_size=args.page_size,
                query_type=args.query_type,
                train_name=args.train_name,
            )
            if args.json:
                out = {"no_complete": no_complete, "orders": orders}
                print(json.dumps(out, ensure_ascii=False, indent=2))
            else:
                print("未完成订单接口状态:", no_complete.get("status"), no_complete.get("httpstatus"))
                print_orders(orders)
            return 0

        if args.command == "candidate-queue":
            ensure_logged_in(client)
            result = client.query_candidate_queue()
            if args.json:
                print(json.dumps(result, ensure_ascii=False, indent=2))
            else:
                print_candidate_queue(result["queue"])
            return 0

        if args.command == "candidate-orders":
            ensure_logged_in(client)
            result = client.query_candidate_orders(
                processed=args.processed,
                page_no=args.page_no,
                start_date=args.start_date,
                end_date=args.end_date,
            )
            if args.json:
                print(json.dumps(result, ensure_ascii=False, indent=2))
            else:
                q = result["query"]
                print(
                    f"查询条件: type={q['type']} | page_no={q['page_no']} | "
                    f"{q['start_date']} -> {q['end_date']}"
                )
                print_candidate_orders(result["rows"], args.limit)
            return 0

        if args.command == "candidate-submit":
            ensure_logged_in(client)
            passenger_names = [x.strip() for x in str(args.passengers or "").split(",") if x.strip()]
            result = client.submit_candidate_order(
                train_date=args.date,
                from_station=args.from_station,
                to_station=args.to_station,
                train_code=args.train_code,
                seat=args.seat,
                passenger_names=passenger_names,
                purpose_codes=args.purpose,
                endpoint=args.endpoint,
                force=args.force,
                max_wait_seconds=args.max_wait_seconds,
                poll_interval=args.poll_interval,
            )
            if args.json:
                print(json.dumps(result, ensure_ascii=False, indent=2))
            else:
                step = result.get("step")
                if step == "queued":
                    print("候补提交成功并完成排队确认。")
                    print("车次:", result.get("train", {}).get("train_code"))
                    print("席别:", result.get("seat_name"), f"({result.get('seat_code')})")
                    print("提交前余票:", result.get("seat_status"))
                    print("乘客:", ",".join(result.get("selected_passengers") or []) or "--")
                    if result.get("auto_selected_passengers"):
                        print("提示: 未传 --passengers，已自动使用首位乘车人。")
                    if result.get("reserve_no"):
                        print("候补单号:", result.get("reserve_no"))
                    else:
                        print("候补单号: 暂未解析到（可用 candidate-orders 查询）")
                    print("下一步页面:", result.get("next_url"))
                elif step == "queue_waiting":
                    print("候补已提交并进入排队中。")
                    print("车次:", result.get("train", {}).get("train_code"))
                    print("席别:", result.get("seat_name"), f"({result.get('seat_code')})")
                    print("乘客:", ",".join(result.get("selected_passengers") or []) or "--")
                    if result.get("auto_selected_passengers"):
                        print("提示: 未传 --passengers，已自动使用首位乘车人。")
                    print("排队超时：", args.max_wait_seconds, "秒（仍可继续等待）")
                    print("可用 candidate-orders / candidate-queue 持续查看状态。")
                elif step == "slide_check_required":
                    print("候补提交需要滑块验证，CLI 暂不支持自动处理。")
                    print("请在 12306 Web/App 完成一次验证后再重试。")
                elif step == "face_check_required":
                    print("候补提交触发身份核验。")
                    print("车次:", result.get("train", {}).get("train_code"))
                    print("席别:", result.get("seat_name"), f"({result.get('seat_code')})")
                    print("提交前余票:", result.get("seat_status"))
                    print("face_check_code:", result.get("face_check_code"))
                    print("is_show_qrcode:", result.get("is_show_qrcode"))
                    print("请先在 12306 App 完成人证核验后重试。")
            return 0

        if args.command == "candidate-cancel":
            ensure_logged_in(client)
            result = client.cancel_candidate_order(reserve_no=args.reserve_no)
            if args.json:
                print(json.dumps(result, ensure_ascii=False, indent=2))
            else:
                print("候补订单取消成功。")
                print("候补单号:", result.get("reserve_no"))
                print("取消方式:", result.get("method"))
            return 0

        if args.command == "candidate-pay":
            ensure_logged_in(client)
            reserve_no = str(args.reserve_no or "").strip()
            queue_resp: dict[str, Any] | None = None
            if not reserve_no:
                queue_resp = client.query_candidate_queue()
                queue_raw = queue_resp.get("raw") if isinstance(queue_resp, dict) else None
                queue_data = queue_raw.get("data") if isinstance(queue_raw, dict) else None
                if isinstance(queue_data, dict):
                    reserve_no = str(queue_data.get("reserve_no") or "").strip()
            if not reserve_no:
                raise RuntimeError("未找到可支付的候补单号，请传入 --reserve-no 或先执行 candidate-queue。")

            client.continue_pay_candidate_order(reserve_no=reserve_no)
            init_pay_resp = client.init_candidate_pay_order()
            client._assert_request_ok(init_pay_resp, context="afterNatePay payOrderInit")
            pay_check_resp = client.candidate_pay_check()
            client._assert_request_ok(pay_check_resp, context="afterNatePay paycheck")
            pay_data = pay_check_resp.get("data") if isinstance(pay_check_resp, dict) else None
            if isinstance(pay_data, dict) and pay_data.get("flag") is False:
                raise RuntimeError(f"候补支付参数获取失败(flag=false): {pay_check_resp}")
            payment = client._build_payment_result(pay_check_resp)
            channel_result: dict[str, Any] | None = None
            pay_qr_url = ""
            pay_qr_image_file = ""
            pay_qr_error = ""
            if args.pay_channel:
                bank_id = client.candidate_pay_channel_to_bank_id(args.pay_channel)
                gateway_post_url = str(payment.get("gateway_post_url") or "").strip()
                gateway_post_data = payment.get("gateway_post_data")
                if not gateway_post_url or not isinstance(gateway_post_data, dict):
                    raise RuntimeError("候补支付网关参数不完整，无法生成渠道跳转链接。")
                channel_result = client.resolve_epay_channel_url(
                    gateway_post_url=gateway_post_url,
                    gateway_post_data={str(k): str(v) for k, v in gateway_post_data.items()},
                    bank_id=bank_id,
                    business_type="1",
                )
                if isinstance(channel_result, dict):
                    raw_url = str(channel_result.get("channel_redirect_url_raw") or "").strip()
                    final_url = str(channel_result.get("channel_redirect_url") or "").strip()
                    pay_qr_url = raw_url or final_url
                    if pay_qr_url:
                        try:
                            qr_path = write_payment_qr_image_file(pay_qr_url)
                            pay_qr_image_file = str(qr_path)
                        except Exception as qr_err:
                            pay_qr_error = str(qr_err)
            out = {
                "reserve_no": reserve_no,
                "pay_channel": args.pay_channel or "",
                "third_party_pay_url": (
                    str(channel_result.get("channel_redirect_url_raw") or channel_result.get("channel_redirect_url") or "")
                    if isinstance(channel_result, dict)
                    else ""
                ),
                "pay_qr_url": pay_qr_url,
                "pay_qr_image_file": pay_qr_image_file,
                "pay_qr_error": pay_qr_error,
            }
            if args.json:
                print(json.dumps(out, ensure_ascii=False, indent=2))
            else:
                print("候补单号:", reserve_no)
                if channel_result:
                    third_party_pay_url = str(
                        channel_result.get("channel_redirect_url_raw") or channel_result.get("channel_redirect_url") or ""
                    )
                    print("支付渠道:", args.pay_channel)
                    print("第三方支付链接(GET):", third_party_pay_url)
                    if pay_qr_image_file:
                        if str(pay_qr_url or "").strip() and str(pay_qr_url).strip() != third_party_pay_url:
                            print("支付二维码链接:", pay_qr_url)
                        print("支付二维码图片路径:", pay_qr_image_file)
                    elif pay_qr_error:
                        print("二维码生成失败:", pay_qr_error)
                else:
                    print("如需直接生成可浏览器打开的 GET 支付链接，请加 --pay-channel alipay|wechat|unionpay。")
            return 0

        if args.command == "order-pay":
            ensure_logged_in(client)
            result = fetch_common_order_payment(client, pay_channel=str(args.pay_channel or "").strip())
            channel_result = result.get("channel_result") if isinstance(result, dict) else None
            third_party_pay_url = (
                str(channel_result.get("channel_redirect_url_raw") or channel_result.get("channel_redirect_url") or "")
                if isinstance(channel_result, dict)
                else ""
            )
            out = {
                "pay_channel": result.get("pay_channel") if isinstance(result, dict) else "",
                "third_party_pay_url": third_party_pay_url,
                "pay_qr_url": result.get("pay_qr_url") if isinstance(result, dict) else "",
                "pay_qr_image_file": result.get("pay_qr_image_file") if isinstance(result, dict) else "",
                "pay_qr_error": result.get("pay_qr_error") if isinstance(result, dict) else "",
            }
            if args.json:
                print(json.dumps(out, ensure_ascii=False, indent=2))
            else:
                if isinstance(channel_result, dict):
                    print("支付渠道:", result.get("pay_channel"))
                    print("第三方支付链接(GET):", third_party_pay_url)
                    if result.get("pay_qr_image_file"):
                        qr_url = str(result.get("pay_qr_url") or "").strip()
                        if qr_url and qr_url != third_party_pay_url:
                            print("支付二维码链接:", qr_url)
                        print("支付二维码图片路径:", result.get("pay_qr_image_file"))
                elif result.get("pay_channel"):
                    print("提示: 未解析到渠道链接。")
                else:
                    print("如需生成渠道支付链接与二维码，请加 --pay-channel alipay|wechat|unionpay。")
                if result.get("pay_qr_error"):
                    print("二维码生成失败:", result.get("pay_qr_error"))
            return 0

        if args.command == "left-ticket":
            result = client.query_left_ticket(
                train_date=args.date,
                from_station=args.from_station,
                to_station=args.to_station,
                purpose_codes=args.purpose,
                endpoint=args.endpoint,
            )
            if args.json:
                print(json.dumps(result, ensure_ascii=False, indent=2))
            else:
                q = result["query"]
                print(
                    f"查询条件: {q['date']} {q['from_station']}({q['from_code']}) -> "
                    f"{q['to_station']}({q['to_code']}) | endpoint={q['endpoint']}"
                )
                print_left_tickets(result["rows"], args.limit)
            return 0

        if args.command == "transfer-ticket":
            result = client.query_transfer_ticket(
                train_date=args.date,
                from_station=args.from_station,
                to_station=args.to_station,
                middle_station=args.middle_station,
                result_index=args.result_index,
                can_query=args.can_query,
                is_show_wz="Y" if args.show_wz else "N",
                purpose_codes=args.purpose,
                channel=args.channel,
                endpoint=args.endpoint,
            )
            if args.json:
                print(json.dumps(result, ensure_ascii=False, indent=2))
            else:
                q = result["query"]
                print(
                    f"查询条件: {q['date']} {q['from_station']}({q['from_code']}) -> "
                    f"{q['to_station']}({q['to_code']}) | middle={q['middle_station'] or '任意'} "
                    f"| endpoint={q['endpoint']}"
                )
                meta = result.get("meta") if isinstance(result.get("meta"), dict) else {}
                print(
                    f"分页信息: result_index={meta.get('result_index')} "
                    f"can_query={meta.get('can_query')}"
                )
                print_transfer_tickets(result["rows"], args.limit)
            return 0

        if args.command == "transfer-book":
            ensure_logged_in(client)
            passenger_names = [name.strip() for name in args.passengers.split(",") if name.strip()]
            if not passenger_names:
                raise RuntimeError("--passengers 至少包含一个乘客姓名。")
            result = client.book_transfer_ticket(
                train_date=args.date,
                from_station=args.from_station,
                to_station=args.to_station,
                seat=args.seat,
                passenger_names=passenger_names,
                middle_station=args.middle_station,
                plan_index=args.plan_index,
                result_index=args.result_index,
                can_query=args.can_query,
                is_show_wz="Y" if args.show_wz else "N",
                purpose_codes=args.purpose,
                channel=args.channel,
                endpoint=args.endpoint,
                max_wait_seconds=args.max_wait_seconds,
                poll_interval=args.poll_interval,
                dry_run=args.dry_run,
            )
            if args.json:
                print(json.dumps(result, ensure_ascii=False, indent=2))
            else:
                if args.dry_run:
                    print("中转下单预检完成（未提交最终排队确认）。")
                    print("方案序号:", result.get("plan_index"))
                    print("席别:", result.get("seat_name"), f"({result.get('seat_code')})")
                    print("乘客:", ", ".join(result.get("selected_passengers") or []))
                    legs = result.get("legs") if isinstance(result.get("legs"), list) else []
                    for idx, leg in enumerate(legs, start=1):
                        if not isinstance(leg, dict):
                            continue
                        print(
                            f"  第{idx}程: {leg.get('train_code')} "
                            f"{leg.get('from_station_code')}->{leg.get('to_station_code')} "
                            f"{leg.get('train_date')}"
                        )
                else:
                    print("中转下单请求已提交。")
                    print("订单号:", result.get("order_id"))
                    print("方案序号:", result.get("plan_index"))
                    print("席别:", result.get("seat_name"), f"({result.get('seat_code')})")
                    print("乘客:", ", ".join(result.get("selected_passengers") or []))
                    print("下一步: 执行 order-pay 获取支付参数。")
            return 0

        if args.command == "route":
            route_train_no = args.train_no
            resolved_train = None
            if not route_train_no:
                resolved = client.resolve_train_no_by_train_code(
                    train_date=args.date,
                    from_station=args.from_station,
                    to_station=args.to_station,
                    train_code=args.train_code,
                    endpoint=args.endpoint,
                    purpose_codes=args.purpose,
                )
                route_train_no = resolved["train_no"]
                resolved_train = resolved.get("train")
            result = client.query_route(
                train_no=route_train_no,
                train_date=args.date,
                from_station=args.from_station,
                to_station=args.to_station,
            )
            if args.json:
                if resolved_train is not None:
                    result["resolved_train"] = resolved_train
                print(json.dumps(result, ensure_ascii=False, indent=2))
            else:
                q = result["query"]
                if args.train_code:
                    print(f"已根据车次 {args.train_code} 解析 train_no={q['train_no']}")
                print(
                    f"查询条件: train_no={q['train_no']} | {q['date']} "
                    f"{q['from_station']}({q['from_code']}) -> {q['to_station']}({q['to_code']})"
                )
                print_route(result["rows"], args.limit)
            return 0

        if args.command == "book":
            ensure_logged_in(client)
            passenger_names = [name.strip() for name in args.passengers.split(",") if name.strip()]
            if not passenger_names:
                raise RuntimeError("--passengers 至少包含一个乘客姓名。")
            result = client.book_ticket(
                train_date=args.date,
                from_station=args.from_station,
                to_station=args.to_station,
                train_code=args.train_code,
                seat=args.seat,
                passenger_names=passenger_names,
                purpose_codes=args.purpose,
                endpoint=args.endpoint,
                choose_seats=args.choose_seats,
                max_wait_seconds=args.max_wait_seconds,
                poll_interval=args.poll_interval,
                dry_run=args.dry_run,
            )
            if args.json:
                print(json.dumps(result, ensure_ascii=False, indent=2))
            else:
                if args.dry_run:
                    print("预下单检查完成（未提交最终排队确认）。")
                    print("车次:", result.get("train", {}).get("train_code"))
                    print("席别代码:", result.get("seat_code"))
                    print("乘客:", ", ".join(result.get("selected_passengers", [])))
                else:
                    print("订票请求已提交。")
                    print("订单号:", result.get("order_id"))
                    print("车次:", result.get("train", {}).get("train_code"))
                    print("席别代码:", result.get("seat_code"))
                    print("乘客:", ", ".join(result.get("selected_passengers", [])))
                    print("下一步: 执行 order-pay 获取支付参数。")
            return 0

        parser.print_help()
        return 1
    except requests.HTTPError as e:
        print(f"HTTP error: {e}", file=sys.stderr)
        return 2
    except Exception as e:  # noqa: BLE001
        print(f"Error: {e}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
