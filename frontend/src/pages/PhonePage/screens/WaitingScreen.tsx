import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { BellRing, BookOpen, Check, ChevronRight, CircleAlert, House, Info, MicOff, Newspaper, PhoneMissed, ShieldCheck, Volume2, WifiOff, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Badge } from '../../../components/atoms/Badge';
import { Card } from '../../../components/atoms/Card';
import type { PhoneMessage } from '../../../api/types';
import type { SoundStatus } from '../phoneSound';
import type { Notice, PhoneUiState } from '../phoneState';
import type { AlertState } from '../usePhone';
import { AlertFamilyCard, NextSteps, WelcomeOfferCard, YourChoicesCard, useMemberChoices } from './HomeCards';
import { LearnTab } from './LearnTab';
import { NewsTab } from './NewsTab';

const MESSAGE_KINDS: Record<PhoneMessage['kind'], string> = {
  weekly: 'This week',
  callback_notice: 'Family number',
  reminder: 'Reminder',
  alert: 'Family alert',
};

export type PhoneTab = 'home' | 'learn' | 'news';

type WaitingScreenProps = {
  memberId: string;
  state: PhoneUiState;
  sound: SoundStatus;
  soundBusy: boolean;
  /** The family's id, when the phone knows it (the News tab needs it). */
  familyId: string | null;
  /** Arrived from the Join tap (once; never after a reload). */
  fromJoin: boolean;
  tab: PhoneTab;
  alert: AlertState;
  welcomeStart: { busy: boolean; error: string | null };
  onTab: (tab: PhoneTab) => void;
  onSound: () => void;
  onDismissNotice: () => void;
  onDismissMessage: (id: number) => void;
  onStartWelcome: () => void;
  onAlert: () => void;
  onResetAlert: () => void;
};

export function WaitingScreen(props: WaitingScreenProps) {
  const { state, tab, familyId, onTab } = props;
  const { link } = state;
  // Loaded once for every tab: the home tab shows them, and leaving
  // Callback changes what the whole screen says.
  const memberChoices = useMemberChoices(props.memberId, state.voice?.phase === 'final' ? state.voice.callId : '');
  const left = memberChoices.choices?.join.opted_out === true;
  const practiceOff = practiceIsOff(memberChoices.choices);
  const tabs: { key: PhoneTab; label: string; icon: LucideIcon }[] = [
    { key: 'home', label: 'Home', icon: House },
    { key: 'learn', label: 'Learn', icon: BookOpen },
    ...(familyId ? [{ key: 'news' as const, label: 'News', icon: Newspaper }] : []),
  ];
  const current = tabs.some((item) => item.key === tab) ? tab : 'home';

  // A new tab starts at the top.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [current]);

  return (
    <main className="phone-screen phone-light phone-waiting has-tabs">
      <header className="phone-top">
        <span className="phone-brand">
          <ShieldCheck size={20} aria-hidden="true" />
          Callback
        </span>
        {link === 'offline' ? (
          <span className="status-pill warn">Offline</span>
        ) : left ? (
          <span className="status-pill phone-status-off">Off</span>
        ) : link === 'online' && practiceOff ? (
          <span className="status-pill phone-status-off">Practice off</span>
        ) : link === 'online' ? (
          <span className="status-pill good phone-status-on">On</span>
        ) : null}
      </header>

      {link === 'offline' && (
        <div className="phone-notice phone-notice--error" role="status">
          <WifiOff size={18} aria-hidden="true" />
          <p>No connection to Callback. Trying again…</p>
        </div>
      )}

      <div id={`phone-panel-${current}`} role="tabpanel" aria-labelledby={`phone-tab-${current}`} className="phone-panel">
        {current === 'home' && <HomeTab {...props} memberChoices={memberChoices} />}
        {current === 'learn' && <LearnTab />}
        {current === 'news' && familyId && <NewsTab familyId={familyId} memberId={props.memberId} />}
      </div>

      <nav className="phone-tabs" aria-label="Callback">
        <div role="tablist" className="phone-tabs__list">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              id={`phone-tab-${key}`}
              type="button"
              role="tab"
              aria-selected={current === key}
              aria-controls={`phone-panel-${key}`}
              className={`phone-tabs__tab ${current === key ? 'is-active' : ''}`}
              onClick={() => onTab(key)}
            >
              <Icon size={22} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      </nav>
    </main>
  );
}

