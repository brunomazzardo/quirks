import { createContext, useContext, useMemo } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { createApiClient, type ApiClient } from "./api-client.js";
import { queryClient } from "./query-client.js";
import { createAppRouter } from "./router.js";
import type { TokenVault } from "./token-vault.js";

export interface ClientRuntime {
  queryClient: typeof queryClient;
  apiClient: ApiClient;
}

const TokenVaultContext = createContext<TokenVault | null>(null);

export function createClientRuntime(vault: TokenVault): ClientRuntime {
  return {
    queryClient,
    apiClient: createApiClient(vault),
  };
}

export function App({ vault }: { vault: TokenVault }) {
  const runtime = useMemo(() => createClientRuntime(vault), [vault]);
  const router = useMemo(
    () =>
      createAppRouter({
        context: {
          queryClient: runtime.queryClient,
          apiClient: runtime.apiClient,
        },
      }),
    [runtime],
  );
  return (
    <TokenVaultContext.Provider value={vault}>
      <QueryClientProvider client={runtime.queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </TokenVaultContext.Provider>
  );
}

export function useTokenVault(): TokenVault {
  const vault = useContext(TokenVaultContext);
  if (!vault) throw new Error("Token vault is unavailable");
  return vault;
}
