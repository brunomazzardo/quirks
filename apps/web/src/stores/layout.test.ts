import { beforeEach, expect, it } from "vite-plus/test";

import { useLayoutStore } from "./layout";

beforeEach(() => {
  useLayoutStore.setState({ shapeHidden: false });
});

it("shows the Shape pane by default", () => {
  expect(useLayoutStore.getState().shapeHidden).toBe(false);
});

it("toggleShape flips shapeHidden, and flips back", () => {
  useLayoutStore.getState().toggleShape();
  expect(useLayoutStore.getState().shapeHidden).toBe(true);

  useLayoutStore.getState().toggleShape();
  expect(useLayoutStore.getState().shapeHidden).toBe(false);
});
