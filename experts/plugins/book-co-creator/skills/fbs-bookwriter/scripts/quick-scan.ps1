param(
    [Parameter(Mandatory = $true)]
    [string]$BookRoot,

    [Parameter(Mandatory = $true)]
    [string]$Output
)

<#
.SYNOPSIS
  FBS-BookWriter 对话模式快速扫描脚本（无 Node.js 依赖）。

.DESCRIPTION
  递归扫描 BookRoot 下的 Markdown 文件（含 deliverables；排除 .fbs/.workbuddy/node_modules 等），输出以下机器可检项：
  - S2 冗余修饰词密度
  - S4 连接词密度
  - S5 buzzword 命中数
  - S6 破折号密度
  - B0 标题编号缺失 / 重复
  - C4 整数百分比密度

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\quick-scan.ps1 -BookRoot "d:\DV3" -Output "d:\DV3\qc-output\quick-scan.json"
#>

$ErrorActionPreference = 'Stop'

function Get-NonWhitespaceLength {
    param([string]$Text)
    return ([regex]::Replace([string]$Text, '\s+', '')).Length
}

function Get-TermHitCount {
    param(
        [string]$Text,
        [string[]]$Terms
    )

    $total = 0
    foreach ($term in $Terms) {
        if ([string]::IsNullOrWhiteSpace($term)) { continue }
        $pattern = [regex]::Escape($term)
        $total += ([regex]::Matches($Text, $pattern)).Count
    }
    return $total
}

function Get-DensityPerThousand {
    param(
        [int]$Count,
        [int]$Chars
    )

    $base = [Math]::Max($Chars, 1)
    return [Math]::Round(($Count * 1000.0) / $base, 2)
}

function Get-RelativePathCompat {
    param(
        [string]$BasePath,
        [string]$TargetPath
    )

    $baseFull = [System.IO.Path]::GetFullPath($BasePath)
    if (-not $baseFull.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
        $baseFull += [System.IO.Path]::DirectorySeparatorChar
    }
    $targetFull = [System.IO.Path]::GetFullPath($TargetPath)

    $baseUri = New-Object System.Uri($baseFull)
    $targetUri = New-Object System.Uri($targetFull)
    return [System.Uri]::UnescapeDataString($baseUri.MakeRelativeUri($targetUri).ToString()).Replace('/', [System.IO.Path]::DirectorySeparatorChar)
}

function Get-SectionIdIssues {
    param([string]$Text)

    $headings = [regex]::Matches($Text, '^(##|###)\s+.+$', [System.Text.RegularExpressions.RegexOptions]::Multiline)
    $ids = New-Object System.Collections.Generic.List[string]
    foreach ($match in $headings) {
        $idMatch = [regex]::Match($match.Value, '^(##|###)\s+((\d+\.\d+(?:\.\d+)?))')
        if ($idMatch.Success) {
            $ids.Add($idMatch.Groups[2].Value)
        }
    }

    $duplicateIds = @()
    if ($ids.Count -gt 0) {
        $duplicateIds = $ids |
            Group-Object |
            Where-Object { $_.Count -gt 1 } |
            ForEach-Object { $_.Name }
    }

    [pscustomobject]@{
        headingCount = $headings.Count
        numberedHeadingCount = $ids.Count
        missing = [Math]::Max($headings.Count - $ids.Count, 0)
        duplicates = @($duplicateIds)
    }
}

