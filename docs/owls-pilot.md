# OWLS pilot on the marketing site

This document describes what was added to `gha-indie-worker.github.io`, why the
default tier ships no JavaScript, and — precisely — what is and is not expected
to carry across a navigation.

**Status: the mechanism is installed and inert.** With the files as committed,
the built site is byte-for-byte what it was before. Nothing is prepared, because
there is nothing real to prepare yet. See "Before this does anything real".

## What OWLS is, and what it actually reuses

OWLS ("ORES WASM Loaders") is a shared loader for WebAssembly applications. Its
release contract, `release-v1`, lets a build publish an immutable manifest of its
assets — canonical HTTPS URL, decoded byte length, SHA-256, kind, and whether the
asset may be fetched speculatively.

The idea being piloted is that a marketing page, which the user reaches first,
can start downloading the application's bytes before the user navigates to the
application.

**Be precise about what carries over.** Cross-document reuse here is about
**reusing downloaded bytes**, and nothing else:

| Carries across a full navigation | Does not carry |
|---|---|
| HTTP cache entries (subject to partitioning and response headers) | The loader's JavaScript objects |
| `CacheStorage` entries, per origin, if an app writes them | Compiled `WebAssembly.Module` objects |
| | An instantiated engine, or any running application state |

A normal navigation destroys the document: its realm, its module graph, its
compiled WASM, its coordinator. **No running loader survives a navigation.** What
survives is the *bytes*, in a cache, which the next document must fetch again —
and may get from cache rather than the network.

## Which cache reuse is expected, across which navigation

