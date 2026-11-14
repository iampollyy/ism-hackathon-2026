import { Volume2, VolumeX } from 'lucide-react';
import { callAudio } from '../audio';
import { nav } from '../copy';
import { store, useLp } from '../store';

export function readSound(): boolean {
  try {
    return window.localStorage.getItem('lp-sound') !== 'off';
  } catch {
    return true;
  }
}

export function setSound(on: boolean) {
  store.set({ soundOn: on });
  callAudio.setMuted(!on);
  try {
    window.localStorage.setItem('lp-sound', on ? 'on' : 'off');
  } catch {
    /* private mode: the toggle still works for this visit */
  }
}

/** Never starts audio by itself; it only mutes or unmutes what plays. */
export function SoundToggle({ className = '', withLabel = false }: { className?: string; withLabel?: boolean }) {
  const on = useLp((s) => s.soundOn);
  const label = on ? nav.soundOn : nav.soundOff;
  return (
    <button
      type="button"
      className={`lp-sound ${className}`}
      aria-label={withLabel ? undefined : label}
      title={label}
      onClick={() => setSound(!on)}
    >
      <span className="lp-sound__icons" data-on={on}>
        <Volume2 size={20} strokeWidth={1.75} aria-hidden="true" className="on" />
        <VolumeX size={20} strokeWidth={1.75} aria-hidden="true" className="off" />
      </span>
      {withLabel ? <span>{label}</span> : null}
    </button>
  );
}
