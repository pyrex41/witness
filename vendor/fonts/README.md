# vendor/fonts

`jetbrains-mono-latin-400-normal.ttf` is the repo's pinned measurement font
(see `PINNED_FONT_FILE` in `boot.js`). It is a byte-for-byte unwrap of the
WOFF shipped by the `@fontsource/jetbrains-mono` dependency — same outlines,
same metrics — because node-canvas (pango/fontconfig on Linux) cannot load
WOFF and fails silently, breaking measurement parity.

Regenerate after bumping the fontsource dependency:

```bash
node vendor/fonts/woff-to-ttf.js
```

JetBrains Mono is licensed under the SIL Open Font License 1.1
(see `node_modules/@fontsource/jetbrains-mono/LICENSE`).
