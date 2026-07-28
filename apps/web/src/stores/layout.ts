import { create } from "zustand";

/**
 * Pane visibility for the workbench shell.
 *
 * Shape is the only pane that can be fully hidden today (QK-NAT-008): the
 * native workbench's `shapeOpen` toggle (apps/workbench/src/core.ts) closes
 * the right-hand split to 0 and hands that width back to the terminal, its
 * only sibling in that split. `shapeHidden` here is the mirror of that flag
 * — `false` is the native `shapeOpen: true` default.
 */
interface LayoutState {
  readonly shapeHidden: boolean;
  toggleShape: () => void;
}

export const useLayoutStore = create<LayoutState>((set) => ({
  shapeHidden: false,
  toggleShape: () => set((state) => ({ shapeHidden: !state.shapeHidden })),
}));
