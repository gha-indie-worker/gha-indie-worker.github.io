#!/usr/bin/env node
// Validates every OWLS release manifest committed under public/releases/, using
// exactly the code path the Astro build uses. Zero dependencies, so CI can run
// it before `npm ci` and before any Astro build.
//
// Exits 0 when every manifest is well formed (including when there are none).
// Exits 1 with the offending file and reason otherwise.
import process from "node:process";
import { collectHints, DEFAULT_ORIGINS } from "../src/lib/prepare.mjs";

try {
  const { links, origins, sources } = collectHints();
  const summary = {
    allowed_origins: [...DEFAULT_ORIGINS],
    manifests_emitting_hints: sources,
    hint_links: links.length,
    hint_origins: origins,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (links.length === 0) {
    process.stdout.write(
      "no release manifest requests preparation: the build will emit no resource hints\n",
    );
  }
} catch (error) {
  process.stderr.write(`release manifest validation failed: ${error.message}\n`);
  process.exit(1);
}
