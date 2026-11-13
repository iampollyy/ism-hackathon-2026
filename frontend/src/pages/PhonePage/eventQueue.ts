// The events a call sends to the back end (lines, tactics, the outcome, the
// reveal, consent), queued and sent in batches.
//
// - One send at a time, at most 100 events per batch (the back end's limit).
// - A batch leaves the queue only once the back end has taken it. On a
//   network or server error it stays and goes again on the next tick.
// - A refusal that can never succeed (the call is over, a bad value) drops
//   that batch, so it cannot block the rest of the call.
// - Events left over at the end keep going in the background (linger), and
//   a page that is closing hands them to lastWords.ts (takeAll).

import { ApiError, api } from '../../api/client';
import type { PhoneEvent } from '../../api/types';

const MAX_BATCH = 100;

/** Errors worth retrying: no connection, a server error, too many requests. */
export function isTransient(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500;
}

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

export class EventQueue {
  private events: PhoneEvent[] = [];
  private sending: Promise<void> | null = null;
  private timer: number | null = null;
  private lingerTimer: number | null = null;

  constructor(readonly callId: string) {}

  push(event: PhoneEvent): void {
    this.events.push(event);
  }

  /** Send every `everyMs` while the call runs. */
  start(everyMs = 500): void {
    this.stop();
    this.timer = window.setInterval(() => void this.sendOnce(), everyMs);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    if (this.lingerTimer !== null) window.clearInterval(this.lingerTimer);
    this.lingerTimer = null;
  }

  /** Everything still queued, removed from the queue (for a page that is
   * closing). A batch on its way may arrive as well: a repeat beats a loss. */
  takeAll(): PhoneEvent[] {
    return this.events.splice(0, this.events.length);
  }

  /** After the call: keep trying every `everyMs` until the queue is empty or
   * `forMs` has passed, then call `onDone`. The back end still takes events
   * after the end of a call. */
  linger(everyMs: number, forMs: number, onDone: () => void): void {
    this.stop();
    const until = Date.now() + forMs;
    const tick = () => {
      if ((this.events.length === 0 && !this.sending) || Date.now() > until) {
        this.stop();
        if (this.events.length > 0) console.warn('Callback: gave up sending these events', this.events);
        onDone();
        return;
      }
      void this.sendOnce();
    };
    this.lingerTimer = window.setInterval(tick, everyMs);
  }

  get size(): number {
    return this.events.length;
  }

  /** Send one batch, unless a send is already on its way (then wait for it). */
  sendOnce(): Promise<void> {
    if (this.sending) return this.sending;
    if (this.events.length === 0) return Promise.resolve();
    const batch = this.events.slice(0, MAX_BATCH);
    this.sending = api
      .sendEvents(this.callId, batch)
      .then(
        () => {
          this.events.splice(0, batch.length); // new events only ever go to the end
        },
        (error: unknown) => {
          if (isTransient(error)) {
            console.warn('Callback: events not sent yet, trying again', error);
            return;
          }
          console.warn('Callback: the back end refused these events', batch, error);
          this.events.splice(0, batch.length);
        },
      )
      .finally(() => {
        this.sending = null;
      });
    return this.sending;
  }

  /** Send everything left, trying again after failures. False if some
   * events could still not be sent after `attempts` failures in a row. */
  async drain(attempts = 6): Promise<boolean> {
    let failures = 0;
    while (this.events.length > 0) {
      if (this.sending) {
        await this.sending;
        continue;
      }
      const before = this.events.length;
      await this.sendOnce();
      if (this.events.length < before) {
        failures = 0;
        continue;
      }
      failures += 1;
      if (failures >= attempts) return false;
      await sleep(400 * failures);
    }
    if (this.sending) await this.sending;
    return true;
  }
}
