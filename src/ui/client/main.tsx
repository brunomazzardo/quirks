import { createRoot } from "react-dom/client";
import { App, createClientRuntime } from "./app.js";
import { consumeFragmentTokens } from "./token-vault.js";

const mount = document.getElementById("app");
if (!mount) throw new Error("Missing #app mount point");

const vault = consumeFragmentTokens({
  href: window.location.href,
  replaceState: (data, unused, url) => history.replaceState(data, unused, url),
});
const runtime = createClientRuntime(vault);

createRoot(mount).render(<App runtime={runtime} />);