$bookRootPath = (Resolve-Path -Path $BookRoot).Path
$outputPath = [System.IO.Path]::GetFullPath($Output)
$outputDir = Split-Path -Parent $outputPath
if (-not (Test-Path -LiteralPath $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$skillRoot = Split-Path -Parent $scriptDir
$lexiconPath = Join-Path $skillRoot 'references\02-quality\s5-buzzword-lexicon.json'
$machineLexPath = Join-Path $skillRoot 'references\02-quality\s2-quality-machine-lexicon.json'

$s2Terms = @('非常','显著','大幅','极大地','深刻地','全面地','前所未有','根本','彻底','高度','充分','深入','尤其','特别','相当','极其','格外','甚')
$imperativeTerms = @('必须','务必','一定','绝不能','无论如何')
$s4Terms = @('此外','另外','同时','其次','再者','值得注意的是','需要指出的是','总的来说','由此可见','总而言之','在此基础上')
$s5Terms = @('赋能','抓手','底座','底层能力','链路','全链路','沉淀','闭环','颗粒度','打通','拉通','对齐','拉齐','心智','势能','卡位','卡点','组合拳','矩阵','生态','中台','协同','联动','融合','整合','维度','视角','层面')

if (Test-Path -LiteralPath $machineLexPath) {
    try {
        $machineJson = Get-Content -LiteralPath $machineLexPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($null -ne $machineJson.safeAdverbs -and $machineJson.safeAdverbs.Count -gt 0) {
            $s2Terms = @($machineJson.safeAdverbs)
        }
        if ($null -ne $machineJson.imperativeClassA -and $machineJson.imperativeClassA.Count -gt 0) {
            $imperativeTerms = @($machineJson.imperativeClassA)
        }
    } catch {
        # 保留内置词表
    }
}

if (Test-Path -LiteralPath $lexiconPath) {
    try {
        $lexiconJson = Get-Content -LiteralPath $lexiconPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($null -ne $lexiconJson.terms -and $lexiconJson.terms.Count -gt 0) {
            $s5Terms = @($lexiconJson.terms)
        }
    } catch {
        # 保留内置词表
    }
}

$markdownFiles = Get-ChildItem -Path $bookRootPath -Recurse -File |
    Where-Object {
        $_.Extension -ieq '.md' -and
        $_.FullName -notmatch '[\\/](node_modules|\.git|\.fbs|\.workbuddy|qc-output|releases|\.codebuddy|\.codebuddy-plugin)[\\/]'

    } |
    Sort-Object FullName

$results = New-Object System.Collections.Generic.List[object]
$summary = [ordered]@{
    s2Hits = 0
    imperativeHits = 0
    s4Hits = 0
    s5Hits = 0
    s6Hits = 0
    intPercentHits = 0
    missingSectionIds = 0
    duplicateSectionIdFiles = 0
}

foreach ($file in $markdownFiles) {
    $text = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8
    $chars = Get-NonWhitespaceLength -Text $text

    $s2Hits = Get-TermHitCount -Text $text -Terms $s2Terms
    $imperativeHits = Get-TermHitCount -Text $text -Terms $imperativeTerms
    $s4Hits = Get-TermHitCount -Text $text -Terms $s4Terms
    $s5Hits = Get-TermHitCount -Text $text -Terms $s5Terms
    $s6Hits = ([regex]::Matches($text, '——')).Count
    $intPercentHits = ([regex]::Matches($text, '\b\d+%')).Count
    $sectionIssues = Get-SectionIdIssues -Text $text

    $summary.s2Hits += $s2Hits
    $summary.imperativeHits += $imperativeHits
    $summary.s4Hits += $s4Hits
    $summary.s5Hits += $s5Hits
    $summary.s6Hits += $s6Hits
    $summary.intPercentHits += $intPercentHits
    $summary.missingSectionIds += $sectionIssues.missing
    if ($sectionIssues.duplicates.Count -gt 0) { $summary.duplicateSectionIdFiles += 1 }

    $results.Add([pscustomobject]@{
        filePath = $file.FullName
        relativePath = Get-RelativePathCompat -BasePath $bookRootPath -TargetPath $file.FullName
        chars = $chars
        s2Hits = $s2Hits
        imperativeHits = $imperativeHits
        s2Density = Get-DensityPerThousand -Count $s2Hits -Chars $chars
        s4Hits = $s4Hits
        s4Density = Get-DensityPerThousand -Count $s4Hits -Chars $chars
        s5Hits = $s5Hits
        s6Hits = $s6Hits
        s6Density = Get-DensityPerThousand -Count $s6Hits -Chars $chars
        intPercentHits = $intPercentHits
        intPercentDensity = Get-DensityPerThousand -Count $intPercentHits -Chars $chars
        sectionIdIssues = $sectionIssues
    }) | Out-Null
}

$payload = [ordered]@{
    generatedAt = (Get-Date).ToString('o')
    bookRoot = $bookRootPath
    totalFiles = $results.Count
    summary = [pscustomobject]$summary
    files = $results
}

$payload | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $outputPath -Encoding UTF8
Write-Output "quick-scan: 已输出 $outputPath"
