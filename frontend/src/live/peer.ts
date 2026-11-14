// A live call's audio link: two browsers talking directly (WebRTC), with the
// back end only passing their offer, answer and ICE candidates along
// (backend/app/services/live_call.py). The caller makes the offer as soon as
// the call rings; the callee answers it once they tap Answer. Each side polls
// for the other's signals and for the call's status, so either side notices
// when the other hangs up.

import { api } from '../api/client';
import type { LiveSide, LiveSignalKind } from '../api/types';

const ICE: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const POLL_MS = 400;
const OPEN = new Set(['ringing', 'in_progress']);

export type LinkStatus = 'connecting' | 'connected' | 'failed';

export type PeerHandlers = {
  onRemoteStream: (stream: MediaStream) => void;
  onLink: (status: LinkStatus) => void;
  /** The call's status on the server, after every poll. */
  onCallStatus: (status: string) => void;
  /** The call is over: the other side hung up, or the server ended it. */
  onClosed: () => void;
};

/** The microphone, for a call: echo cancellation on, so a phone on speaker works. */
export function openMicrophone(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false,
  });
}

export class LivePeer {
  private readonly pc: RTCPeerConnection;
  private after = 0;
  private timer = 0;
  private closed = false;
  private remoteSet = false;
  private pendingIce: RTCIceCandidateInit[] = [];

  constructor(
    private readonly callId: string,
    private readonly side: LiveSide,
    local: MediaStream,
    private readonly handlers: PeerHandlers,
  ) {
    this.pc = new RTCPeerConnection(ICE);
    for (const track of local.getAudioTracks()) this.pc.addTrack(track, local);
    this.pc.ontrack = (event) => handlers.onRemoteStream(event.streams[0] ?? new MediaStream([event.track]));
    this.pc.onicecandidate = (event) => {
      if (event.candidate) void this.send('ice', event.candidate.toJSON() as Record<string, unknown>);
    };
    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState;
      if (state === 'connected') handlers.onLink('connected');
      else if (state === 'failed') handlers.onLink('failed');
    };
  }

  async start(): Promise<void> {
    this.handlers.onLink('connecting');
    if (this.side === 'caller') {
      const offer = await this.pc.createOffer({ offerToReceiveAudio: true });
      await this.pc.setLocalDescription(offer);
      await this.send('offer', { type: offer.type, sdp: offer.sdp ?? '' });
    }
    void this.poll();
  }

  /** Tell the other side we hung up, then stop. */
  hangUp(): void {
    void this.send('bye');
    this.close();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    window.clearTimeout(this.timer);
    try {
      this.pc.close();
    } catch {
      // already closed
    }
  }

  private async send(kind: LiveSignalKind, data: Record<string, unknown> = {}): Promise<void> {
    try {
      await api.sendSignal(this.callId, this.side, kind, data);
    } catch {
      // the call is over, or the network blinked: the poll notices either way
    }
  }

  private poll = async (): Promise<void> => {
    if (this.closed) return;
    try {
      const answer = await api.signals(this.callId, this.side, this.after);
      for (const message of answer.messages) {
        this.after = Math.max(this.after, message.n);
        await this.handle(message.kind, message.data);
        if (this.closed) return;
      }
      this.handlers.onCallStatus(answer.status);
      if (!OPEN.has(answer.status)) {
        this.close();
        this.handlers.onClosed();
        return;
      }
    } catch {
      // a blink in the network: try again
    }
    if (!this.closed) this.timer = window.setTimeout(() => void this.poll(), POLL_MS);
  };

  private async handle(kind: string, data: Record<string, unknown>): Promise<void> {
    try {
      if (kind === 'offer' && this.side === 'callee') {
        await this.pc.setRemoteDescription(data as unknown as RTCSessionDescriptionInit);
        await this.remoteReady();
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        await this.send('answer', { type: answer.type, sdp: answer.sdp ?? '' });
      } else if (kind === 'answer' && this.side === 'caller') {
        await this.pc.setRemoteDescription(data as unknown as RTCSessionDescriptionInit);
        await this.remoteReady();
      } else if (kind === 'ice') {
        const candidate = data as RTCIceCandidateInit;
        if (this.remoteSet) await this.pc.addIceCandidate(candidate).catch(() => undefined);
        else this.pendingIce.push(candidate);
      } else if (kind === 'bye') {
        this.close();
        this.handlers.onClosed();
      }
    } catch (error) {
      console.warn('live call signal failed', kind, error);
      this.handlers.onLink('failed');
    }
  }

  private async remoteReady(): Promise<void> {
    this.remoteSet = true;
    const waiting = this.pendingIce;
    this.pendingIce = [];
    for (const candidate of waiting) await this.pc.addIceCandidate(candidate).catch(() => undefined);
  }
}
