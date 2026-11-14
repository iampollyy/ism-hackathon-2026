// Sound and the microphone, unlocked by a tap on another page (the Join
// button) for the phone page that opens next.
//
// Phones only play sound after a tap, and the welcome call rings the moment
// the phone page first polls. So the Join tap itself creates and resumes an
// AudioContext and asks for the microphone, then the router moves to the
// phone page in the same document (a client-side navigation keeps both).
// PhoneSound adopts what was unlocked here, so the first ring is heard and
// the microphone question has already been answered. The context lives as
// long as the document; PhoneSound never closes it.

export type AudioContextClass = typeof AudioContext;

export function audioContextClass(): AudioContextClass | null {
  const w = window as typeof window & { webkitAudioContext?: AudioContextClass };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export type PrimedAudio = {
  /** Created and resumed inside the tap; null where there is no Web Audio. */
  context: AudioContext | null;
  /** True once the microphone may be used; false if refused or missing. */
  microphone: Promise<boolean>;
};

let primed: PrimedAudio | null = null;

function askMicrophone(): Promise<boolean> {
  if (!navigator.mediaDevices?.getUserMedia) return Promise.resolve(false);
  return navigator.mediaDevices.getUserMedia({ audio: true }).then(
    (stream) => {
      stream.getTracks().forEach((track) => track.stop());
      return true;
    },
    () => false,
  );
}

/** Call straight from a tap's click handler, before any await. */
export function unlockAudioInTap(): void {
  if (primed) {
    // A later tap (Open my phone after Save): wake the same sound again.
    primed.context?.resume().catch(() => undefined);
    primed = { context: primed.context, microphone: askMicrophone() };
    return;
  }
  let context: AudioContext | null = null;
  const Context = audioContextClass();
  if (Context) {
    try {
      context = new Context();
      context.resume().catch(() => undefined);
      // One silent sample, played inside the tap: iOS needs a sound to start.
      const source = context.createBufferSource();
      source.buffer = context.createBuffer(1, 1, 22050);
      source.connect(context.destination);
      source.start(0);
    } catch {
      context = null;
    }
  }
  primed = { context, microphone: askMicrophone() };
}

/** What a tap on this document unlocked, or null if nothing was. */
export function primedAudio(): PrimedAudio | null {
  return primed;
}
