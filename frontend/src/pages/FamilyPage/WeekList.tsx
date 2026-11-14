// This week's activity: calls, messages and reminders, newest first.

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Bell, CalendarClock, MessageSquare, Phone, PhoneCall, PhoneIncoming, ShieldAlert } from 'lucide-react';
import type { WeekItem } from '../../api/types';
import { statusWords, whenWords } from './words';

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

export function WeekList({ week }: { week: WeekItem[] }) {
  return (
    <section className="content-panel week-panel">
      <div className="section-heading-row compact">
        <div>
          <span className="eyebrow">This week</span>
          <h2>Calls and messages</h2>
        </div>
      </div>

      {week.length === 0 ? (
        <p className="panel-empty">Nothing yet this week. Start a practice, or a welcome call from someone's card.</p>
      ) : (
        <div className="activity-stack">
          {week.slice(0, SHOWN).map((item, index) => {
            const linked = item.call_id && (item.kind === 'practice' || item.kind === 'welcome');
            const body = (
              <>
                <div className={`activity-icon kind-${item.kind}`}>{ICONS[item.kind]}</div>
                <div>
                  <strong>{item.text}</strong>
                  <small>
                    <span className={`week-status ${item.status}`}>{statusWords(item.status)}</span> · {whenWords(item.when)}
                  </small>
                </div>
              </>
            );
            return linked ? (
              <Link key={`${item.call_id}-${index}`} to={`/calls/${item.call_id}`} className="activity-item week-item linked">
                {body}
              </Link>
            ) : (
              <div key={`${item.kind}-${item.when}-${index}`} className="activity-item week-item">
                {body}
              </div>
            );
          })}
          {week.length > SHOWN ? <small className="panel-empty">And {week.length - SHOWN} earlier.</small> : null}
        </div>
      )}
    </section>
  );
}
