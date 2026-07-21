import { createRoot } from "react-dom/client";
import { App } from "./app.js";
import { consumeFragmentTokens } from "./token-vault.js";

const mount = document.getElementById("app");
if (!mount) throw new Error("Missing #app mount point");

const vault = consumeFragmentTokens({
  href: window.location.href,
  replaceState: (data, unused, url) => history.replaceState(data, unused, url),
});

createRoot(mount).render(<App vault={vault} />);
