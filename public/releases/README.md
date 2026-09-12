# OWLS release manifests

This directory holds **OWLS release-v1 manifests** for the applications this
marketing site links to. It is the convention that lets a static page prepare an
application's bytes without knowing anything about that application's build.

## The convention

Each application publishes one manifest describing the exact release currently
deployed to its origin, and commits a copy here at a stable path:

```
public/releases/<app-id>.json
```

Astro copies `public/` through unchanged, so a manifest committed here is also
served at `https://gha-indie-worker.github.io/releases/<app-id>.json`.

A manifest must validate against the OWLS **release-v1** contract, published as
`schemas/release.schema.json` in `ores-wasm-loaders/owls-interfaces`
(`$id: https://ores-wasm-loaders.github.io/schemas/release-v1.json`). Required
fields: `schemaVersion` (exactly `1`), `appId`, `release`, `runtime`,
`entrypoint`, `assets`. Optional: `extensions`. Any other top-level field is a
validation failure — release-v1 sets `additionalProperties: false`, and tenant
data belongs under `extensions`.

Each asset declares its canonical HTTPS `url`, its decoded `bytes`, its
`sha256`, its `kind`, and whether it is eligible for speculative preparation
(`prepare`). The `sha256` is what makes an asset verifiable at activation time;
this site never verifies it, because this site never activates anything.

`gha-indie-worker/gha-indie-worker-interfaces` additionally publishes
`schema/v1/wasm-release-profile.json`, an organization profile that *narrows*
release-v1 (allowed `appId`s, allowed asset origins, and a required
`extensions.ghaIndieWorker` block). release-v1 remains the base authority;
validate against it first, then against the profile.

## What this site does with a manifest

At **build time only**, `src/lib/prepare.mjs` reads every `*.json` here,
validates it structurally, and turns assets marked `"prepare": true` into
`<link rel="preconnect">` and `<link rel="prefetch">` tags in `<head>`. No
JavaScript is involved and none is shipped. See `docs/owls-pilot.md`.

## Rules this directory enforces

- **A missing directory, or no non-example manifest, means "no preparation."**
  That is a normal state and never an error. This is the state the site is in
  today.
- **A committed manifest that is malformed fails the build, loudly.** Committing
  a manifest is a deliberate act; silently skipping a broken one would hide a
  deployment mistake.
- **A committed manifest whose asset origins are not on the site's allowlist
  fails the build.** The allowlist lives in `src/lib/prepare.mjs`
  (`DEFAULT_ORIGINS`) and can be replaced with the `PUBLIC_OWLS_ORIGINS`
  environment variable.
- **Files whose names begin with `example` are documentation.** They are still
  validated — so a sample cannot silently rot — but they are discarded before
  the origin check and can never produce a resource hint. This is why
  `example-app.json` may safely use a reserved `.invalid` host.

## Status today: nothing is prepared

`example-app.json` is the only file here, and it is an example. **No real
manifest exists yet, and no hints are emitted.** The applications this site
links to — `user.`, `org.` and `auth.gha-indie-worker.github.io` — **do not
exist at the time of writing**. Adding a manifest here does not create them.

The order of operations to make this real is:

1. An application actually deploys to one of those subdomains.
2. Its build produces a release-v1 manifest from that exact build (see
   `owls-runtime::inspect_build`, which derives sizes and hashes from real build
   output rather than guessing them).
3. That origin serves its assets with `Access-Control-Allow-Origin` permitting
   `https://gha-indie-worker.github.io`, and serves `.wasm` as
   `application/wasm`. Without correct CORS, an anonymous cross-origin prefetch
   is fetched into a cache entry the application cannot reuse.
4. The manifest is committed here, and its origin is on the allowlist.

Until all four hold, this directory is documentation.
