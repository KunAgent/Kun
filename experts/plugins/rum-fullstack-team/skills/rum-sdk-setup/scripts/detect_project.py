#!/usr/bin/env python3
"""
RUM SDK Project Detector

Analyzes a project directory to determine its type, framework, language,
and package manager for automated RUM SDK integration.

Usage: python3 detect_project.py <project_root>
Output: JSON object with detection results
"""

import json
import os
import sys
from pathlib import Path
from typing import List

SKIP_DIRS = {
    "node_modules", "dist", "build", ".next", ".nuxt", ".git",
    # monorepo / SDK 仓库常见干扰目录
    "packages", "demo", "test", "tests", "__tests__", "scripts", "skills",
    "docs", "lib", "coverage", ".codebuddy",
}
# 根目录常见配置文件，不应参与项目类型关键词扫描
SKIP_FILES = {
    ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.mjs",
    "rollup.config.js", "rollup.config.mjs", "rollup.config.ts",
    "webpack.config.js", "webpack.config.ts",
    "vite.config.js", "vite.config.ts", "vite.config.mjs",
    "jest.config.js", "jest.config.ts",
    "babel.config.js", "babel.config.cjs",
    "tsconfig.json", "tsconfig.base.json", "tsconfig.app.json",
    "package.json", "package-lock.json",
    "lerna.json", "project.json",
    "commitlint.config.js",
    ".prettierrc", ".prettierrc.js",
}
TEXT_EXTENSIONS = {
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".json",
    ".mjs",
    ".cjs",
    ".vue",
    ".svelte",
    ".html",
    ".ux",
    ".we",
    ".wxml",
    ".axml",
    ".ttml",
    ".qml",
}


def read_json_file(filepath: str) -> dict:
    """Safely read and parse a JSON file."""
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, UnicodeDecodeError):
        return {}


def file_exists(root: str, *paths: str) -> bool:
    """Check if any of the given paths exist relative to root."""
    return any(os.path.exists(os.path.join(root, p)) for p in paths)


def dir_exists(root: str, *paths: str) -> bool:
    """Check if any of the given directories exist relative to root."""
    return any(os.path.isdir(os.path.join(root, p)) for p in paths)


def should_skip_parts(parts: List[str]) -> bool:
    return any(part in SKIP_DIRS for part in parts)


def find_files(root: str, patterns: List[str], max_depth: int = 3) -> List[str]:
    """Find files matching patterns up to max_depth."""
    results = []
    root_path = Path(root)
    for pattern in patterns:
        for path in root_path.rglob(pattern):
            rel = path.relative_to(root_path)
            if len(rel.parts) <= max_depth and not should_skip_parts(list(rel.parts)):
                results.append(str(rel))
    return results


def project_contains_keywords(
    root: str,
    keywords: List[str],
    max_depth: int = 4,
    max_files: int = 120,
) -> bool:
    """Scan a limited set of source files for identifying keywords."""
    root_path = Path(root)
    scanned = 0
    lowered_keywords = [keyword.lower() for keyword in keywords]

    for path in root_path.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(root_path)
        if len(rel.parts) > max_depth or should_skip_parts(list(rel.parts)):
            continue
        if path.name.lower() in SKIP_FILES:
            continue
        if path.suffix.lower() not in TEXT_EXTENSIONS:
            continue
        try:
            if path.stat().st_size > 1024 * 512:
                continue
            content = path.read_text(encoding="utf-8", errors="ignore").lower()
        except OSError:
            continue
        scanned += 1
        if any(keyword in content for keyword in lowered_keywords):
            return True
        if scanned >= max_files:
            break
    return False


def detect_package_manager(root: str) -> str:
    """Detect the package manager used in the project."""
    if file_exists(root, "pnpm-lock.yaml", "pnpm-workspace.yaml"):
        return "pnpm"
    if file_exists(root, "yarn.lock"):
        return "yarn"
    if file_exists(root, "package-lock.json"):
        return "npm"
    return "npm"


