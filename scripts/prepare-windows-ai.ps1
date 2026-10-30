$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$cache = Join-Path $project '.runtime/windows/ai-build'
$stage = Join-Path $project '.runtime/windows/ai'
New-Item -ItemType Directory -Force -Path $cache, $stage | Out-Null

function Get-VerifiedFile([string]$Url, [string]$Name, [string]$Sha256) {
    $path = Join-Path $cache $Name
    if (!(Test-Path $path) -or (Get-FileHash $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Sha256) {
        Invoke-WebRequest -Uri $Url -OutFile $path
    }
    if ((Get-FileHash $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Sha256) {
        throw "Checksum mismatch for $Name"
    }
    return $path
}

# Build the same persistent NCNN worker used by Linux. Vulkan is disabled for
# this first Windows package, but inference and model weights are identical.
$ncnnArchive = Get-VerifiedFile `
    'https://codeload.github.com/Tencent/ncnn/tar.gz/refs/tags/20220729' `
    'ncnn-20220729.tar.gz' `
    'fa337dce2db3aea82749633322c3572490a86d6f2e144e53aba03480f651991f'
$ncnnSource = Join-Path $cache 'ncnn-20220729'
if (!(Test-Path (Join-Path $ncnnSource 'CMakeLists.txt'))) {
    tar -xf $ncnnArchive -C $cache
    if ($LASTEXITCODE -ne 0) { throw 'Could not extract the pinned NCNN source' }
}
$vcpkg = Join-Path $env:VCPKG_INSTALLATION_ROOT 'vcpkg.exe'
if (!(Test-Path $vcpkg)) { throw 'The Windows build environment is missing vcpkg' }
& $vcpkg install 'libpng:x64-windows-static'
if ($LASTEXITCODE -ne 0) { throw 'Could not prepare static libpng for the AI worker' }
$build = Join-Path $cache 'worker-build'
$toolchain = Join-Path $env:VCPKG_INSTALLATION_ROOT 'scripts/buildsystems/vcpkg.cmake'
cmake -S (Join-Path $project 'native/ai-gpu') -B $build `
    -A x64 `
    -DCMAKE_BUILD_TYPE=Release `
    "-DNCNN_SOURCE=$ncnnSource" `
    -DRLCUT_AI_VULKAN=OFF `
    "-DCMAKE_TOOLCHAIN_FILE=$toolchain" `
    -DVCPKG_TARGET_TRIPLET=x64-windows-static `
    -DBUILD_TESTING=OFF
if ($LASTEXITCODE -ne 0) { throw 'Could not configure the Windows NCNN worker' }
cmake --build $build --config Release --target rlcut-ai-gpu --parallel 2
if ($LASTEXITCODE -ne 0) { throw 'Could not compile the Windows NCNN worker' }
Copy-Item (Join-Path $build 'Release/rlcut-ai-gpu.exe') (Join-Path $stage 'rlcut-ai-cpu.exe') -Force

$rifeArchive = Get-VerifiedFile `
    'https://github.com/nihui/rife-ncnn-vulkan/releases/download/20221029/rife-ncnn-vulkan-20221029-ubuntu.zip' `
    'rife-models.zip' `
    '1e2c7ee7fa7daa326542d50622f0afedc80cf6f1858bda411d16385ffa5cdf68'
$rifeExtract = Join-Path $cache 'rife-models'
if (Test-Path $rifeExtract) { Remove-Item -Recurse -Force $rifeExtract }
Expand-Archive -Path $rifeArchive -DestinationPath $rifeExtract
$rifeRoot = Join-Path $rifeExtract 'rife-ncnn-vulkan-20221029-ubuntu'
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'rife-v4.6') | Out-Null
Copy-Item (Join-Path $rifeRoot 'rife-v4.6/flownet.param'), (Join-Path $rifeRoot 'rife-v4.6/flownet.bin') (Join-Path $stage 'rife-v4.6') -Force
Copy-Item (Join-Path $rifeRoot 'LICENSE') (Join-Path $stage 'RIFE-LICENSE') -Force

$esrganArchive = Get-VerifiedFile `
    'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-ubuntu.zip' `
    'esrgan-models.zip' `
    'e5aa6eb131234b87c0c51f82b89390f5e3e642b7b70f2b9bbe95b6a285a40c96'
$esrganExtract = Join-Path $cache 'esrgan-models'
if (Test-Path $esrganExtract) { Remove-Item -Recurse -Force $esrganExtract }
Expand-Archive -Path $esrganArchive -DestinationPath $esrganExtract
Copy-Item (Join-Path $esrganExtract 'models/realesr-animevideov3-x2.param'), (Join-Path $esrganExtract 'models/realesr-animevideov3-x2.bin') $stage -Force

foreach ($model in @(
    @('upscayl-lite-4x.param', '22174924330297357434ad21ed0af7f4b820008d2a502b492754d130d4142714'),
    @('upscayl-lite-4x.bin', '85ee266b632a765a725425ba6a5620c088c8aa2939a03063b2d83b3462724cc1')
)) {
    $asset = Get-VerifiedFile ("https://raw.githubusercontent.com/upscayl/upscayl/v2.15.0/resources/models/" + $model[0]) $model[0] $model[1]
    Copy-Item $asset (Join-Path $stage $model[0]) -Force
}
Copy-Item (Join-Path $project 'resources/licenses/NCNN-LICENSE'), (Join-Path $project 'resources/licenses/REALESRGAN-LICENSE'), (Join-Path $project 'resources/licenses/UPSCAYL-LICENSE') $stage -Force

Write-Host 'Windows NCNN worker and the same Linux neural models are staged.'
