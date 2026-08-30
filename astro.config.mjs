// @ts-check
import { defineConfig } from "astro/config";

const site = process.env.PUBLIC_SITE_URL ?? "https://gha-indie-worker.github.io";

export default defineConfig({
  site,
  output: "static",
  trailingSlash: "always",
  build: {
    format: "directory",
  },
});