def detect_language(root: str) -> str:
    """Detect if the project uses TypeScript or JavaScript."""
    if file_exists(root, "tsconfig.json", "tsconfig.app.json", "tsconfig.base.json"):
        return "typescript"

    pkg = read_json_file(os.path.join(root, "package.json"))
    all_deps = {}
    all_deps.update(pkg.get("dependencies", {}))
    all_deps.update(pkg.get("devDependencies", {}))

    if "typescript" in all_deps:
        return "typescript"

    ts_files = find_files(root, ["*.ts", "*.tsx"], max_depth=2)
    if ts_files:
        return "typescript"

    return "javascript"


def detect_existing_aegis(root: str) -> dict:
    """Check if RUM SDK is already installed.

    Two-pass detection:
    1. Check package.json dependencies for known Aegis package names.
    2. Scan source files for import/require of Aegis packages or `new Aegis(` usage.

    Returns installed package list and source-level detection results.
    """
    pkg = read_json_file(os.path.join(root, "package.json"))
    all_deps = {}
    all_deps.update(pkg.get("dependencies", {}))
    all_deps.update(pkg.get("devDependencies", {}))

    aegis_packages = [
        "aegis-web-sdk",
        "@tencent/aegis-web-sdk",
        "aegis-mp-sdk",
        "@tencent/aegis-mp-sdk",
        "aegis-rn-sdk",
        "@tencent/aegis-rn-sdk",
        "aegis-node-sdk",
        "@tencent/aegis-node-sdk",
        "aegis-hippy-sdk",
        "@tencent/aegis-hippy-sdk",
        "aegis-cocos-sdk",
        "@tencent/aegis-cocos-sdk",
        "aegis-liteapp-sdk",
        "@tencent/aegis-liteapp-sdk",
        "aegis-quickapp-sdk",
        "@tencent/aegis-quickapp-sdk",
        "aegis-viola-sdk",
        "@tencent/aegis-viola-sdk",
        "aegis-weex-sdk",
        "@tencent/aegis-weex-sdk",
    ]

    installed = [pkg_name for pkg_name in aegis_packages if pkg_name in all_deps]

    # --- Pass 2: scan source files for Aegis import / require / new Aegis ---
    # Note: project_contains_keywords lowercases both keywords and file content,
    # so "new aegis(" will match "new Aegis(" in source code.
    source_import_keywords = [kw.lower() for kw in aegis_packages]
    source_init_keywords = [
        "new aegis(",       # standard: new Aegis({...})
        "new aegis (",      # with space: new Aegis ({...})
        "new aegis\n(",     # with newline
        "aegis.info(",      # instance method calls
        "aegis.error(",
        "aegis.report(",
        "aegis.reportevent(",
        "aegis.reporttime(",
        "aegis.setconfig(",
        # CDN script tag patterns (based on actual CDN URLs used by Aegis)
        "tam.cdn-go.cn/aegis-sdk/",
        "cdn-go.cn/aegis/aegis-sdk/",
        "/aegis.min.js",
    ]
    all_source_keywords = source_import_keywords + source_init_keywords

    has_source_usage = project_contains_keywords(root, all_source_keywords)

    return {
        "hasExisting": len(installed) > 0 or has_source_usage,
        "installedPackages": installed,
        "hasSourceUsage": has_source_usage,
    }


def first_matching_dep(dep_names: List[str], all_deps: dict) -> str:
    for dep in dep_names:
        if dep in all_deps:
            return all_deps.get(dep, "")
    return ""


