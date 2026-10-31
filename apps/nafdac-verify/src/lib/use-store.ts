"use client";

import { useSyncExternalStore } from "react";
import type { JsonStore } from "./json-store";

export function useStore<T>(store: JsonStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
}
