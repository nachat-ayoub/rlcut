#!/usr/bin/env python3
"""Build a separate Vulkan helper; the universal CPU helper remains the fallback.
No inference, device probes, benchmarks or tests are run by this script.
"""
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / '.runtime/ai-build'
STAGE = ROOT / '.runtime/ai'

def source(name, url, digest, target):
    archive = WORK / name
    if not archive.exists():
        with urllib.request.urlopen(url, timeout=120) as src, archive.open('wb') as dst:
            shutil.copyfileobj(src, dst)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != digest:
        raise SystemExit('Checksum mismatch: ' + name)
    if target.exists() and (target / 'CMakeLists.txt').exists():
        return
    unpack = WORK / (name + '-unpack')
    unpack.mkdir(exist_ok=True)
    with tarfile.open(archive) as data:
        for item in data.getmembers():
            dest = (unpack / item.name).resolve()
            if unpack.resolve() not in dest.parents or item.issym() or item.islnk():
                raise SystemExit('Unsafe archive path')
        data.extractall(unpack)
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists(): target.rmdir()  # Empty git submodule directory.
    shutil.move(str(next(unpack.iterdir())), target)
    unpack.rmdir()

ncnn = WORK / 'ncnn-20220729'
if not ncnn.exists():
    raise SystemExit('Run prepare-ai-cpu.py first')
source('glslang.tar.gz', 'https://codeload.github.com/KhronosGroup/glslang/tar.gz/refs/tags/11.11.0',
       '26c216c3062512c018cbdd752224b8dad703b7e5bb90bf338ba2dbb5d4f11438', ncnn / 'glslang')
headers = WORK / 'Vulkan-Headers-1.3.224'
source('vulkan-headers.tar.gz', 'https://codeload.github.com/KhronosGroup/Vulkan-Headers/tar.gz/refs/tags/v1.3.224',
       '8829272058455c6ba393df66b9fac3ae3617eb0df48c860e225ceb1622fa7700', headers)
loader = next((p for p in [Path('/lib/x86_64-linux-gnu/libvulkan.so.1'), Path('/usr/lib/x86_64-linux-gnu/libvulkan.so.1')] if p.exists()), None)
if loader is None: raise SystemExit('Install libvulkan1 to build the GPU helper')
build = WORK / 'gpu-helper-build'
subprocess.run(['cmake', '-S', str(ROOT / 'native/ai-gpu'), '-B', str(build),
    '-DCMAKE_BUILD_TYPE=Release', '-DNCNN_SOURCE=' + str(ncnn),
    '-DVulkan_INCLUDE_DIR=' + str(headers / 'include'), '-DVulkan_LIBRARY=' + str(loader),
    '-DBUILD_TESTING=OFF'], check=True)
subprocess.run(['cmake', '--build', str(build), '--target', 'rlcut-ai-gpu', '--parallel', os.environ.get('RLCUT_BUILD_JOBS', '2')], check=True)
shutil.copyfile(build / 'rlcut-ai-gpu', STAGE / 'rlcut-ai-gpu')
(STAGE / 'rlcut-ai-gpu').chmod(0o755)
shutil.copyfile(ncnn / 'glslang/LICENSE.txt', STAGE / 'GLSLANG-LICENSE')
shutil.copyfile(headers / 'LICENSE.txt', STAGE / 'VULKAN-HEADERS-LICENSE')
print('Built optional hardware Vulkan upscaler (CPU fallback retained)')