def detect_framework(root: str, pkg: dict) -> dict:
    """Detect the project runtime/framework and return type + version info."""
    all_deps = {}
    all_deps.update(pkg.get("dependencies", {}))
    all_deps.update(pkg.get("devDependencies", {}))
    dep_names = {name.lower() for name in all_deps.keys()}
    pkg_name = str(pkg.get("name", "")).lower()

    result = {"name": "unknown", "version": ""}

    # --- Special runtimes / SDK families (detect before generic web frameworks) ---

    if (
        "liteapp" in pkg_name
        or project_contains_keywords(root, ["lite.addeventlistener(", "lite.store", "setstore(", "litemodule"]) 
    ):
        return {"name": "liteapp", "version": pkg.get("version", "")}

    if (
        file_exists(root, "app.ux", "src/app.ux")
        or find_files(root, ["*.ux"], max_depth=4)
        or any("quickapp" in dep or dep.startswith("@hap-toolkit") for dep in dep_names)
        or project_contains_keywords(root, ["@system.fetch", "@system.device", "@system.network"])
    ):
        quickapp_version = first_matching_dep(
            [
                "@hap-toolkit/packager",
                "@hap-toolkit/server",
                "@hap-toolkit/cli",
                "quickapp-router",
                "quickapp-native",
            ],
            all_deps,
        )
        return {"name": "quickapp", "version": quickapp_version}

    if (
        "@tencent/viola-mqq" in all_deps
        or "viola" in pkg_name
        or project_contains_keywords(root, ["violaenv", "viola.requireapi(", "viola.on("])
    ):
        return {"name": "viola", "version": all_deps.get("@tencent/viola-mqq", "")}

    if (
        any("weex" in dep for dep in dep_names)
        or find_files(root, ["*.we"], max_depth=4)
        or project_contains_keywords(root, ["weex.requiremodule(", "weex.config", "stream.fetch"])
    ):
        weex_version = ""
        for dep, version in all_deps.items():
            if "weex" in dep.lower():
                weex_version = version
                break
        return {"name": "weex", "version": weex_version}

    if (
        "cocos" in pkg_name
        or any(dep in dep_names for dep in {"cocos", "cocos-engine", "cocos-creator"})
        or (dir_exists(root, "assets", "settings") and project_contains_keywords(root, ["cc.director", "cc.loader", "cc.assetmanager"]))
    ):
        cocos_version = first_matching_dep(["cocos-engine", "cocos-creator", "cocos"], all_deps)
        return {"name": "cocos", "version": cocos_version}

    if "@hippy/vue" in all_deps or "@hippy/react" in all_deps:
        hippy_version = all_deps.get("@hippy/vue", all_deps.get("@hippy/react", ""))
        return {"name": "hippy", "version": hippy_version}

    if "react-native" in all_deps:
        return {"name": "react-native", "version": all_deps.get("react-native", "")}

    # --- Mini-program detection ---

    if file_exists(root, "app.json", "project.config.json"):
        app_json = read_json_file(os.path.join(root, "app.json"))
        if "pages" in app_json or "subpackages" in app_json:
            if file_exists(root, "project.config.json"):
                project_config = read_json_file(os.path.join(root, "project.config.json"))
                if project_config.get("appid", "").startswith("wx"):
                    return {"name": "miniprogram-wechat", "version": ""}
            if file_exists(root, "project.qq.json"):
                return {"name": "miniprogram-qq", "version": ""}
            return {"name": "miniprogram-wechat", "version": ""}

    if file_exists(root, "mini.project.json"):
        return {"name": "miniprogram-alipay", "version": ""}

    if file_exists(root, "project.tt.json"):
        return {"name": "miniprogram-douyin", "version": ""}

    if "taro" in pkg_name or "@tarojs/taro" in all_deps:
        taro_version = all_deps.get("@tarojs/taro", "")
        return {"name": "miniprogram-wechat", "version": f"taro {taro_version}"}

    # --- Generic web frameworks ---

    if "next" in all_deps:
        return {"name": "web-next", "version": all_deps.get("next", "")}

    if "nuxt" in all_deps or "nuxt3" in all_deps:
        return {"name": "web-nuxt", "version": all_deps.get("nuxt", all_deps.get("nuxt3", ""))}

    if "react" in all_deps:
        return {"name": "web-react", "version": all_deps.get("react", "")}

    if "vue" in all_deps:
        return {"name": "web-vue", "version": all_deps.get("vue", "")}

    if "@angular/core" in all_deps:
        return {"name": "web-angular", "version": all_deps.get("@angular/core", "")}

    if "svelte" in all_deps:
        return {"name": "web-svelte", "version": all_deps.get("svelte", "")}

    # --- Node.js detection ---
    if any(dep in all_deps for dep in ["express", "koa", "fastify", "nestjs", "@nestjs/core", "hapi"]):
        server_dep = next(
            dep for dep in ["express", "koa", "fastify", "@nestjs/core", "hapi"] if dep in all_deps
        )
        return {"name": "node", "version": all_deps.get(server_dep, "")}

    # --- Vanilla HTML fallback ---
    html_files = find_files(root, ["*.html"], max_depth=2)
    if html_files:
        return {"name": "web-vanilla", "version": ""}

    return result


