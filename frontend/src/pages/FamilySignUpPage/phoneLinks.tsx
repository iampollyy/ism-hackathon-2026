// Phone links for QR codes and copying. publicUrl() gives VITE_PUBLIC_URL or
// this site's address. When that is localhost (the laptop in development, with
// no VITE_PUBLIC_URL), phones cannot open it, so the organiser can paste the
// HTTPS address phones reach (the tunnel) and the links use that instead.

import { useEffect, useRef, useState } from 'react';
import { Check, Copy, MessageCircle, QrCode, Share2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { publicUrl } from '../../api/client';

const BASE_KEY = 'callback.phoneAddress';

export function isLocalAddress(url: string): boolean {
  return /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i.test(url);
}

/** True when the links publicUrl() makes would not open on a phone. */
export function linksAreLocal(): boolean {
  return isLocalAddress(publicUrl('/'));
}

/**
 * The pasted address reduced to its origin (https://host[:port]), or '' when
 * it is not an https:// address. Phones block the microphone on http://, and a
 * pasted phone link (…/phone/mem_a) must not end up inside every link.
 */
function cleanBase(value: string): string {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && url.hostname ? url.origin : '';
  } catch {
    return '';
  }
}

/** The full address of a phone link: the pasted address when publicUrl() is local. */
export function phoneUrl(path: string, pastedBase: string): string {
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

/** Shown only when the links would point at localhost. */
type NoteProps = { base: string; onChange: (value: string) => void; compact?: boolean };

export function PhoneAddressNote({ base, onChange, compact = false }: NoteProps) {
  if (!linksAreLocal()) return null;
  const valid = cleanBase(base) !== '';
  return (
    <div className="phone-address-note">
      <strong>Phones can't open this laptop's address.</strong>
      {compact ? (
        <p>Paste the HTTPS address phones can reach (the tunnel), and these links will use it.</p>
      ) : (
        <p>
          These links start with localhost, which only works on this laptop. Paste the HTTPS address that phones can
          reach (for example the tunnel), and the links and QR codes will use it.
        </p>
      )}
      <label className="input-stack">
        <span>Address for phones</span>
        <input
          type="url"
          inputMode="url"
          placeholder="https://your-tunnel.trycloudflare.com"
          value={base}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={base !== '' && !valid}
        />
      </label>
      {base !== '' && !valid ? <small className="field-error">Start the address with https://</small> : null}
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

type CopyProps = {
  text: string;
  label?: string;
  /** Whose link this is, so a screen reader can tell the buttons apart. */
  owner?: string;
};

export function CopyButton({ text, label = 'Copy', owner }: CopyProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    const ok = await copyText(text);
    setState(ok ? 'copied' : 'failed');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), 2000);
  };

  const shown = state === 'copied' ? 'Copied' : state === 'failed' ? 'Select and copy' : label;
  const spoken = owner
    ? state === 'copied'
      ? `Copied ${owner}'s link`
      : state === 'failed'
        ? `Could not copy ${owner}'s link. Select it and copy`
        : `Copy ${owner}'s link`
    : undefined;

  return (
    <button type="button" className="button button-secondary copy-button" onClick={copy} aria-label={spoken}>
      {state === 'copied' ? <Check size={15} /> : <Copy size={15} />}
      <span>{shown}</span>
    </button>
  );
}

/**
 * A phone link's QR code. While the link still points at this laptop
 * (localhost), a phone could not open it, so a note stands in for the code
 * until an address phones can reach is pasted.
 */
export function PhoneQrCode({ url, owner, size }: { url: string; owner: string; size: number }) {
  if (isLocalAddress(url)) {
    return (
      <div className="qr-placeholder" style={{ width: size, height: size }} role="note">
        <QrCode size={28} aria-hidden="true" />
        <span>Paste the address for phones above to get {owner}'s code.</span>
      </div>
    );
  }
  return <QRCodeSVG value={url} size={size} level="M" marginSize={1} title={`${owner}'s phone link`} />;
}

/** A link without its https:// prefix, for showing (copying uses the full link). */
export function shownUrl(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

/**
 * The words sent with an invite, in the organiser's own voice: a bare link
 * from nowhere is exactly what a scam-wary parent has learned to ignore.
 * `from` is the organiser's first name; `own` is a link to their own phone.
 */
export function inviteMessage(name: string, from: string | null | undefined, own = false): string {
  if (own) return 'My own Callback link. Open this on my phone:';
  const hello = from ? `${name}, it's ${from}.` : `${name},`;
  return `${hello} I've set up Callback so our family can practise spotting scam calls. Open this on your phone:`;
}

type ShareProps = {
  url: string;
  /** Who the link is for. */
  name: string;
  familyName: string;
  /** The organiser's first name, who sends it. */
  from?: string | null;
  /** The organiser's own link. */
  own?: boolean;
};

/**
 * Share a link with the phone's or laptop's own share sheet (WhatsApp, SMS,
 * email...). Where the browser has none, it opens WhatsApp with the message.
 */
export function ShareButton({ url, name, familyName, from, own = false }: ShareProps) {
  const text = inviteMessage(name, from, own);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  if (!canShare) {
    return (
      <a
        className="button button-secondary copy-button"
        href={`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`}
        target="_blank"
        rel="noreferrer"
        aria-label={`Send ${name}'s link on WhatsApp`}
      >
        <MessageCircle size={15} aria-hidden="true" />
        <span>WhatsApp</span>
      </a>
    );
  }

  const share = async () => {
    try {
      await navigator.share({ title: `Join ${familyName} on Callback`, text, url });
    } catch {
      // Closed the share sheet, or the browser refused: nothing to do.
    }
  };

  return (
    <button type="button" className="button button-secondary copy-button" onClick={() => void share()} aria-label={`Share ${name}'s link`}>
      <Share2 size={15} aria-hidden="true" />
      <span>Share</span>
    </button>
  );
}
