$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
& "$PSScriptRoot/prepare-windows-tools.ps1"
& npm run desktop:build:native -- --config src-tauri/tauri.windows.conf.json
if ($LASTEXITCODE -ne 0) { throw 'Windows installer build failed' }
$installer = @(Get-ChildItem 'src-tauri/target/release/bundle/nsis' -Filter '*-setup.exe')
if ($installer.Count -ne 1) { throw 'Expected one Windows installer' }
Copy-Item $installer[0].FullName 'dist/rlcut-setup.exe' -Force
Write-Host 'Windows installer saved to dist/rlcut-setup.exe. Video tools and WebView2 are included.'
