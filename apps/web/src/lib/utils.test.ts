import { expect, it } from "vite-plus/test";

import { cn } from "./utils";

it("drops nullish entries and lets the later Tailwind utility win", () => {
  expect(cn("px-2", null, undefined, "px-6")).toBe("px-6");
});

it("keeps only the truthy branches of a conditional map", () => {
  expect(cn("text-sm", { "font-mono": true, "font-sans": false })).toBe("text-sm font-mono");
});
