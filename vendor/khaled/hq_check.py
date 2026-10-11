"""مساعد tiktok-hq.sh: يحدد معدل الفريمات الصحيح، ويفحص الملف الناتج.

الاستخدام:
    python3 hq_check.py rate <source> [max_fps=120]
        يطبع سطر واحد: <معدل_المصدر> <المعدل_المستهدف> <عدد_الفريمات> <vfr 0/1> <فلتر_الفريمات>

    python3 hq_check.py validate <source> <prep> <final> <target_fps> <hdr 0/1>
        يفحص الناتج ويطبع النتائج. رمز الخروج 0 = سليم، 1 = فيه مشكلة.

متوافق مع Python 3.9 (النسخة اللي تجي مع الماك).
"""

from __future__ import annotations

import json
import os
import statistics
import subprocess
import sys
from fractions import Fraction

from tiktok_quality.mp4.parser import (
    find_box, find_box_path, find_track_by_handler,
    parse_stsz, parse_stts, read_u32,
)

# المعدلات القياسية. نختار الأقرب للمعدل الفعلي للمصدر.
STANDARD_RATES = [
    Fraction(24000, 1001), Fraction(24), Fraction(25),
    Fraction(30000, 1001), Fraction(30), Fraction(48), Fraction(50),
    Fraction(60000, 1001), Fraction(60),
]
MAX_FPS = 120
GHOST_SIZE = 8           # حجم الفريم الوهمي اللي يضيفه الباتش
MIN_PSNR = 35.0          # أقل جودة مقبولة لأي فريم (مقارنة مصغّرة مع المصدر)
PSNR_WIDTH = 320
FFMPEG = os.environ.get('HQ_FFMPEG', 'ffmpeg')
FFPROBE = os.environ.get('HQ_FFPROBE', 'ffprobe')


def run(cmd: list[str]) -> str:
    return subprocess.run(cmd, capture_output=True, text=True, check=True).stdout


def packet_times(path: str) -> list[float]:
    out = run([FFPROBE, '-v', 'error', '-select_streams', 'v:0',
               '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', path])
    return sorted(float(x) for x in out.split() if x not in ('', 'N/A'))


def fmt_rate(r: Fraction) -> str:
    return str(r.numerator) if r.denominator == 1 else f'{r.numerator}/{r.denominator}'


def snap(rate: float) -> Fraction | None:
    """أقرب معدل قياسي، أو عدد صحيح قريب (100، 120، 240)، إذا الفرق أقل من 0.5%."""
    best = min(STANDARD_RATES, key=lambda s: abs(float(s) - rate))
    exact = min((Fraction(round(rate)), Fraction(round(rate * 1.001) * 1000, 1001)),
                key=lambda s: abs(float(s) - rate))
    if abs(float(exact) - rate) / rate < 0.0005:
        return exact
    return best if abs(float(best) - rate) / rate < 0.005 else None


def measure(path: str, max_fps: int = MAX_FPS) -> tuple[Fraction, Fraction, int, bool]:
    """يرجع (معدل المصدر، المعدل المستهدف، عدد الفريمات، هل الفريمات متغيرة).

    نعتمد على وسيط المسافة بين الفريمات، مو على المتوسط ولا على r_frame_rate:
    الآيفون يكتب 29.97 والفريمات فعلياً كل 1/30، وأحياناً فيه فجوة أطول شوي
    تنزّل المتوسط بدون ما يكون فيه تغيير حقيقي في المعدل.
    """
    times = packet_times(path)
    if len(times) < 2:
        return Fraction(30), Fraction(30), len(times), False
    deltas = [b - a for a, b in zip(times, times[1:]) if b > a]
    median = statistics.median(deltas)
    raw = 1 / median
    vfr = sum(abs(d - median) / median > 0.25 for d in deltas) > 0.05 * len(deltas)

    src = snap(raw) or Fraction(raw).limit_denominator(1001)
    # أعلى من الحد (120): نقسم على أصغر عدد صحيح يخليه
    # تحت الحد (120→60، 100→50)، فالتحويل يكون بأخذ فريم من كل k بدون رجّة
    k = 1
    while float(src) / k > max_fps + 0.5:
        k += 1
    target = src / k
    if snap(float(target)) is None and float(target) <= MAX_FPS:
        # معدل غريب (مثلاً 15 أو 12): أقرب معدل قياسي، مع تكرار أو حذف فريمات
        target = min(STANDARD_RATES, key=lambda s: abs(float(s) - float(target)))
    return src, target, len(times), vfr


def step(src: Fraction, target: Fraction) -> int:
    """كل كم فريم من المصدر ناخذ واحد (1 = كلها). 0 = النسبة مو عدد صحيح."""
    ratio = src / target
    return int(ratio) if ratio.denominator == 1 else 0


