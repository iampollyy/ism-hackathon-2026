// The phone page, /phone/:memberId: what a family member holds. Full screen,
// mobile first. waiting -> ringing -> in call -> reveal -> practice line
// (the family_line call: an AI helper, and it says so),
// and after the welcome call its thank-you screen.
// The logic lives in usePhone.ts; the screens are in ./screens.

import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Link2Off } from 'lucide-react';
import { api } from '../../api/client';
import type { PhoneState } from '../../api/types';
import { usePhone } from './usePhone';
import { useMemberManifest } from './pwa';
import { WaitingScreen, type PhoneTab } from './screens/WaitingScreen';
import { RingingScreen } from './screens/RingingScreen';
import { CallScreen } from './screens/CallScreen';
import { PRACTICE_LINE_NOTE, RevealScreen } from './screens/RevealScreen';
import { WelcomeDoneScreen } from './screens/WelcomeDoneScreen';
import { LiveCallScreen } from './screens/LiveCallScreen';
import './PhonePage.scss';

const DARK_BAR = '#0e0a24';
const WARNING_BAR = '#8f1820';

/** Paint the browser bar to match the dark call screens. */
function useThemeColor(colour: string | null) {
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta || !colour) return;
    const before = meta.content;
    meta.content = colour;
    return () => {
      meta.content = before;
    };
  }, [colour]);
}

/** The family's id, if phone-state ever carries it (the News tab needs it).
 * Today's PhoneMember has only the family's name, so the tab stays hidden. */
function familyIdOf(phone: PhoneState | null): string | null {
  const member = phone?.member as (PhoneState['member'] & { family_id?: unknown }) | undefined;
  return typeof member?.family_id === 'string' && member.family_id ? member.family_id : null;
}

export function PhonePage() {
  const { memberId = '' } = useParams<{ memberId: string }>();
  // A fresh phone (state, sound, polling) for each member link.
  return <Phone key={memberId} memberId={memberId} />;
}

function Phone({ memberId }: { memberId: string }) {
  const phone = usePhone(memberId);
  // Installing from here (even after the Join tap) opens this member's page.
  useMemberManifest(memberId);
  const { state } = phone;
  const { view } = state;
  const location = useLocation();
  const navigate = useNavigate();
  // Arrived from the Join tap: read once. The router keeps location.state in
  // the history entry across reloads, so it is cleared at once; a reload
  // must not say the welcome call is about to ring.
  const [fromJoin] = useState(() => (location.state as { fromJoin?: boolean } | null)?.fromJoin === true);
  useEffect(() => {
    if (location.state != null) navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate]);
  // The installed app always opens here (its manifest's start_url). Someone
  // who installed it from their invite and hasn't joined yet goes back to the
  // invite, so they join, and take the welcome call, inside the app.
  useEffect(() => {
    if (fromJoin) return;
    let live = true;
    api.getJoin(memberId).then(
      (join) => {
        if (live && !join.joined && !join.opted_out) navigate(`/join/${memberId}`, { replace: true });
      },
      () => undefined, // the phone page still works; the link check above covers a bad id
    );
    return () => {
      live = false;
    };
  }, [fromJoin, memberId, navigate]);
  const [tab, setTab] = useState<PhoneTab>('home');
  const dark = view.name === 'ringing' || view.name === 'in_call' || view.name === 'family_line' || view.name === 'live_call';
  useThemeColor(phone.shield?.warn ? WARNING_BAR : dark ? DARK_BAR : null);

  if (state.link === 'not_found' && view.name === 'waiting') {
    return (
      <div className="phone-page">
        <main className="phone-screen phone-light phone-missing">
          <span className="phone-missing__icon" aria-hidden="true">
            <Link2Off size={28} />
          </span>
          <h1 className="phone-hero__title">This phone link does not work</h1>
          <p className="phone-hero__text">Check that the whole link was copied, or ask your family to send it again.</p>
        </main>
      </div>
    );
  }

  let screen;
  switch (view.name) {
    case 'ringing':
      screen = <RingingScreen call={view.call} onAnswer={phone.answer} onDecline={phone.decline} />;
      break;
    case 'in_call':
      screen = (
        <CallScreen
          title={view.title}
          number={view.number}
          variant={view.kind}
          startedAt={view.startedAt}
          connected={view.connected}
          mode={view.mode}
          ending={view.ending}
          shield={phone.shield}
          recording={view.kind === 'welcome' && phone.recording}
          onCallBack={phone.callBackFromShield}
          onEnd={phone.hangUp}
        />
      );
      break;
    case 'family_line':
      screen = (
        <CallScreen
          title="Callback practice line"
          number={null}
          note={PRACTICE_LINE_NOTE}
          variant="family_line"
          startedAt={view.startedAt}
          connected={view.connected}
          mode={view.mode}
          onEnd={phone.hangUp}
        />
      );
      break;
    case 'live_call':
      screen = (
        <LiveCallScreen
          callId={view.callId}
          title={view.title}
          number={view.number}
          startedAt={view.startedAt}
          shield={phone.shield}
          onEnded={(message) => phone.liveEnded(view.callId, message)}
        />
      );
      break;
    case 'reveal':
      screen = (
        <RevealScreen
          view={view}
          familyNumber={state.phone?.family_number.enabled ?? false}
          onCallFamily={phone.callFamilyNumber}
          onDone={phone.done}
        />
      );
      break;
    case 'welcome_done':
      screen = (
        <WelcomeDoneScreen
          view={view}
          name={state.phone?.member.name ?? null}
          voice={state.voice}
          welcomeStart={phone.welcomeStart}
          onStartWelcome={phone.startWelcomeCall}
          onDone={phone.done}
        />
      );
      break;
    default:
      screen = (
        <WaitingScreen
          memberId={memberId}
          state={state}
          sound={phone.sound}
          soundBusy={phone.soundBusy}
          familyId={familyIdOf(state.phone)}
          fromJoin={fromJoin}
          tab={tab}
          alert={phone.alert}
          welcomeStart={phone.welcomeStart}
          onTab={setTab}
          onSound={phone.switchOnSound}
          onDismissNotice={phone.dismissNotice}
          onDismissMessage={phone.dismissMessage}
          onStartWelcome={phone.startWelcomeCall}
          onAlert={phone.alertFamily}
          onResetAlert={phone.resetAlert}
        />
      );
  }

  return <div className="phone-page">{screen}</div>;
}
