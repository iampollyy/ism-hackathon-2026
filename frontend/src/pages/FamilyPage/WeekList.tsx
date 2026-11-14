// This week's calls, messages and alerts, newest first. The same message sent
// to several people at once (a Shield alert) is one line, with who got it.
// A practice call's line says whose voice it used only once it is over, and
// the organiser's own planned drill keeps its time a surprise. Times are in
// the family's time zone, as under Protection.
//
// A change to the protection settings, or a pause, cancels the drills still
// to come; the back end marks them failed and plans new ones. Those are left
// out: a failed practice whose time is still ahead was cancelled, and one
// whose time has passed was cancelled if it ended before its time (its call
// says when it ended).

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Bell, CalendarClock, MessageSquare, Phone, PhoneCall, PhoneIncoming, ShieldAlert } from 'lucide-react';
import { api } from '../../api/client';
import type { ScenarioView, WeekItem } from '../../api/types';
import type { Person } from './people';
import { browserZone, scenarioTitle, statusWords, whenInZone, whenWords, zoneCity } from './words';

const ICONS: Record<WeekItem['kind'], ReactNode> = {
  welcome: <PhoneIncoming size={16} />,
  practice: <PhoneCall size={16} />,
  family_line: <Phone size={16} />,
  message: <MessageSquare size={16} />,
  reminder: <Bell size={16} />,
  weekly: <CalendarClock size={16} />,
  alert: <ShieldAlert size={16} />,
};

const SHOWN = 8;
const SAME_MESSAGE_MS = 5 * 60_000;
const MESSAGE_KINDS: WeekItem['kind'][] = ['message', 'reminder', 'weekly', 'alert'];

type Row = { item: WeekItem; to: string[] };

/** Statuses after which a practice call's voice may be named. */
const OVER: string[] = ['ended', 'scored', 'missed', 'declined'];
/** A drill that ended this long before its time was cancelled, not one that failed to ring. */
const EARLY_MS = 5000;

const isFailedPractice = (item: WeekItem) => item.kind === 'practice' && item.status === 'failed' && Boolean(item.call_id);

/**
 * The call ids of drills cancelled before their time. Ones still ahead are
 * known at once; for ones whose time has passed, their call is asked once
 * (failed is final, so the answer is kept). Until then they stay out.
 */
function useCancelled(week: WeekItem[]): (item: WeekItem) => boolean {
  const known = useRef(new Map<string, boolean>());
  const [, setVersion] = useState(0);
  const now = Date.now();
  const failed = week.filter(isFailedPractice);
  for (const item of failed) {
    if (Date.parse(item.when) > now) known.current.set(item.call_id as string, true);
  }
  const unknown = failed
    .filter((item) => !known.current.has(item.call_id as string))
    .map((item) => `${item.call_id}|${item.when}`)
    .join(',');

  useEffect(() => {
    if (!unknown) return;
    let live = true;
    const pairs = unknown.split(',').map((pair) => pair.split('|') as [string, string]);
    void Promise.all(
      pairs.map(async ([id, when]) => {
        try {
          const call = await api.getCall(id);
          const ended = call.ended_at ? Date.parse(call.ended_at) : Number.NaN;
          return [id, Number.isFinite(ended) && ended < Date.parse(when) - EARLY_MS] as const;
        } catch {
          return [id, false] as const; // shown as it is
        }
      }),
    ).then((answers) => {
      for (const [id, cancelled] of answers) known.current.set(id, cancelled);
      if (live) setVersion((version) => version + 1);
    });
    return () => {
      live = false;
    };
  }, [unknown]);

  return (item) => isFailedPractice(item) && known.current.get(item.call_id as string) !== false;
}

/** One row per call, and per message however many people got it. */
function toRows(week: WeekItem[]): Row[] {
  const rows: Row[] = [];
  for (const item of week) {
    if (!MESSAGE_KINDS.includes(item.kind)) {
      rows.push({ item, to: [] });
      continue;
    }
    const same = rows.find(
      (row) =>
        row.item.kind === item.kind &&
        row.item.text === item.text &&
        Math.abs(Date.parse(row.item.when) - Date.parse(item.when)) < SAME_MESSAGE_MS,
    );
    if (same) {
      if (!same.to.includes(item.member_name)) same.to.push(item.member_name);
    } else {
      rows.push({ item, to: [item.member_name] });
    }
  }
  return rows;
}

function names(list: string[]): string {
  if (list.length <= 1) return list[0] ?? '';
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/** "Practice for Sara: relative new number, in Jon's voice" with the story's own title. */
function callText(item: WeekItem, scenarios: ScenarioView[]): string {
  if (item.kind !== 'practice') return item.text;
  const match = /^Practice for (.+?): (.+?)(, in .+'s voice)?$/.exec(item.text);
  if (!match) return item.text;
  const [, who, story, voice = ''] = match;
  const title = scenarioTitle(story.replace(/ /g, '_'), scenarios);
  // Whose voice is named only once the call is over.
  return `Practice for ${who}: ${title}${OVER.includes(item.status) ? voice : ''}`;
}

type Props = {
  week: WeekItem[];
  familyId: string;
  scenarios: ScenarioView[];
  people: Record<string, Person>;
  /** The family's time zone; null while the protection settings load. */
  zone: string | null;
};

export function WeekList({ week, familyId, scenarios, people, zone }: Props) {
  const cancelled = useCancelled(week);
  const rows = toRows(week.filter((item) => !cancelled(item)));
  const here = browserZone();
  const when = (item: WeekItem) => {
    if (item.kind === 'practice' && item.status === 'scheduled' && people[item.member_id]?.organiser) {
      return 'time kept a surprise';
    }
    return zone ? whenInZone(item.when, zone) : whenWords(item.when);
  };

  return (
    <section id="week" className="fh-panel fh-week" aria-labelledby="week-title">
      <div className="fh-panel-head">
        <div>
          <h2 id="week-title">This week</h2>
          {zone && here && here !== zone ? <p className="fh-week-zone">Times in {zoneCity(zone)} time</p> : null}
        </div>
        <Link to={`/family/${familyId}/activity`} className="fh-inline-link">
          All activity <ArrowRight size={14} />
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="fh-empty">Nothing yet this week. Calls, messages and alerts show here as they happen.</p>
      ) : (
        <ul className="fh-week-list">
          {rows.slice(0, SHOWN).map(({ item, to }, index) => {
            const linked = item.call_id && (item.kind === 'practice' || item.kind === 'welcome');
            const status = to.length > 1 ? 'sent' : item.status;
            const body = (
              <>
                <span className={`fh-week-icon kind-${item.kind}`} aria-hidden="true">
                  {ICONS[item.kind]}
                </span>
                <span className="fh-week-text">
                  <strong>{callText(item, scenarios)}</strong>
                  <small>
                    <span className={`fh-week-status ${status}`}>{statusWords(status)}</span>
                    {to.length > 0 ? ` to ${names(to)}` : ''} · {when(item)}
                  </small>
                </span>
              </>
            );
            return (
              <li key={`${item.call_id ?? item.kind}-${item.when}-${index}`}>
                {linked ? (
                  <Link to={`/calls/${item.call_id}`} className="fh-week-item linked">
                    {body}
                  </Link>
                ) : (
                  <div className="fh-week-item">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {rows.length > SHOWN ? <p className="fh-more">And {rows.length - SHOWN} earlier.</p> : null}
    </section>
  );
}
