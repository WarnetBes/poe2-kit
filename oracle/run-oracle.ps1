# run-oracle.ps1 — headless-PoB2 оракул: снимок статов -> golden-oracle.json
# Использование:
#   .\run-oracle.ps1                 # снимок + сравнение с golden (mscorlib CI-режим)
#   .\run-oracle.ps1 -UpdateGolden    # перезаписать golden (после осознанного изменения данных/формул PoB2)
# Требования:
#   - PathOfBuilding-PoE2 в C:\TestPE\_research (или задать -PobSrc)
#   - oracle\bin\luajit.exe (luapower mingw64 build, LuaJIT 2.1, MIT)
#                  + LUA_CPATH указывает на runtime PoB2 (C-модули lua-utf8/socket/...)
param(
  [string]$PobSrc = 'C:\TestPE\_research\PathOfBuilding-PoE2\src',
  [string]$Out    = "$PSScriptRoot\oracle-output.jsonl",
  [string]$Golden = "$PSScriptRoot\golden-oracle.json",
  [switch]$UpdateGolden
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$env:LUA_PATH  = '?.lua;?\init.lua;../runtime/lua/?.lua;../runtime/lua/?/init.lua'
$env:LUA_CPATH = (Join-Path (Split-Path $PobSrc -Parent) 'runtime') + '\?.dll'
$lua = Join-Path $PSScriptRoot 'bin\luajit.exe'
$script = Join-Path $PSScriptRoot 'oracle.lua'

Push-Location $PobSrc
try {
  # CI-режим PoB2: не трогать ModCache (см. HeadlessWrapper.lua:191)
  $env:CI = 'true'
  & $lua $script | Out-File -Encoding utf8 $Out
  if ($LASTEXITCODE -ne 0) { throw "oracle.lua завершился с кодом $LASTEXITCODE" }
} finally { Pop-Location }

# JSON-строки оракула -> компактный golden-файл (сортировка ключей уже в oracle.lua)
$entries = Get-Content $Out | Where-Object { $_ -match '^\s*\{' } |
  ForEach-Object { $_ | ConvertFrom-Json }
if (-not $entries) { throw "oracle не выдал JSON (см. $Out)" }

if ($UpdateGolden) {
  # UTF-8 без BOM: иначе JSON.parse в node падает на \uFEFF
  $json = $entries | ConvertTo-Json -Depth 6 -Compress
  [System.IO.File]::WriteAllText($Golden, $json, (New-Object System.Text.UTF8Encoding($false)))
  Write-Output "Golden обновлён: $Golden"
} else {
  node (Join-Path $PSScriptRoot 'compare-golden.mjs') $Out $Golden
  if ($LASTEXITCODE -ne 0) { exit 1 }
  Write-Output "OK: оракул совпал с golden ($($entries.Count) сценариев)"
}
