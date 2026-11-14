// This week's calls, messages and alerts, newest first. The same message sent
// to several people at once (a Shield alert) is one line, with who got it.
// While a practice call is still to come or ringing, its line leaves out
// whose voice it uses.

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Bell, CalendarClock, MessageSquare, Phone, PhoneCall, PhoneIncoming, ShieldAlert } from 'lucide-react';
import type { ScenarioView, WeekItem } from '../../api/types';
import { isLiveStatus, scenarioTitle, statusWords, whenWords } from './words';

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
  // Whose voice stays out while the call is still to come or ringing.
  return `Practice for ${who}: ${title}${isLiveStatus(item.status) ? '' : voice}`;
}

type Props = { week: WeekItem[]; familyId: string; scenarios: ScenarioView[] };

export function WeekList({ week, familyId, scenarios }: Props) {
  const rows = toRows(week);

  return (
    <section id="week" className="fh-panel fh-week" aria-labelledby="week-title">
      <div className="fh-panel-head">
        <h2 id="week-title">This week</h2>
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
                    {to.length > 0 ? ` to ${names(to)}` : ''} · {whenWords(item.when)}
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
