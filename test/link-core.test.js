import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {sealLink, openLink, readLinkToken, forgetLinkToken, makeUnlockCode, normalizeUnlockCode, LinkError, LINK_VERSION} from "../link-core.js";

const APP = "echo-ai-key-v1";
const CODE_SHAPE = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
const refused = code => e => e instanceof LinkError && e.code === code;

test("a sealed link opens with its unlock code and only with it", async () => {
  const {token, code} = await sealLink({provider: "deepseek", key: "sk-test", model: "deepseek-chat"}, {app: APP, days: 30});
  assert.match(code, CODE_SHAPE, "12 Crockford characters in three groups");
  assert.equal(token.split(".").length, 4);
  assert.ok(token.startsWith(LINK_VERSION + "."));
  assert.doesNotMatch(token, /sk-test/, "the key is not readable in the link");
  const body = await openLink(token, code.toLowerCase().replace(/-/g, " "), {app: APP});
  assert.equal(body.provider, "deepseek");
  assert.equal(body.key, "sk-test");
  assert.equal(body.model, "deepseek-chat");
  assert.equal(body.v, 1);
  assert.ok(body.exp > Date.now() + 29 * 86400000);
  await assert.rejects(openLink(token, "0000-0000-0000", {app: APP}), refused("wrong-code"));
});

test("expired, damaged, tampered and empty links are refused", async () => {
  const old = await sealLink({provider: "openai", key: "k"}, {app: APP, days: 7, now: Date.now() - 8 * 86400000});
  await assert.rejects(openLink(old.token, old.code, {app: APP}), refused("expired"));
  await assert.rejects(openLink("v1.abc", old.code, {app: APP}), refused("malformed"));
  await assert.rejects(openLink("v2.a.b.c", old.code, {app: APP}), refused("malformed"));
  await assert.rejects(openLink("v1.a!.b.c", old.code, {app: APP}), refused("malformed"));
  const forever = await sealLink({provider: "openai", key: "k"}, {app: APP});
  assert.equal((await openLink(forever.token, forever.code, {app: APP})).exp, undefined, "no limit has no expiry");
  const [v, salt, iv, sealed] = forever.token.split(".");
  const flipped = sealed.slice(0, -2) + (sealed.at(-2) === "A" ? "B" : "A") + sealed.at(-1);
  await assert.rejects(openLink([v, salt, iv, flipped].join("."), forever.code, {app: APP}), refused("wrong-code"), "AES-GCM catches tampering");
  const empty = await sealLink({}, {app: APP, days: 7});
  await assert.rejects(openLink(empty.token, empty.code, {app: APP}), refused("malformed"), "a link with nothing in it is refused");
});

test("the app decides what a usable payload is", async () => {
  const {token, code} = await sealLink({note: "hello"}, {app: APP});
  const accept = body => !!(body.provider && body.key);
  await assert.rejects(openLink(token, code, {app: APP, accept}), refused("malformed"));
  assert.equal((await openLink(token, code, {app: APP})).note, "hello");
});

test("a link sealed for one app never opens in another", async () => {
  const {token, code} = await sealLink({provider: "google", key: "g"}, {app: "echo-ai-key-v1"});
  await assert.rejects(openLink(token, code, {app: "minihongo-kaiwa-key-v1"}), refused("wrong-code"));
  await assert.rejects(openLink(token, code, {app: "echo-ai-key-v2"}), refused("wrong-code"));
  assert.equal((await openLink(token, code, {app: "echo-ai-key-v1"})).key, "g");
});

test("the app name is required on both sides", async () => {
  await assert.rejects(sealLink({key: "k"}), TypeError);
  await assert.rejects(sealLink({key: "k"}, {app: ""}), TypeError);
  await assert.rejects(openLink("v1.a.b.c", "0000-0000-0000"), TypeError);
});

test("a device link travels in #link=, opens with the code, and expires", async () => {
  const {token, code} = await sealLink({sync: {token: "ghp_x", gist: "https://gist.github.com/u/0667891e19f8f468e0362ce22c8c25f3"}}, {app: APP, days: 1, now: 1000});
  assert.equal(readLinkToken("#link=" + token, "link"), token);
  assert.equal(readLinkToken("#link=" + token), null, "a device link is not an invite");
  const body = await openLink(token, code, {app: APP, now: 2000});
  assert.equal(body.sync.token, "ghp_x");
  await assert.rejects(openLink(token, code, {app: APP, now: 1000 + 2 * 86400000}), refused("expired"));
});

