import { createContext, useContext } from "react";
import type { TokenVault } from "./token-vault.js";

const TokenVaultContext = createContext<TokenVault | null>(null);

export function App({ vault }: { vault: TokenVault }) {
  return (
    <TokenVaultContext.Provider value={vault}>
      <main className="ui-loading" role="status">
        Loading workspace…
      </main>
    </TokenVaultContext.Provider>
  );
}

export function useTokenVault(): TokenVault {
  const vault = useContext(TokenVaultContext);
  if (!vault) throw new Error("Token vault is unavailable");
  return vault;
}
