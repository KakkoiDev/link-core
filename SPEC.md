# link-core token format, version 1

This is everything another implementation needs to seal and open links that interoperate with `link-core.js`. Test vectors are in [`test/vectors.json`](test/vectors.json); `npm test` checks them against an implementation written from this page, and against the library.

## Token

```
token = "v1" "." b64u(salt) "." b64u(iv) "." b64u(ciphertext)
```

- `b64u`: base64url (RFC 4648 §5), no padding.
- `salt`: 16 random bytes. `iv`: 12 random bytes. Both fresh for every token, neither secret.
- `ciphertext`: AES-256-GCM output with the 16-byte tag appended (as Web Crypto returns it).
- Anything else (another prefix, not four parts, a part that is not base64url) is **malformed**.

The token travels in a URL fragment as `#<name>=<token>`, possibly among other `&`-separated fragment parts. `name` is chosen by the application (`key` for an invite, `link` for a device link, by convention). The fragment is never sent in HTTP requests.

## Unlock code

- 12 symbols from the Crockford base32 alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ`, each chosen uniformly (a random byte mod 32), shown as three groups of four joined by `-`. 60 bits.
- **Normalisation** before use, for both sealing and opening: upper-case; remove every character outside `0-9A-Z`; replace `O` with `0` and `I`, `L` with `1`. The UTF-8 bytes of the result are the PBKDF2 password.

## Key

```
key = PBKDF2(HMAC-SHA-256, password = normalised code, salt, iterations = 600000, length = 32 bytes)
```

## Associated data

The UTF-8 bytes of the application id (`app`), a non-empty string, passed as AES-GCM additional authenticated data. It is fixed per application: a token sealed under one id fails to authenticate under any other.

Known ids: `echo-ai-key-v1` (Echo), `minihongo-kaiwa-key-v1` (Minihongo's Kaiwa).

**Renaming.** An opener may try a list of ids, the current one first, then earlier ones (`previousApps`). The key is derived once; each id costs one AES-GCM attempt. A token opens if any id authenticates.

## Plaintext

```
body      = JSON object, UTF-8: the payload's members, plus "v": 1, plus "exp" if it expires
plaintext = body                              if its first byte is "{" (0x7B)
          | 0x00 || deflate-raw(body)         compressed
```

- `exp`: expiry time in milliseconds since the Unix epoch.
- deflate-raw is RFC 1951 with no zlib or gzip header (`CompressionStream("deflate-raw")`).
- A sealer compresses only when that makes the plaintext shorter (`1 + deflated < plain`); otherwise it stores the JSON itself. Tokens made by link-core 0.1 are all of the first form, so they open unchanged.
- An opener refuses as **malformed** any other first byte, a deflated body that inflates past 65,536 bytes, a body that is not a JSON object, and (by default) an object with no member other than `v` and `exp`. An application may apply a stricter test.

## Opening, in order

1. Parse the token (**malformed** if it does not parse).
2. Derive the key from the normalised code and the salt.
3. Decrypt with each allowed application id in turn. If none authenticates: **wrong-code**. (A wrong code, a modified token and a token for another application are deliberately indistinguishable.)
4. Read the plaintext per above (**malformed** on failure).
5. If `exp` is present and now > `exp`: **expired**. This check is the application's: the cryptography does not enforce it.

Errors: `unsupported` (no Web Crypto, or no DecompressionStream for a compressed body), `malformed`, `wrong-code`, `expired`.

## Test vectors

Each entry of `test/vectors.json` has `app`, `code`, `salt` and `iv` (hex), `plaintext` (hex), `token`, the opened `body`, optionally `now` (a time at which it has not expired) and `otherApp` (an id under which it must fail with wrong-code).

An implementation passes if, for every vector, sealing `plaintext` with the given code, salt, IV and app produces exactly `token`, and opening `token` yields `body`. The deflated vector's plaintext is given as bytes, since deflate output may differ between compressors; any valid deflate-raw stream must be accepted.
