// The phone page, /phone/:memberId: what a family member holds. Full screen,
// mobile first. waiting -> ringing -> in call -> reveal -> family line.
// The logic lives in usePhone.ts; the screens are in ./screens.

import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Link2Off } from 'lucide-react';
import { usePhone } from './usePhone';
import { WaitingScreen } from './screens/WaitingScreen';
import { RingingScreen } from './screens/RingingScreen';
import { CallScreen } from './screens/CallScreen';
import { RevealScreen } from './screens/RevealScreen';
import './PhonePage.scss';

const DARK_BAR = '#0a1824';

/** Paint the browser bar dark while the dark call screens show. */
function useThemeColor(dark: boolean) {
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta || !dark) return;
    const before = meta.content;
    meta.content = DARK_BAR;
    return () => {
      meta.content = before;
    };
  }, [dark]);
}

export function PhonePage() {
  const { memberId = '' } = useParams<{ memberId: string }>();
  // A fresh phone (state, sound, polling) for each member link.
  return <Phone key={memberId} memberId={memberId} />;
}

function Phone({ memberId }: { memberId: string }) {
  const phone = usePhone(memberId);
  const { state } = phone;
  const { view } = state;
  useThemeColor(view.name === 'ringing' || view.name === 'in_call' || view.name === 'family_line');

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
          onEnd={phone.hangUp}
        />
      );
      break;
    case 'family_line':
      screen = (
        <CallScreen
          title="Family line"
          number={null}
          variant="family_line"
          startedAt={view.startedAt}
          connected={view.connected}
          mode={view.mode}
          onEnd={phone.hangUp}
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
    default:
      screen = (
        <WaitingScreen
          state={state}
          sound={phone.sound}
          soundBusy={phone.soundBusy}
          onSound={phone.switchOnSound}
          onDismissNotice={phone.dismissNotice}
          onDismissMessage={phone.dismissMessage}
        />
      );
  }

  return <div className="phone-page">{screen}</div>;
}
