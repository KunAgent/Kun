# FBS-BookWriter v2.0 三侧打包脚本
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\pack.ps1 [-Channel user|enterprise|platform|all]
#
# 三侧说明：
#   user       🟢 用户侧   SKILL.md + references/ 用户侧文档 + references/scene-packs/ 降级兜底规范
#   enterprise 🔵 企业侧   user + 企业侧文档(04-business等) + 场景包配置
#   ⚠️ 注意：$enterpriseExtra 中部分文件/目录当前用户侧仓库不存在（如 04-business/、01-core/design/），
#   这些条目留作企业版构建占位，打包时若文件缺失会跳过并警告。
#   platform   ⚙️ 平台侧   enterprise + scripts/ + assets/ + package.json 等

param(
    [string]$Channel = 'all'   # user | enterprise | platform | all
)

$ErrorActionPreference = 'Stop'
$src     = Split-Path -Parent $PSScriptRoot
$outDir  = $src   # ZIP 输出到工作区根目录

# ---------------------------------------------
# 1. 版本四源一致性校验
# ---------------------------------------------
Write-Host "`n[STEP 1] 版本四源一致性校验..." -ForegroundColor Cyan

$pkgJson       = Get-Content "$src\package.json"       -Raw -Encoding UTF8 | ConvertFrom-Json
$pkgVersion    = $pkgJson.version
$skillMd       = Get-Content "$src\SKILL.md"           -Raw -Encoding UTF8
$skillVersion  = if ($skillMd -match '(?m)^version:\s*([^\r\n]+)') { $Matches[1].Trim() } else { '' }
$versionMjs    = Get-Content "$src\scripts\version.mjs" -Raw -Encoding UTF8
$versionMjsVer = if ($versionMjs  -match "VERSION\s*=\s*'([^']+)'")  { $Matches[1].Trim() } else { '' }
$pluginMeta    = Get-Content "$src\_plugin_meta.json"  -Raw -Encoding UTF8 | ConvertFrom-Json
$pluginVersion = $pluginMeta.version

Write-Host "  package.json        : $pkgVersion"
Write-Host "  SKILL.md            : $skillVersion"
Write-Host "  scripts/version.mjs : $versionMjsVer"
Write-Host "  _plugin_meta.json   : $pluginVersion"

if (($pkgVersion -ne $skillVersion) -or
    ($pkgVersion -ne $versionMjsVer) -or
    ($pkgVersion -ne $pluginVersion)) {
    Write-Error "[FAIL] 版本号四源不一致，请统一后重试。"
    exit 1
}
$Version = $pkgVersion
Write-Host "  [OK] 版本统一：$Version" -ForegroundColor Green

# ---------------------------------------------
# 2. 场景包版本锁校验
# ---------------------------------------------
Write-Host "`n[STEP 2] 场景包版本锁校验..." -ForegroundColor Cyan

# 场景包校验可选：如果 registry.json 不存在，跳过
if (Test-Path "$src\scene-packs\registry.json") {
    $registry        = Get-Content "$src\scene-packs\registry.json" -Raw -Encoding UTF8 | ConvertFrom-Json
    $registryVersion = $registry._version
    $declaredSpVer   = $pkgJson.'scene-pack-version'

    if ($registryVersion -ne $declaredSpVer) {
        Write-Error "[FAIL] registry.json._version ($registryVersion) != package.json.scene-pack-version ($declaredSpVer)"
        exit 1
    }
    Write-Host "  [OK] 场景包版本：$registryVersion" -ForegroundColor Green
} else {
    Write-Host "  [SKIP] 场景包版本锁校验（registry.json 不存在）" -ForegroundColor Yellow
}

# ---------------------------------------------
# 3. 文件清单定义
# ---------------------------------------------

