$ErrorActionPreference = 'Stop'
$version = '2026.10.26'
$folder = '.runtime/windows/yt-dlp'
$target = Join-Path $folder 'yt-dlp.exe'
$base = "https://github.com/yt-dlp/yt-dlp/releases/download/$version"
New-Item -ItemType Directory -Force -Path $folder | Out-Null
$sums = Invoke-RestMethod "$base/SHA2-256SUMS"
$expected = (($sums -split "`n" | Where-Object { $_ -match '\syt-dlp\.exe\s*$' } | Select-Object -First 1) -split '\s+')[0]
if (!$expected) { throw 'Could not find the official yt-dlp.exe checksum' }
if ((Test-Path $target) -and ((Get-FileHash $target -Algorithm SHA256).Hash -ieq $expected)) { exit 0 }
$temporary = "$target.download"
Invoke-WebRequest "$base/yt-dlp.exe" -OutFile $temporary
$actual = (Get-FileHash $temporary -Algorithm SHA256).Hash
if ($actual -ine $expected) { Remove-Item $temporary -Force; throw 'yt-dlp.exe checksum mismatch' }
Move-Item $temporary $target -Force
Write-Host "rlcut: prepared yt-dlp $version for Windows audio previews."
