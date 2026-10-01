param(
  [string]$OutFile = "docs\screenshots\overlay-price.png"
)
$ErrorActionPreference = 'Stop'
# 1. RU-предмет из watchlist друга → буфер обмена (UTF-8 без попорченной кодировки)
$wd = "C:\Users\mezhavikiserj\BildPOE2\poe2-kit"
node -e "const fs=require('fs');const w=JSON.parse(fs.readFileSync(process.env.APPDATA+'/@poe2-kit/overlay/watchlist.json','utf8'));fs.writeFileSync(process.env.TEMP+'/item.txt',w[0].itemText,'utf8');console.log('item in buffer file')"
$raw = Get-Content "$env:TEMP\item.txt" -Raw -Encoding UTF8
Set-Clipboard -Value $raw
Write-Host "clipboard set ($($raw.Length) chars)"
# 2. Ctrl+F1 — глобальный хотей оверлея (прайс)
$sh = New-Object -ComObject WScript.Shell
$sh.SendKeys("^{F1}")
Write-Host "hotkey sent, waiting for price fetch..."
Start-Sleep 6
# 3. Скрин вкладки price
node "$wd\scripts\cdp-shot.mjs" price "$OutFile"
