// "First, put Callback on your Home Screen": the sheet an invite opens with on
// a phone browser. Installed from here, the app opens this member's own page
// (index.html points the manifest at /api/members/{id}/manifest.webmanifest
// on /join/{id} too), and the phone page sends someone who has not joined yet
// back to this invite, so joining and the welcome call happen in the app.
// "Continue here instead" always works: everything also runs in the browser.

import { useEffect, useRef, useState } from 'react';
import { Check, Download, EllipsisVertical, ExternalLink, Share, Smartphone, SquarePlus } from 'lucide-react';
import { isInstalled, isIos, useInstallOffer } from '../PhonePage/pwa';

/** A phone or tablet browser (desktops never see the sheet). */
function isPhone(): boolean {
  return isIos() || /Android/i.test(navigator.userAgent);
}

/** Inside Instagram, Facebook, WhatsApp and similar apps, a page cannot be
 * added to the Home Screen: it has to be opened in the real browser first. */
function isInAppBrowser(): boolean {
  return /FBAN|FBAV|FB_IAB|Instagram|WhatsApp|Line\/|Snapchat|; wv\)/i.test(navigator.userAgent);
}

/** Whether to open with the sheet: a phone browser tab, not the installed app. */
export function wantsInstallFirst(): boolean {
  try {
    return isPhone() && !isInstalled();
  } catch {
    return false;
  }
}

export function InstallFirst({ memberId, onContinue }: { memberId: string; onContinue: () => void }) {
  const install = useInstallOffer(memberId);
  const [inApp] = useState(isInAppBrowser);
  const sheet = useRef<HTMLElement>(null);

  useEffect(() => {
    sheet.current?.focus(); // the sheet, not a button: no focus ring on open
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onContinue();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onContinue]);

  const done = install.installed;
  const mode = done ? 'done' : inApp ? 'in-app' : install.offer === 'prompt' ? 'prompt' : isIos() ? 'ios' : 'menu';

  return (
    <div className="join-install" role="presentation">
      <section
        ref={sheet}
        tabIndex={-1}
        className="join-install__sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="join-install-title"
      >
        <span className="join-install__app" aria-hidden="true">
          <img src="/icon-192.png" alt="" width={48} height={48} />
        </span>
        <h2 className="join-install__title" id="join-install-title">
          {done ? 'Now open Callback from your Home Screen' : 'First, put Callback on your Home Screen'}
        </h2>
        <p className="join-install__lead">
          {done
            ? 'Look for the Callback icon and open it. Your invitation is waiting there.'
            : 'It then opens like an app, and practice calls reach you there. About 20 seconds.'}
        </p>

        {mode === 'prompt' && (
          <button type="button" className="join-button join-button--go" onClick={() => void install.install()}>
            <Download size={22} aria-hidden="true" />
            Add Callback to my Home Screen
          </button>
        )}

        {mode === 'ios' && (
          <ol className="join-install__steps">
            <li>
              <span className="join-install__icon" aria-hidden="true">
                <Share size={20} />
              </span>
              <span>
                Tap <strong>Share</strong> in Safari’s toolbar.
              </span>
            </li>
            <li>
              <span className="join-install__icon" aria-hidden="true">
                <SquarePlus size={20} />
              </span>
              <span>
                Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
              </span>
            </li>
            <li>
              <span className="join-install__icon" aria-hidden="true">
                <Smartphone size={20} />
              </span>
              <span>
                Open <strong>Callback</strong> from your Home Screen. Your invitation opens there.
              </span>
            </li>
          </ol>
        )}

        {mode === 'menu' && (
          <ol className="join-install__steps">
            <li>
              <span className="join-install__icon" aria-hidden="true">
                <EllipsisVertical size={20} />
              </span>
              <span>
                Open your browser’s <strong>menu</strong>.
              </span>
            </li>
            <li>
              <span className="join-install__icon" aria-hidden="true">
                <SquarePlus size={20} />
              </span>
              <span>
                Choose <strong>Add to Home screen</strong> or <strong>Install app</strong>.
              </span>
            </li>
            <li>
              <span className="join-install__icon" aria-hidden="true">
                <Smartphone size={20} />
              </span>
              <span>
                Open <strong>Callback</strong> from your Home Screen. Your invitation opens there.
              </span>
            </li>
          </ol>
        )}

        {mode === 'in-app' && (
          <ol className="join-install__steps">
            <li>
              <span className="join-install__icon" aria-hidden="true">
                <ExternalLink size={20} />
              </span>
              <span>
                This link opened inside another app. Tap <strong>⋯</strong> or <strong>⋮</strong> and choose{' '}
                <strong>Open in browser</strong> (Safari or Chrome).
              </span>
            </li>
            <li>
              <span className="join-install__icon" aria-hidden="true">
                <SquarePlus size={20} />
              </span>
              <span>
                There, add Callback to your <strong>Home Screen</strong> and open it from there.
              </span>
            </li>
          </ol>
        )}

        {mode === 'ios' && !inApp && (
          <p className="join-install__note">No “Add to Home Screen”? Open this link in Safari first.</p>
        )}

        {done && (
          <p className="join-install__done">
            <Check size={18} aria-hidden="true" />
            Callback is on your Home Screen.
          </p>
        )}

        <button type="button" className="join-button join-button--quiet" onClick={onContinue}>
          Continue here instead
        </button>
      </section>
    </div>
  );
}