def frame_filter(src: Fraction, target: Fraction, vfr: bool) -> str:
    """فلتر FFmpeg للفريمات.

    لما المعدل الهدف = المصدر (أو المصدر مضاعفه)، نرتّب الفريمات 1:1 على شبكة
    الهدف (conform) بدل فلتر fps. ساعة كاميرا الآيفون تنحرف شوي (120 فعلياً
    ~119.94)، والانحراف يتجمع لين فلتر fps يكرر فريم ويزيح كل اللي بعده.
    """
    k = step(src, target)
    if vfr or k == 0:
        return f'fps={fmt_rate(target)}'
    pick = f"select='not(mod(n\\,{k}))'," if k > 1 else ''
    return f'{pick}setpts=N/({fmt_rate(target)})/TB'


def probe_json(path: str, extra: list[str]) -> dict:
    return json.loads(run([FFPROBE, '-v', 'error', '-of', 'json', *extra, path]))


def duration(path: str) -> float:
    # مدة مسار الفيديو (مو مدة الملف كله)
    streams = probe_json(path, ['-select_streams', 'v:0', '-show_entries', 'stream=duration'])['streams']
    return float(streams[0]['duration'])


def has_audio(path: str) -> bool:
    return bool(probe_json(path, ['-select_streams', 'a', '-show_entries', 'stream=index'])['streams'])


def decoded_frames(path: str) -> int:
    # الفريمات الوهمية ما تنفك، فالعدد هنا = الفريمات الحقيقية.
    # ffprobe يوقف عند أخطاء الفريمات الوهمية، فنعد بـ ffmpeg مع تجاهلها
    proc = subprocess.run([FFMPEG, '-v', 'quiet', '-nostdin', '-nostats', '-max_error_rate', '1',
                           '-i', path, '-map', '0:v:0', '-f', 'null', '-', '-progress', 'pipe:1'],
                          capture_output=True, text=True)
    frames = [line.split('=', 1)[1] for line in proc.stdout.splitlines() if line.startswith('frame=')]
    return int(frames[-1]) if frames else 0


def video_tables(path: str) -> tuple[list[int], list[tuple[int, int]], int]:
    data = open(path, 'rb').read()
    moov_pos, moov_size = find_box(data, 'moov')
    vt_pos, vt_size = find_track_by_handler(data, moov_pos, moov_size, b'vide')
    stbl_pos, stbl_size = find_box_path(data, ['mdia', 'minf', 'stbl'], vt_pos + 8, vt_pos + vt_size)
    stsz_pos, _ = find_box(data, 'stsz', stbl_pos + 8, stbl_pos + stbl_size)
    stts_pos, _ = find_box(data, 'stts', stbl_pos + 8, stbl_pos + stbl_size)
    audio_samples = 0
    at_pos, at_size = find_track_by_handler(data, moov_pos, moov_size, b'soun')
    if at_pos is not None:
        a_stbl, a_size = find_box_path(data, ['mdia', 'minf', 'stbl'], at_pos + 8, at_pos + at_size)
        a_stsz, _ = find_box(data, 'stsz', a_stbl + 8, a_stbl + a_size)
        audio_samples = read_u32(data, a_stsz + 16)
    return parse_stsz(data, stsz_pos), parse_stts(data, stts_pos), audio_samples


def min_psnr(source: str, final: str, k: int = 1) -> float | None:
    """أقل PSNR لأي فريم بعد تصغير الاثنين، مع ترتيب الفريمات حسب رقمها.

    يكشف الفريمات المحذوفة أو المكررة (تطلع ~25 dB) والتلف.
    """
    align = 'setpts=round(N/30/TB)'   # round: بدونه بعض وحدات التوقيت تقارن فريمات غلط
    pick = 'select=not(mod(n\\,%d)),' % k if k > 1 else ''   # نفس فريمات الناتج لما ناخذ فريم من كل k
    # نفس افتراض التجهيز (المصدر بدون وصف ألوان = Rec.709)، وإلا FFmpeg يحوّل
    # ألوان واحد منهم وقت المقارنة ويطلع فرق ما له وجود في الملف
    tags = 'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709'
    graph = (f'[0:v]{tags},scale={PSNR_WIDTH}:-2,format=yuv420p,setsar=1,{align}[d];'
             f'[1:v]{tags},{pick}scale={PSNR_WIDTH}:-2,format=yuv420p,setsar=1,{align}[r];'
             '[d][r]psnr=stats_file=-')
    proc = subprocess.run([FFMPEG, '-v', 'error', '-nostdin', '-max_error_rate', '1',
                           '-i', final, '-i', source, '-lavfi', graph, '-f', 'null', '-'],
                          capture_output=True, text=True)
    values = []
    for line in proc.stdout.splitlines():
        for field in line.split():
            if field.startswith('psnr_y:'):
                v = field.split(':', 1)[1]
                values.append(float('inf') if v == 'inf' else float(v))
    return min(values) if values else None


