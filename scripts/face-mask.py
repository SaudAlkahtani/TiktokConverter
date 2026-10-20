"""Detect faces at reduced resolution and create a lossless blur mask.

This is an aid for reviewing footage, not a guarantee that every face is found.
Manual blur rectangles can supplement the detector. The source video is never
written as decoded frames; only a compact grayscale mask is saved.
"""
import argparse
import json
import subprocess
import sys

try:
    import cv2
    import numpy as np
except ImportError as exc:
    raise SystemExit("Automatic face blur needs Python packages opencv-python-headless and numpy. Run: python -m pip install -r requirements-editor.txt") from exc


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ffmpeg", required=True)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--width", required=True, type=int)
    parser.add_argument("--height", required=True, type=int)
    parser.add_argument("--settings", required=True)
    args = parser.parse_args()
    settings = json.loads(args.settings)
    source_w, source_h = args.width, args.height
    factor = min(1, 540 / min(source_w, source_h))
    width = max(2, round(source_w * factor / 2) * 2)
    height = max(2, round(source_h * factor / 2) * 2)
    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    if cascade.empty():
        raise SystemExit("OpenCV's frontal face detector was not found.")
    writer = cv2.VideoWriter(args.output, cv2.VideoWriter_fourcc(*"FFV1"), 60, (width, height), False)
    if not writer.isOpened():
        raise SystemExit("Could not open the lossless face mask output.")
    decoder = subprocess.Popen([
        args.ffmpeg, "-hide_banner", "-loglevel", "error", "-i", args.input,
        "-vf", f"fps=60,scale={width}:{height}", "-pix_fmt", "bgr24", "-f", "rawvideo", "-"
    ], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    frame_bytes = width * height * 3
    previous = []
    frames = 0
    try:
        while True:
            raw = decoder.stdout.read(frame_bytes)
            if not raw:
                break
            if len(raw) != frame_bytes:
                raise RuntimeError("Incomplete frame from FFmpeg face detector input.")
            frame = np.frombuffer(raw, dtype=np.uint8).reshape((height, width, 3))
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            found = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=4, minSize=(20, 20))
            faces = []
            for x, y, w, h in found:
                cx, cy = (x + w / 2) / width, (y + h / 2) / height
                keep = settings.get("keepClear")
                if keep and keep["x"] <= cx <= keep["x"] + keep["w"] and keep["y"] <= cy <= keep["y"] + keep["h"]:
                    continue
                pad_x, pad_y = int(w * 0.35), int(h * 0.45)
                faces.append((max(0, x - pad_x), max(0, y - pad_y), min(width, x + w + pad_x), min(height, y + h + pad_y)))
            # Hold recent detections briefly to cover short detector misses.
            if faces:
                previous = [(face, 6) for face in faces]
            else:
                previous = [(face, ttl - 1) for face, ttl in previous if ttl > 1]
            mask = np.zeros((height, width), dtype=np.uint8)
            for face, _ in previous:
                x1, y1, x2, y2 = face
                cv2.rectangle(mask, (x1, y1), (x2, y2), 255, -1)
            at = frames / 60
            for region in settings.get("blurRegions", []):
                if region["start"] <= at <= region["end"]:
                    x1, y1 = round(region["x"] * width), round(region["y"] * height)
                    x2, y2 = round((region["x"] + region["w"]) * width), round((region["y"] + region["h"]) * height)
                    cv2.rectangle(mask, (x1, y1), (x2, y2), 255, -1)
            writer.write(mask)
            frames += 1
    finally:
        writer.release()
        decoder.stdout.close()
    error = decoder.stderr.read().decode("utf-8", "replace")[-900:]
    if decoder.wait() != 0 or not frames:
        raise RuntimeError(f"Face mask could not decode the video: {error}")
    print(json.dumps({"frames": frames, "width": width, "height": height}))


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError) as exc:
        sys.exit(str(exc))
