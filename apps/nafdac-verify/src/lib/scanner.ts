import { useSyncExternalStore } from "react";

// Open state of the scanner sheet, shared by every "Scan" button and the one sheet in the mobile layout.
let open = false;
const listeners = new Set<() => void>();

export function setScannerOpen(value: boolean) {
  open = value;
  listeners.forEach((listener) => listener());
}

export function useScannerOpen(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => open,
    () => false,
  );
}
