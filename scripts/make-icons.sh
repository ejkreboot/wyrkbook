#!/usr/bin/env bash
#
# Regenerates every icon asset from static/logo.png.
# Run after replacing the logo:  npm run icons
#
# Uses sips (macOS built-in) for resizing and a few lines of Node for the .ico,
# so there is no ImageMagick or Pillow dependency to install.
set -euo pipefail
cd "$(dirname "$0")/.."

SRC=static/logo.png
[ -f "$SRC" ] || { echo "missing $SRC"; exit 1; }

W=$(sips -g pixelWidth "$SRC" | awk '/pixelWidth/{print $2}')
H=$(sips -g pixelHeight "$SRC" | awk '/pixelHeight/{print $2}')
SIDE=$(( W > H ? W : H ))

# Square canvas on the paper tone. A transparent square would leave the dark
# line-art invisible against dark browser chrome.
sips -p "$SIDE" "$SIDE" --padColor FAF7F2 "$SRC" --out /tmp/wyrkbook-square.png >/dev/null

for s in 16 32 48 180 192 512; do
	sips -z $s $s /tmp/wyrkbook-square.png --out "static/icon-$s.png" >/dev/null
done
cp static/icon-180.png static/apple-touch-icon.png

# favicon.ico bundling the 16/32/48 PNGs.
node - <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';

const sizes = [16, 32, 48];
const pngs = sizes.map((s) => readFileSync(`static/icon-${s}.png`));

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // 1 = icon
header.writeUInt16LE(sizes.length, 4);

let offset = 6 + 16 * sizes.length;
const entries = sizes.map((s, i) => {
	const e = Buffer.alloc(16);
	e.writeUInt8(s === 256 ? 0 : s, 0); // width  (0 means 256)
	e.writeUInt8(s === 256 ? 0 : s, 1); // height
	e.writeUInt8(0, 2);                 // palette size
	e.writeUInt8(0, 3);                 // reserved
	e.writeUInt16LE(1, 4);              // colour planes
	e.writeUInt16LE(32, 6);             // bits per pixel
	e.writeUInt32LE(pngs[i].length, 8);
	e.writeUInt32LE(offset, 12);
	offset += pngs[i].length;
	return e;
});

writeFileSync('static/favicon.ico', Buffer.concat([header, ...entries, ...pngs]));
console.log(`favicon.ico: ${sizes.join('/')} px`);
JS

echo "icons written to static/"