`github.io` is on the [Public Suffix List](https://publicsuffix.org/). That has a
concrete consequence for this site:

- `gha-indie-worker.github.io` is a **registrable domain** — a "site".
- `user.gha-indie-worker.github.io` is therefore a **same-site, cross-origin**
  subdomain of it.

Modern browsers partition the HTTP cache by **top-level site**, where the site is
the registrable domain of the top-level document. Because `github.io` is a public
suffix, the registrable domain of *both* `gha-indie-worker.github.io` and
`user.gha-indie-worker.github.io` is `gha-indie-worker.github.io`.

So navigating from `https://gha-indie-worker.github.io/` to
`https://user.gha-indie-worker.github.io/` changes the **origin** but **not the
top-level site**. The cache partition key is expected to stay the same, and a
resource fetched by the marketing page can be reused by the application page.

(If these applications ever move to separate registrable domains — say
`app.example.com` and `www.example.net` — that reuse disappears entirely, and
this whole pilot stops applying. The reuse depends on the shared registrable
domain, which is an accident of hosting everything under one `github.io`
subdomain tree.)

Two honest caveats:

1. **Same-site is not same-origin.** The origins differ. So the fetch must be a
   correct CORS fetch (`crossorigin="anonymous"`, `credentials: "omit"`), and the
   application origin must return `Access-Control-Allow-Origin` covering
   `https://gha-indie-worker.github.io`. A cache entry created by a request whose
   mode/credentials do not match the application's later request is **not**
   reusable by it; it is a wasted download.
2. **Partitioning behaviour differs between browsers and changes over time.**
   Treat the paragraph above as the expected mechanism, not a guarantee. It is
   what the harness in `gha-indie-worker-test/gha-indie-worker-test.github.io`
   exists to measure.

**No speed claim is made here.** Nothing in this repository has been measured.
`transferSize === 0` on a resource timing entry is a *browser-reported hint* that
a response came from cache; it is not proof, and it is not a benchmark.

## What was added

| Path | Role |
|---|---|
| `public/releases/README.md` | The manifest convention, and the rules this site enforces |
| `public/releases/example-app.json` | A valid release-v1 sample; inert by construction |
| `src/lib/prepare.mjs` | Build-time manifest reader, validator and hint builder |
| `src/lib/intent.mjs` | Opt-in intent preparation. Off by default |
| `src/components/OwlsIntent.astro` | The island that ships `intent.mjs`, only when enabled |
| `src/pages/index.astro` | One marked block in frontmatter, one in `<head>` |

### Zero new dependencies

`package.json` is untouched. `astro` remains the only runtime dependency, as the
organization's marketing-site contract requires (`.github/marketing-site/
scripts/validate-site.mjs:45`: *"only Astro may be a runtime dependency"*).

That is why `src/lib/prepare.mjs` does **not** import
`@ores-wasm-loaders/owls-web-loader`. It re-implements, by hand, the selection
and budget semantics of that package's `hintDescriptors()` and a structural
subset of its release-v1 validation. This is a deliberate duplicate, and it is a
maintenance cost: **release-v1 remains the authority, and if the two ever
disagree, `prepare.mjs` is the bug.**

### Why the default tier is zero-JavaScript

The site currently ships **zero `<script>` tags**. That is a property worth
keeping:

- `<link rel="preconnect">` and `<link rel="prefetch">` are declarative. They
  cost no main-thread JavaScript, cannot throw, cannot leak, and cannot delay
  rendering.
- They degrade to nothing. A browser that ignores `prefetch` simply does not
  prefetch; there is no error path.
- They need no CSP `script-src` allowance and add no bundle.
- Turning on the JS tier makes Astro emit a bundled
  `<script type="module" src="/_astro/…">`. That is a **real, visible change to
  the page's contract**, not a free addition.

So the declarative tier is the default and the JS tier is opt-in.

## Tier 1 (default): declarative hints

At build time, `src/lib/prepare.mjs` reads `public/releases/*.json`, validates
each manifest structurally, and returns descriptors. `src/pages/index.astro`
renders them into `<head>` immediately after the existing `canonical` link:

- `<link rel="preconnect" href="<origin>" crossorigin="anonymous">` — one per
  distinct asset origin, to pay TCP/TLS setup early. `crossorigin` matters: a
  preconnect without it opens a connection in a different pool than the anonymous
  asset fetch will use.
- `<link rel="dns-prefetch" href="<origin>">` — the fallback for user agents that
  ignore `preconnect`. Harmless where `preconnect` is honoured.
- `<link rel="prefetch" href="…" as="fetch" crossorigin="anonymous"
  referrerpolicy="no-referrer">` — one per asset marked `"prepare": true`,
  subject to an 8 MiB total budget (the same default as
  `owls-web-loader`'s `browserPolicy()`).

Failure policy:

- **No manifest → no hints.** Not an error. This is today's state.
- **Malformed manifest → the build fails, loudly.** Committing a manifest is
  deliberate; silently skipping a broken one would hide a deploy mistake.
- **Non-allowlisted asset origin → the build fails.** The allowlist is
  `DEFAULT_ORIGINS` in `prepare.mjs`, overridable with `PUBLIC_OWLS_ORIGINS`.
- **`example*.json` → validated, then discarded** before any origin check, so a
  sample can use a reserved `.invalid` host and can never emit a hint.

## Tier 2 (opt-in): intent preparation

`src/lib/intent.mjs` attaches `pointerenter` / `focusin` / `touchstart` listeners
to the CTA anchors that already point at the application subdomains
(`src/pages/index.astro` lines 102, 103, 111–113, 194–196) and warms the HTTP
cache with `fetch`.

Its policy mirrors `owls-web-loader`'s `browserPolicy()` and `prepareOnIntent()`:

- `credentials: "omit"`, `mode: "cors"`, `redirect: "error"`,
  `referrerPolicy: "no-referrer"`, `priority: "low"`
- an 8 MiB budget checked before the first byte, and a per-asset cap enforced
  while streaming
- an `AbortController` with a 30 s deadline, `{ once: true }` listeners
- a guard that refuses to spend bytes when `navigator.connection.saveData` is set
  or `effectiveType` is `slow-2g`/`2g`
- every error swallowed — speculative preparation must never break the page

**It never executes anything.** No `WebAssembly.compile`, no
`WebAssembly.instantiate`, no dynamic `import()`, no script injection. It reads
each response body to completion under a cap and drops it. The only effect it
intends is a populated HTTP cache entry.

### How to turn it on

```sh
PUBLIC_OWLS_INTENT=1 npm run build
```

`OwlsIntent.astro` checks `import.meta.env.PUBLIC_OWLS_INTENT === "1"`. When it
is anything else — including unset, which is the default and what CI does today —
the component renders nothing and Astro emits no client bundle.

Before enabling it in CI, decide deliberately that the site may ship a script
tag, and add `PUBLIC_OWLS_INTENT: "1"` to the `npm run build` step's `env:` in
`.github/workflows/pages.yml`.

## Before this does anything real

Four things must exist. **None of them exist at the time of writing.** The CTAs
on the home page already link to the first three; those links currently point at
hosts that do not resolve.

1. `https://user.gha-indie-worker.github.io` — the user application
2. `https://org.gha-indie-worker.github.io` — the organization application
3. `https://auth.gha-indie-worker.github.io` — Shared Auth
4. An asset-hosting surface with versioned, immutable URLs

On (4): **there is no asset origin, no versioning scheme, no CDN and no publish
workflow anywhere in this organization today.** `gha-indie-worker-assets`
contains a README and one PNG. A release manifest names immutable, content-
addressed URLs; something has to produce and serve them. Until it does, the
`sha256` and `bytes` fields in a manifest have nothing to describe.

Each application origin must also:

- serve `.wasm` as `application/wasm`
- return `Access-Control-Allow-Origin: https://gha-indie-worker.github.io` (or a
  policy covering it) on the asset responses
- serve release assets from immutable, versioned paths with a long-lived
  `Cache-Control`, and serve the manifest itself with a *shorter* policy, since
  the manifest is how a rollback takes effect

## What this pilot does not do

- **No `Link:` header tier.** GitHub Pages does not let this repository set
  response headers. `gha-indie-worker-web-server.rs` has no HTTP framework at all
  (its dependencies are `serde`, `serde_json`, `thiserror`; `src/server.rs:6`
  `pub fn run` only prints), so there is no middleware and no static-asset path
  to inject a `Link:` header into. That tier does not exist and was not built.
- **No CSP tier.** Same reason: no header control.
- **No service worker.** Nothing here registers one.
- **No Flutter surface.** `gha-indie-worker-flutter` has no `web/` directory on
  any branch, so there is no Flutter web build to prepare.
- **No measurement.** This repository measures nothing. The harness in
  `gha-indie-worker-test/gha-indie-worker-test.github.io` is where the mechanism
  is exercised and timed.

## Rolling it back

Delete the two marked blocks from `src/pages/index.astro` and remove
`src/lib/prepare.mjs`, `src/lib/intent.mjs` and `src/components/OwlsIntent.astro`.
Nothing else in the site depends on them, and `package.json` never changed.
