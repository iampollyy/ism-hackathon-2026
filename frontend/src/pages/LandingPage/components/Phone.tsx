// The CSS phone. It renders on first paint everywhere and, in 3D mode, its box is
// the anchor the WebGL phone flies to (the frame hides, the box stays).
import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';

/** 'bloom' is one green burst, as a call connects. */
export type Rings = 'scam' | 'safe' | 'bloom' | 'off';

export function Phone({
  anchor,
  rings = 'off',
  tilt = 'none',
  className = '',
  decorative = true,
  children,
  style,
}: {
  anchor?: string;
  rings?: Rings;
  tilt?: 'none' | 'hero' | 'left' | 'right';
  className?: string;
  /** Illustrations are hidden from assistive tech and cannot take focus. */
  decorative?: boolean;
  children?: ReactNode;
  style?: CSSProperties;
}) {
  const screenRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = screenRef.current;
    if (!el) return;
    const set = () => {
      const w = el.clientWidth;
      if (w > 0) el.style.setProperty('--s', String(w / 390));
    };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div
      className={`lp-phone lp-phone--tilt-${tilt} ${className}`}
      data-phone-anchor={anchor}
      data-rings={rings}
      style={style}
      aria-hidden={decorative || undefined}
      inert={decorative || undefined}
    >
      <span className="lp-rings" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <div className="lp-phone__body">
        <span className="lp-phone__btn lp-phone__btn--power" />
        <span className="lp-phone__btn lp-phone__btn--vol1" />
        <span className="lp-phone__btn lp-phone__btn--vol2" />
        <div className="lp-phone__screen" ref={screenRef}>
          <div className="lp-phone__content">{children}</div>
          <span className="lp-phone__glare" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
