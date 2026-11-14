// Protection, the product's heart: random drills on or off, how many a week,
// the hours they may ring, the Shield, and each person's drills (paused or
// not, why someone cannot get one, their next drill, how many this week).
// GET on open and every few seconds; a PUT on each change, then the answer.
// The organiser gets drills too, so their own next drill is never shown.

import { useRef, useState } from 'react';
import { EyeOff, PhoneCall, Radio, ShieldCheck } from 'lucide-react';
import { api } from '../../api/client';
import type { ProtectionMemberView, ProtectionUpdate, ProtectionView } from '../../api/types';
import type { Person } from './people';
import { Switch } from './Switch';
import type { Poll } from './usePoll';
import { WeekAhead } from './WeekAhead';
import { browserZone, errorText, hourLabel, whenInZone, zoneCity } from './words';

type Props = {
  familyId: string;
  poll: Poll<ProtectionView>;
  people: Record<string, Person>;
  /** The page already says the server can't be reached. */
  pageStale: boolean;
};

const PER_WEEK = [1, 2, 3, 4, 5, 6, 7];
const START_HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const END_HOURS = Array.from({ length: 24 }, (_, hour) => hour + 1);

function reasonWords(reason: string | null | undefined): string {
  switch (reason) {
    case 'Has not agreed to practice calls.': return "Hasn't agreed to practice calls yet.";
    case 'Has left Callback.': return 'Has left Callback. No calls go to them.';
    case 'Drills are paused.': return 'Paused. No drills until you switch them back on.';
    default: return reason ?? 'Cannot get a drill right now.';
  }
}

function drillLine(
  member: ProtectionMemberView,
  protection: ProtectionView,
  organiser: boolean,
): { text: string; tone: 'next' | 'quiet' | 'warn' } {
  if (!member.eligible) {
    return { text: reasonWords(member.reason_if_not), tone: member.paused ? 'quiet' : 'warn' };
  }
  // Whether one is booked, and when, would give it away.
  if (organiser && protection.enabled) return { text: 'Your own drills stay a surprise too.', tone: 'next' };
  if (member.next_drill_at) {
    return { text: `Next drill ${whenInZone(member.next_drill_at, protection.timezone)}`, tone: 'next' };
  }
  if (!protection.enabled) return { text: 'Ready for drills once protection is on.', tone: 'quiet' };
  if (member.drills_last_7_days >= protection.drills_per_week) {
    return { text: "Had this week's drills. The next one comes later.", tone: 'quiet' };
  }
  return { text: 'Choosing a moment for the next drill…', tone: 'quiet' };
}

