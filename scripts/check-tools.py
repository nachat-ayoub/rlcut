"""Verify a target's FFmpeg resource pair before packaging; never downloads binaries."""
import pathlib
import subprocess
import sys

folder = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'src-tauri/resources/ffmpeg')
suffix = '.exe' if sys.platform == 'win32' else ''
def output(binary, *args):
    return subprocess.run([str(binary), *args], capture_output=True, text=True, check=True).stdout
try:
    ffmpeg, ffprobe = folder / ('ffmpeg' + suffix), folder / ('ffprobe' + suffix)
    version = output(ffmpeg, '-version')
    print(version.splitlines()[0])
    print(output(ffprobe, '-version').splitlines()[0])
    if '--enable-nonfree' in version: raise ValueError('Nonfree builds must not be redistributed')
    if 'libx264' not in output(ffmpeg, '-hide_banner', '-encoders'): raise ValueError('libx264 is required')
    filters = output(ffmpeg, '-hide_banner', '-filters')
    for name in ['scale', 'crop', 'gblur', 'geq', 'overlay', 'zscale', 'tonemap']:
        if name not in filters: raise ValueError('Required filter missing: ' + name)
    print('Tools respond and support the configured pipeline. Verify target compatibility and corresponding license/source notices before distribution.')
except (OSError, ValueError, subprocess.CalledProcessError) as error:
    print('Tool verification failed:', error, file=sys.stderr)
    sys.exit(1)
