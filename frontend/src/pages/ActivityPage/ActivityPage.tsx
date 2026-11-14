// Who did what (/family/:familyId/activity), on GET /api/families/{id}/activity:
// a newest-first timeline grouped by day, an icon per kind, and a link to the
// call where there is one. The drills list colours each drill by how it went
// (the activity item itself only has a sentence). Refreshed every few seconds.
// Drills that are planned, ringing or in progress are never listed here (the
// back end leaves them out): a drill is a surprise.

import { useMemo, type ComponentType } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  AudioLines, BadgeCheck, BellRing, ChevronRight, CirclePause, Hourglass, Lightbulb, LogOut, Mail, MessageSquare,
  Mic, PhoneCall, PhoneForwarded, PhoneMissed, ShieldCheck, Sparkles, UserPlus, type LucideProps,
} from 'lucide-react';
import { api } from '../../api/client';
import type { ActivityView, DrillList, FamilyView } from '../../api/types';
import {
  EmptyState, LoadError, LoadingRows, memberIndex, PersonAvatar, PersonFilter, ReviewHeader, StaleNotice,
  useRememberFamily,
} from '../DrillsPage/ReviewParts';
import { clockTime, dayHeading, dayKey, drillState, plural, type ActivityItem, type DrillView } from '../DrillsPage/reviewWords';
import { usePolled } from '../DrillsPage/usePolled';
import { useShieldCalls, type ShieldInfo } from '../DrillsPage/useShieldCalls';
import { parseTime } from '../LiveCallPage/liveCallState';
import '../DrillsPage/review.scss';
import './ActivityPage.scss';

const REFRESH_MS = 5000;

type Kind = ActivityItem['kind'];
type Tone = 'good' | 'tip' | 'alert' | 'neutral';
type Look = { icon: ComponentType<LucideProps>; label: string; tone: Tone; open?: string };

const LOOKS: Record<Kind, Look> = {
  joined: { icon: UserPlus, label: 'Joined', tone: 'good' },
  consent_given: { icon: BadgeCheck, label: 'Practice calls', tone: 'good' },
  consent_withdrawn: { icon: CirclePause, label: 'Practice calls', tone: 'neutral' },
  voice_consent: { icon: Mic, label: 'Voice', tone: 'good' },
  voice_ready: { icon: AudioLines, label: 'Voice', tone: 'good' },
  welcome_done: { icon: Sparkles, label: 'Welcome call', tone: 'good', open: 'Open the call' },
  drill: { icon: ShieldCheck, label: 'Drill', tone: 'good', open: 'Replay' },
  drill_unanswered: { icon: PhoneMissed, label: 'Drill', tone: 'neutral', open: 'Open' },
  family_line: { icon: PhoneForwarded, label: 'Family number', tone: 'good', open: 'Replay the drill' },
  alert: { icon: BellRing, label: 'Family alert', tone: 'alert' },
  weekly_note: { icon: Mail, label: 'Weekly note', tone: 'neutral' },
  reminder: { icon: PhoneCall, label: 'Reminder', tone: 'neutral' },
  message: { icon: MessageSquare, label: 'Message', tone: 'neutral' },
  opted_out: { icon: LogOut, label: 'Left Callback', tone: 'neutral' },
};

/** A drill's look depends on how it went, which the drills list knows, and
 * on whether it was a Shield demo call. */
function lookFor(item: ActivityItem, drills: Map<string, DrillView>, shields: Map<string, ShieldInfo>): Look {
  const base = LOOKS[item.kind] ?? LOOKS.message;
  if (item.kind !== 'drill' && item.kind !== 'drill_unanswered') return base;
  const name = item.call_id && shields.has(item.call_id) ? 'Shield demo' : base.label;
  if (item.kind === 'drill_unanswered') return { ...base, label: name };
  const drill = item.call_id ? drills.get(item.call_id) : undefined;
  const state = drill ? drillState(drill) : null;
  if (state === 'safe') return { ...base, label: `${name} · handled the safe way` };
  if (state === 'tip') return { ...base, icon: Lightbulb, tone: 'tip', label: `${name} · a tip for next time` };
  if (state === 'reviewing') return { ...base, icon: Hourglass, tone: 'neutral', label: `${name} · being reviewed` };
  // Not in the drills list (older than its last 100): say only that it was a drill.
  return { ...base, icon: PhoneCall, tone: 'neutral', label: name };
}