test("the unlock code survives being typed: case, spaces, missing dashes, O and I/L", () => {
  assert.equal(normalizeUnlockCode("ab1o-2il3 4567"), "AB1021134567");
  const codes = new Set(Array.from({length: 50}, makeUnlockCode));
  assert.equal(codes.size, 50);
  for (const code of codes) assert.match(code, CODE_SHAPE);
});

test("readLinkToken finds the token among other fragment parts", () => {
  assert.equal(readLinkToken("#key=v1.a.b.c"), "v1.a.b.c");
  assert.equal(readLinkToken("#tools&key=v1.a-b.c_d.e"), "v1.a-b.c_d.e");
  assert.equal(readLinkToken("#tools"), null);
  assert.equal(readLinkToken("#monkey=v1.a.b.c"), null, "only a whole name matches");
});

test("forgetLinkToken takes the token out of the address and keeps the rest", () => {
  const calls = [];
  const history = {state: {echo: true}, replaceState: (...args) => calls.push(args)};
  assert.equal(forgetLinkToken("key", {location: {pathname: "/settings", search: "?a=1", hash: "#key=v1.a.b.c"}, history}), true);
  assert.deepEqual(calls.at(-1), [{echo: true}, "", "/settings?a=1"]);
  assert.equal(forgetLinkToken("link", {location: {pathname: "/", search: "", hash: "#tools&link=v1.a.b.c"}, history}), true);
  assert.deepEqual(calls.at(-1), [{echo: true}, "", "/#tools"]);
  assert.equal(forgetLinkToken("key", {location: {pathname: "/", search: "", hash: "#link=v1.a.b.c"}, history}), false);
  assert.equal(calls.length, 2);
});

// Tokens sealed by the copies this library replaced. They must keep opening.
const FIXTURES = {
  echoInvite: {app: "echo-ai-key-v1", token: "v1.YoYcqjWDmYHjQiQiOlJlkw.re_mK8lFXNgsWW-2.onbhnLcPu0OIFS3hij3CA4y6wknllAnrcFtBamnvw46OVcNwGgzEKcRuRirycXe220vtM0pNxKav9-XLSsNNmDFGP1rNbwlaGipJlo1_rXxlHHe4n2Ueow", code: "30KE-7SH2-MRED"},
  echoLink: {app: "echo-ai-key-v1", token: "v1.QYTDNngpUFDurFINeVAwPQ.QbJzAKX3uofL674j.jFGc6tfYAKaYaiRndoLXwQn7hpBNSEgLopafYReUZ2DULDKqWWctwiBTttxZYirJr_bOpKuxcGftqMR7q8bsMFbxhy0lWBG8E8Gt9aLHZfwGG4B-0YrBbahcDzNESz6jI_YvQo73cSTut5MoUlqBKRJhJiXKxoISR9b_PBr2uqfyRo5RE3R-JhY", code: "9N1B-VH81-0MSW"},
  minihongo: {app: "minihongo-kaiwa-key-v1", token: "v1.JOuslNBiyepNr7dhrVhJpA.a-Rt4axUVoUkQEFw.u8kgyK5VDpFkyuZC4dGpSi8RS5xqa6AMGsn20Ri51QU3TUlFasaeotjG-anjzW2EWwzC014oR9_-eLUlWCU", code: "ME8S-TYVQ-HT8T"},
};

test("links sealed by Echo's and Minihongo's earlier copies still open", async () => {
  const echo = await openLink(FIXTURES.echoInvite.token, FIXTURES.echoInvite.code, {app: FIXTURES.echoInvite.app});
  assert.deepEqual(echo, {provider: "deepseek", key: "sk-fixture", model: "deepseek-chat", v: 1});
  const link = await openLink(FIXTURES.echoLink.token, FIXTURES.echoLink.code, {app: FIXTURES.echoLink.app, now: 2000});
  assert.equal(link.sync.token, "ghp_fixture");
  assert.equal(link.exp, 1000 + 86400000);
  const mini = await openLink(FIXTURES.minihongo.token, FIXTURES.minihongo.code, {app: FIXTURES.minihongo.app});
  assert.deepEqual(mini, {provider: "google", key: "mh-fixture", v: 1});
  await assert.rejects(openLink(FIXTURES.minihongo.token, FIXTURES.minihongo.code, {app: "echo-ai-key-v1"}), refused("wrong-code"));
});

