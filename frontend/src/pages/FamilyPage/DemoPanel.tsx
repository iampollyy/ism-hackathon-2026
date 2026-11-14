// Two buttons for showing Callback to someone: a surprise drill that rings
// within a minute, and a Shield demo call (a simulated scam call during which
// the Shield warns the person live and alerts the family by itself).

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Radio, Sparkles } from 'lucide-react';
import { api } from '../../api/client';
import type { CallStatus, MemberView, ProtectionView } from '../../api/types';
import { callErrorText } from './words';

type Props = {
  familyId: string;
  members: MemberView[];
  protection: ProtectionView | null;
};

type Drill = { callId: string; name: string; status: CallStatus | 'scheduled' };

const ANYONE = '';

/** The first choice for the Shield demo: someone who agreed, with their phone open, not the organiser. */
function firstPick(members: MemberView[]): string {
  const pool = members.filter((member) => member.consent.practice);
  return (
    pool.find((member) => !member.is_organiser && member.phone_online)?.id ??
    pool.find((member) => member.phone_online)?.id ??
    pool.find((member) => !member.is_organiser)?.id ??
    pool[0]?.id ??
    ''
  );
}

export function DemoPanel({ familyId, members, protection }: Props) {
  const navigate = useNavigate();
  const eligibleIds = new Set(protection?.members.filter((member) => member.eligible).map((member) => member.member_id));
  const knowsEligibility = protection !== null;
  const isEligible = (id: string) => !knowsEligibility || eligibleIds.has(id);
  const reasonFor = (id: string) => protection?.members.find((member) => member.member_id === id)?.reason_if_not;

  // ---------------------------------------------------------------- surprise drill

  const [drillFor, setDrillFor] = useState(ANYONE);
  const [drillBusy, setDrillBusy] = useState(false);
  const [drillError, setDrillError] = useState<string | null>(null);
  const [drill, setDrill] = useState<Drill | null>(null);

  // Follow the drill until it is over: it is planned, then rings, then is answered.
  const drillId = drill?.callId;
  const drillOver = drill ? !['scheduled', 'ringing', 'in_progress'].includes(drill.status) : true;
  useEffect(() => {
    if (!drillId || drillOver) return;
    let live = true;
    const check = async () => {
      try {
        const call = await api.getCall(drillId);
        if (live) setDrill((current) => (current && current.callId === drillId ? { ...current, status: call.status } : current));
      } catch {
        // the next check tries again
      }
    };
    const timer = window.setInterval(() => void check(), 2000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [drillId, drillOver]);

  const drillTarget = members.find((member) => member.id === drillFor);
  // An error goes once what it was about changes: the person, or the drill on its way.
  useEffect(() => setDrillError(null), [drillFor, drill?.status]);

  const surprise = async () => {
    setDrillBusy(true);
    setDrillError(null);
    try {
      const created = await api.surpriseDrill(familyId, { member_id: drillFor || null, within_seconds: 60 });
      setDrill({ callId: created.call_id, name: created.member.name, status: 'scheduled' });
    } catch (error) {
      setDrillError(callErrorText(error, drillTarget?.name ?? 'This person'));
    } finally {
      setDrillBusy(false);
    }
  };

  // ---------------------------------------------------------------- shield demo

  const [shieldFor, setShieldFor] = useState('');
  const [shieldBusy, setShieldBusy] = useState(false);
  const [shieldError, setShieldError] = useState<string | null>(null);
  useEffect(() => {
    if (!shieldFor || !members.some((member) => member.id === shieldFor)) {
      const pick = firstPick(members);
      if (pick) setShieldFor(pick);
    }
  }, [members, shieldFor]);
  const shieldTarget = members.find((member) => member.id === shieldFor);
  const shieldOff = protection !== null && !protection.shield_enabled;
  const targetOnline = shieldTarget?.phone_online;
  useEffect(() => setShieldError(null), [shieldFor, targetOnline]);

  const shield = async () => {
    if (!shieldTarget) return;
    setShieldBusy(true);
    setShieldError(null);
    try {
      const created = await api.shieldCall(familyId, { member_id: shieldTarget.id });
      navigate(`/calls/${created.call_id}`);
    } catch (error) {
      setShieldError(callErrorText(error, shieldTarget.name));
      setShieldBusy(false);
    }
  };

  const drillNotice = (() => {
    if (!drill) return null;
    switch (drill.status) {
      case 'scheduled':
        return { tone: 'wait', text: `A drill will ring ${drill.name}'s phone within a minute.`, link: null };
      case 'ringing':
        return { tone: 'live', text: `Ringing on ${drill.name}'s phone now.`, link: 'Watch the call' };
      case 'in_progress':
        return { tone: 'live', text: `${drill.name} answered the drill.`, link: 'Watch the call' };
      case 'ended':
      case 'scored':
        return { tone: 'done', text: `${drill.name}'s drill has ended.`, link: 'See how it went' };
      case 'missed':
      case 'declined':
        return { tone: 'done', text: `${drill.name} didn't pick up this time. That's fine; another drill will come.`, link: null };
      default:
        return { tone: 'done', text: `The drill for ${drill.name} didn't go ahead.`, link: null };
    }
  })();

  return (
    <section id="demo" className="fh-panel fh-demo" aria-labelledby="demo-title">
      <div className="fh-panel-head">
        <h2 id="demo-title">Show it working</h2>
        <span className="fh-demo-tag">Demo</span>
      </div>
      <p className="fh-panel-note">For showing Callback to someone. Both ring a real phone page.</p>

      <div className="fh-demo-block">
        <div className="fh-demo-title">
          <Sparkles size={18} aria-hidden="true" />
          <h3>Surprise drill</h3>
        </div>
        <p>A practice call rings within a minute, chosen as a random drill would be. It always ends with the reveal.</p>
        <label className="fh-field">
          <span>Who gets it</span>
          <select value={drillFor} onChange={(event) => setDrillFor(event.target.value)}>
            <option value={ANYONE}>Anyone who can get one</option>
            {members.map((member) => (
              <option key={member.id} value={member.id} disabled={!isEligible(member.id)}>
                {member.name}
                {!isEligible(member.id) ? ` (${(reasonFor(member.id) ?? 'not now').replace(/\.$/, '').toLowerCase()})` : ''}
              </option>
            ))}
          </select>
        </label>
        {drillError ? (
          <div className="fh-alert" role="alert">{drillError}</div>
        ) : drillTarget && !drillTarget.phone_online ? (
          <small className="fh-hint warn">{drillTarget.name}'s phone page isn't open. Open it to see the drill ring.</small>
        ) : null}
        {drillNotice ? (
          <div className={`fh-demo-notice ${drillNotice.tone}`} role="status">
            <span className="fh-demo-pulse" aria-hidden="true" />
            <span>{drillNotice.text}</span>
            {drillNotice.link && drill ? (
              <Link to={`/calls/${drill.callId}`} className="fh-inline-link">
                {drillNotice.link} <ArrowRight size={14} />
              </Link>
            ) : null}
          </div>
        ) : null}
        <button type="button" className="button button-primary fh-wide" onClick={surprise} disabled={drillBusy}>
          <Sparkles size={16} /> {drillBusy ? 'Planning the drill…' : 'Ring a surprise drill'}
        </button>
      </div>

      <div className="fh-demo-block">
        <div className="fh-demo-title">
          <Radio size={18} aria-hidden="true" />
          <h3>Shield demo call</h3>
        </div>
        <p>
          A simulated scam call that rings now. As soon as it sounds like a scam, Callback Shield warns them on screen
          and alerts the family by itself.
        </p>
        <label className="fh-field">
          <span>Who gets it</span>
          <select value={shieldFor} onChange={(event) => setShieldFor(event.target.value)} disabled={members.length === 0}>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
                {member.phone_online ? ' · phone open' : ''}
              </option>
            ))}
          </select>
        </label>
        {shieldError ? (
          <div className="fh-alert" role="alert">{shieldError}</div>
        ) : shieldOff ? (
          <small className="fh-hint warn">The Shield is switched off. Switch it on under Protection to use this.</small>
        ) : shieldTarget && !shieldTarget.consent.practice ? (
          <small className="fh-hint warn">{shieldTarget.name} hasn't agreed to practice calls yet.</small>
        ) : shieldTarget && !shieldTarget.phone_online ? (
          <small className="fh-hint warn">Open {shieldTarget.name}'s phone link first. It rings straight away.</small>
        ) : shieldTarget ? (
          <small className="fh-hint good">{shieldTarget.name}'s phone is open.</small>
        ) : null}
        <button type="button" className="button fh-shield-button fh-wide" onClick={shield} disabled={shieldBusy || shieldOff || !shieldTarget}>
          <Radio size={16} /> {shieldBusy ? 'Ringing…' : 'Start a Shield demo call'}
        </button>
      </div>
    </section>
  );
}