def validate(source: str, prep: str, final: str, target_fps: str, hdr: bool) -> bool:
    ok = True

    def check(passed: bool, good: str, bad: str) -> None:
        nonlocal ok
        print(f'  ✓ {good}' if passed else f'  ✗ {bad}')
        ok = ok and passed

    src_rate, _, src_frames, vfr = measure(source, MAX_FPS)
    target = Fraction(target_fps)
    k = 0 if vfr else step(src_rate, target)
    preserved = k == 1

    # 1) الفريمات الحقيقية
    out_frames = decoded_frames(final)
    if preserved:
        check(out_frames == src_frames,
              f'الفريمات: {out_frames} = عدد فريمات المصدر',
              f'الفريمات: {out_frames} والمصدر {src_frames}')
    else:
        # متغيّر الفريمات: الناتج الثابت = المدة × المعدل. غير جذي: نسبة المعدلين
        expected = (-(-src_frames // k) if k > 1
                    else round(duration(source) * float(target)) if vfr
                    else round(src_frames * float(target) / float(src_rate)))
        diff = out_frames - src_frames
        note = f'أضيف {diff} فريم بالتكرار' if diff > 0 else f'انحذف {-diff} فريم'
        reason = 'المصدر متغيّر الفريمات' if vfr else f'تحويل من {fmt_rate(src_rate)} إلى {target_fps}'
        check(abs(out_frames - expected) <= 2,
              f'الفريمات: {out_frames} ({reason}: {note})',
              f'الفريمات: {out_frames} والمتوقع حوالي {expected} ({reason})')

    # 2) المدة
    src_dur, out_dur = duration(source), duration(final)
    # ساعة الكاميرا تنحرف لين ~0.1%، والترتيب 1:1 على شبكة ثابتة يغيّر المدة بنفس النسبة
    tolerance = max(0.05, 2 / float(target), 0.002 * src_dur)
    check(abs(out_dur - src_dur) <= tolerance,
          f'المدة: {out_dur:.2f} ث = المصدر',
          f'المدة: {out_dur:.2f} ث والمصدر {src_dur:.2f} ث')

    # 3) الصوت
    if has_audio(source):
        check(has_audio(final), 'الصوت موجود', 'الصوت ضايع')

    # 4) سلامة الباتش: الفريمات الحقيقية ما تغيّرت، والوهمية بالعدد الصحيح
    p_sizes, p_stts, p_audio = video_tables(prep)
    f_sizes, f_stts, f_audio = video_tables(final)
    real = len(p_sizes)
    ghosts = f_sizes[real:]
    check(f_sizes[1:real] == p_sizes[1:real]
          and len(ghosts) > 0 and all(s == GHOST_SIZE for s in ghosts)
          and f_stts[0] == (real, p_stts[0][1])
          and f_audio == p_audio,
          f'الباتش: {real} فريم حقيقي سليم + {len(ghosts)} وهمي',
          'الباتش: جداول الملف ما تطابق الملف المجهّز')

    # 5) مقارنة الصورة مع المصدر فريم بفريم (لما الفريمات 1:1 أو فريم من كل k، والألوان SDR)
    if k >= 1 and not hdr:
        worst = min_psnr(source, final, k)
        if worst is None:
            print('  - مقارنة الصورة: ما قدرت أقارن (تخطيت)')
        else:
            check(worst >= MIN_PSNR,
                  f'الصورة: أسوأ فريم {worst:.1f} dB (كل الفريمات مطابقة للمصدر)',
                  f'الصورة: فيه فريم جودته {worst:.1f} dB (احتمال فريم مختلف أو تالف)')
    else:
        why = 'HDR تحوّل لـ SDR' if hdr else 'الفريمات اتحولت'
        print(f'  - مقارنة الصورة فريم بفريم: تخطيت ({why})')

    return ok


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd == 'rate' and len(sys.argv) in (3, 4):
        src, target, frames, vfr = measure(sys.argv[2], int(sys.argv[3]) if len(sys.argv) == 4 else MAX_FPS)
        print(fmt_rate(src), fmt_rate(target), frames, int(vfr), frame_filter(src, target, vfr))
    elif cmd == 'validate' and len(sys.argv) == 7:
        sys.exit(0 if validate(*sys.argv[2:6], hdr=sys.argv[6] == '1') else 1)
    else:
        print(__doc__, file=sys.stderr)
        sys.exit(2)


if __name__ == '__main__':
    main()
