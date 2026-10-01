# Снимок окна оверлея: находим окно по классу Chrome_WidgetWin_1 c размером ~540x560 DIP,
# берём его физический прямоугольник и копируем регион экрана (окно прозрачное — PrintWindow даст чёрный фон).
param(
  [string]$OutFile = "$PSScriptRoot\..\docs\screenshots\overlay-buildpanel.png",
  [int]$MinW = 400,
  [int]$MinH = 400
)
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;
public class WinEnum {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lp);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lp);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  public static List<long[]> Find(string cls) {
    var res = new List<long[]>();
    EnumWindows((h, l) => {
      var sb = new StringBuilder(256); GetClassName(h, sb, 256);
      var wt = new StringBuilder(256); GetWindowText(h, wt, 256);
      if (sb.ToString() == cls && IsWindowVisible(h) && wt.ToString().StartsWith("PoE2 Kit")) {
        RECT r; GetWindowRect(h, out r);
        if (r.Right - r.Left >= 300 && r.Bottom - r.Top >= 300)
          res.Add(new long[] { h.ToInt64(), r.Left, r.Top, r.Right, r.Bottom });
      }
      return true;
    }, IntPtr.Zero);
    return res;
  }
}
"@ -ReferencedAssemblies System.Drawing
$wins = [WinEnum]::Find('Chrome_WidgetWin_1')
if (-not $wins) { Write-Error 'overlay window not found'; exit 1 }
$wins | ForEach-Object { Write-Host ("hwnd={0} rect=({1},{2})-({3},{4}) size={5}x{6}" -f $_[0],$_[1],$_[2],$_[3],$_[4],($_[3]-$_[1]),($_[4]-$_[2])) }
$w = $wins[0]
Add-Type -AssemblyName System.Drawing
$left=[int]$w[1]; $top=[int]$w[2]; $wd=[int]$w[3]-$left; $ht=[int]$w[4]-$top
$bmp = New-Object System.Drawing.Bitmap $wd, $ht
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($left, $top, 0, 0, (New-Object System.Drawing.Size $wd, $ht))
$g.Dispose()
$dir = Split-Path $OutFile -Parent
if (-not (Test-Path $dir)) { New-Item $dir -ItemType Directory -Force | Out-Null }
$bmp.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host "saved: $OutFile ($wd x $ht)"
