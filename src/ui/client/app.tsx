import { QueryClientProvider } from "@tanstack/react-query";
import { createApiClient, type ApiClient } from "./api-client.js";
import { queryClient } from "./query-client.js";
import type { TokenVault } from "./token-vault.js";

export interface ClientRuntime {
  queryClient: typeof queryClient;
  apiClient: ApiClient;
}

export function createClientRuntime(vault: TokenVault): ClientRuntime {
  return {
    queryClient,
    apiClient: createApiClient(vault),
  };
}

export function App({ runtime }: { runtime: ClientRuntime }) {
  return (
    <QueryClientProvider client={runtime.queryClient}>
      <main className="ui-loading" role="status">
        Loading workspace…
      </main>
    </QueryClientProvider>
  );
}
