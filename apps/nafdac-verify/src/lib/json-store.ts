export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface JsonStore<T> {
  subscribe(listener: () => void): () => void;
  getSnapshot(): T;
  getServerSnapshot(): T;
  set(value: T): void;
}

interface Options<T> {
  key: string;
  empty: T;
  parse: (raw: string) => T | null;
  getStorage: () => KeyValueStorage | null;
}

// Snapshots must be referentially stable for useSyncExternalStore, so parsed values are cached by raw string.
export function createJsonStore<T>({ key, empty, parse, getStorage }: Options<T>): JsonStore<T> {
  const listeners = new Set<() => void>();
  let cachedRaw: string | null = null;
  let cachedValue: T = empty;
  // Private-mode and blocked-storage setups throw on write; keep the flow working in memory instead.
  let memoryValue: { value: T } | null = null;

  function getSnapshot(): T {
    if (memoryValue) return memoryValue.value;
    let raw: string | null;
    try {
      raw = getStorage()?.getItem(key) ?? null;
    } catch (error) {
      console.warn(`Could not read "${key}" from storage`, error);
      return cachedValue;
    }
    if (raw === cachedRaw) return cachedValue;
    cachedRaw = raw;
    cachedValue = raw === null ? empty : (parse(raw) ?? empty);
    return cachedValue;
  }

  function set(value: T): void {
    try {
      const storage = getStorage();
      if (!storage) throw new Error("Storage is unavailable");
      storage.setItem(key, JSON.stringify(value));
      memoryValue = null;
    } catch (error) {
      console.warn(`Could not save "${key}" to storage; keeping it in memory`, error);
      memoryValue = { value };
    }
    listeners.forEach((listener) => listener());
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot,
    getServerSnapshot: () => empty,
    set,
  };
}

export function parseJson<T>(raw: string, validate: (value: unknown) => T | null): T | null {
  try {
    return validate(JSON.parse(raw));
  } catch (error) {
    console.warn("Ignoring unreadable stored data", error);
    return null;
  }
}
