import test from "node:test";
import assert from "node:assert/strict";
import {qrMatrix, qrSvg, qrCapacity} from "../link-core-qr.js";

test("byte capacities match the QR standard's table", () => {
  const known = {1: {L: 17, M: 14, Q: 11, H: 7}, 2: {M: 26}, 7: {M: 122}, 10: {L: 271, M: 213, Q: 151, H: 119}, 20: {M: 666}, 27: {L: 1465}, 40: {L: 2953, M: 2331, Q: 1663, H: 1273}};
  for (const [version, levels] of Object.entries(known)) {
    for (const [ecc, bytes] of Object.entries(levels)) assert.equal(qrCapacity(Number(version), ecc), bytes, `v${version}-${ecc}`);
  }
});

test("the smallest version that fits is chosen; finder and timing patterns are in place", () => {
  assert.equal(qrMatrix("x".repeat(14)).version, 1);
  assert.equal(qrMatrix("x".repeat(15)).version, 2);
  const {version, size, modules} = qrMatrix("https://echo.kakkoi.dev/#link=v1." + "A".repeat(300));
  assert.equal(size, version * 4 + 17);
  for (const [x, y] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
    assert.equal(modules[y][x], true); assert.equal(modules[y + 1][x + 1], false); assert.equal(modules[y + 3][x + 3], true);
  }
  for (let i = 8; i < size - 8; i++) { assert.equal(modules[6][i], i % 2 === 0); assert.equal(modules[i][6], i % 2 === 0); }
  assert.equal(modules[size - 8][8], true, "the dark module");
  assert.throws(() => qrMatrix("x".repeat(2332)), RangeError);
});

test("the SVG is one path on an optional background, and escapes its label", () => {
  const svg = qrSvg("hello", {label: 'a "link" <x>'});
  assert.match(svg, /^<svg [^>]*viewBox="0 0 29 29"/);
  assert.match(svg, /aria-label="a &quot;link&quot; &lt;x&gt;"/);
  assert.equal(svg.match(/<path /g).length, 1);
  assert.doesNotMatch(qrSvg("hello", {light: null, dark: "currentColor"}), /<rect/);
});
