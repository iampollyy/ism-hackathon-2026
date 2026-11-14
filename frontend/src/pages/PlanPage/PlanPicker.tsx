// The plans a family can choose (GET /api/pricing), as cards. Choosing one
// is POST /api/families/{id}/plan: demo mode, so it only records the choice.
// There are no card fields anywhere; the bank plan asks for the partner code.
// Used by the plan page and the last step of sign-up.

import { useEffect, useState, type FormEvent } from 'react';
import { Check, CircleAlert, Info, Landmark, LoaderCircle } from 'lucide-react';
import { api, ApiError } from '../../api/client';
import type { FamilyPlanView, PlanChoice, Pricing } from '../../api/types';
import './PlanPicker.scss';

type PlanKey = PlanChoice['plan'];

const CHOOSABLE: readonly string[] = ['family_monthly', 'family_yearly', 'bank'];

function isPlanKey(key: string): key is PlanKey {
  return CHOOSABLE.includes(key);
}

/** "€4.99 a month" → ["€4.99", "a month"]; "Free" → ["Free", ""]. */
function splitPrice(price: string): [string, string] {
  const space = price.indexOf(' ');
  return space === -1 ? [price, ''] : [price.slice(0, space), price.slice(space + 1)];
}

type Props = {
  familyId: string;
  current: FamilyPlanView | null;
  onChosen: (plan: FamilyPlanView) => void;
  /** The pricing answer, when the page has it already (for its demo note and trial length). */
  onPricing?: (pricing: Pricing) => void;
  /** The plan whose button is filled; null when the page has its own main action. */
  highlight?: PlanKey | null;
};

export function PlanPicker({ familyId, current, onChosen, onPricing, highlight = 'family_yearly' }: Props) {
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<PlanKey | null>(null);
  const [errors, setErrors] = useState<Partial<Record<PlanKey, string>>>({});
  const [bankOpen, setBankOpen] = useState(false);
  const [bankCode, setBankCode] = useState('');

  useEffect(() => {
    let live = true;
    setLoadError(null);
    api.pricing().then(
      (answer) => {
        if (!live) return;
        setPricing(answer);
        onPricing?.(answer);
      },
      (error) => live && setLoadError(error instanceof ApiError ? error.message : 'The plans could not be loaded.'),
    );
    return () => {
      live = false;
    };
    // onPricing comes from the parent; loading once per attempt is enough.
  }, [attempt]);

  const choose = async (key: PlanKey, code?: string) => {
    setBusy(key);
    setErrors((current) => ({ ...current, [key]: undefined }));
    try {
      const chosen = await api.choosePlan(familyId, key === 'bank' ? { plan: key, bank_code: code } : { plan: key });
      setBankOpen(false);
      onChosen(chosen);
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.code === 'invalid_bank_code'
            ? 'That code doesn’t look right. It is 4 to 40 letters, digits or dashes, as printed by your bank.'
            : error.message
          : 'Something went wrong. Please try again.';
      setErrors((current) => ({ ...current, [key]: message }));
    } finally {
      setBusy(null);
    }
  };

  const submitBank = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = bankCode.trim();
    if (!/^[A-Za-z0-9-]{4,40}$/.test(code)) {
      setErrors((current) => ({
        ...current,
        bank: 'Enter the code from your bank: 4 to 40 letters, digits or dashes.',
      }));
      return;
    }
    void choose('bank', code);
  };

  if (loadError) {
    return (
      <div className="pp-alert" role="alert">
        <CircleAlert size={18} aria-hidden="true" />
        <span>{loadError}</span>
        <button type="button" className="button button-secondary" onClick={() => setAttempt((count) => count + 1)}>
          Try again
        </button>
      </div>
    );
  }

  if (!pricing) {
    return (
      <div className="pp-grid" aria-busy="true" aria-label="Loading the plans">
        {[0, 1, 2].map((index) => (
          <div key={index} className="pp-card skeleton" aria-hidden="true" />
        ))}
      </div>
    );
  }

  const plans = pricing.plans.filter((plan) => plan.choosable && isPlanKey(plan.key));

  return (
    <div className="pp">
      <div className="pp-grid">
        {plans.map((plan) => {
          const key = plan.key as PlanKey;
          const isCurrent = current?.plan === key && current.status === 'active';
          const [amount, period] = splitPrice(plan.price);
          const error = errors[key];
          const working = busy === key;
          return (
            <article key={key} className={`pp-card${isCurrent ? ' current' : ''}${key === 'family_yearly' ? ' featured' : ''}`}>
              <header className="pp-card-head">
                <h3>{plan.name}</h3>
                {isCurrent ? (
                  <span className="pp-tag current">
                    <Check size={13} aria-hidden="true" /> Your plan
                  </span>
                ) : key === 'family_yearly' ? (
                  <span className="pp-tag">Best value</span>
                ) : null}
              </header>

              <div className="pp-price">
                <strong>{amount}</strong>
                {period ? <span>{period}</span> : null}
              </div>
              <p className="pp-note">{plan.note}</p>

              <ul className="pp-features">
                {plan.features.map((feature) => (
                  <li key={feature}>
                    <Check size={16} aria-hidden="true" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              <div className="pp-action">
                {key === 'bank' && bankOpen && !isCurrent ? (
                  <form className="pp-bank" onSubmit={submitBank} noValidate>
                    <label htmlFor={`bank-code-${familyId}`}>Code from your bank</label>
                    <input
                      id={`bank-code-${familyId}`}
                      type="text"
                      value={bankCode}
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      maxLength={40}
                      autoFocus
                      onChange={(event) => {
                        setBankCode(event.target.value);
                        setErrors((current) => ({ ...current, bank: undefined }));
                      }}
                      aria-invalid={Boolean(error)}
                      aria-describedby={error ? `bank-code-error-${familyId}` : undefined}
                    />
                    {error ? (
                      <small className="pp-error" id={`bank-code-error-${familyId}`}>
                        {error}
                      </small>
                    ) : null}
                    <div className="pp-bank-buttons">
                      <button type="submit" className="button button-primary" disabled={busy !== null}>
                        {working ? <LoaderCircle size={16} className="pp-spin" aria-hidden="true" /> : null}
                        Use this code
                      </button>
                      <button type="button" className="button button-ghost" onClick={() => setBankOpen(false)}>
                        Back
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <button
                      type="button"
                      className={`button ${key === highlight && !isCurrent ? 'button-primary' : 'button-secondary'}`}
                      disabled={isCurrent || busy !== null}
                      onClick={() => (key === 'bank' ? setBankOpen(true) : void choose(key))}
                    >
                      {working ? <LoaderCircle size={16} className="pp-spin" aria-hidden="true" /> : null}
                      {key === 'bank' ? <Landmark size={16} aria-hidden="true" /> : null}
                      {isCurrent ? 'Your current plan' : plan.cta}
                    </button>
                    {error && key !== 'bank' ? <small className="pp-error">{error}</small> : null}
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <p className="pp-demo">
        <Info size={16} aria-hidden="true" />
        <span>{pricing.demo_note}</span>
      </p>
    </div>
  );
}
