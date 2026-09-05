// OWLS build-time resource-hint helper for the GHA Indie Worker marketing site.
//
// WHY THIS FILE HAS NO IMPORTS
// The organization's marketing-site contract (see `.github/marketing-site/
// scripts/validate-site.mjs:45`, "only Astro may be a runtime dependency")
// forbids this site from taking a new npm runtime dependency. So this file does
// NOT import @ores-wasm-loaders/owls-web-loader. It re-implements, by hand, the
// selection and budget semantics of that package's `hintDescriptors()`
// (owls-web-loader/src/hints.ts) and a structural subset of its release-v1
// validation (owls-web-loader/src/manifest.ts). The OWLS release-v1 JSON Schema
// remains the authority; this is a deliberate, documented duplicate. If the two
// ever disagree, release-v1 wins and this file is the bug.
//
// WHAT IT DOES
// Runs at BUILD TIME ONLY, inside Astro frontmatter. Reads the release manifests
// committed under `public/releases/`, validates them structurally, and returns
// plain descriptors for <link> tags. It never fetches, never executes, and
// emits no JavaScript into the page.
//
// FAILURE POLICY
// - No `public/releases/` directory, or no non-example manifest: emit nothing.
//   "No preparation" is a normal, supported state, not an error.
// - A manifest that is present but malformed: THROW, failing the build loudly.
//   A committed manifest is a deliberate act; silently ignoring a broken one
//   would hide a deploy mistake.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

// Resolved from the process working directory, NOT from import.meta.url.
// Astro/Vite may relocate or bundle this module during a build, which would
// make an import.meta.url-relative path point somewhere unintended. Astro runs
// its build with the project root as the working directory, so cwd is the
// stable anchor. Callers (and tests) may override it.
const releasesDir = (root) => path.resolve(root ?? process.cwd(), "public", "releases");

// Origins this site is willing to name in a resource hint.
//
// IMPORTANT, VERIFIED FACT: as of this commit none of these four subdomains
// exist. They are the origins the site's own CTAs already link to
// (src/pages/index.astro lines 102, 103, 111, 112, 113, 194, 195, 196). Listing
// them here does not create them. Until an application actually deploys to one
// of them AND publishes a manifest under public/releases/, this helper returns
// an empty array and the page is byte-for-byte unchanged.
const DEFAULT_ORIGINS = Object.freeze([
  "https://user.gha-indie-worker.github.io",
  "https://org.gha-indie-worker.github.io",
  "https://auth.gha-indie-worker.github.io",
  "https://app.gha-indie-worker.github.io",
]);

// Mirrors owls-web-loader browserPolicy(): 8 MiB speculative budget.
const DEFAULT_BUDGET_BYTES = 8 * 1024 * 1024;

const ASSET_KINDS = Object.freeze(["wasm", "module", "script", "data", "font"]);
const RUNTIMES = Object.freeze(["raw-wasm", "wasm-bindgen", "flutter-web"]);
const ENTRYPOINT_KIND = Object.freeze({
  "raw-wasm": "wasm",
  "wasm-bindgen": "module",
  "flutter-web": "script",
});

const APP_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const RELEASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ASSET_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA256 = /^[0-9a-f]{64}$/;

export class ManifestError extends Error {
  constructor(file, message) {
    super(`public/releases/${file}: ${message}`);
    this.name = "ManifestError";
    this.file = file;
  }
}

const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/** Structural mirror of owls-interfaces release-v1. Hand-written; no ajv. */
export function validateRelease(value, file) {
  const bad = (message) => {
    throw new ManifestError(file, message);
  };
  if (!isPlainObject(value)) bad("manifest must be a JSON object");

  const allowed = new Set([
    "schemaVersion",
    "appId",
    "release",
    "runtime",
    "entrypoint",
    "assets",
    "extensions",
  ]);
  for (const key of Object.keys(value)) {
    // release-v1 sets additionalProperties:false. Tenant fields go in extensions.
    if (!allowed.has(key)) bad(`unknown top-level field ${JSON.stringify(key)}`);
  }
  if (value.schemaVersion !== 1) bad("schemaVersion must be exactly 1");
  if (typeof value.appId !== "string" || !APP_ID.test(value.appId)) bad("invalid appId");
  if (typeof value.release !== "string" || !RELEASE_ID.test(value.release)) bad("invalid release");
  if (!RUNTIMES.includes(value.runtime)) bad(`runtime must be one of ${RUNTIMES.join(", ")}`);
  if (typeof value.entrypoint !== "string" || value.entrypoint.length < 1 || value.entrypoint.length > 128)
    bad("entrypoint must be a 1..128 character asset id");
  if (!Array.isArray(value.assets) || value.assets.length < 1 || value.assets.length > 512)
    bad("assets must be an array of 1..512 entries");
  if ("extensions" in value && !isPlainObject(value.extensions)) bad("extensions must be an object");

  const ids = new Set();
  const urls = new Set();
  for (const [index, asset] of value.assets.entries()) {
    const at = (m) => bad(`assets[${index}]: ${m}`);
    if (!isPlainObject(asset)) at("must be an object");
    const assetAllowed = new Set(["id", "url", "kind", "bytes", "sha256", "prepare"]);
    for (const key of Object.keys(asset)) if (!assetAllowed.has(key)) at(`unknown field ${JSON.stringify(key)}`);
    for (const key of assetAllowed) if (!(key in asset)) at(`missing required field ${JSON.stringify(key)}`);
    if (typeof asset.id !== "string" || !ASSET_ID.test(asset.id)) at("invalid id");
    if (typeof asset.url !== "string" || asset.url.length > 4096 || !/^https:\/\/\S+$/.test(asset.url))
      at("url must be an HTTPS URL with no whitespace");
    if (!ASSET_KINDS.includes(asset.kind)) at(`kind must be one of ${ASSET_KINDS.join(", ")}`);
    if (!Number.isSafeInteger(asset.bytes) || asset.bytes < 1 || asset.bytes > 268435456)
      at("bytes must be an integer in 1..268435456");
    if (typeof asset.sha256 !== "string" || !SHA256.test(asset.sha256))
      at("sha256 must be 64 lowercase hex characters");
    if (typeof asset.prepare !== "boolean") at("prepare must be a boolean");

    // Mirrors assertAssetUrl(): canonical HTTPS, no credentials, no query, no fragment.
    let url;
    try {
      url = new URL(asset.url);
    } catch {
      at("url is not parseable");
    }
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.href !== asset.url)
      at("url must be a canonical HTTPS URL without credentials, query or fragment");

    if (ids.has(asset.id)) at(`duplicate asset id ${JSON.stringify(asset.id)}`);
    if (urls.has(asset.url)) at("duplicate asset url");
    ids.add(asset.id);
    urls.add(asset.url);
  }

  const entry = value.assets.find((a) => a.id === value.entrypoint);
  if (!entry) bad(`entrypoint ${JSON.stringify(value.entrypoint)} names no declared asset`);
  if (entry.kind !== ENTRYPOINT_KIND[value.runtime])
    bad(`runtime ${value.runtime} requires an entrypoint of kind ${ENTRYPOINT_KIND[value.runtime]}`);

  return value;
}

