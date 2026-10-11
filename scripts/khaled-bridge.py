"""Windows bridge for the pinned, MIT-licensed Khaled MP4 method."""
import contextlib
import io
import json
import os
from pathlib import Path
import sys
import subprocess

# Hide child FFmpeg consoles on Windows, including calls from the upstream checker.
_run = subprocess.run
def hidden_run(*args, **kwargs):
    if os.name == 'nt':
        kwargs.setdefault('creationflags', subprocess.CREATE_NO_WINDOW)
    return _run(*args, **kwargs)
subprocess.run = hidden_run

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'vendor' / 'khaled'))
from tiktok_quality import transform
import hq_check as hq


def main():
    if sys.version_info < (3, 10):
        raise RuntimeError('Python 3.10 or newer is required.')
    command = sys.argv[1]
    if command == 'rate':
        src, target, frames, vfr = hq.measure(sys.argv[2], 120)
        print(json.dumps(dict(sourceFps=hq.fmt_rate(src), targetFps=hq.fmt_rate(target),
                             sourceFrames=frames, vfr=vfr, frameFilter=hq.frame_filter(src, target, vfr))))
    elif command == 'patch':
        prep, output, fps = sys.argv[2:5]
        # The upstream patch builds several in-memory copies. Fail clearly before
        # exceeding its 32-bit MP4 box/chunk-offset limits; no half-written output.
        if os.path.getsize(prep) > 1024 ** 3:
            raise RuntimeError('Prepared MP4 exceeds the 1 GB container-patch limit. Export shorter clips.')
        stats = transform(prep, output, multiplier=10, verbose=False)
        report = io.StringIO()
        with contextlib.redirect_stdout(report):
            # Validate against prep: resizing/tone mapping are intentional, but
            # patching must preserve every decoded picture and the audio samples.
            valid = hq.validate(prep, prep, output, fps, hdr=False)
        if not valid:
            raise RuntimeError('Patched output validation failed:\n' + report.getvalue())
        def picture_hash(filename):
            result = subprocess.run([hq.FFMPEG, '-v', 'quiet', '-nostdin', '-max_error_rate', '1',
                                     '-i', filename, '-map', '0:v:0', '-an', '-vsync', '0',
                                     '-c:v', 'rawvideo', '-pix_fmt', 'yuv420p', '-f', 'hash', '-hash', 'sha256', '-'],
                                    capture_output=True, text=True, check=True)
            digest = result.stdout.strip()
            if not digest.startswith('SHA256='):
                raise RuntimeError('No decoded picture checksum was produced.')
            return digest
        if picture_hash(prep) != picture_hash(output):
            raise RuntimeError('The MP4 patch changed decoded pictures.')
        audio_matches = None
        if hq.has_audio(prep):
            def audio_hash(filename):
                result = subprocess.run([hq.FFMPEG, '-v', 'quiet', '-nostdin', '-max_error_rate', '1',
                                         '-i', filename, '-map', '0:a:0', '-vn', '-c:a', 'pcm_s16le',
                                         '-f', 'hash', '-hash', 'sha256', '-'],
                                        capture_output=True, text=True, check=True)
                if not result.stdout.strip().startswith('SHA256='):
                    raise RuntimeError('No decoded audio checksum was produced.')
                return result.stdout.strip()
            audio_matches = audio_hash(prep) == audio_hash(output)
            if not audio_matches:
                raise RuntimeError('The MP4 patch changed decoded audio.')
        if stats['declared_frames'] != stats['original_frames'] * 10:
            raise RuntimeError('Unexpected declared sample multiplier.')
        sizes, _, _ = hq.video_tables(prep)
        final_sizes, _, _ = hq.video_tables(output)
        if len(final_sizes) != len(sizes) * 10:
            raise RuntimeError('Patched sample table failed validation.')
        print(json.dumps(dict(stats=stats, validated=True, decodedPicturesMatch=True,
                             decodedAudioMatch=audio_matches, report=report.getvalue())))
    else:
        raise RuntimeError('Unknown bridge command.')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