def detect_entry_files(root: str, project_type: str) -> List[str]:
    """Find the most likely entry files for SDK initialization."""
    entries = []

    if project_type.startswith("web-react") or project_type == "web-next":
        candidates = [
            "src/index.tsx",
            "src/index.ts",
            "src/index.jsx",
            "src/index.js",
            "src/main.tsx",
            "src/main.ts",
            "src/main.jsx",
            "src/main.js",
            "src/App.tsx",
            "src/App.ts",
            "src/App.jsx",
            "src/App.js",
            "pages/_app.tsx",
            "pages/_app.js",
            "src/pages/_app.tsx",
            "src/app/layout.tsx",
            "src/app/layout.ts",
            "app/layout.tsx",
            "app/layout.ts",
        ]
    elif project_type.startswith("web-vue") or project_type == "web-nuxt":
        candidates = [
            "src/main.ts",
            "src/main.js",
            "src/main.tsx",
            "src/main.jsx",
            "src/App.vue",
            "app.vue",
            "plugins/aegis.client.ts",
            "plugins/aegis.client.js",
            "src/plugins/aegis.ts",
            "src/plugins/aegis.js",
        ]
    elif project_type == "web-angular":
        candidates = [
            "src/main.ts",
            "src/app/app.module.ts",
            "src/app/app.component.ts",
        ]
    elif project_type == "web-svelte":
        candidates = [
            "src/main.ts",
            "src/main.js",
            "src/App.svelte",
            "App.svelte",
        ]
    elif project_type == "web-vanilla":
        candidates = ["index.html", "src/index.html", "public/index.html"]
    elif project_type.startswith("miniprogram"):
        candidates = [
            "app.ts",
            "app.js",
            "src/app.ts",
            "src/app.js",
            "miniprogram/app.ts",
            "miniprogram/app.js",
        ]
    elif project_type == "react-native":
        candidates = [
            "App.tsx",
            "App.js",
            "src/App.tsx",
            "src/App.js",
            "index.js",
            "index.ts",
        ]
    elif project_type == "node":
        candidates = [
            "src/index.ts",
            "src/index.js",
            "src/app.ts",
            "src/app.js",
            "src/server.ts",
            "src/server.js",
            "src/main.ts",
            "src/main.js",
            "index.ts",
            "index.js",
            "app.ts",
            "app.js",
            "server.ts",
            "server.js",
        ]
    elif project_type == "hippy":
        candidates = [
            "src/main.ts",
            "src/main.js",
            "src/index.ts",
            "src/index.js",
            "src/app.ts",
            "src/app.js",
        ]
    elif project_type == "cocos":
        candidates = [
            "src/main.ts",
            "src/main.js",
            "main.ts",
            "main.js",
            "assets/scripts/main.ts",
            "assets/scripts/main.js",
        ]
    elif project_type == "liteapp":
        candidates = [
            "common.js",
            "common.ts",
            "app.js",
            "app.ts",
            "src/app.js",
            "src/app.ts",
            "store/index.js",
            "src/store/index.js",
        ]
    elif project_type == "quickapp":
        candidates = [
            "app.ux",
            "src/app.ux",
            "main.ux",
            "src/main.ux",
        ]
    elif project_type == "viola":
        candidates = [
            "src/index.ts",
            "src/index.js",
            "src/main.ts",
            "src/main.js",
            "index.ts",
            "index.js",
            "main.ts",
            "main.js",
        ]
    elif project_type == "weex":
        candidates = [
            "src/main.ts",
            "src/main.js",
            "src/index.ts",
            "src/index.js",
            "main.ts",
            "main.js",
            "index.ts",
            "index.js",
        ]
    else:
        candidates = []

    for candidate in candidates:
        full_path = os.path.join(root, candidate)
        if os.path.exists(full_path):
            entries.append(candidate)

    return entries


def detect_vue_version(root: str, pkg: dict) -> int:
    """Detect Vue major version (2 or 3)."""
    all_deps = {}
    all_deps.update(pkg.get("dependencies", {}))
    all_deps.update(pkg.get("devDependencies", {}))

    vue_version = all_deps.get("vue", "")

    if vue_version.startswith("^3") or vue_version.startswith("~3") or vue_version.startswith("3"):
        return 3
    if "@vue/compiler-sfc" in all_deps or "vue-loader" not in all_deps:
        if "@vue/compiler-sfc" in all_deps:
            return 3

    if vue_version.startswith("^2") or vue_version.startswith("~2") or vue_version.startswith("2"):
        return 2
    if "vue-template-compiler" in all_deps:
        return 2

    return 3


