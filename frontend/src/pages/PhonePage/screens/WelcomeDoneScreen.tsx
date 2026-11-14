import { Check, CircleAlert, HeartHandshake, LoaderCircle, MicOff, Phone, PhoneOff, ShieldCheck } from 'lucide-react';
import { Button } from '../../../components/atoms/Button';
import type { VoiceProgress, WelcomeDoneView } from '../phoneState';

type WelcomeDoneScreenProps = {
  view: WelcomeDoneView;
  name: string | null;
  voice: VoiceProgress | null;
  welcomeStart: { busy: boolean; error: string | null };
  onStartWelcome: () => void;
  onDone: () => void;
};

/** After the welcome call: thanks that match what they said, and what
 * became of the copy of their voice. */
export function WelcomeDoneScreen({ view, name, voice, welcomeStart, onStartWelcome, onDone }: WelcomeDoneScreenProps) {
  const failed = view.endedBy === 'error' && view.consent === null;
  const who = name ? `, ${name}` : '';
  const ownVoice = voice && voice.callId === view.callId ? voice : null;

  let tone: 'good' | 'calm' | 'warn';
  let Icon = Check;
  let title: string;
  let text: string;
  if (failed && !view.connected) {
    tone = 'warn';
    Icon = PhoneOff;
    title = 'The welcome call didn’t connect';
    text = 'Nothing is lost. You can start it again now, or later from your home screen.';
  } else if (failed) {
    tone = 'warn';
    Icon = PhoneOff;
    title = 'The line dropped';
    text = `Thank you for your time${who}. You can have the welcome call again now, or later from your home screen.`;
  } else if (view.consent === true) {
    tone = 'good';
    title = `You’re all set${who}`;
    text =
      'Thank you for the call. Callback is on. Practice calls will come at random times, and each one tells you at the end that it was a practice.';
  } else if (view.consent === false) {
    tone = 'calm';
    Icon = HeartHandshake;
    title = `Thank you${who}`;
    text = 'No practice calls will come unless you change your mind. Callback Shield and your family are still here for you.';
  } else {
    tone = 'calm';
    Icon = HeartHandshake;
    title = `Thank you for the call${who}`;
    text = 'If it ended before you were finished, you can have the welcome call again.';
  }

  return (
    <main className="phone-screen phone-light phone-welcome-done">
      <span className={`phone-welcome-done__mark phone-welcome-done__mark--${tone}`} aria-hidden="true">
        <Icon size={34} strokeWidth={2.2} />
      </span>
      <h1 className="phone-welcome-done__title">{title}</h1>
      <p className="phone-welcome-done__text">{text}</p>

      {ownVoice && <VoiceCard voice={ownVoice} voiceConsent={view.voiceConsent} />}

      {!failed && (
        <ul className="phone-next" aria-label="What happens now">
          <li>
            <ShieldCheck size={20} aria-hidden="true" />
            <span>Keep this page open with the screen on, so a call can reach you.</span>
          </li>
          <li>
            <Phone size={20} aria-hidden="true" />
            <span>If a call ever asks for money or a code, hang up and call back on a number you already have.</span>
          </li>
        </ul>
      )}

      <div className="phone-reveal__actions">
        {(failed || view.consent === null) && (
          <button
            type="button"
            className={`phone-big-button ${failed ? 'phone-big-button--green' : 'phone-big-button--quiet'}`}
            onClick={onStartWelcome}
            disabled={welcomeStart.busy}
          >
            {welcomeStart.busy ? (
              <LoaderCircle className="phone-spin" size={24} aria-hidden="true" />
            ) : (
              <Phone size={24} aria-hidden="true" />
            )}
            {welcomeStart.busy ? 'Starting…' : failed ? 'Start my welcome call' : 'Have the welcome call again'}
          </button>
        )}
        {welcomeStart.error && (
          <p className="phone-inline-error" role="alert">
            <CircleAlert size={16} aria-hidden="true" />
            {welcomeStart.error}
          </p>
        )}
        <Button variant="secondary" className="phone-done" onClick={onDone}>
          {failed ? 'Not now' : 'Done'}
        </Button>
      </div>
    </main>
  );
}

/** "Your voice": the upload, then the copy being made, then the result. */
function VoiceCard({ voice, voiceConsent }: { voice: VoiceProgress; voiceConsent: boolean | null }) {
  let tone: 'busy' | 'good' | 'warn' | 'calm' = 'busy';
  let title: string;
  let text: string | null = null;

  if (voice.phase === 'no_recording') {
    // Only worth saying when they agreed to a copy on the call.
    if (voiceConsent !== true) return null;
    tone = 'warn';
    title = 'We couldn’t hear your microphone';
    text = 'So no copy of your voice was made. You can record it later with your family.';
  } else if (voice.phase === 'upload_failed') {
    tone = 'warn';
    title = 'Your recording couldn’t be sent';
    text = `${voice.reason ?? 'Something went wrong.'} No copy of your voice was made.`;
  } else if (voice.phase === 'uploading') {
    title = 'Sending your side of the call…';
    text = 'Only your own voice, for practice calls to your family.';
  } else if (voice.state === 'ready') {
    tone = 'good';
    title = 'Your voice is ready';
    text = 'Callback uses it only for practice calls to your family. You can delete it at any time from your home screen.';
  } else if (voice.state === 'failed') {
    tone = 'warn';
    title = 'Your voice copy couldn’t be made';
    text = voice.reason ?? 'Something went wrong while it was being made.';
  } else if (voice.state === 'none') {
    tone = 'calm';
    title = 'No copy of your voice was made';
    text =
      voiceConsent === false
        ? 'You said no, so nothing from this call was kept.'
        : 'Nothing from this call was kept.';
  } else if (voice.state === 'waiting_for_consent') {
    if (voice.phase === 'final') {
      tone = 'calm';
      title = 'No copy of your voice was made';
      text = 'Callback didn’t hear a clear yes on the call, so it won’t use the recording.';
    } else {
      title = 'Checking your answer…';
      text = 'A copy is only made after a clear yes on the call.';
    }
  } else {
    title = 'Making a copy of your voice…';
    text = 'This takes a few seconds.';
  }

  const Icon =
    tone === 'good'
      ? Check
      : tone === 'warn'
        ? voice.phase === 'no_recording'
          ? MicOff
          : CircleAlert
        : tone === 'calm'
          ? ShieldCheck
          : LoaderCircle;
  return (
    <section className={`phone-voice phone-voice--${tone}`} aria-live="polite" aria-label="Your voice">
      <span className="phone-voice__icon" aria-hidden="true">
        <Icon size={20} className={tone === 'busy' ? 'phone-spin' : undefined} />
      </span>
      <div>
        <h2 className="phone-voice__title">{title}</h2>
        {text && <p className="phone-voice__text">{text}</p>}
      </div>
    </section>
  );
}
