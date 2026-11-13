import { Check, CircleAlert, Info, MicOff, PhoneMissed, ShieldCheck, Volume2, WifiOff, X } from 'lucide-react';
import { Badge } from '../../../components/atoms/Badge';
import { Card } from '../../../components/atoms/Card';
import type { PhoneMessage } from '../../../api/types';
import type { SoundStatus } from '../phoneSound';
import type { Notice, PhoneUiState } from '../phoneState';

const MESSAGE_KINDS: Record<PhoneMessage['kind'], string> = {
  weekly: 'This week',
  callback_notice: 'Family number',
  reminder: 'Reminder',
};

type WaitingScreenProps = {
  state: PhoneUiState;
  sound: SoundStatus;
  soundBusy: boolean;
  onSound: () => void;
  onDismissNotice: () => void;
  onDismissMessage: (id: number) => void;
};

export function WaitingScreen({ state, sound, soundBusy, onSound, onDismissNotice, onDismissMessage }: WaitingScreenProps) {
  const { phone, link, notice } = state;
  const hidden = new Set(state.hiddenMessages);
  const messages = (phone?.messages ?? []).filter((message) => !hidden.has(message.id));

  return (
    <main className="phone-screen phone-light phone-waiting">
      <header className="phone-top">
        <span className="phone-brand">
          <ShieldCheck size={20} aria-hidden="true" />
          Callback
        </span>
        {link === 'offline' ? (
          <span className="status-pill warn">Offline</span>
        ) : link === 'online' ? (
          <span className="status-pill good">On</span>
        ) : null}
      </header>

      {link === 'offline' && (
        <div className="phone-notice phone-notice--error" role="status">
          <WifiOff size={18} aria-hidden="true" />
          <p>No connection to Callback. Trying again…</p>
        </div>
      )}

      {notice && <NoticeBanner notice={notice} onDismiss={onDismissNotice} />}

      <Card className="phone-hero">
        <span className={`phone-hero__light ${link === 'online' ? 'is-on' : ''}`} aria-hidden="true" />
        <h1 className="phone-hero__title">Callback is on</h1>
        <p className="phone-hero__who">
          {phone ? (
            <>
              <strong>{phone.member.name}</strong>
              {phone.member.family && <span> · {phone.member.family}</span>}
            </>
          ) : (
            <span className="muted">Connecting…</span>
          )}
        </p>
        <p className="phone-hero__text">Keep this page open with the screen on. A call can come at any time.</p>

        <SoundControl sound={sound} busy={soundBusy} onSound={onSound} />
      </Card>

      {messages.length > 0 && (
        <section className="phone-messages" aria-label="Messages">
          <h2 className="phone-section-title">Messages</h2>
          {messages.map((message) => (
            <Card key={message.id} className="phone-message">
              <div className="phone-message__head">
                <Badge tone={message.kind === 'callback_notice' ? 'good' : 'neutral'}>{MESSAGE_KINDS[message.kind]}</Badge>
              </div>
              <p className="phone-message__text">{message.text}</p>
              <button type="button" className="phone-message__dismiss" onClick={() => onDismissMessage(message.id)}>
                <Check size={16} aria-hidden="true" />
                Got it
              </button>
            </Card>
          ))}
        </section>
      )}

      <p className="phone-habit-line">
        If a call ever feels wrong: hang up and call back on the family number, or ask for the family word.
      </p>
    </main>
  );
}

function SoundControl({ sound, busy, onSound }: { sound: SoundStatus; busy: boolean; onSound: () => void }) {
  if (sound === 'on') {
    return (
      <button type="button" className="phone-sound phone-sound--on" onClick={onSound} disabled={busy}>
        <Check size={20} aria-hidden="true" />
        Sound is on
      </button>
    );
  }
  return (
    <>
      <button type="button" className="phone-big-button phone-big-button--green" onClick={onSound} disabled={busy}>
        <Volume2 size={24} aria-hidden="true" />
        {busy ? 'Switching on…' : sound === 'mic_blocked' ? 'Tap to try again' : 'Tap to switch on sound'}
      </button>
      {sound === 'mic_blocked' ? (
        <p className="phone-sound-note phone-sound-note--warn">
          <MicOff size={16} aria-hidden="true" />
          The microphone is blocked. Allow it for this page in the browser settings, then tap again.
        </p>
      ) : (
        <p className="phone-sound-note">So the phone can ring out loud and you can talk on the call.</p>
      )}
    </>
  );
}

function NoticeBanner({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  const Icon = notice.missed ? PhoneMissed : notice.tone === 'error' ? CircleAlert : notice.tone === 'good' ? Check : Info;
  return (
    <div className={`phone-notice phone-notice--${notice.tone}`} role="status">
      <Icon size={18} aria-hidden="true" />
      <p>{notice.text}</p>
      <button type="button" className="phone-notice__close" onClick={onDismiss} aria-label="Dismiss">
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  );
}
