#!/usr/bin/env python3
"""Synthesize one scene's narration: one clip per sentence, joined with gaps.

Usage: tts.py <request.json> <out.wav>
  request.json: {"sentences": [...], "lead": 0.5, "gap": 0.3, "tail": 0.6}
Prints JSON to stdout: {"duration": s, "starts": [...], "ends": [...]}

Engine: Kokoro (neural, offline) when its model files are present in
$KOKORO_DIR (kokoro-v1.0.onnx + voices-v1.0.bin); otherwise espeak-ng.
"""
import json, os, subprocess, sys, tempfile

import numpy as np
import soundfile as sf

SR = 24000


def kokoro_engine():
    d = os.environ.get("KOKORO_DIR", "")
    model, voices = os.path.join(d, "kokoro-v1.0.onnx"), os.path.join(d, "voices-v1.0.bin")
    if not (d and os.path.exists(model) and os.path.exists(voices)):
        return None
    from kokoro_onnx import Kokoro
    k = Kokoro(model, voices)
    voice = os.environ.get("KOKORO_VOICE", "af_heart")
    speed = float(os.environ.get("KOKORO_SPEED", "1.0"))

    def say(text):
        samples, sr = k.create(text, voice=voice, speed=speed, lang="en-us")
        assert sr == SR, sr
        return samples.astype(np.float32)
    return say


def espeak_say(text):
    with tempfile.NamedTemporaryFile(suffix=".wav") as f:
        subprocess.run(["espeak-ng", "-s", "165", "-w", f.name, text], check=True)
        data, sr = sf.read(f.name, dtype="float32")
    # resample crudely to SR so every clip shares one rate
    idx = np.linspace(0, len(data) - 1, int(len(data) * SR / sr))
    return np.interp(idx, np.arange(len(data)), data).astype(np.float32)


def main():
    req = json.load(open(sys.argv[1]))
    say = kokoro_engine() or espeak_say
    silence = lambda s: np.zeros(int(s * SR), dtype=np.float32)
    parts, starts, ends, t = [silence(req.get("lead", 0.5))], [], [], req.get("lead", 0.5)
    for i, text in enumerate(req["sentences"]):
        if i:
            parts.append(silence(req.get("gap", 0.3)))
            t += req.get("gap", 0.3)
        clip = say(text)
        starts.append(t)
        t += len(clip) / SR
        ends.append(t)
        parts.append(clip)
    parts.append(silence(req.get("tail", 0.6)))
    t += req.get("tail", 0.6)
    sf.write(sys.argv[2], np.concatenate(parts), SR)
    print(json.dumps({"duration": t, "starts": starts, "ends": ends}))


if __name__ == "__main__":
    main()
