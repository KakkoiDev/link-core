# link-core

Put a secret inside a link, with no server. One ES module, zero dependencies, no build step. Web Crypto only: browsers in a secure context (https or localhost) and Node 20+.

A payload (an AI provider key, a speech key, sync credentials for another device) is encrypted in the sender's browser and carried in the link's `#fragment`. The recipient opens it with a 12-character unlock code that the sender passes on separately. Nothing is uploaded anywhere: the ciphertext *is* the link.

It exists because two static apps (Echo and Minihongo) carried copies of the same code. The cryptography is standard; what this packages is the pattern around it: no server, per-app binding, readable unlock codes, expiry, and the arrival flow.

## Install

Install from a pinned tag; there is no npm registry publication.

```sh
npm install @kakkoidev/link-core@https://codeload.github.com/KakkoiDev/link-core/tar.gz/refs/tags/v0.1.0
```

Or, for a static site with no build step, copy `link-core.js` into the site with a header naming the source tag and commit, and import it by path. Copy it; don't fork it. Change the rules here first and bring the copy over in the same change.

## Use

```js
import {sealLink, openLink, readLinkToken, forgetLinkToken, LinkError} from "./link-core.js";

const APP = "my-app-key-v1"; // fixed forever: changing it orphans every link already sent

// Sender
const {token, code} = await sealLink({provider: "openai", key: "sk-…"}, {app: APP, days: 30});
const url = new URL(location.origin);
url.hash = "key=" + token;      // the link: share it any way you like
showToSenderOnly(code);         // "7K2M-QX9D-4HTB": send it another way

// Recipient, on arrival
const found = readLinkToken(location.hash, "key");
if (found) {
  try {
    const body = await openLink(found, await askForCode(), {app: APP, accept: b => !!(b.provider && b.key)});
    await saveKeyExplicitly(body);    // body = payload + {v: 1, exp?}
    forgetLinkToken("key");           // take the token out of the address bar
  } catch (e) {
    if (e instanceof LinkError) showProblem(e.code); // 'unsupported' | 'malformed' | 'wrong-code' | 'expired'
    else throw e;
  }
}
```

| Export | What it does |
| --- | --- |
| `sealLink(payload, {app, days = 0, now})` | Encrypts `{...payload, v: 1, exp?}`. Returns `{token, code}`. `days: 0` means no expiry. |
| `openLink(token, code, {app, now, accept})` | Decrypts and returns the body. `accept(body)` lets the app refuse a well-formed link that carries nothing it can use (`'malformed'`); by default any non-empty payload passes. |
| `readLinkToken(hash, name = "key")` | Finds `name=<token>` in a fragment such as `#key=…` or `#tools&link=…`. Use different names for different kinds of link (Echo: `key` is an invite, `link` is one of your own devices). |
| `forgetLinkToken(name = "key")` | Optional. Removes that token from the address and the current history entry, keeping any other fragment parts. |
| `makeUnlockCode()`, `normalizeUnlockCode(code)` | 12 Crockford base32 characters in three groups; normalisation accepts lower case, spaces, missing dashes, and O→0, I/L→1. |
| `LinkError` | `.code` is `'unsupported'`, `'malformed'`, `'wrong-code'` or `'expired'`. A wrong code, a tampered link and a link sealed for another app are all `'wrong-code'`, indistinguishable by design. |
| `isLinkSupported()` | Web Crypto present and the context is secure. |

`npm test` runs the tests (no network). They include tokens sealed by the copies this library replaced, so a change that would stop old links opening fails.

## How it works

```
unlock code ──PBKDF2-SHA256 (600,000 rounds, random 16-byte salt)──▶ AES-256 key
{...payload, v: 1, exp?} ──AES-256-GCM (random 12-byte IV, associated data = app)──▶ ciphertext
token: v1.<salt>.<iv>.<ciphertext>        (base64url, after #key= or #link=)
```

The fragment is never sent in an HTTP request, so the site host, its logs, analytics and link-preview bots never see the token. The salt and IV are random per link and not secret. The app name is bound as AES-GCM associated data, so a link sealed for one app does not open in another, even with the right code.

The formats in use: Echo's `app` is `echo-ai-key-v1` (invites and device links alike), Minihongo's is `minihongo-kaiwa-key-v1`.

## Threat model, plainly

- **The code must not travel with the link.** Whoever has both has the secret. Send the link one way (a chat) and the code another (say it aloud, a different app). Never put the code in the URL, a Share sheet or the same message.
- **The code is the whole strength.** 12 Crockford characters are 60 bits. Someone who has the link can guess codes offline, with no rate limit; 600,000 PBKDF2-SHA256 rounds make each guess expensive (on the order of 2^60 × 600k SHA-256 operations to exhaust), which is far beyond a casual or well-funded attacker for a key that will be revoked long before. It is not a password manager: do not seal something that must stay secret for decades.
- **Expiry is enforced by the app, not by cryptography.** `exp` lives inside the encrypted payload and `openLink` refuses an expired link, but anyone holding the link *and* the code can decrypt it with their own code and ignore the date. Expiry stops casual reuse, not a determined holder.
- **Revocation happens at the provider.** A link cannot be recalled. To revoke, delete or rotate the key at the provider (OpenAI, Google, Groq, GitHub …). Prefer keys with spending limits and narrow scopes.
- **What you seal is what you hand over.** A GitHub token in a device link with the `gist` scope can read and write *every* gist of that account, not just the sync file. Use a token made only for this, and keep device links short-lived (Echo: one day).
- **The recipient's device is trusted.** Once opened, the secret is stored by the app like a typed key. A compromised browser, extension or device gets it.
- **The page is trusted.** The code that seals and opens runs from the site; whoever controls the site's JavaScript controls the secret. That is true of any web app holding a key.
- **No forward secrecy, no authentication of the sender.** A link opens for anyone with the code; it does not prove who made it.

## Prior art, and what is different

Putting the key in the fragment is an old idea: Firefox Send, PrivateBin and Bitwarden Send all keep the decryption key after `#` so the server stores only ciphertext. magic-wormhole uses short human codes, with a PAKE so a code allows one online guess rather than offline guessing.

Here, no server stores anything: the ciphertext travels in the link itself, so there is nothing to host, expire or delete. The price is that the link holder can guess offline, which is why the code is 60 bits and stretched with 600k rounds rather than a three-word wormhole code. It is meant for small secrets in bring-your-own-key static apps (sharing an AI key with a friend) and for linking your own devices (handing sync credentials to your phone), where a server would be the only server the app has.

## License

MIT
