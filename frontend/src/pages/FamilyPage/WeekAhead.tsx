// The week ahead, as a timetable: one row a day, the hours drills may ring
// shaded on each, and each person's next planned practice call where it
// falls. For the organiser only; the people called never see these times.

import { useEffect, useState } from 'react';
import type { ProtectionView } from '../../api/types';
import { hourLabel, whenInZone, zoneCity, zonedTime } from './words';

type Person = { initials: string; color: string };

type Props = {
  protection: ProtectionView;
  people: Record<string, Person>;
};

const DAY = 86_400_000;
const SCALE = [0, 6, 12, 18, 24];

function dayName(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric' }).format(date);
  }
}

export function WeekAhead({ protection, people }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const zone = protection.timezone;
  const start = protection.window_start_hour;
  const end = protection.window_end_hour;
  const today = zonedTime(new Date(now), zone);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now + index * DAY);
    return {
      key: zonedTime(date, zone).dayKey,
      label: index === 0 ? 'Today' : index === 1 ? 'Tomorrow' : dayName(date, zone),
    };
  });

  const planned = protection.members
    .filter((member) => member.next_drill_at)
    .map((member) => {
      const at = new Date(member.next_drill_at as string);
      const when = zonedTime(at, zone);
      return { id: member.member_id, name: member.name, iso: member.next_drill_at as string, ...when };
    })
    .filter((item) => days.some((day) => day.key === item.dayKey));

  const pct = (hour: number) => `${(hour / 24) * 100}%`;
  const summary = [
    `Drills may ring between ${hourLabel(start)} and ${hourLabel(end)}, ${zoneCity(zone)} time.`,
    planned.length > 0
      ? `Planned: ${planned.map((item) => `${item.name}, ${whenInZone(item.iso, zone)}`).join('; ')}.`
      : 'No drill is planned in the next seven days yet.',
  ].join(' ');

  return (
    <figure className={`fh-week-ahead${protection.enabled ? '' : ' off'}`} role="img" aria-label={summary}>
      <div className="fh-wa-scale" aria-hidden="true">
        <span />
        <div>
          {SCALE.map((hour) => (
            <span key={hour} style={{ left: pct(hour) }}>
              {hourLabel(hour)}
            </span>
          ))}
        </div>
      </div>
      {days.map((day, index) => {
        const dots = planned.filter((item) => item.dayKey === day.key);
        return (
          <div key={day.key} className="fh-wa-row" aria-hidden="true">
            <span className="fh-wa-day">{day.label}</span>
            <div className="fh-wa-track">
              <span className="fh-wa-window" style={{ left: pct(start), width: pct(end - start) }} />
              {index === 0 ? (
                <>
                  <span className="fh-wa-past" style={{ width: pct(today.hour) }} />
                  <span className="fh-wa-now" style={{ left: pct(today.hour) }} />
                </>
              ) : null}
              {dots.map((item) => {
                const person = people[item.id];
                return (
                  <span
                    key={item.id}
                    className="fh-wa-dot"
                    style={{ left: pct(item.hour), background: person?.color }}
                    title={`${item.name}: ${whenInZone(item.iso, zone)}`}
                  >
                    {person?.initials ?? item.name.slice(0, 1)}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
    </figure>
  );
}
