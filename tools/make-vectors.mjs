// Writes test/vectors.json: fixed code, salt and IV → token, per SPEC.md.
// It uses Web Crypto directly, not link-core.js, so the vectors check the
// library against the spec rather than against itself. Re-run only when
// adding a vector; existing tokens must never change.
import {writeFileSync} from "node:fs";

const enc = new TextEncoder();
const hex = bytes => Buffer.from(bytes).toString("hex");
const b64u = bytes => Buffer.from(bytes).toString("base64url");
const seq = (n, start) => Uint8Array.from({length: n}, (_, i) => (start + i) & 255);

async function seal({name, app, code, salt, iv, body, deflate = false, now, otherApp}) {
  let plain = enc.encode(JSON.stringify(body));
  if (deflate) {
    const packed = new Uint8Array(await new Response(new Blob([plain]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
    plain = Uint8Array.of(0, ...packed);
  }
  const normal = code.toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  const base = await crypto.subtle.importKey("raw", enc.encode(normal), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({name: "PBKDF2", hash: "SHA-256", salt, iterations: 600000}, base, {name: "AES-GCM", length: 256}, false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({name: "AES-GCM", iv, additionalData: enc.encode(app)}, key, plain));
  return {name, app, code, salt: hex(salt), iv: hex(iv), plaintext: hex(plain), token: ["v1", b64u(salt), b64u(iv), b64u(ct)].join("."), body, ...(now !== undefined && {now}), ...(otherApp && {otherApp})};
}

const vectors = [
  await seal({name: "invite, no expiry", app: "echo-ai-key-v1", code: "0123-4567-89AB", salt: seq(16, 0), iv: seq(12, 16), body: {provider: "openai", key: "sk-test", v: 1}, otherApp: "minihongo-kaiwa-key-v1"}),
  await seal({name: "device link with expiry", app: "echo-ai-key-v1", code: "CDEF-GHJK-MNPQ", salt: seq(16, 100), iv: seq(12, 200), body: {sync: {token: "ghp_test", gist: "https://gist.github.com/u/0667891e19f8f468e0362ce22c8c25f3"}, v: 1, exp: 1767225600000}, now: 1767139200000}),
  await seal({name: "UTF-8 payload, another app", app: "minihongo-kaiwa-key-v1", code: "RSTV-WXYZ-0000", salt: seq(16, 240), iv: seq(12, 7), body: {provider: "google", key: "g-test", note: "日本語のメモ", v: 1}, otherApp: "echo-ai-key-v1"}),
  await seal({name: "deflated body", app: "example-app-v1", code: "7K2M-QX9D-4HTB", salt: seq(16, 50), iv: seq(12, 60), deflate: true, body: {items: Array.from({length: 12}, (_, i) => ({id: i, kind: "example", ok: true})), v: 1}}),
];
writeFileSync(new URL("../test/vectors.json", import.meta.url), JSON.stringify(vectors, null, 2) + "\n");
console.log(vectors.map(v => `${v.name}: ${v.token.length} chars`).join("\n"));
