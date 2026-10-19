#!/usr/bin/env python3
"""Build the CPU-only tiled inference helper and stage its pinned upscale model."""
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import urllib.request
import zipfile

ROOT=Path(__file__).resolve().parents[1]
STAGE=ROOT/'.runtime/ai'
WORK=ROOT/'.runtime/ai-build'
STAGE.mkdir(parents=True,exist_ok=True)
WORK.mkdir(parents=True,exist_ok=True)
def fetch(url,digest,name):
    path=WORK/name
    def checksum():
        h=hashlib.sha256()
        with path.open('rb') as f:
            for chunk in iter(lambda:f.read(1048576),b''):h.update(chunk)
        return h.hexdigest()
    if not path.exists():
        cached=os.environ.get('RLCUT_'+name.upper().replace('.','_').replace('-','_'))
        if cached:shutil.copyfile(cached,path)
        else:
            with urllib.request.urlopen(url,timeout=120) as source,path.open('wb') as out:shutil.copyfileobj(source,out)
    if checksum()!=digest:raise SystemExit('Checksum mismatch for '+name+'; remove the cached file and retry')
    return path
archive=fetch('https://codeload.github.com/Tencent/ncnn/tar.gz/refs/tags/20220729','fa337dce2db3aea82749633322c3572490a86d6f2e144e53aba03480f651991f','ncnn.tar.gz')
source=WORK/'ncnn-20220729'
if not source.exists():
    with tarfile.open(archive) as data:
        for entry in data.getmembers():
            target=(WORK/entry.name).resolve()
            if WORK.resolve() not in target.parents or entry.issym() or entry.islnk():raise SystemExit('Unsafe ncnn archive path')
        data.extractall(WORK)
build=WORK/'ncnn-build'
subprocess.run(['cmake','-S',str(source),'-B',str(build),'-DCMAKE_BUILD_TYPE=Release','-DNCNN_VULKAN=OFF','-DNCNN_BUILD_TOOLS=OFF','-DNCNN_BUILD_EXAMPLES=OFF','-DNCNN_BUILD_BENCHMARK=OFF','-DNCNN_BUILD_TESTS=OFF','-DNCNN_SHARED_LIB=OFF'],check=True)
subprocess.run(['cmake','--build',str(build),'--parallel','2'],check=True)
flags=subprocess.check_output(['pkg-config','--cflags','--libs','libpng'],text=True).split()
subprocess.run(['c++','-O2','-std=c++17','-fopenmp','-I'+str(source/'src'),'-I'+str(build/'src'),str(ROOT/'native/ai-cpu.cpp'),str(build/'src/libncnn.a'),*flags,'-o',str(STAGE/'rlcut-ai-cpu')],check=True)
(STAGE/'rlcut-ai-cpu').chmod(0o755)
models=fetch('https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-ubuntu.zip','e5aa6eb131234b87c0c51f82b89390f5e3e642b7b70f2b9bbe95b6a285a40c96','esrgan-models.zip')
with zipfile.ZipFile(models) as data:
    for ext in ('bin','param'):
        name='realesr-animevideov3-x2.'+ext
        with data.open('models/'+name) as src,(STAGE/name).open('wb') as dst:shutil.copyfileobj(src,dst)
        (STAGE/name).chmod(0o644)
shutil.copyfile(ROOT/'resources/licenses/REALESRGAN-LICENSE',STAGE/'REALESRGAN-LICENSE')
print('Built CPU-only tiled RIFE / Real-ESRGAN helper')
