// Two buttons for showing Callback to someone: a surprise drill that rings
// within a minute, and a Shield demo call (a simulated scam call during which
// the Shield warns the person live and alerts the family by itself). The
// state lives in useDemo, on the page.

import { Link } from 'react-router-dom';
import { ArrowRight, Radio, Sparkles } from 'lucide-react';
import type { MemberView, ProtectionView } from '../../api/types';
import { ANYONE, type Demo, type Drill } from './useDemo';

type Props = {
  members: MemberView[];
  protection: ProtectionView | null;
  demo: Demo;
};

type Hint = { tone: 'warn' | 'good'; text: string };

function names(list: string[]): string {
  if (list.length <= 1) return list[0] ?? '';
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

function drillNotice(drill: Drill): { tone: 'wait' | 'live' | 'done'; text: string; link: string | null } {
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
}

export function DemoPanel({ members, protection, demo }: Props) {
  const { canGet, reasonFor, drill, shield } = demo;

  // ---------------------------------------------------------------- surprise drill

  const canGetOne = members.filter((member) => canGet(member.id));
  const openOnes = canGetOne.filter((member) => member.phone_online);
  const drillHint: Hint | null = (() => {
    if (drill.choice !== ANYONE) {
      const target = drill.target;
      if (!target) return null;
      return target.phone_online
        ? { tone: 'good', text: `${target.name}'s phone is open.` }
        : { tone: 'warn', text: `${target.name}'s phone page isn't open. Open it to see the drill ring.` };
    }
    if (canGetOne.length === 0) return { tone: 'warn', text: 'Nobody can get a drill right now. Protection shows why.' };
    if (openOnes.length === 0) {
      return { tone: 'warn', text: "No phone page is open, so nobody would see it ring. Open someone's phone link first." };
    }
    if (openOnes.length < canGetOne.length) {
      const open = openOnes.map((member) => member.name);
      return {
        tone: 'warn',
        text: `Only ${names(open)}'s ${open.length === 1 ? 'phone is' : 'phones are'} open. Choose ${
          open.length === 1 ? open[0] : 'one of them'
        } to see it ring.`,
      };
    }
    return null;
  })();

  const notice = drill.current ? drillNotice(drill.current) : null;
  const drillLabel = drill.busy
    ? 'Planning the drill…'
    : drill.live
      ? drill.current?.status === 'scheduled'
        ? 'Drill on its way…'
        : 'Drill in progress…'
      : drill.current
        ? 'Ring another surprise drill'
        : 'Ring a surprise drill';

  // ---------------------------------------------------------------- shield demo

  const shieldOff = protection !== null && !protection.shield_enabled;
  const target = shield.target;
  const shieldHint: Hint | null = shieldOff
    ? { tone: 'warn', text: 'The Shield is switched off. Switch it on under Protection to use this.' }
    : !target
      ? null
      : !target.consent.practice
        ? { tone: 'warn', text: `${target.name} hasn't agreed to practice calls yet.` }
        : !target.phone_online
          ? { tone: 'warn', text: `Open ${target.name}'s phone link first. It rings straight away.` }
          : { tone: 'good', text: `${target.name}'s phone is open.` };

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
          <select value={drill.choice} onChange={(event) => drill.choose(event.target.value)} disabled={drill.live}>
            {members.map((member) => {
              const able = canGet(member.id);
              const why = (reasonFor(member.id) ?? 'not now').replace(/\.$/, '').toLowerCase();
              return (
                <option key={member.id} value={member.id} disabled={!able}>
                  {member.name}
                  {!able ? ` (${why})` : member.phone_online ? ' · phone open' : ''}
                </option>
              );
            })}
            <option value={ANYONE}>Anyone, at random</option>
          </select>
        </label>
        {drill.error ? (
          <div className="fh-alert" role="alert">
            {drill.error}
          </div>
        ) : drillHint && !drill.live ? (
          <small className={`fh-hint ${drillHint.tone}`}>{drillHint.text}</small>
        ) : null}
        {notice && drill.current ? (
          <div className={`fh-demo-notice ${notice.tone}`} role="status">
            <span className="fh-demo-pulse" aria-hidden="true" />
            <div className="fh-demo-notice-text">
              <span>{notice.text}</span>
              {notice.link ? (
                <Link to={`/calls/${drill.current.callId}`} className="fh-inline-link">
                  {notice.link} <ArrowRight size={14} />
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}
        <button
          type="button"
          className="button button-primary fh-wide"
          onClick={() => void drill.start()}
          disabled={drill.busy || drill.live}
        >
          <Sparkles size={16} /> {drillLabel}
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
          <select value={shield.choice} onChange={(event) => shield.choose(event.target.value)} disabled={members.length === 0}>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
                {!member.consent.practice ? ' · not agreed yet' : member.phone_online ? ' · phone open' : ''}
              </option>
            ))}
          </select>
        </label>
        {shield.error ? (
          <div className="fh-alert" role="alert">
            {shield.error}
          </div>
        ) : shieldHint ? (
          <small className={`fh-hint ${shieldHint.tone}`}>{shieldHint.text}</small>
        ) : null}
        <button
          type="button"
          className="button fh-shield-button fh-wide"
          onClick={() => void shield.start()}
          disabled={shield.busy || shieldOff || !target}
        >
          <Radio size={16} /> {shield.busy ? 'Ringing…' : 'Start a Shield demo call'}
        </button>
      </div>
    </section>
  );
}
