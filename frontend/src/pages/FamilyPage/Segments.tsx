// The organiser's home on a phone, in parts: a row of tabs (People,
// Protection, Demo, Practice, Progress, This week) that scrolls sideways,
// so the page stays short and each part is one tap away. Arrow keys, Home
// and End move between the tabs, as in any tab list.

import { useRef } from 'react';

export const SEGMENTS = [
  { key: 'people', label: 'People', hash: 'members' },
  { key: 'protection', label: 'Protection', hash: 'protection' },
  { key: 'demo', label: 'Demo', hash: 'demo' },
  { key: 'practice', label: 'Practice', hash: 'practice' },
  { key: 'progress', label: 'Progress', hash: 'plan' },
  { key: 'week', label: 'This week', hash: 'week' },
] as const;

export type SegmentKey = (typeof SEGMENTS)[number]['key'];

export const SEGMENT_PANEL = 'fh-seg-panel';

export function segmentForHash(hash: string): SegmentKey | null {
  const id = hash.replace(/^#/, '');
  return SEGMENTS.find((segment) => segment.hash === id || segment.key === id)?.key ?? null;
}

type Props = {
  value: SegmentKey;
  onChange: (key: SegmentKey) => void;
  /** Small notes beside a tab's name, like "2 of 3". */
  notes?: Partial<Record<SegmentKey, string>>;
};

export function Segments({ value, onChange, notes = {} }: Props) {
  const list = useRef<HTMLDivElement>(null);

  const move = (event: React.KeyboardEvent, index: number) => {
    const last = SEGMENTS.length - 1;
    const next =
      event.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
        : event.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
          : event.key === 'Home' ? 0
            : event.key === 'End' ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    onChange(SEGMENTS[next].key);
    list.current?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus();
  };

  return (
    <div className="fh-segments-bar">
      <div ref={list} className="fh-segments" role="tablist" aria-label="Family overview">
        {SEGMENTS.map((segment, index) => {
          const selected = segment.key === value;
          return (
            <button
              key={segment.key}
              id={`fh-seg-${segment.key}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={SEGMENT_PANEL}
              tabIndex={selected ? 0 : -1}
              className={`fh-segment${selected ? ' on' : ''}`}
              onClick={(event) => {
                onChange(segment.key);
                event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
              }}
              onKeyDown={(event) => move(event, index)}
            >
              {segment.label}
              {notes[segment.key] ? <small>{notes[segment.key]}</small> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
