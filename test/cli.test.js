import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const BIN = fileURLToPath(new URL("../bin/link-core.js", import.meta.url));
const run = (args, input = "") => spawnSync(process.execPath, [BIN, ...args], {input, encoding: "utf8"});

test("seal from stdin, open the link with the code on stdin", () => {
  const sealed = run(["seal", "--app", "cli-test-v1", "--days", "1", "--url", "https://app.example/settings", "--name", "link"], '{"sync":{"token":"ghp_x"}}');
  assert.equal(sealed.status, 0, sealed.stderr);
  const {token, code, url} = JSON.parse(sealed.stdout);
  assert.equal(url, "https://app.example/settings#link=" + token);
  assert.match(sealed.stderr, /separately/);
  const opened = run(["open", url, "--app", "cli-test-v1"], code.toLowerCase() + "\n");
  assert.equal(opened.status, 0, opened.stderr);
  const body = JSON.parse(opened.stdout);
  assert.equal(body.sync.token, "ghp_x");
  assert.ok(body.exp > Date.now());
});

test("--json payload, a bare token, a renamed app; errors exit non-zero with the reason", () => {
  const {token, code} = JSON.parse(run(["seal", "--app", "old-id", "--json", '{"key":"k"}']).stdout);
  assert.equal(JSON.parse(run(["open", token, "--app", "new-id", "--previous-app", "old-id"], code).stdout).key, "k");
  const wrong = run(["open", token, "--app", "new-id"], code);
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /wrong-code/);
  assert.equal(run(["seal", "--json", "{}"]).status, 2, "--app is required");
  assert.equal(run(["seal", "--app", "a", "--json", "[1]"]).status, 2, "an object only");
  assert.equal(run(["open", "https://app.example/#tools", "--app", "a"]).status, 2, "no token in that link");
  assert.equal(run(["open", token, "--app", "a", "--code", code]).status, 2, "the code is never an argument");
});
