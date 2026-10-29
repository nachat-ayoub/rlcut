# Packaging-time download only. End users never install or download video tools.
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$cache = Join-Path $project '.runtime/windows'
$stage = Join-Path $project '.runtime/windows/tools'
$url = 'https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-8.1.2-essentials_build.zip'
New-Item -ItemType Directory -Force -Path $cache, $stage | Out-Null
$archive = Join-Path $cache 'ffmpeg-8.1.2-essentials_build.zip'
$expected = 'db580001caa24ac104c8cb856cd113a87b0a443f7bdf47d8c12b1d740584a2ec'
if (!(Test-Path $archive) -or (Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) {
    Invoke-WebRequest -Uri $url -OutFile $archive
}
if ((Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Video tools checksum verification failed' }
$extracted = Join-Path $cache 'extracted'
if (Test-Path $extracted) { Remove-Item -Recurse -Force $extracted }
Expand-Archive -Path $archive -DestinationPath $extracted
$tool = @(Get-ChildItem $extracted -Recurse -File -Filter ffmpeg.exe)
if ($tool.Count -ne 1) { throw 'Expected one Windows FFmpeg build' }
$bin = $tool[0].Directory.FullName
foreach ($name in @('ffmpeg.exe', 'ffprobe.exe', 'ffplay.exe')) {
    Copy-Item (Join-Path $bin $name) (Join-Path $stage $name) -Force
    $version = & (Join-Path $stage $name) -version
    if ($LASTEXITCODE -ne 0) { throw "$name cannot run on the packaging machine" }
    if (($version -join "`n") -match '--enable-nonfree') { throw 'Nonfree builds cannot be packaged' }
}
$encoders = & (Join-Path $stage 'ffmpeg.exe') -hide_banner -encoders 2>$null
if ($LASTEXITCODE -ne 0 -or ($encoders -join "`n") -notmatch '\blibx264\b') { throw 'H.264 encoder missing' }
$filters = & (Join-Path $stage 'ffmpeg.exe') -hide_banner -filters 2>$null
if ($LASTEXITCODE -ne 0) { throw 'Video filters could not be verified' }
foreach ($filter in @('scale', 'crop', 'gblur', 'geq', 'overlay', 'zscale', 'tonemap', 'minterpolate', 'unsharp')) {
    if (($filters -join "`n") -notmatch "\b$filter\b") { throw "Required filter missing: $filter" }
}
$notices = Join-Path $stage 'notices'
New-Item -ItemType Directory -Force -Path $notices | Out-Null
$buildRoot = Split-Path $bin -Parent
Get-ChildItem $buildRoot -File | Where-Object { $_.Extension -ne '.exe' } | Copy-Item -Destination $notices -Force
Copy-Item (Join-Path $project 'THIRD_PARTY_NOTICES.md') $notices -Force
"Archive: $url`nSHA256: $expected`nBuild/source documentation: https://www.gyan.dev/ffmpeg/builds/`nFFmpeg source: https://github.com/FFmpeg/FFmpeg/tree/n8.1.2" | Set-Content (Join-Path $notices 'build-source.txt')
& (Join-Path $stage 'ffmpeg.exe') -hide_banner -buildconf 2>&1 | Set-Content (Join-Path $notices 'build-configuration.txt')
Write-Host 'Windows video tools verified and staged for the portable app.'
