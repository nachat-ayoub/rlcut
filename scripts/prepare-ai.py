#!/usr/bin/env python3
"""Stage the optional Linux x86_64 RIFE engine/model with a pinned archive digest."""
import hashlib
import os
from pathlib import Path
import shutil
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = '20221029'
ARCHIVE = f'rife-ncnn-vulkan-{VERSION}-ubuntu'
URL = f'https://github.com/nihui/rife-ncnn-vulkan/releases/download/{VERSION}/{ARCHIVE}.zip'
SHA256 = '1e2c7ee7fa7daa326542d50622f0afedc80cf6f1858bda411d16385ffa5cdf68'
FILES = {'rife-ncnn-vulkan': 'rife-ncnn-vulkan', 'rife-v4.6/flownet.param': 'rife-v4.6/flownet.param', 'rife-v4.6/flownet.bin': 'rife-v4.6/flownet.bin', 'LICENSE': 'RIFE-LICENSE'}
stage = ROOT / '.runtime/ai'
stage.mkdir(parents=True, exist_ok=True)
shutil.copyfile(ROOT / 'resources/licenses/NCNN-LICENSE', stage / 'NCNN-LICENSE')
stamp = stage / '.archive-sha256'
if stamp.is_file() and stamp.read_text().strip() == SHA256 and all((stage / name).is_file() for name in FILES.values()):
    print('Pinned RIFE engine already staged')
    raise SystemExit(0)

with tempfile.TemporaryDirectory(prefix='rlcut-rife-') as work:
    archive = Path(work) / 'rife.zip'
    # A local copy still requires the same digest; useful in offline build environments.
    cached = os.environ.get('RLCUT_RIFE_ARCHIVE')
    if cached:
        shutil.copyfile(cached, archive)
    else:
        print('Downloading optional RIFE engine (411 MiB at build time only)', flush=True)
        with urllib.request.urlopen(URL, timeout=120) as response, archive.open('wb') as output:
            shutil.copyfileobj(response, output)
    checksum = hashlib.sha256()
    with archive.open('rb') as payload:
        for chunk in iter(lambda: payload.read(1024 * 1024), b''):
            checksum.update(chunk)
    digest = checksum.hexdigest()
    if digest != SHA256:
        raise SystemExit(f'RIFE checksum mismatch: expected {SHA256}, received {digest}')
    stage.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as source:
        # Extract only the engine, selected model and license, never arbitrary archive paths.
        for original, target in FILES.items():
            dest = stage / target
            dest.parent.mkdir(parents=True, exist_ok=True)
            with source.open(f'{ARCHIVE}/{original}') as src, dest.open('wb') as dst:
                shutil.copyfileobj(src, dst)
    (stage / 'rife-ncnn-vulkan').chmod(0o755)
    stamp.write_text(SHA256 + '\n')
print('Staged CPU-capable RIFE v4.6 engine and license')
