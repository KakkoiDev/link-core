#!/usr/bin/env node
// link-core on the command line: seal a JSON payload into a link token, or
// open one. The unlock code is never taken as an argument (it would land in
// shell history and the process list): `open` asks for it, or reads the first
// line of stdin when stdin is not a terminal.
import {createInterface} from "node:readline";
import {sealLink, openLink, readLinkToken, LinkError} from "../link-core.js";

const USAGE = `usage:
  link-core seal --app <id> [--days N] [--json '<object>'] [--url <base>] [--name key] [--no-compress]
      payload: --json, or a JSON object on stdin
      prints {"token", "code", "url"?} as JSON; send the code separately, never with the link
  link-core open <token-or-url> --app <id> [--previous-app <id> ...] [--name key]
      asks for the unlock code (or reads it from stdin), prints the payload as JSON`;

function parse(argv) {
  const out = {_: [], previousApps: []};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--no-compress") out.compress = false;
    else if (arg === "-h" || arg === "--help") out.help = true;
    else if (arg.startsWith("--")) {
      const key = arg.slice(2), value = argv[++i];
      if (value === undefined) throw usage(`missing value for ${arg}`);
      if (key === "previous-app") out.previousApps.push(value);
      else if (["app", "days", "json", "url", "name"].includes(key)) out[key] = value;
      else throw usage(`unknown option ${arg}`);
    } else out._.push(arg);
  }
  return out;
}

const usage = message => Object.assign(new Error(message), {usage: true});

async function readStdin() {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

async function askCode() {
  if (!process.stdin.isTTY) return (await readStdin()).split(/\r?\n/)[0];
  const rl = createInterface({input: process.stdin, output: process.stderr});
  try { return await new Promise(resolve => rl.question("Unlock code: ", resolve)); }
  finally { rl.close(); }
}

async function main(argv) {
  const opts = parse(argv);
  const [command, target] = opts._;
  if (opts.help || !command) { console.log(USAGE); return 0; }
  if (!opts.app) throw usage("--app is required");
  if (command === "seal") {
    if (opts.json === undefined && process.stdin.isTTY) throw usage("give the payload with --json or on stdin");
    let payload;
    try { payload = JSON.parse(opts.json ?? await readStdin()); }
    catch { throw usage("the payload is not valid JSON"); }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw usage("the payload must be a JSON object");
    const days = opts.days === undefined ? 0 : Number(opts.days);
    if (!(days >= 0)) throw usage("--days must be a number ≥ 0");
    const {token, code} = await sealLink(payload, {app: opts.app, days, compress: opts.compress ?? true});
    const result = {token, code};
    if (opts.url) {
      const url = new URL(opts.url);
      url.hash = (opts.name || "key") + "=" + token;
      result.url = url.href;
    }
    console.log(JSON.stringify(result, null, 2));
    console.error("Send the code separately, never with the link.");
    return 0;
  }
  if (command === "open") {
    if (!target) throw usage("open needs a token or a link");
    const hash = target.includes("#") ? target.slice(target.indexOf("#")) : null;
    const token = hash ? (opts.name ? readLinkToken(hash, opts.name) : readLinkToken(hash, "key") ?? readLinkToken(hash, "link")) : target;
    if (!token) throw usage("no token found in that link");
    const body = await openLink(token, await askCode(), {app: opts.app, previousApps: opts.previousApps});
    console.log(JSON.stringify(body, null, 2));
    return 0;
  }
  throw usage(`unknown command ${command}`);
}

main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => {
  if (error instanceof LinkError) { console.error(`link-core: ${error.code}`); process.exitCode = 1; }
  else if (error.usage) { console.error(`link-core: ${error.message}\n\n${USAGE}`); process.exitCode = 2; }
  else { console.error(error); process.exitCode = 1; }
});
