import test from "node:test";
import assert from "node:assert/strict";
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
