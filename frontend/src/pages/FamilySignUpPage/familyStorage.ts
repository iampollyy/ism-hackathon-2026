// The family this browser set up, so the sidebar and the home page can find
// the family page again. Only the id is kept; storage can be blocked or empty,
// so every read and write is guarded.

import { useSyncExternalStore } from 'react';

const FAMILY_KEY = 'callback.familyId';
const CHANGED = 'callback:family-changed';

export function storedFamilyId(): string | null {
  try {
    return window.localStorage.getItem(FAMILY_KEY);
  } catch {
    return null;
  }
}

export function saveFamilyId(familyId: string): void {
  try {
    window.localStorage.setItem(FAMILY_KEY, familyId);
  } catch {
    // Storage is blocked: the family page still works from its address.
  }
  window.dispatchEvent(new Event(CHANGED));
}

/** Forget the stored family, but only if it is this one (it no longer exists). */
export function forgetFamilyId(familyId: string): void {
  if (storedFamilyId() !== familyId) return;
  try {
    window.localStorage.removeItem(FAMILY_KEY);
  } catch {
    // nothing to forget
  }
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/** The stored family id, kept up to date when sign-up saves a new one. */
export function useStoredFamilyId(): string | null {
  return useSyncExternalStore(subscribe, storedFamilyId, () => null);
}
