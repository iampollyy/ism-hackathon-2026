import { useEffect } from 'react';

/** "Your families · Callback" in the browser tab while the page is open. */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (!title) return;
    const before = document.title;
    document.title = `${title} · Callback`;
    return () => {
      document.title = before;
    };
  }, [title]);
}
