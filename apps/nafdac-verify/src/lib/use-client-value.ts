import { useSyncExternalStore } from "react";

const noSubscribe = () => () => {};

/**
 * Read a browser-only string (URL, sessionStorage) without a setState-in-effect round trip.
 * The server render uses `serverValue`; React swaps in the browser value during hydration.
 * `read` must return a primitive so React can compare snapshots.
 */
export function useClientValue(read: () => string, serverValue = ""): string {
  return useSyncExternalStore(
    noSubscribe,
    () => {
      try {
        return read();
      } catch {
        return serverValue;
      }
    },
    () => serverValue,
  );
}

export const useSearchParam = (name: string) =>
  useClientValue(() => new URLSearchParams(window.location.search).get(name) ?? "");
