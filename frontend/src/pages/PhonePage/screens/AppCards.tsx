// Two small cards on the home tab: install Callback on the Home Screen, and
// get call alerts (Web Push) so a practice call can ring with the page closed.
// Both are optional: calls ring on this open page with or without them.

import {
  BellOff, BellRing, Check, CircleAlert, Download, LoaderCircle, Share, Smartphone, SquarePlus, X,
} from 'lucide-react';
import { Card } from '../../../components/atoms/Card';
import { isIos, useInstallOffer, usePushAlerts } from '../pwa';

export function AppCards({ memberId }: { memberId: string }) {
  const install = useInstallOffer(memberId);
  const alerts = usePushAlerts(memberId);
  const { offer } = install;

  return (
    <>
      {offer !== 'none' && !install.dismissed && (
        <InstallCard offer={offer} onInstall={install.install} onDismiss={install.dismiss} />
      )}
      <CallAlertsCard
        {...alerts}
        // On iPhone the steps are in the install card; bring it back if it was put away.
        onShowInstall={install.offer === 'ios' && install.dismissed ? install.showAgain : null}
      />
    </>
  );
}

// ---------------------------------------------------------------- installing

function InstallCard({
  offer,
  onInstall,
  onDismiss,
}: {
  offer: 'prompt' | 'ios';
  onInstall: () => void;
  onDismiss: () => void;
}) {
  return (
    <Card className="phone-card phone-app-card phone-install">
      <div className="phone-app-card__head">
        <span className="phone-app-card__icon" aria-hidden="true">
          <Smartphone size={22} />
        </span>
        <h2 className="phone-card__title">{offer === 'ios' ? 'Add Callback to your Home Screen' : 'Put Callback on your Home Screen'}</h2>
        <button type="button" className="phone-app-card__close" onClick={onDismiss} aria-label="Not now">
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <p className="phone-card__text">
        {offer === 'ios'
          ? 'It then opens straight to this page, like an app, and on iPhone that is what lets call alerts work.'
          : 'It then opens straight to this page, like an app.'}
      </p>
      {offer === 'ios' ? (
        <ol className="phone-install__steps">
          <li>
            <span className="phone-install__step-icon" aria-hidden="true">
              <Share size={20} />
            </span>
            <span>
              Tap <strong>Share</strong> in Safari’s toolbar.
            </span>
          </li>
          <li>
            <span className="phone-install__step-icon" aria-hidden="true">
              <SquarePlus size={20} />
            </span>
            <span>
              Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
            </span>
          </li>
        </ol>
      ) : (
        <button type="button" className="phone-big-button phone-install__button" onClick={onInstall}>
          <Download size={22} aria-hidden="true" />
          Install Callback
        </button>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- call alerts

function CallAlertsCard({
  status,
  message,
  switchOn,
  switchOff,
  onShowInstall,
}: ReturnType<typeof usePushAlerts> & { onShowInstall: (() => void) | null }) {
  if (status === 'checking') return null;

  if (status === 'on') {
    return (
      <Card className="phone-card phone-app-card phone-alerts phone-alerts--on">
        <p className="phone-alerts__on" role="status">
          <Check size={20} aria-hidden="true" />
          Call alerts are on
        </p>
        <p className="phone-card__text">
          This phone shows a notification when a practice call rings, even when this page is closed. Tap it to answer.
        </p>
        <button type="button" className="phone-link-button phone-alerts__off" onClick={switchOff}>
          Turn off call alerts
        </button>
      </Card>
    );
  }

  const working = status === 'working';
  return (
    <Card className="phone-card phone-app-card phone-alerts">
      <div className="phone-app-card__head">
        <span className="phone-app-card__icon" aria-hidden="true">
          <BellRing size={22} />
        </span>
        <h2 className="phone-card__title">Get call alerts</h2>
      </div>
      <p className="phone-card__text">So a practice call can ring even when this page is closed.</p>

      {status === 'needs_install' ? (
        <p className="phone-alerts__state">
          <Smartphone size={18} aria-hidden="true" />
          <span>
            <strong>Add Callback to your Home Screen first.</strong> On iPhone, alerts only work when Callback is
            opened from there (iOS 16.4 or later).
            {onShowInstall && (
              <>
                {' '}
                <button type="button" className="phone-link-button" onClick={onShowInstall}>
                  Show me how
                </button>
              </>
            )}
          </span>
        </p>
      ) : status === 'blocked' ? (
        <p className="phone-alerts__state">
          <BellOff size={18} aria-hidden="true" />
          <span>
            <strong>Notifications are blocked for Callback.</strong> To get call alerts, allow notifications for this
            site in your browser or phone settings, then reload this page.
          </span>
        </p>
      ) : status === 'unsupported' ? (
        <p className="phone-alerts__state">
          <BellOff size={18} aria-hidden="true" />
          <span>
            <strong>{isIos() ? 'Call alerts need iOS 16.4 or later.' : 'Not supported in this browser.'}</strong> Keep
            this page open with the screen on, and calls still ring here.
          </span>
        </p>
      ) : status === 'server_off' ? (
        <p className="phone-alerts__state">
          <BellOff size={18} aria-hidden="true" />
          <span>
            <strong>Call alerts are off on Callback’s side for now.</strong> Keep this page open with the screen on, and
            calls still ring here.
          </span>
        </p>
      ) : (
        <>
          <button type="button" className="phone-big-button phone-alerts__button" onClick={switchOn} disabled={working}>
            {working ? <LoaderCircle className="phone-spin" size={22} aria-hidden="true" /> : <BellRing size={22} aria-hidden="true" />}
            {working ? 'Switching on…' : status === 'error' ? 'Try again' : 'Get call alerts'}
          </button>
          {status === 'error' && message ? (
            <p className="phone-inline-error" role="alert">
              <CircleAlert size={16} aria-hidden="true" />
              {message} Calls still ring while this page is open.
            </p>
          ) : (
            <p className="phone-sound-note" role="status">
              {message ?? 'Your phone will ask once whether Callback may show notifications.'}
            </p>
          )}
        </>
      )}
    </Card>
  );
}
