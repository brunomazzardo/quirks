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

it("falls back to the repo-derived default port when unset", () => {
  // import.meta.env is backed by process.env in this test runtime, which
  // stringifies assignments — `= undefined` becomes the string "undefined".
  // Deleting the key is what actually simulates "unset".
  delete import.meta.env.VITE_QUIRKS_URL;
  expect(serviceBaseUrl()).toBe("http://127.0.0.1:47301");
});

it("falls back when VITE_QUIRKS_URL is blank", () => {
  import.meta.env.VITE_QUIRKS_URL = "   ";
  expect(serviceBaseUrl()).toBe("http://127.0.0.1:47301");
});

it("prefers VITE_QUIRKS_URL when set, trimming a trailing slash", () => {
  import.meta.env.VITE_QUIRKS_URL = "http://127.0.0.1:9999/";
  expect(serviceBaseUrl()).toBe("http://127.0.0.1:9999");
});
