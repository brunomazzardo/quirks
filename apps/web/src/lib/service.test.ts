import { afterEach, expect, it } from "vite-plus/test";

import { serviceBaseUrl } from "./service";

const ORIGINAL: unknown = import.meta.env.VITE_QUIRKS_URL;

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete import.meta.env.VITE_QUIRKS_URL;
  } else {
    import.meta.env.VITE_QUIRKS_URL = ORIGINAL;
  }
});

it("defaults to the same origin, so the dev proxy is what reaches the daemon", () => {
  // import.meta.env is backed by process.env in this test runtime, which
  // stringifies assignments — `= undefined` becomes the string "undefined".
  // Deleting the key is what actually simulates "unset".
  delete import.meta.env.VITE_QUIRKS_URL;
  expect(serviceBaseUrl()).toBe("");
});

it("defaults to the same origin when VITE_QUIRKS_URL is blank", () => {
  import.meta.env.VITE_QUIRKS_URL = "   ";
  expect(serviceBaseUrl()).toBe("");
});

it("prefers VITE_QUIRKS_URL when set, trimming a trailing slash", () => {
  import.meta.env.VITE_QUIRKS_URL = "http://127.0.0.1:9999/";
  expect(serviceBaseUrl()).toBe("http://127.0.0.1:9999");
});

it("composes onto a route path under either resolution", () => {
  delete import.meta.env.VITE_QUIRKS_URL;
  expect(`${serviceBaseUrl()}/v1/goals`).toBe("/v1/goals");
  import.meta.env.VITE_QUIRKS_URL = "http://127.0.0.1:47301";
  expect(`${serviceBaseUrl()}/v1/goals`).toBe("http://127.0.0.1:47301/v1/goals");
});
