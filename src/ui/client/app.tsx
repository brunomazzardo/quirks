import { createContext, useContext, useMemo } from "react";
import { RouterProvider } from "@tanstack/react-router";
import { createAppRouter } from "./router.js";
import type { TokenVault } from "./token-vault.js";

const TokenVaultContext = createContext<TokenVault | null>(null);

export function App({ vault }: { vault: TokenVault }) {
  const router = useMemo(
    () => createAppRouter({ context: { queryClient: undefined, apiClient: undefined } }),
    [],
  );
  return (
    <TokenVaultContext.Provider value={vault}>
      <RouterProvider router={router} />
    </TokenVaultContext.Provider>
  );
}

export function useTokenVault(): TokenVault {
  const vault = useContext(TokenVaultContext);
  if (!vault) throw new Error("Token vault is unavailable");
  return vault;
}
