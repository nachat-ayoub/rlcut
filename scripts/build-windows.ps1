$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $project
& "$PSScriptRoot/prepare-windows-tools.ps1"
& npm run desktop:build:native -- --no-bundle --config src-tauri/tauri.windows.conf.json
if ($LASTEXITCODE -ne 0) { throw 'Windows application build failed' }

$sevenZip = 'C:\Program Files\7-Zip\7z.exe'
$sfx = 'C:\Program Files\7-Zip\7z.sfx'
if (!(Test-Path $sevenZip) -or !(Test-Path $sfx)) {
    throw 'Install 7-Zip before creating the portable Windows executable'
}
$work = Join-Path ([IO.Path]::GetTempPath()) "rlcut-portable-$PID"
$stage = Join-Path $work 'app'
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'resources/ffmpeg'), (Join-Path $project 'dist') | Out-Null
try {
    Copy-Item 'src-tauri/target/release/rlcut.exe' (Join-Path $stage 'rlcut.exe') -Force
    Copy-Item '.runtime/windows/tools/ffmpeg.exe', '.runtime/windows/tools/ffprobe.exe', '.runtime/windows/tools/ffplay.exe' (Join-Path $stage 'resources/ffmpeg') -Force
    Copy-Item '.runtime/windows/tools/notices' (Join-Path $stage 'resources/ffmpeg/notices') -Recurse -Force
    $archive = Join-Path $work 'payload.7z'
    & $sevenZip a -t7z -mx=7 $archive "$stage\*"
    if ($LASTEXITCODE -ne 0) { throw 'Could not create portable payload' }
    $config = Join-Path $work 'sfx.txt'
    [IO.File]::WriteAllText($config, ";!@Install@!UTF-8!`nTitle=`"rlcut`"`nRunProgram=`"rlcut.exe`"`nGUIMode=`"2`"`n;!@InstallEnd@!`n", [Text.UTF8Encoding]::new($false))
    cmd /c copy /b `"$sfx`"+`"$config`"+`"$archive`" `"dist\rlcut-Windows-x86_64-portable.exe`"
    if ($LASTEXITCODE -ne 0) { throw 'Could not create portable executable' }
} finally {
    if (Test-Path $work) { Remove-Item -Recurse -Force $work }
}
Write-Host 'Portable Windows app saved to dist/rlcut-Windows-x86_64-portable.exe.'