test("a renamed app still opens links sealed under its previous ids", async () => {
  const {token, code} = await sealLink({provider: "google", key: "g"}, {app: "kaiwa-key-v1"});
  const body = await openLink(token, code, {app: "minihongo-kaiwa-key-v2", previousApps: ["kaiwa-key-v0", "kaiwa-key-v1"]});
  assert.equal(body.key, "g");
  await assert.rejects(openLink(token, code, {app: "minihongo-kaiwa-key-v2", previousApps: ["echo-ai-key-v1"]}), refused("wrong-code"), "unrelated ids still fail");
  await assert.rejects(openLink(token, "0000-0000-0000", {app: "minihongo-kaiwa-key-v2", previousApps: ["kaiwa-key-v1"]}), refused("wrong-code"), "the right binding with a wrong code still fails");
  await assert.rejects(openLink(token, code, {app: "x", previousApps: [""]}), TypeError);
});

test("a body that compresses well is deflated, and still opens", async () => {
  const big = {sync: {token: "ghp_" + "a1b2".repeat(10), gist: "https://gist.github.com/someone/0667891e19f8f468e0362ce22c8c25f3"}, note: "the same words again and again ".repeat(20)};
  const packed = await sealLink(big, {app: APP});
  const plain = await sealLink(big, {app: APP, compress: false});
  assert.ok(packed.token.length < plain.token.length / 3, `${packed.token.length} vs ${plain.token.length}`);
  assert.deepEqual(await openLink(packed.token, packed.code, {app: APP}), {...big, v: 1});
  assert.deepEqual(await openLink(plain.token, plain.code, {app: APP}), {...big, v: 1});
});

test("a body that would not shrink is sealed as plain JSON, the v0.1 format", async () => {
  const {token, code} = await sealLink({k: "x"}, {app: APP});
  const plain = await openRaw(token, code, APP);
  assert.equal(plain[0], 0x7b, "starts with '{'");
});

test("a deflated body that inflates past 64 KiB is refused", async () => {
  const bomb = await deflateRaw(new TextEncoder().encode(JSON.stringify({pad: "x".repeat(70000)})));
  const token = await specSeal(Uint8Array.of(0, ...bomb), {app: APP, code: "0000-0000-0001", salt: new Uint8Array(16), iv: new Uint8Array(12)});
  await assert.rejects(openLink(token, "0000-0000-0001", {app: APP}), refused("malformed"));
});

// An independent implementation of SPEC.md, written from the spec and not
// from link-core.js. The published vectors must agree with it and with
// link-core; the plain-JSON ones must be reproduced byte for byte.
const enc = new TextEncoder();
const b64u = bytes => Buffer.from(bytes).toString("base64url");
async function specKey(code, salt) {
  const normal = code.toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  const base = await crypto.subtle.importKey("raw", enc.encode(normal), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({name: "PBKDF2", hash: "SHA-256", salt, iterations: 600000}, base, {name: "AES-GCM", length: 256}, false, ["encrypt", "decrypt"]);
}
async function specSeal(plain, {app, code, salt, iv}) {
  const ct = new Uint8Array(await crypto.subtle.encrypt({name: "AES-GCM", iv, additionalData: enc.encode(app)}, await specKey(code, salt), plain));
  return ["v1", b64u(salt), b64u(iv), b64u(ct)].join(".");
}
async function openRaw(token, code, app) {
  const [, salt, iv, ct] = token.split(".").map(part => Buffer.from(part, "base64url"));
  return new Uint8Array(await crypto.subtle.decrypt({name: "AES-GCM", iv, additionalData: enc.encode(app)}, await specKey(code, salt), ct));
}
async function deflateRaw(bytes) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
}

const vectors = JSON.parse(readFileSync(new URL("./vectors.json", import.meta.url), "utf8"));

test("the published test vectors (SPEC.md) hold", async () => {
  assert.ok(vectors.length >= 4);
  for (const vector of vectors) {
    const hex = h => Uint8Array.from(Buffer.from(h, "hex"));
    const opened = await openLink(vector.token, vector.code, {app: vector.app, now: vector.now ?? 0});
    assert.deepEqual(opened, vector.body, vector.name);
    const plain = await openRaw(vector.token, vector.code, vector.app);
    assert.equal(Buffer.from(plain).toString("hex"), vector.plaintext, vector.name + ": plaintext bytes");
    assert.equal(await specSeal(plain, {app: vector.app, code: vector.code, salt: hex(vector.salt), iv: hex(vector.iv)}), vector.token, vector.name + ": token reproduced");
    if (vector.otherApp) await assert.rejects(openLink(vector.token, vector.code, {app: vector.otherApp}), refused("wrong-code"));
  }
});