/** The Shield call an alert came from. An alert item has no call, but the
 * Shield writes its alerts the moment it alerts (call.shield.alerted_at); the
 * "Something's wrong" button only works outside a call. */
function shieldCallFor(item: ActivityItem, shields: Map<string, ShieldInfo>): string | null {
  if (item.kind !== 'alert') return null;
  const at = parseTime(item.when);
  if (at === null) return null;
  for (const [callId, shield] of shields) {
    const alerted = parseTime(shield.alertedAt);
    if (alerted !== null && Math.abs(at - alerted) <= 15_000) return callId;
  }
  return null;
}

type Day = { key: string; title: string; detail: string | null; items: ActivityItem[] };

function byDay(items: ActivityItem[]): Day[] {
  const days: Day[] = [];
  for (const item of items) {
    const key = dayKey(item.when);
    let day = days[days.length - 1];
    if (!day || day.key !== key) {
      day = { key, ...dayHeading(item.when), items: [] };
      days.push(day);
    }
    day.items.push(item);
  }
  return days;
}

export function ActivityPage() {
  const { familyId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const memberId = params.get('member');

  const family = usePolled<FamilyView>(() => api.getFamily(familyId), familyId, 30_000, 'The family could not be loaded.');
  const activity = usePolled<ActivityView>(() => api.activity(familyId, 200), familyId, REFRESH_MS, 'The activity could not be loaded.');
  const drillList = usePolled<DrillList>(() => api.drills(familyId, undefined, 100), familyId, 10_000, 'The drills could not be loaded.');
  useRememberFamily(family.data?.id);

  const items = activity.data?.items ?? null;
  const drills = useMemo(
    () => new Map((drillList.data?.drills ?? []).map((drill) => [drill.call_id, drill] as const)),
    [drillList.data],
  );
  const shields = useShieldCalls(drillList.data?.drills);
  // Whom each item is about: its member, and for a Shield alert (whose member
  // is who got it) also the person on the Shield call.
  const people = useMemo(() => {
    const map = new Map<ActivityItem, Set<string>>();
    for (const item of items ?? []) {
      const ids = new Set<string>();
      if (item.member) ids.add(item.member.id);
      const shieldCall = shieldCallFor(item, shields);
      const onCall = shieldCall ? drills.get(shieldCall)?.member.id : undefined;
      if (onCall) ids.add(onCall);
      map.set(item, ids);
    }
    return map;
  }, [items, shields, drills]);
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const ids of people.values()) for (const id of ids) map.set(id, (map.get(id) ?? 0) + 1);
    return map;
  }, [people]);
  const shown = useMemo(
    () => (items ?? []).filter((item) => !memberId || people.get(item)?.has(memberId)),
    [items, memberId, people],
  );
  const days = useMemo(() => byDay(shown), [shown]);
  const members = family.data?.members ?? [];
  const selected = members.find((member) => member.id === memberId) ?? null;

  const choose = (next: string | null) => {
    const copy = new URLSearchParams(params);
    if (next) copy.set('member', next);
    else copy.delete('member');
    setParams(copy, { replace: true });
  };

  if (family.notFound || activity.notFound) {
    return (
      <div className="rv">
        <ReviewHeader
          familyId={familyId}
          familyName={null}
          back={{ to: '/families', label: 'Your families' }}
          title="We couldn’t find this family"
          lead="The link may be from another server, or the family was removed."
          actions={<Link to="/families" className="button button-primary rv-button">See your families</Link>}
        />
      </div>
    );
  }

  return (
    <div className="rv rv-activity">
      <ReviewHeader
        familyId={familyId}
        familyName={family.data?.name ?? null}
        title="Activity"
        lead="Who did what in the family, newest first: joining, the welcome calls, drills, the family number and alerts."
        actions={(
          <Link to={`/family/${familyId}/drills`} className="button button-secondary rv-button">
            <ShieldCheck size={16} aria-hidden /> All drills
          </Link>
        )}
      />

      {activity.stale ? <StaleNotice /> : null}

      <section className="rv-panel" aria-label="Activity">
        {members.length && items?.length ? (
          <div className="rv-toolbar">
            <PersonFilter
              members={members}
              value={memberId}
              onChange={choose}
              counts={counts}
              total={items.length}
              label="Show activity for"
            />
          </div>
        ) : null}

        {items === null ? (
          activity.error && !activity.loading ? (
            <LoadError message={activity.error} onRetry={activity.reload} />
          ) : (
            <LoadingRows label="Loading the activity" />
          )
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Sparkles size={22} />}
            title="Nothing has happened yet"
            action={<Link to={`/family/${familyId}`} className="button button-primary rv-button">Invite the family</Link>}
          >
            <p>
              When someone joins from their invite link, takes the welcome call, or answers a drill, it shows up here
              with the time, so you can see how everyone is getting on.
            </p>
          </EmptyState>
        ) : shown.length === 0 ? (
          <EmptyState
            compact
            icon={<Sparkles size={20} />}
            title={`Nothing from ${selected?.name ?? 'this person'} yet`}
            action={<button type="button" className="button button-ghost rv-button" onClick={() => choose(null)}>Show everyone</button>}
          >
            <p>Once {selected?.name ?? 'they'} joins or takes a call, it shows up here.</p>
          </EmptyState>
        ) : (
          <div className="rv-days">
            {days.map((day) => (
              <section key={day.key} className="rv-day" aria-label={day.detail ? `${day.title}, ${day.detail}` : day.title}>
                <h2 className="rv-day__title">
                  {day.title}
                  {day.detail ? <span>{day.detail}</span> : null}
                  <small>{plural(day.items.length, 'event')}</small>
                </h2>
                <ol className="rv-timeline">
                  {day.items.map((item, index) => (
                    <TimelineItem
                      key={`${item.when}-${item.kind}-${index}`}
                      item={item}
                      look={lookFor(item, drills, shields)}
                      shieldCallId={shieldCallFor(item, shields)}
                      drills={drills}
                      colorIndex={item.member ? memberIndex(family.data, item.member.id) : 0}
                    />
                  ))}
                </ol>
              </section>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// For a message, `member` is who got it, not who did something.
const SENT_KINDS: readonly Kind[] = ['alert', 'weekly_note', 'reminder', 'message'];

type TimelineItemProps = {
  item: ActivityItem;
  look: Look;
  /** For an alert the Shield sent during a Shield demo call: that call. */
  shieldCallId: string | null;
  /** The drills list, to tell a Shield call still going on from a past one. */
  drills: Map<string, DrillView>;
  colorIndex: number;
};

function TimelineItem({ item, look, shieldCallId, drills, colorIndex }: TimelineItemProps) {
  const Icon = look.icon;
  const sent = SENT_KINDS.includes(item.kind);
  const name = shieldCallId ? 'Shield alert' : look.label;
  const label = sent ? `${name} · sent to ${item.member ? item.member.name : 'the family'}` : name;
  const callId = item.call_id ?? shieldCallId;
  const shieldDrill = shieldCallId ? drills.get(shieldCallId) : undefined;
  const shieldLive = !!shieldDrill && ['live', 'reviewing'].includes(drillState(shieldDrill));
  return (
    <li className={`rv-event is-${look.tone}`}>
      <time className="rv-event__time" dateTime={item.when}>{clockTime(item.when)}</time>
      <span className="rv-event__node" aria-hidden><Icon size={16} /></span>
      <div className="rv-event__body">
        <p>{item.text}</p>
        <span className="rv-event__meta">
          {item.member ? <PersonAvatar name={item.member.name} index={colorIndex} size="sm" /> : null}
          {label}
        </span>
      </div>
      {callId ? (
        <Link to={`/calls/${callId}`} className="rv-event__open">
          {shieldCallId ? (shieldLive ? 'Follow the call' : 'Replay the call') : look.open ?? 'Open the call'}
          <ChevronRight size={15} aria-hidden />
        </Link>
      ) : <span />}
    </li>
  );
}
