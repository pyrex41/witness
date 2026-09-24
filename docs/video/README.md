# Tutorial video

[`witness-tutorial.mp4`](witness-tutorial.mp4) is a narrated walkthrough of about
four minutes. It covers where Witness runs, installing it, a passing proof, a
caught overflow, rendering, the agent fix loop, the design gates, freerange, and
the Figma diff (still WIP). [`../TUTORIAL.md`](../TUTORIAL.md) has the same
material as text.

The video is generated rather than screen-recorded. Every terminal command runs
for real when the video is built, and the output shown is what it printed.
That includes font-dependent numbers: the committed video was built on Linux,
where `sans-serif` is DejaVu Sans.

## Rebuilding

```bash
node docs/video/build.js                      # everything -> docs/video/witness-tutorial.mp4
node docs/video/build.js --only fail,agent    # a subset, e.g. while editing
node docs/video/build.js --out /tmp/test.mp4
```

| File | Role |
|---|---|
| `scenes.js` | Scene list: narration sentences, the commands to run, and slides |
| `build.js` | Runs the commands, synthesizes narration, screenshots each state, and muxes with ffmpeg |
| `template.html` | The 1920×1080 frame: title, terminal or slide, and caption |
| `tts.py` | Narration: one clip per sentence, which gives captions and command starts exact timings |

Requirements:

- `ffmpeg` (with libx264)
- Playwright + Chromium (`npm i -g playwright`; a local install also works)
- `python3` with `numpy` and `soundfile`
- A voice. The committed video uses [Kokoro](https://github.com/thewh1teagle/kokoro-onnx),
  a small offline neural TTS model. To use it, `pip install kokoro-onnx`,
  download `kokoro-v1.0.onnx` and `voices-v1.0.bin` from its
  [releases](https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0),
  and point `KOKORO_DIR` at the folder. Set `KOKORO_VOICE` and `KOKORO_SPEED`
  to change the voice. Without `KOKORO_DIR`, the build falls back to
  `espeak-ng`, which works but sounds robotic.

Intermediate files (frames, per-scene audio, and per-scene mp4s) go to
`$WITNESS_VIDEO_TMP`, which defaults to `/tmp/witness-video`.
