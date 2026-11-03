function Test-PathEqual([string]$Left, [string]$Right) {
  $leftPath = [IO.Path]::GetFullPath($Left).TrimEnd('\')
  $rightPath = [IO.Path]::GetFullPath($Right).TrimEnd('\')
  return [string]::Equals($leftPath, $rightPath, [StringComparison]::OrdinalIgnoreCase)
}

function Find-KunRegistration {
  $matches = @(Get-ChildItem 'HKCU:\Software' | ForEach-Object {
    try {
      $location = Get-ItemPropertyValue -LiteralPath $_.PSPath -Name InstallLocation -ErrorAction Stop
      if (Test-PathEqual $location $script:installLocation) { $_ }
    } catch {}
  })
  Assert-True ($matches.Count -eq 1) "Expected one Kun registration for $script:installLocation, found $($matches.Count)."
  $script:installRegistryPath = $matches[0].PSPath
  $script:uninstallRegistryPath = Join-Path `
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' $matches[0].PSChildName
  Assert-True (Test-Path -LiteralPath $script:uninstallRegistryPath) 'The Kun uninstall registration is missing.'
}
