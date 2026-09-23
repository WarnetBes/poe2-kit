# Пересборка poe2k-overlay-transfer.zip из текущего состояния репозитория.
# Запуск из корня репо:  powershell -ExecutionPolicy Bypass -File deploy/poe2k-overlay-transfer-src/make-transfer-zip.ps1
# Результат: deploy/poe2k-overlay-transfer.zip (zip в .gitignore — бинарный артефакт).

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot\..\..").Path
$stageRoot = Join-Path $env:TEMP 'poe2k_stage'
$stage = Join-Path $stageRoot 'poe2k-overlay'
$zip = Join-Path $repo 'deploy\poe2k-overlay-transfer.zip'

if (Test-Path $stageRoot) { Remove-Item -Recurse -Force $stageRoot }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

# Дерево репо без node_modules/dist/.git/deploy и локальных отладочных файлов
# (start-overlay.bat теперь живёт в корне репо и попадает в zip сам)
robocopy $repo $stage /E /XD node_modules dist .git deploy /XF WORK_LOG.md '_*.mjs' '_*.log' '_*.txt' 'e2e_code.txt' '*.tsbuildinfo' | Out-Null

# README пакета переноски + bootstrap-скрипт перехода на git-автообновление
Copy-Item "$PSScriptRoot\README.md" (Join-Path $stage 'README-OVERLAY.md') -Force
Copy-Item "$PSScriptRoot\convert-to-git.bat" (Join-Path $stage 'convert-to-git.bat') -Force

Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -Force
"OK: $zip ($([math]::Round((Get-Item $zip).Length / 1MB, 2)) MB)"
