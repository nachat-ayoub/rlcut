"""Real FFmpeg integration tests. Run `npm run test:integration` after installing FFmpeg.
The graph is compiled from the production Rust builder, never reimplemented here.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
FFMPEG = os.environ.get('RLCUT_FFMPEG') or shutil.which('ffmpeg')
FFPROBE = os.environ.get('RLCUT_FFPROBE') or shutil.which('ffprobe')

def run(args):
    return subprocess.run([str(a) for a in args], check=True, capture_output=True, text=True)

@unittest.skipUnless(FFMPEG and FFPROBE, 'Install FFmpeg and FFprobe to run real encoding tests')
class Pipeline(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        (ROOT / '.checks').mkdir(exist_ok=True)
        cls.cli = ROOT / '.checks' / ('graph-cli.exe' if os.name == 'nt' else 'graph-cli')
        run(['rustc', '--edition=2021', ROOT / 'scripts/graph-cli.rs', '-o', cls.cli])

    def exercise(self, width, height, quality, fps, audio, shape):
        with tempfile.TemporaryDirectory(prefix='rlcut-') as folder:
            folder = Path(folder)
            source, output, preview = folder / 'source unicode é.mp4', folder / 'short.mp4', folder / 'preview.png'
            args = [FFMPEG, '-v', 'error', '-f', 'lavfi', '-i', f'testsrc2=size={width}x{height}:rate=24:duration=0.5']
            if audio:
                args += ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.8', '-c:a', 'aac']
            run(args + ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', source])
            graph = run([self.cli, width, height, quality, fps, shape, 'audio' if audio else 'silent']).stdout.strip()
            common = [FFMPEG, '-v', 'error', '-filter_complex_threads', '1', '-i', source, '-filter_complex', graph, '-map', '[out]']
            # Execute production export arguments as well as the production graph.
            # This catches audio duration/CFR/encoder bugs hidden by a test-only command.
            export_args = run([self.cli, width, height, quality, fps, shape,
                               'audio' if audio else 'silent', source, output, 0.5]).stdout.rstrip('\0').split('\0')
            run([FFMPEG] + export_args)
            run(common + ['-frames:v', '1', '-threads', '1', '-update', '1', preview])
            info = json.loads(run([FFPROBE, '-v', 'error', '-show_streams', '-show_format', '-of', 'json', output]).stdout)
            stream = next(s for s in info['streams'] if s['codec_type'] == 'video')
            expected = {480: (480, 854), 720: (720, 1280), 1080: (1080, 1920)}[quality]
            self.assertEqual((stream['width'], stream['height']), expected)
            self.assertEqual(stream['r_frame_rate'], f'{fps}/1')
            self.assertEqual(stream['codec_name'], 'h264')
            self.assertEqual(stream['sample_aspect_ratio'], '1:1')
            self.assertEqual(any(s['codec_type'] == 'audio' for s in info['streams']), audio)
            self.assertAlmostEqual(float(info['format']['duration']), 0.5, delta=0.15)
            # Compare lossless preview with the decoded first export frame. Encoding can
            # change a few values; a large difference signals composition drift.
            raw_a = subprocess.check_output([str(FFMPEG), '-v', 'error', '-i', str(preview), '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'])
            raw_b = subprocess.check_output([str(FFMPEG), '-v', 'error', '-i', str(output), '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'])
            self.assertEqual(len(raw_a), len(raw_b))
            self.assertLess(sum(abs(a-b) for a,b in zip(raw_a,raw_b))/len(raw_a), 8.0)

    def test_480_30_audio_circle(self): self.exercise(640, 360, 480, 30, True, 'circle')
    def test_720_60_silent_ellipse(self): self.exercise(1280, 720, 720, 60, False, 'ellipse')
    def test_1080_30_4k(self): self.exercise(3840, 2160, 1080, 30, False, 'circle')
    def test_portrait_source(self): self.exercise(360, 640, 480, 60, True, 'ellipse')

if __name__ == '__main__': unittest.main(verbosity=2)