function HomeTab({
  memberId,
  state,
  sound,
  soundBusy,
  fromJoin,
  alert,
  welcomeStart,
  onSound,
  onDismissNotice,
  onDismissMessage,
  onStartWelcome,
  onAlert,
  onResetAlert,
  memberChoices,
}: WaitingScreenProps & { memberChoices: ReturnType<typeof useMemberChoices> }) {
  const { phone, notice } = state;
  const hidden = new Set(state.hiddenMessages);
  const visible = (phone?.messages ?? []).filter((message) => !hidden.has(message.id));
  // A family alert is urgent: it goes first, above everything else.
  const alerts = visible.filter((message) => message.kind === 'alert');
  const messages = visible.filter((message) => message.kind !== 'alert');
  // Just joined, and nothing has rung or been learned about a welcome call yet.
  // Once one rings, or the history says there was one, the usual line is back.
  const awaitingWelcome = fromJoin && state.welcomeOffer === 'unknown' && state.voice === null;
  const { choices, error: choicesError, reload } = memberChoices;
  const practiceOff = practiceIsOff(choices);

  if (choices?.join.opted_out) {
    const { organiser, family } = choices.join;
    return (
      <>
        <Card className="phone-hero phone-hero--left">
          <h1 className="phone-hero__title">You’ve left Callback</h1>
          <p className="phone-hero__who">
            <strong>{choices.join.member.name}</strong>
            <span> · {family.name}</span>
          </p>
          <p className="phone-hero__text">
            No practice calls will come, and nothing is recorded. If you would like to come back,
            {organiser ? ` ask ${organiser.name}` : ' ask your family'} to add you again.
          </p>
        </Card>
        <p className="phone-habit-line">
          If a call ever feels wrong: hang up and call back on a number you already have, or ask for the family word.
        </p>
      </>
    );
  }

  return (
    <>
      {notice && <NoticeBanner notice={notice} onDismiss={onDismissNotice} />}

      {alerts.length > 0 && (
        <section className="phone-messages" aria-label="Family alerts">
          {alerts.map((message) => (
            <MessageCard key={message.id} message={message} onDismiss={onDismissMessage} />
          ))}
        </section>
      )}

      <Card className={`phone-hero ${practiceOff ? 'phone-hero--off' : ''}`}>
        <h1 className="phone-hero__title">{practiceOff ? 'Practice calls are off' : 'Callback is on'}</h1>
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
        <p className="phone-hero__text">
          {awaitingWelcome
            ? 'Your welcome call will ring on this page in a few seconds. Keep it open.'
            : practiceOff
              ? 'You won’t get practice calls. You can switch them on any time.'
              : 'Keep this page open with the screen on. A call can come at any time.'}
        </p>

        {practiceOff && !awaitingWelcome ? (
          // Nothing rings by itself while practice is off, so no sound button:
          // "Start my welcome call" switches the sound on with its own tap.
          <Link className="phone-hero__switch" to={`/join/${memberId}`}>
            Switch on practice calls
            <ChevronRight size={18} aria-hidden="true" />
          </Link>
        ) : (
          <SoundControl sound={sound} busy={soundBusy} onSound={onSound} />
        )}
      </Card>

      {state.welcomeOffer === 'show' && (
        <WelcomeOfferCard busy={welcomeStart.busy} error={welcomeStart.error} onStart={onStartWelcome} />
      )}

      {messages.length > 0 && (
        <section className="phone-messages" aria-label="Messages">
          <h2 className="phone-section-title">Messages</h2>
          {messages.map((message) => (
            <MessageCard key={message.id} message={message} onDismiss={onDismissMessage} />
          ))}
        </section>
      )}

      <AlertFamilyCard alert={alert} family={phone?.member.family ?? null} onAlert={onAlert} onReset={onResetAlert} />

      <NextSteps />

      <YourChoicesCard memberId={memberId} choices={choices} error={choicesError} onReload={reload} />

      <p className="phone-habit-line">
        If a call ever feels wrong: hang up and call back on the family number, or ask for the family word.
      </p>
    </>
  );
}

/** They said no to practice calls (at join, or out loud on the welcome call).
 * Unknown while their choices load: then the usual "Callback is on". */
function practiceIsOff(choices: ReturnType<typeof useMemberChoices>['choices']): boolean {
  return choices !== null && !choices.join.opted_out && !choices.join.consents.practice;
}

const WHEN = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

function MessageCard({ message, onDismiss }: { message: PhoneMessage; onDismiss: (id: number) => void }) {
  const alert = message.kind === 'alert';
  const when = new Date(message.created_at);
  return (
    <Card className={`phone-message ${alert ? 'phone-message--alert' : ''}`}>
      <div className="phone-message__head">
        {alert ? (
          <span className="phone-message__alert-label">
            <BellRing size={16} aria-hidden="true" />
            {MESSAGE_KINDS[message.kind]}
          </span>
        ) : (
          <Badge tone={message.kind === 'callback_notice' ? 'good' : 'neutral'}>{MESSAGE_KINDS[message.kind]}</Badge>
        )}
        {!Number.isNaN(when.getTime()) && <time dateTime={message.created_at}>{WHEN.format(when)}</time>}
      </div>
      <p className="phone-message__text">{message.text}</p>
      <button type="button" className="phone-message__dismiss" onClick={() => onDismiss(message.id)}>
        <Check size={16} aria-hidden="true" />
        Got it
      </button>
    </Card>
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
      {sound === 'mic_blocked' && !busy ? (
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
