// What the caller says, as text, live: ElevenLabs realtime speech-to-text on
// the caller's own microphone (a single-use token from our back end; the API
// key never reaches the browser). Each finished sentence goes to the call as
// a caller turn, so the Shield's risk check on the member's phone judges it.

import { CommitStrategy, RealtimeEvents, Scribe } from '@elevenlabs/client';
import { api } from '../api/client';

export type Listening = { stop: () => void; setMuted: (muted: boolean) => void };

export async function listenToCaller(
  callId: string,
  onSentence: (text: string) => void,
  onProblem: (message: string) => void,
): Promise<Listening> {
  const { token, model_id } = await api.scribeToken(callId);
  const connection = Scribe.connect({
    token,
    modelId: model_id,
    commitStrategy: CommitStrategy.VAD,
    vadSilenceThresholdSecs: 0.8,
    microphone: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  connection.on(RealtimeEvents.COMMITTED_TRANSCRIPT, (message) => {
    const text = message.text?.trim();
    if (text) onSentence(text);
  });
  const problem = () => onProblem('Live listening stopped. The call goes on.');
  connection.on(RealtimeEvents.AUTH_ERROR, problem);
  connection.on(RealtimeEvents.QUOTA_EXCEEDED, problem);
  connection.on(RealtimeEvents.ERROR, problem);
  return {
    setMuted: (muted) => {
      try {
        if (muted) connection.mute();
        else connection.unmute();
      } catch {
        // not started yet: nothing to mute
      }
    },
    stop: () => {
      try {
        connection.close();
      } catch {
        // already closed
      }
    },
  };
}

/** Post one caller sentence to the call (the risk check runs on the server). */
export async function postCallerTurn(callId: string, text: string): Promise<void> {
  await api.sendEvents(callId, [{ type: 'turn', speaker: 'agent', text }]);
}
