# Rebuild poe2k-overlay-transfer.zip from the current repo state.
# Run from repo root:  powershell -ExecutionPolicy Bypass -File deploy/poe2k-overlay-transfer-src/make-transfer-zip.ps1
# Result: deploy/poe2k-overlay-transfer.zip + auto git commit & push of the zip
# (game PC pulls the fresh build straight from git).

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot\..\..").Path
$stageRoot = Join-Path $env:TEMP 'poe2k_stage'
$stage = Join-Path $stageRoot 'poe2k-overlay'
$zip = Join-Path $repo 'deploy\poe2k-overlay-transfer.zip'

if (Test-Path $stageRoot) { Remove-Item -Recurse -Force $stageRoot }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

# Repo tree without node_modules/dist/.git/deploy and local debug files
# (start-overlay.bat now lives in the repo root and is zipped automatically)
robocopy $repo $stage /E /XD node_modules dist .git deploy /XF WORK_LOG.md 'README-netfix.md' '_*.mjs' '_*.log' '_*.txt' '_*.py' '_*.json' 'e2e_code.txt' '*.tsbuildinfo' | Out-Null

# Transfer package README + bootstrap script for the git auto-update path
Copy-Item "$PSScriptRoot\README.md" (Join-Path $stage 'README-OVERLAY.md') -Force
Copy-Item "$PSScriptRoot\convert-to-git.bat" (Join-Path $stage 'convert-to-git.bat') -Force

Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -Force
"OK: $zip ($([math]::Round((Get-Item $zip).Length / 1MB, 2)) MB)"

# ── Publish zip to the repo: game PC pulls the fresh build straight from git ──
Push-Location $repo
git add -- deploy/poe2k-overlay-transfer.zip
if (git diff --cached --quiet) {
  "git: transfer-zip unchanged, no commit needed"
} else {
  git commit -m "chore: fresh transfer-zip for game PC (auto)"
}
git push origin main
if ($LASTEXITCODE -ne 0) {
  "WARN: push failed (network?) - zip committed locally, retry manually: git push origin main"
}
Pop-Location
