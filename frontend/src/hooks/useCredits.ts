import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "gimmeleads-credits";
const DEFAULT_MAX = 200;
const DEFAULT_REMAINING = 142;

interface CreditsState {
  remaining: number;
  max: number;
}

function read(): CreditsState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {
    /* ignore */
  }
  return { remaining: DEFAULT_REMAINING, max: DEFAULT_MAX };
}

// Cross-component subscription so sidebar updates when search consumes a credit.
const listeners = new Set<() => void>();
function notify() {
  listeners.forEach((l) => l());
}

export function useCredits() {
  const [state, setState] = useState<CreditsState>(read);

  useEffect(() => {
    const listener = () => setState(read());
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const persist = useCallback((next: CreditsState) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setState(next);
    notify();
  }, []);

  const consume = useCallback(
    (amount = 1) => {
      const current = read();
      const next = {
        ...current,
        remaining: Math.max(0, current.remaining - amount),
      };
      persist(next);
    },
    [persist],
  );

  return {
    remaining: state.remaining,
    max: state.max,
    consume,
  };
}
