import { AsyncLocalStorage } from "node:async_hooks";

const fetchStorage = new AsyncLocalStorage<typeof globalThis.fetch | undefined>();
const originalFetch = globalThis.fetch.bind(globalThis);

let installed = false;

function installFetchOverrideHook() {
  if (installed) {
    return;
  }

  const wrappedFetch: typeof globalThis.fetch = async (input, init) => {
    const override = fetchStorage.getStore();
    if (override && override !== wrappedFetch) {
      return override(input, init);
    }
    return originalFetch(input, init);
  };

  Object.defineProperty(globalThis, "fetch", {
    value: wrappedFetch,
    writable: true,
    configurable: true,
  });

  installed = true;
}

export async function runWithFetchOverride<T>(
  fetchOverride: typeof globalThis.fetch | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!fetchOverride) {
    return fn();
  }

  installFetchOverrideHook();
  return fetchStorage.run(fetchOverride, fn);
}
