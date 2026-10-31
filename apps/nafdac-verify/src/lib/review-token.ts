import { useCallback, useState } from "react";
import { useClientValue } from "@/lib/use-client-value";

const TOKEN_KEY = "safemeds:review-token";

/** Reviewer token kept in sessionStorage for this tab; shared by the dashboard and metrics pages. */
export function useReviewToken() {
  const stored = useClientValue(() => sessionStorage.getItem(TOKEN_KEY) ?? "");
  // undefined = not signed in or out during this visit, so fall back to the stored token.
  const [override, setOverride] = useState<string | null | undefined>(undefined);
  const token = override === undefined ? stored || null : override;

  const signIn = useCallback((value: string) => {
    try {
      sessionStorage.setItem(TOKEN_KEY, value);
    } catch {
      /* memory only */
    }
    setOverride(value);
  }, []);

  const signOut = useCallback(() => {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
    setOverride(null);
  }, []);

  return { token, signIn, signOut };
}