# ── 用户侧文件（相对于 $src，不含目录本身）──
$userFiles = @(
    'SKILL.md',
    'references/01-core/execution-contract-brief.md',
    'references/01-core/intake-and-routing.md',
    'references/01-core/section-3-workflow.md',
    'references/01-core/section-4-commands.md',
    'references/01-core/section-6-tech.md',
    'references/01-core/section-8-onboarding.md',
    'references/01-core/section-nlu.md',
    'references/01-core/section-s6-transformation.md',
    'references/01-core/session-protocols.md',
    'references/01-core/skill-authoritative-supplement.md',
    'references/01-core/skill-index.md',
    'references/01-core/workbuddy-agent-briefings.md',
    'references/02-quality/abbreviation-audit-lexicon.json',
    'references/02-quality/book-level-consistency.md',
    'references/02-quality/citation-format.md',
    'references/02-quality/cross-chapter-consistency.md',
    'references/02-quality/metrics.md',
    'references/02-quality/quality-AI-scan.md',
    'references/02-quality/quality-check.md',
    'references/02-quality/quality-PLC.md',
    'references/02-quality/quality-S.md',
    'references/02-quality/s5-buzzword-lexicon.json',
    'references/03-product/01-user-install-guide.md',
    'references/03-product/04-templates.md',
    'references/03-product/06-typography.md',
    'references/03-product/07-ux-design.md',
    'references/03-product/08-visual.md',
    'references/03-product/10-case-library.md',
    'references/03-product/mermaid-templates/flowchart.md',
    'references/03-product/mermaid-templates/gantt.md',
    'references/03-product/mermaid-templates/mindmap.md',
    'references/03-product/mermaid-templates/sequence.md',
    'references/03-product/mermaid-templates/state.md',
    'references/03-product/mermaid-templates/timeline.md',
    'references/05-ops/brand-outputs.md',
    'references/05-ops/delivery-guide.md',
    'references/05-ops/html-deliverable-gate.md',
    'references/05-ops/large-scale-book-strategy.md',
    'references/05-ops/multi-agent-horizontal-sync.md',
    'references/05-ops/platform-ops-brief.md',
    'references/05-ops/promise-code-user-alignment.md',
    'references/05-ops/quality-gates-brief.md',
    'references/05-ops/audit-optimization-summary-v201.md',
    'references/05-ops/optimization-complete-report-v201.md',
    'references/05-ops/phased-quality-improvement-report-v201.md',
    'references/05-ops/search-policy.json',
    'references/bibliography.md',
    'CHANGELOG.md',
    # 场景包降级兜底规范（网络不可用时 AI 读取本地内置规范）
    'references/scene-packs/consultant.md',
    'references/scene-packs/genealogy.md',
    'references/scene-packs/general.md',
    'references/scene-packs/ghostwriter.md',
    'references/scene-packs/personal-book.md',
    'references/scene-packs/report.md',
    'references/scene-packs/training.md',
    'references/scene-packs/whitepaper.md'
)

# ── 企业侧追加（在 user 基础上增量）──
$enterpriseExtra = @(
    'references/01-core/coordinator-arbiter-briefs.md',
    'references/01-core/interface-contract.md',
    'references/01-core/task-role-alias.md',
    'references/01-core/design/onboarding-flow.md',
    'references/01-core/design/preference-panel.md',
    'references/01-core/design/asset-panel.md',
    'references/01-core/design/components.md',
    'references/02-quality/L3-semantic-interface.md',
    'references/03-product/02-presets.md',
    'references/03-product/03-persona.md',
    'references/03-product/05-product-framework.md',
    'references/03-product/09-user-profile-template.md',
    'references/03-product/book-auditor-prompt.md',
    'references/04-business/membership-tiers.md',
    'references/04-business/scene-pack-spec.md',
    'references/04-business/strategy.md',
    'references/04-business/team-protocol.md',
    'references/FBS-BookWriter-v2.0-whitepaper.md',
    'references/05-ops/national-standards-editorial-checklist.md',
    'references/05-ops/artifact-registry.json',
    'references/05-ops/p0-cli-map.md',
    'references/05-ops/templates/codebuddy-book-project/CODEBUDDY.snippet.md',
    'references/05-ops/templates/codebuddy-book-project/README.md',
    'references/05-ops/templates/codebuddy-book-project/rules/fbs-bookwriter-on-demand.md.template',
    'scene-packs/enterprise.json.example',
    'scene-packs/official-schema.json',
    'scene-packs/registry.json',
    'scene-packs/user-config.json',
    '_plugin_meta.json',
    '_skillhub_meta.json'
)

