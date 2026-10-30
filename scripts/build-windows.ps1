$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $project
& "$PSScriptRoot/prepare-windows-tools.ps1"
& "$PSScriptRoot/prepare-windows-ai.ps1"
& npm run desktop:build:native -- --no-bundle --config src-tauri/tauri.windows.conf.json
if ($LASTEXITCODE -ne 0) { throw 'Windows application build failed' }

$work = Join-Path ([IO.Path]::GetTempPath()) "rlcut-portable-$PID"
$stage = Join-Path $work 'app'
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'resources/ffmpeg'), (Join-Path $stage 'rlcut-ai'), (Join-Path $project 'dist') | Out-Null
try {
    Copy-Item 'src-tauri/target/release/rlcut.exe' (Join-Path $stage 'rlcut.exe') -Force
    Copy-Item '.runtime/windows/tools/ffmpeg.exe', '.runtime/windows/tools/ffprobe.exe', '.runtime/windows/tools/ffplay.exe' (Join-Path $stage 'resources/ffmpeg') -Force
    Copy-Item '.runtime/windows/tools/notices' (Join-Path $stage 'resources/ffmpeg/notices') -Recurse -Force
    Copy-Item '.runtime/windows/ai/*' (Join-Path $stage 'rlcut-ai') -Recurse -Force
    $archive = Join-Path $project 'dist/rlcut-Windows-x86_64-portable.zip'
    Compress-Archive -Path "$stage\*" -DestinationPath $archive -CompressionLevel Optimal -Force
    if (!(Test-Path $archive) -or (Get-Item $archive).Length -eq 0) { throw 'Could not create portable ZIP' }
} finally {
    if (Test-Path $work) { Remove-Item -Recurse -Force $work }
}
Write-Host 'Portable Windows app saved to dist/rlcut-Windows-x86_64-portable.zip.'
