// OWLS intent-preparation tier. OFF BY DEFAULT. Ships only when the build sets
// PUBLIC_OWLS_INTENT === "1" (see src/components/OwlsIntent.astro).
//
// It warms the HTTP cache for assets a manifest marked `prepare`. It NEVER
// compiles, instantiates, imports, evaluates or mounts anything: the fetched
// bytes are read to completion and dropped. Activation belongs to the
// application page, not to the marketing page.
//
// Policy shape mirrors owls-web-loader browserPolicy() / prepareOnIntent():
// saveData + effectiveType guard, byte budget, AbortController, credential-free
// CORS, redirects refused.
const BUDGET_BYTES = 8 * 1024 * 1024;
const ASSET_LIMIT = 64 * 1024 * 1024;
const TIMEOUT_MS = 30000;
const EVENTS = ["pointerenter", "focusin", "touchstart"];

/** Mirrors browserPolicy().allowPreparation: never spend a data-saver's bytes. */
function allowPreparation() {
  const c = navigator.connection;
  return !c?.saveData && !["slow-2g", "2g"].includes(c?.effectiveType ?? "");
}

/** Reads the body to completion under a hard byte cap, then discards it. */
async function drain(response, cap) {
  const reader = response.body?.getReader();
  if (!reader) return;
  let seen = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    seen += value.byteLength;
    if (seen > cap) {
      await reader.cancel();
      throw new Error("asset exceeded preparation budget");
    }
  }
}

/**
 * Warm `urls` once, on first intent, cancellable. Returns a teardown function.
 * Errors are swallowed: speculative preparation must never break the page.
 */
export function prepareOnIntent(elements, urls, { budget = BUDGET_BYTES, onBegin } = {}) {
  const total = urls.reduce((n, u) => n + (u.bytes ?? 0), 0);
  if (urls.length === 0 || total > budget) return () => {};
  const controller = new AbortController();
  let started = false;

  const begin = () => {
    if (started || !allowPreparation()) return;
    started = true;
    try {
      onBegin?.(urls);
    } catch {
      /* an observer must never stop preparation */
    }
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    Promise.all(
      urls.map((u) =>
        fetch(u.href, {
          credentials: "omit",
          mode: "cors",
          redirect: "error",
          cache: "force-cache",
          referrerPolicy: "no-referrer",
          priority: "low",
          signal: controller.signal,
        }).then((r) => (r.ok ? drain(r, Math.min(u.bytes ?? ASSET_LIMIT, ASSET_LIMIT)) : undefined)),
      ),
    )
      .catch(() => {})
      .finally(() => clearTimeout(timer));
  };

  for (const element of elements) {
    for (const event of EVENTS) element.addEventListener(event, begin, { passive: true, once: true });
  }
  return () => {
    controller.abort();
    for (const element of elements) {
      for (const event of EVENTS) element.removeEventListener(event, begin);
    }
  };
}

/**
 * Wires the CTA anchors that already point at the application subdomains.
 * `onBegin` is an optional observer, used by the pilot harness to record that
 * preparation actually started. It cannot influence preparation.
 */
export function attach(descriptors, { onBegin } = {}) {
  const byOrigin = new Map();
  for (const d of descriptors) {
    const origin = new URL(d.href).origin;
    if (!byOrigin.has(origin)) byOrigin.set(origin, []);
    byOrigin.get(origin).push(d);
  }
  const teardowns = [];
  for (const [origin, group] of byOrigin) {
    const anchors = [...document.querySelectorAll("a[href]")].filter((a) => {
      try {
        return new URL(a.href).origin === origin;
      } catch {
        return false;
      }
    });
    if (anchors.length > 0) teardowns.push(prepareOnIntent(anchors, group, { onBegin }));
  }
  return () => teardowns.forEach((t) => t());
}
