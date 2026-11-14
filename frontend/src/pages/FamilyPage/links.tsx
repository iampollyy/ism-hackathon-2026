// Invite and phone links on the family page: the full address, Copy, Share
// and a QR code. publicUrl() gives VITE_PUBLIC_URL or this site's address.
// When that is localhost (a laptop in development), phones cannot open it,
// so the organiser can paste the HTTPS address phones reach (a tunnel); the
// address is kept on this browser under the same key the sign-up page uses.

import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Mail, MessageCircle, QrCode, Share2, Smartphone } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { publicUrl } from '../../api/client';
import { inviteMessage } from '../FamilySignUpPage/phoneLinks';

const BASE_KEY = 'callback.phoneAddress';

export function isLocalAddress(url: string): boolean {
  return /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i.test(url);
}

/** True when links made here would not open on a phone. */
export function linksAreLocal(): boolean {
  return isLocalAddress(publicUrl('/'));
}

/** The pasted address reduced to https://host[:port], or '' when it is not an https:// address. */
function cleanBase(value: string): string {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && url.hostname ? url.origin : '';
  } catch {
    return '';
  }
}

/** The full address of a link: the pasted address when publicUrl() is local. */
export function fullUrl(path: string, pastedBase: string): string {
  const url = publicUrl(path);
  const base = cleanBase(pastedBase);
  return base && isLocalAddress(url) ? `${base}${path}` : url;
}

function readBase(): string {
  try {
    return window.localStorage.getItem(BASE_KEY) ?? '';
  } catch {
    return '';
  }
}

/** The pasted phone address, remembered on this browser. */
export function usePhoneAddress(): [string, (value: string) => void] {
  const [base, setBase] = useState(readBase);
  const update = (value: string) => {
    setBase(value);
    try {
      window.localStorage.setItem(BASE_KEY, value);
    } catch {
      // only a convenience
    }
  };
  return [base, update];
}

/**
 * Shown only while links would point at localhost: the full note until a
 * working address is set, then one quiet line that opens the field again.
 */
export function PhoneAddressNote({ base, onChange }: { base: string; onChange: (value: string) => void }) {
  const clean = cleanBase(base);
  const valid = clean !== '';
  const [editing, setEditing] = useState(!valid);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Only when the field opens again, not on every keystroke.
    if (editing && valid) input.current?.focus();
  }, [editing]);

  if (!linksAreLocal()) return null;

  if (valid && !editing) {
    return (
      <p className="fh-address-set">
        <Smartphone size={16} aria-hidden="true" />
        <span>
          Phone links use <strong>{clean}</strong>
        </span>
        <button type="button" className="fh-text-button" onClick={() => setEditing(true)}>
          Change
        </button>
      </p>
    );
  }

  return (
    <div className={`fh-address-note${valid ? ' is-set' : ''}`}>
      <Smartphone size={18} aria-hidden="true" />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) setEditing(false);
        }}
      >
        {valid ? (
          <strong>The address phones open</strong>
        ) : (
          <>
            <strong>Phones can't open this laptop's address.</strong>
            <p>Paste the HTTPS address phones can reach (the tunnel), and every invite link and QR code will use it.</p>
          </>
        )}
        <div className="fh-address-row">
          <label className="fh-field">
            <span>Address for phones</span>
            <input
              ref={input}
              type="url"
              inputMode="url"
              placeholder="https://your-tunnel.trycloudflare.com"
              value={base}
              onChange={(event) => onChange(event.target.value)}
              aria-invalid={base !== '' && !valid}
            />
          </label>
          {valid ? (
            <button type="submit" className="fh-chip-button strong">
              Done
            </button>
          ) : null}
        </div>
        {base !== '' && !valid ? <small className="fh-field-error">Start the address with https://</small> : null}
      </form>
    </div>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers, or no permission: copy through a hidden text box.
    const box = document.createElement('textarea');
    box.value = text;
    box.setAttribute('readonly', '');
    box.style.position = 'fixed';
    box.style.opacity = '0';
    document.body.appendChild(box);
    box.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    box.remove();
    return ok;
  }
}

export function CopyButton({ text, owner, what = 'link' }: { text: string; owner: string; what?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    const ok = await copyText(text);
    setState(ok ? 'copied' : 'failed');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), 2000);
  };

  const spoken =
    state === 'copied'
      ? `Copied ${owner}'s ${what}`
      : state === 'failed'
        ? `Could not copy ${owner}'s ${what}. Select it and copy`
        : `Copy ${owner}'s ${what}`;
  return (
    <button type="button" className="fh-chip-button" onClick={copy} aria-label={spoken}>
      {state === 'copied' ? <Check size={15} /> : <Copy size={15} />}
      <span aria-live="polite">{state === 'copied' ? 'Copied' : state === 'failed' ? 'Select and copy' : 'Copy'}</span>
    </button>
  );
}

/** Share through the phone's or computer's share sheet; without one, offer WhatsApp, a text and an email. */
export function ShareButton({
  url, name, familyName, from, own = false,
}: { url: string; name: string; familyName: string; from?: string | null; own?: boolean }) {
  const [open, setOpen] = useState(false);
  // In the organiser's own voice: a link from nowhere is what people learn to distrust.
  const text = inviteMessage(name, from, own);

  const share = async () => {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: `Join ${familyName} on Callback`, text, url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        // No share sheet after all: fall through to the links.
      }
    }
    setOpen((current) => !current);
  };

  const body = `${text} ${url}`;
  return (
    <div className="fh-share">
      <button
        type="button"
        className="fh-chip-button"
        onClick={share}
        aria-expanded={open}
        aria-label={`Share ${name}'s invite`}
      >
        <Share2 size={15} /> <span>Share</span>
      </button>
      {open ? (
        <div className="fh-share-menu">
          <a href={`https://wa.me/?text=${encodeURIComponent(body)}`} target="_blank" rel="noreferrer">
            <MessageCircle size={15} /> WhatsApp
          </a>
          <a href={`sms:?&body=${encodeURIComponent(body)}`}>
            <Smartphone size={15} /> Text message
          </a>
          <a
            href={`mailto:?subject=${encodeURIComponent(`Join ${familyName} on Callback`)}&body=${encodeURIComponent(`${text}\n\n${url}`)}`}
          >
            <Mail size={15} /> Email
          </a>
        </div>
      ) : null}
    </div>
  );
}

/** A link's QR code; while the link still points at this laptop, a note stands in for it. */
export function LinkQrCode({ url, owner, size }: { url: string; owner: string; size: number }) {
  if (isLocalAddress(url)) {
    return (
      <div className="fh-qr-placeholder" style={{ width: size, height: size }} role="note">
        <QrCode size={26} aria-hidden="true" />
        <span>Paste the address for phones above to get {owner}'s code.</span>
      </div>
    );
  }
  return <QRCodeSVG value={url} size={size} level="M" marginSize={1} title={`${owner}'s link`} />;
}