export function ProtectionPanel({ familyId, poll, people, pageStale }: Props) {
  const [saving, setSaving] = useState<string | null>(null);
  const [pausing, setPausing] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const latest = useRef<ProtectionView | null>(null);
  latest.current = poll.data;

  const data = poll.data;
  if (!data) {
    return (
      <section id="protection" className="fh-protection is-loading" aria-labelledby="protection-title" aria-busy={!poll.error}>
        <div className="fh-prot-head">
          <span className="fh-prot-icon" aria-hidden="true">
            <ShieldCheck size={22} />
          </span>
          <div>
            <h2 id="protection-title">Protection</h2>
            <p className="fh-prot-lede">
              {poll.error ? `${poll.error.message} Trying again every few seconds.` : 'Loading the protection settings…'}
            </p>
          </div>
        </div>
      </section>
    );
  }

  const on = data.enabled;
  const zone = data.timezone;
  const here = browserZone();

  const change = async (body: ProtectionUpdate, what: string) => {
    const before = latest.current;
    if (!before) return;
    setFailure(null);
    setSaving(what);
    poll.accept({ ...before, ...(Object.fromEntries(Object.entries(body).filter(([, value]) => value !== null && value !== undefined)) as Partial<ProtectionView>) });
    try {
      poll.accept(await poll.guard(() => api.setProtection(familyId, body)));
    } catch (error) {
      if (latest.current) poll.accept({ ...latest.current, ...pick(before, body) });
      setFailure(errorText(error, "That change didn't save. Please try again."));
      poll.refresh();
    } finally {
      setSaving((current) => (current === what ? null : current));
    }
  };

  const pause = async (member: ProtectionMemberView, paused: boolean) => {
    const current = latest.current;
    if (!current) return;
    setFailure(null);
    setPausing(member.member_id);
    const optimistic: ProtectionMemberView = paused
      ? { ...member, paused: true, eligible: false, reason_if_not: 'Drills are paused.', next_drill_at: null }
      : { ...member, paused: false };
    poll.accept({ ...current, members: current.members.map((m) => (m.member_id === member.member_id ? optimistic : m)) });
    try {
      const entry = await poll.guard(() => api.pauseDrills(member.member_id, { paused }));
      const after = latest.current;
      if (after) poll.accept({ ...after, members: after.members.map((m) => (m.member_id === entry.member_id ? entry : m)) });
    } catch (error) {
      const after = latest.current;
      if (after) poll.accept({ ...after, members: after.members.map((m) => (m.member_id === member.member_id ? member : m)) });
      setFailure(errorText(error, `${member.name}'s drills didn't change. Please try again.`));
    } finally {
      setPausing(null);
      poll.refresh();
    }
  };

  const eligible = data.members.filter((member) => member.eligible).length;

  return (
    <section id="protection" className={`fh-protection ${on ? 'is-on' : 'is-off'}`} aria-labelledby="protection-title">
      <div className="fh-prot-head">
        <span className="fh-prot-icon" aria-hidden="true">
          <ShieldCheck size={22} />
        </span>
        <div>
          <h2 id="protection-title">Protection</h2>
          <p className="fh-prot-lede">
            {!on
              ? 'Off. No practice call rings by itself.'
              : eligible === 0
                ? 'On, but nobody can get a drill right now. See who below.'
                : `On for ${eligible === 1 ? '1 person' : `${eligible} people`}. Practice calls ring at random.`}
          </p>
        </div>
        <Switch
          size="lg"
          surface="dark"
          checked={on}
          label="Protection"
          busy={saving === 'enabled'}
          onChange={(next) => void change({ enabled: next }, 'enabled')}
        />
      </div>

      <ul className="fh-prot-means" aria-label={on ? 'What protection does now' : 'What switching protection on does'}>
        <li>
          <PhoneCall size={18} aria-hidden="true" />
          <div>
            <strong>Random practice calls</strong>
            <span>
              Up to {data.drills_per_week} a week each, {hourLabel(data.window_start_hour)} to{' '}
              {data.window_end_hour === 24 ? 'midnight' : hourLabel(data.window_end_hour)}, often in a relative's cloned
              voice. Each one ends by saying it was practice.
            </span>
          </div>
        </li>
        <li>
          <EyeOff size={18} aria-hidden="true" />
          <div>
            <strong>Nobody is told when</strong>
            <span>A drill feels like a real call, so the habit of checking sticks. You see everyone's times but your own.</span>
          </div>
        </li>
        <li>
          <Radio size={18} aria-hidden="true" />
          <div>
            <strong>{data.shield_enabled ? 'The Shield during calls' : 'The Shield is off'}</strong>
            <span>
              {data.shield_enabled
                ? 'If a call sounds like a scam, their phone warns them live and the family is alerted.'
                : 'No live warnings and no family alerts. Switch it on below.'}
            </span>
          </div>
        </li>
      </ul>

      <div className="fh-prot-settings">
        <fieldset className="fh-setting">
          <legend>Drills a week, per person</legend>
          <div className="fh-steps">
            {PER_WEEK.map((count) => (
              <label key={count} className={data.drills_per_week === count ? 'on' : undefined}>
                <input
                  type="radio"
                  name="drills-per-week"
                  value={count}
                  checked={data.drills_per_week === count}
                  onChange={() => void change({ drills_per_week: count }, 'per-week')}
                />
                <span>{count}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="fh-setting">
          <legend>
            Allowed hours <span className="fh-zone">{zoneCity(zone)} time</span>
          </legend>
          <div className="fh-hours">
            <select
              aria-label="Drills may ring from"
              value={data.window_start_hour}
              onChange={(event) => void change({ window_start_hour: Number(event.target.value) }, 'hours')}
            >
              {START_HOURS.map((hour) => (
                <option key={hour} value={hour} disabled={hour >= data.window_end_hour}>
                  {hourLabel(hour)}
                </option>
              ))}
            </select>
            <span>to</span>
            <select
              aria-label="Drills may ring until"
              value={data.window_end_hour}
              onChange={(event) => void change({ window_end_hour: Number(event.target.value) }, 'hours')}
            >
              {END_HOURS.map((hour) => (
                <option key={hour} value={hour} disabled={hour <= data.window_start_hour}>
                  {hour === 24 ? 'Midnight' : hourLabel(hour)}
                </option>
              ))}
            </select>
          </div>
          {here && here !== zone ? (
            <button type="button" className="fh-zone-button" onClick={() => void change({ timezone: here }, 'zone')}>
              Use this computer's time zone ({zoneCity(here)})
            </button>
          ) : null}
        </fieldset>
      </div>

      <WeekAhead protection={data} people={people} />

      <div className="fh-shield-row">
        <span className="fh-shield-icon" aria-hidden="true">
          <Radio size={18} />
        </span>
        <div>
          <strong>Callback Shield</strong>
          <p>On a call that sounds like a scam: a live warning on their phone, and an alert to the family.</p>
        </div>
        <Switch
          surface="dark"
          checked={data.shield_enabled}
          label="Callback Shield"
          busy={saving === 'shield'}
          onChange={(next) => void change({ shield_enabled: next }, 'shield')}
        />
      </div>

      {failure ? (
        <div className="fh-alert on-dark" role="alert">
          {failure}
        </div>
      ) : null}
      {poll.error && !pageStale ? (
        <p className="fh-prot-stale" role="status">
          The settings didn't refresh. Showing the last ones; trying again.
        </p>
      ) : null}

      <div className="fh-prot-people">
        <h3>Who gets drills</h3>
        <ul>
          {data.members.map((member) => {
            const person = people[member.member_id];
            const line = drillLine(member, data, Boolean(person?.organiser));
            const left = member.reason_if_not === 'Has left Callback.';
            // Green only for someone a drill can reach now; otherwise the switch only says they are not paused.
            const covered = on && member.eligible && !member.paused;
            return (
              <li key={member.member_id}>
                <span className="fh-mini-avatar" style={{ background: person?.color }} aria-hidden="true">
                  {person?.initials ?? member.name.slice(0, 1)}
                </span>
                <div className="fh-prot-person">
                  <strong>{member.name}</strong>
                  <span className={`fh-prot-line ${line.tone}`}>{line.text}</span>
                </div>
                <span className="fh-prot-count">
                  <strong>{member.drills_last_7_days}</strong> in the last 7 days
                </span>
                <Switch
                  surface="dark"
                  checked={!member.paused}
                  label={`Drills for ${member.name}`}
                  onText={covered ? 'Drills on' : 'Not paused'}
                  offText="Paused"
                  tone={covered ? 'good' : 'neutral'}
                  disabled={left}
                  busy={pausing === member.member_id}
                  onChange={(next) => void pause(member, !next)}
                />
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/** The fields of `from` that `body` tried to change, to put them back after a failed write. */
function pick(from: ProtectionView, body: ProtectionUpdate): Partial<ProtectionView> {
  const out: Partial<ProtectionView> = {};
  for (const key of Object.keys(body) as (keyof ProtectionUpdate)[]) {
    (out as Record<string, unknown>)[key] = from[key];
  }
  return out;
}
