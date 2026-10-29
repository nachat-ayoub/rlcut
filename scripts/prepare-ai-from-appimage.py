#!/usr/bin/env python3
"""Reuse the pinned, verified AI payload from a previously published AppImage."""

import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
URL = os.environ["RLCUT_PREBUILT_AI_APPIMAGE"]
EXPECTED = os.environ["RLCUT_PREBUILT_AI_SHA256"]
STAGE = ROOT / ".runtime/ai"
REQUIRED = (
    "rife-ncnn-vulkan",
    "rife-v4.6/flownet.param",
    "rife-v4.6/flownet.bin",
    "rlcut-ai-cpu",
    "rlcut-ai-gpu",
    "realesr-animevideov3-x2.param",
    "realesr-animevideov3-x2.bin",
    "upscayl-lite-4x.param",
    "upscayl-lite-4x.bin",
    "libvulkan.so.1",
    "libpng16.so.16",
    "libgomp.so.1",
)


def digest(path: Path) -> str:
    checksum = hashlib.sha256()
    with path.open("rb") as payload:
        for chunk in iter(lambda: payload.read(1024 * 1024), b""):
            checksum.update(chunk)
    return checksum.hexdigest()


stamp = STAGE / ".release-appimage-sha256"
if stamp.is_file() and stamp.read_text().strip() == EXPECTED and all(
    (STAGE / name).is_file() for name in REQUIRED
):
    print("Pinned release AI payload already staged")
    raise SystemExit(0)

with tempfile.TemporaryDirectory(prefix="rlcut-ai-release-") as temporary:
    work = Path(temporary)
    image = work / "rlcut.AppImage"
    local_image = os.environ.get("RLCUT_PREBUILT_AI_LOCAL_PATH")
    if local_image:
        shutil.copyfile(local_image, image)
    else:
        print("Downloading verified release AI payload", flush=True)
        with urllib.request.urlopen(URL, timeout=180) as source, image.open("wb") as output:
            shutil.copyfileobj(source, output)
    actual = digest(image)
    if actual != EXPECTED:
        raise SystemExit(f"AppImage checksum mismatch: expected {EXPECTED}, received {actual}")
    image.chmod(0o755)
    subprocess.run([str(image), "--appimage-extract"], cwd=work, check=True, stdout=subprocess.DEVNULL)
    source = work / "squashfs-root/usr/bin/rlcut-ai"
    if not source.is_dir() or not all((source / name).is_file() for name in REQUIRED):
        raise SystemExit("Published AppImage does not contain the complete AI payload")
    if STAGE.exists():
        shutil.rmtree(STAGE)
    shutil.copytree(source, STAGE)
    stamp.write_text(EXPECTED + "\n")

for executable in ("rife-ncnn-vulkan", "rlcut-ai-cpu", "rlcut-ai-gpu"):
    (STAGE / executable).chmod(0o755)
print("Staged pinned AI payload from the published AppImage")
