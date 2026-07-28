import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@fontsource-variable/dm-sans/index.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
// Before ./index.css on purpose: xterm ships its own layout rules for the
// terminal viewport, and where the two overlap the app's stylesheet — loaded
// after — is the one that should win (QK-WB-004).
import "@xterm/xterm/css/xterm.css";
import "./index.css";

import { createAppRouter } from "./router";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("index.html is missing the #root mount point.");
}

const router = createAppRouter();

createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