# ── 平台侧追加（在 enterprise 基础上增量）——
# 取工作区 scripts/ assets/ 下所有 .mjs/.ps1/.json 文件 + package.json + scene-packs/.offline-cache/
function Get-PlatformExtra {
    $files = @()
    $files += 'package.json'
    # scripts/ 全量（排除 _archive/、node_modules/、wecom-probe-result.json）
    Get-ChildItem "$src\scripts" -Recurse -File | Where-Object {
        $_.FullName -notmatch '\\_archive\\' -and
        $_.FullName -notmatch '\\node_modules\\' -and
        $_.Name -ne 'wecom-probe-result.json'
    } | ForEach-Object {
        $files += $_.FullName.Substring($src.Length + 1).Replace('\','/')
    }
    # assets/ 全量
    if (Test-Path "$src\assets") {
        Get-ChildItem "$src\assets" -Recurse -File | ForEach-Object {
            $files += $_.FullName.Substring($src.Length + 1).Replace('\','/')
        }
    }
    # scene-packs/.offline-cache/
    if (Test-Path "$src\scene-packs\.offline-cache") {
        Get-ChildItem "$src\scene-packs\.offline-cache" -Recurse -File | ForEach-Object {
            $files += $_.FullName.Substring($src.Length + 1).Replace('\','/')
        }
    }
    return $files
}

# ---------------------------------------------
# 4. 打包函数
# ---------------------------------------------
function Build-Zip {
    param(
        [string]   $label,
        [string[]] $fileList,
        [string]   $dst
    )

    Write-Host "`n  打包 $label ..." -ForegroundColor Cyan

    # 校验所有文件存在
    $missing = @()
    foreach ($f in $fileList) {
        if (-not (Test-Path "$src\$($f.Replace('/','\'))")) { $missing += $f }
    }
    if ($missing.Count -gt 0) {
        Write-Host "  [WARN] 以下文件不存在，已跳过：" -ForegroundColor Yellow
        $missing | ForEach-Object { Write-Host "    - $_" -ForegroundColor Yellow }
    }
    $fileList = $fileList | Where-Object { $missing -notcontains $_ }

    # 写入 ZIP
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem

    if (Test-Path $dst) { Remove-Item $dst -Force }
    $stream = [System.IO.File]::Open($dst, [System.IO.FileMode]::Create)
    $zip    = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Create)

    foreach ($f in $fileList) {
        $absPath   = "$src\$($f.Replace('/','\'))"
        $entryName = "FBS-BookWriter/$f"
        $entry     = $zip.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
        $entryStream = $entry.Open()
        $fileStream  = [System.IO.File]::OpenRead($absPath)
        $fileStream.CopyTo($entryStream)
        $fileStream.Close()
        $entryStream.Close()
    }

    $zip.Dispose()
    $stream.Close()

    $count  = $fileList.Count
    $sizeMB = [math]::Round((Get-Item $dst).Length / 1MB, 1)
    Write-Host "  [OK] $count 文件, ${sizeMB}MB → $dst" -ForegroundColor Green
}

# ---------------------------------------------
# 5. 执行打包
# ---------------------------------------------
$enterpriseFiles = $userFiles + $enterpriseExtra
$platformFiles   = $enterpriseFiles + (Get-PlatformExtra)

if ($Channel -eq 'user' -or $Channel -eq 'all') {
    Build-Zip -label '🟢 用户侧' `
              -fileList $userFiles `
              -dst "$outDir\FBS-BookWriter-v$Version-user.zip"
}

if ($Channel -eq 'enterprise' -or $Channel -eq 'all') {
    Build-Zip -label '🔵 企业侧' `
              -fileList $enterpriseFiles `
              -dst "$outDir\FBS-BookWriter-v$Version-enterprise.zip"
}

if ($Channel -eq 'platform' -or $Channel -eq 'all') {
    Build-Zip -label '⚙️ 平台侧' `
              -fileList $platformFiles `
              -dst "$outDir\FBS-BookWriter-v$Version-platform.zip"
}

Write-Host "`n[DONE] 打包完成：v$Version / channel=$Channel`n" -ForegroundColor Green

# ---------------------------------------------
# 6. 用户侧引用图孤岛校验（打包后自动运行）
# ---------------------------------------------
Write-Host "[STEP 6] 用户侧引用图孤岛校验（audit-broken-links）..." -ForegroundColor Cyan

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Host "  [SKIP] 未检测到 node，跳过引用图校验（可手动运行: node scripts/audit-broken-links.mjs --channel user）" -ForegroundColor Yellow
} else {
    $auditScript = "$src\scripts\audit-broken-links.mjs"
    if (-not (Test-Path $auditScript)) {
        Write-Host "  [SKIP] 找不到 $auditScript，跳过" -ForegroundColor Yellow
    } else {
        # 对用户侧执行校验（--enforce 有 P0/P1 时退出码非零，但不阻断打包）
        node "$auditScript" --channel user --skill-root "$src"
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  [WARN] 用户侧引用图发现 P0/P1 问题，建议修复后重新打包。" -ForegroundColor Yellow
            Write-Host "         完整报告：node scripts/audit-broken-links.mjs --channel user --enforce" -ForegroundColor Yellow
        } else {
            Write-Host "  [OK] 用户侧引用图校验通过" -ForegroundColor Green
        }
    }
}

