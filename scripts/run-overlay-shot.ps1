param(
  [int]$W = 2400,
  [int]$H = 2000
)
$ErrorActionPreference = 'Stop'
Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 2
$settings = "$env:APPDATA\@poe2-kit\overlay\overlay-settings.json"
node -e "const fs=require('fs');const p=process.env.APPDATA+'/@poe2-kit/overlay/overlay-settings.json';const s=JSON.parse(fs.readFileSync(p,'utf8'));s.width=$W;s.height=$H;fs.writeFileSync(p,JSON.stringify(s,null,2),'utf8')"
$p = Start-Process -FilePath "C:\Users\mezhavikiserj\BildPOE2\poe2-kit\node_modules\electron\dist\electron.exe" `
    -ArgumentList "apps\overlay" -WorkingDirectory "C:\Users\mezhavikiserj\BildPOE2\poe2-kit" -PassThru
Start-Sleep 9
Add-Type @"
using System; using System.Runtime.InteropServices;
public class R1 {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,Rr,B; }
}
"@
$r = New-Object R1+RECT
$proc = Get-Process -Id $p.Id
[R1]::GetWindowRect($proc.MainWindowHandle, [ref]$r) | Out-Null
Write-Host ("hwnd={0} rect=({1},{2},{3},{4}) size={5}x{6}" -f $proc.MainWindowHandle, $r.L, $r.T, $r.Rr, $r.B, ($r.Rr-$r.L), ($r.B-$r.T))
Write-Host "PID=$($p.Id)"