/**
 * Mirrors owls-web-loader hintDescriptors(): filter on the `prepare` flag, apply
 * the byte budget across the selected assets, and describe cross-origin,
 * referrer-free hints. Throws on budget overflow rather than silently trimming.
 */
export function hintDescriptors(release, file, { rel = "prefetch", budget = DEFAULT_BUDGET_BYTES } = {}) {
  const selected = release.assets.filter((a) => a.prepare && (rel !== "modulepreload" || a.kind === "module"));
  const total = selected.reduce((n, a) => n + a.bytes, 0);
  if (!Number.isSafeInteger(budget) || budget < 1 || total > budget)
    throw new ManifestError(file, `hints total ${total} bytes, over the ${budget} byte preparation budget`);
  return selected.map((a) =>
    Object.freeze({
      rel,
      href: a.url,
      as: rel === "modulepreload" ? undefined : "fetch",
      crossorigin: "anonymous",
      referrerpolicy: "no-referrer",
    }),
  );
}

function readManifestFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") return []; // no releases directory: no preparation
    throw error;
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".json"))
    .map((e) => e.name)
    .sort();
}

/** Documentation samples are validated but never emitted. See public/releases/README.md. */
export const isExample = (file) => file.startsWith("example");

/**
 * The single entry point used by src/pages/index.astro.
 *
 * Returns { links, origins, intent, sources }:
 *   links   - <link rel="prefetch"> descriptors, in manifest then asset order
 *   origins - distinct origins to <link rel="preconnect"> / dns-prefetch
 *   intent  - { href, bytes } for the opt-in JS tier, which needs the declared
 *             byte length to enforce its own budget (the <link> descriptors
 *             deliberately do not carry it, matching hintDescriptors())
 *   sources - manifest filenames that contributed, for a build-time comment
 *
 * Returns empty arrays when there is nothing to prepare. Throws ManifestError
 * when a committed manifest is malformed or names a non-allowlisted origin.
 */
export function collectHints({
  origins = readOriginsFromEnv() ?? DEFAULT_ORIGINS,
  budget = DEFAULT_BUDGET_BYTES,
  root = undefined,
} = {}) {
  const dir = releasesDir(root);
  const allowed = new Set(origins);
  const links = [];
  const originList = [];
  const intent = [];
  const sources = [];

  for (const file of readManifestFiles(dir)) {
    let parsed;
    const raw = readFileSync(path.join(dir, file), "utf8");
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new ManifestError(file, `not valid JSON: ${error.message}`);
    }
    // Examples are validated so they cannot rot, then discarded before any
    // origin check, so a sample may safely use a reserved .invalid host.
    const release = validateRelease(parsed, file);
    if (isExample(file)) continue;

    for (const asset of release.assets) {
      const origin = new URL(asset.url).origin;
      if (!allowed.has(origin))
        throw new ManifestError(file, `asset origin ${origin} is not in the site's allowed origin list`);
    }
    const descriptors = hintDescriptors(release, file, { budget });
    if (descriptors.length === 0) continue;
    sources.push(file);
    links.push(...descriptors);
    for (const d of descriptors) {
      const origin = new URL(d.href).origin;
      if (!originList.includes(origin)) originList.push(origin);
      const asset = release.assets.find((a) => a.url === d.href);
      intent.push(Object.freeze({ href: d.href, bytes: asset.bytes }));
    }
  }
  return { links, origins: originList, intent, sources };
}

/** PUBLIC_OWLS_ORIGINS, if set, replaces the default allowlist entirely. */
function readOriginsFromEnv() {
  const raw = process.env.PUBLIC_OWLS_ORIGINS;
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export { DEFAULT_ORIGINS, DEFAULT_BUDGET_BYTES, releasesDir };
