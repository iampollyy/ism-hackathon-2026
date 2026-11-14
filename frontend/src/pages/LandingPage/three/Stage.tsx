import { useEffect, type RefObject } from 'react';

export default function Stage({ onFail }: { portal: RefObject<HTMLDivElement | null>; onReady: () => void; onFail: () => void }) {
  useEffect(() => onFail(), [onFail]);
  return null;
}