def detect_platforms(root: str) -> List[str]:
    """Scan for all platform signals in the project, even across subdirectories.

    Returns a list of detected platform identifiers (e.g. ["web", "miniprogram-wechat"]).
    This helps identify composite projects that contain code for multiple platforms.
    """
    platforms = []

    # --- Web signals ---
    html_files = find_files(root, ["*.html"], max_depth=3)
    if html_files:
        platforms.append("web")

    # --- WeChat Mini-Program signals ---
    # Check root level and common subdirectories for mini-program markers
    mp_markers = ["app.json", "project.config.json"]
    mp_extensions = ["*.wxml", "*.wxss"]

    # Check root level
    has_mp_at_root = file_exists(root, *mp_markers)

    # Check common subdirectories where mini-program code may reside
    mp_subdirs = [
        "statics/mp_view", "dist/mp-weixin", "dist/build/mp-weixin",
        "unpackage/dist/build/mp-weixin", "miniprogram", "mp",
    ]
    has_mp_in_subdir = False
    mp_subdir_path = ""
    for subdir in mp_subdirs:
        subdir_full = os.path.join(root, subdir)
        if os.path.isdir(subdir_full):
            if file_exists(subdir_full, *mp_markers):
                has_mp_in_subdir = True
                mp_subdir_path = subdir
                break

    # Also scan for .wxml files anywhere in the project
    wxml_files = find_files(root, mp_extensions, max_depth=5)

    if has_mp_at_root or has_mp_in_subdir or wxml_files:
        platforms.append("miniprogram-wechat")

    # --- Alipay Mini-Program signals ---
    axml_files = find_files(root, ["*.axml"], max_depth=5)
    if file_exists(root, "mini.project.json") or axml_files:
        platforms.append("miniprogram-alipay")

    # --- Douyin Mini-Program signals ---
    ttml_files = find_files(root, ["*.ttml"], max_depth=5)
    if file_exists(root, "project.tt.json") or ttml_files:
        platforms.append("miniprogram-douyin")

    # --- Node.js signals ---
    pkg = read_json_file(os.path.join(root, "package.json"))
    all_deps = {}
    all_deps.update(pkg.get("dependencies", {}))
    all_deps.update(pkg.get("devDependencies", {}))
    if any(dep in all_deps for dep in ["express", "koa", "fastify", "nestjs", "@nestjs/core", "hapi"]):
        platforms.append("node")

    # --- React Native signals ---
    if "react-native" in all_deps:
        platforms.append("react-native")

    # --- QQ Mini-Program signals ---
    if file_exists(root, "project.qq.json"):
        platforms.append("miniprogram-qq")

    # --- Hippy signals ---
    if "@hippy/vue" in all_deps or "@hippy/react" in all_deps:
        platforms.append("hippy")

    # --- Cocos signals ---
    if (
        any(dep in {name.lower() for name in all_deps} for dep in {"cocos", "cocos-engine", "cocos-creator"})
        or project_contains_keywords(root, ["cc.director", "cc.loader", "cc.assetmanager"])
    ):
        platforms.append("cocos")

    # --- LiteApp signals ---
    if project_contains_keywords(root, ["lite.addeventlistener(", "lite.store", "litemodule"]):
        platforms.append("liteapp")

    # --- QuickApp signals ---
    if (
        file_exists(root, "app.ux", "src/app.ux")
        or find_files(root, ["*.ux"], max_depth=4)
        or any("quickapp" in dep or dep.startswith("@hap-toolkit") for dep in {name.lower() for name in all_deps})
    ):
        platforms.append("quickapp")

    # --- Viola signals ---
    if (
        "@tencent/viola-mqq" in all_deps
        or project_contains_keywords(root, ["violaenv", "viola.requireapi(", "viola.on("])
    ):
        platforms.append("viola")

    # --- Weex signals ---
    if (
        any("weex" in dep for dep in {name.lower() for name in all_deps})
        or find_files(root, ["*.we"], max_depth=4)
        or project_contains_keywords(root, ["weex.requiremodule(", "weex?.requiremodule(", "weex.config"])
    ):
        platforms.append("weex")

    # --- PHP backend signals (not an SDK target, but useful context) ---
    php_files = find_files(root, ["*.php"], max_depth=2)
    if php_files:
        platforms.append("php-backend")

    return platforms


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: detect_project.py <project_root>"}))
        sys.exit(1)

    root = os.path.abspath(sys.argv[1])

    if not os.path.isdir(root):
        print(json.dumps({"error": f"Directory not found: {root}"}))
        sys.exit(1)

    # Always detect all platform signals first (regardless of package.json)
    detected_platforms = detect_platforms(root)
    is_composite = len([p for p in detected_platforms if p != "php-backend"]) > 1

    pkg_path = os.path.join(root, "package.json")
    pkg = read_json_file(pkg_path)

    if not pkg:
        # Even without package.json, scan source files for Aegis usage (e.g. CDN import)
        aegis_source_keywords = [
            "aegis-web-sdk", "@tencent/aegis-web-sdk",
            "aegis-mp-sdk", "@tencent/aegis-mp-sdk",
            "aegis-rn-sdk", "@tencent/aegis-rn-sdk",
            "aegis-node-sdk", "@tencent/aegis-node-sdk",
            "new aegis(", "new aegis (",
            "aegis.info(", "aegis.error(", "aegis.report(",
            "tam.cdn-go.cn/aegis-sdk/", "cdn-go.cn/aegis/aegis-sdk/",
            "/aegis.min.js",
        ]
        has_source_usage = project_contains_keywords(root, aegis_source_keywords)

        html_files = find_files(root, ["*.html"], max_depth=2)
        quickapp_files = find_files(root, ["*.ux"], max_depth=4)
        if quickapp_files:
            result = {
                "projectType": "quickapp",
                "language": "javascript",
                "packageManager": "npm",
                "entryFiles": quickapp_files[:3],
                "hasExistingAegis": has_source_usage,
                "hasSourceUsage": has_source_usage,
                "framework": {"name": "quickapp", "version": ""},
                "detectedPlatforms": detected_platforms,
                "isCompositeProject": is_composite,
            }
        elif is_composite:
            primary = detected_platforms[0] if detected_platforms else "unknown"
            result = {
                "projectType": primary,
                "language": "javascript",
                "packageManager": "npm",
                "entryFiles": html_files[:3] if html_files else [],
                "hasExistingAegis": has_source_usage,
                "hasSourceUsage": has_source_usage,
                "framework": {"name": primary, "version": ""},
                "detectedPlatforms": detected_platforms,
                "isCompositeProject": True,
            }
        elif html_files:
            result = {
                "projectType": "web-vanilla",
                "language": "javascript",
                "packageManager": "npm",
                "entryFiles": html_files[:3],
                "hasExistingAegis": has_source_usage,
                "hasSourceUsage": has_source_usage,
                "framework": {"name": "vanilla", "version": ""},
                "detectedPlatforms": detected_platforms,
                "isCompositeProject": is_composite,
            }
        else:
            result = {
                "projectType": "unknown",
                "language": "unknown",
                "packageManager": "unknown",
                "entryFiles": [],
                "hasExistingAegis": has_source_usage,
                "hasSourceUsage": has_source_usage,
                "framework": {"name": "unknown", "version": ""},
                "detectedPlatforms": detected_platforms,
                "isCompositeProject": is_composite,
            }
        print(json.dumps(result, indent=2))
        sys.exit(0)

    framework = detect_framework(root, pkg)
    project_type = framework["name"]
    language = detect_language(root)
    package_manager = detect_package_manager(root)
    has_aegis = detect_existing_aegis(root)
    entry_files = detect_entry_files(root, project_type)

    extra = {}
    if project_type.startswith("web-vue"):
        extra["vueVersion"] = detect_vue_version(root, pkg)

    result = {
        "projectType": project_type,
        "language": language,
        "packageManager": package_manager,
        "entryFiles": entry_files,
        "hasExistingAegis": has_aegis["hasExisting"],
        "installedAegisPackages": has_aegis["installedPackages"],
        "hasSourceUsage": has_aegis["hasSourceUsage"],
        "framework": framework,
        "detectedPlatforms": detected_platforms,
        "isCompositeProject": is_composite,
    }

    if extra:
        result["extra"] = extra

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
