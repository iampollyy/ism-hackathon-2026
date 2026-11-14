// /family/:familyId/plan: the family's plan (GET /api/families/{id}/plan),
// changing it (POST .../plan) and cancelling it (POST .../plan/cancel). Demo
// mode: nothing is ever charged and there are no card fields.

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CalendarClock, CircleAlert, Info, Landmark, LoaderCircle, RotateCcw } from 'lucide-react';
import { api, ApiError } from '../../api/client';
import type { FamilyPlanView, Pricing } from '../../api/types';
import { useDocumentTitle } from '../../layouts/useDocumentTitle';
import { PlanPicker } from './PlanPicker';
import { STATUS_WORDS, daysWord, longDate, trialDaysLeft } from './planWords';
import './PlanPage.scss';

type Load =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error'; message: string }
  | { status: 'ready'; plan: FamilyPlanView };

export function PlanPage() {
  useDocumentTitle('Plan and billing');
  const { familyId = '' } = useParams();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setLoad({ status: 'loading' });
    setNotice(null);
    setConfirming(false);
    api.plan(familyId).then(
      (plan) => live && setLoad({ status: 'ready', plan }),
      (error) => {
        if (!live) return;
        if (error instanceof ApiError && error.status === 404) setLoad({ status: 'missing' });
        else setLoad({ status: 'error', message: error instanceof ApiError ? error.message : 'The plan could not be loaded.' });
      },
    );
    return () => {
      live = false;
    };
  }, [familyId, attempt]);

  const chosen = (plan: FamilyPlanView) => {
    setLoad({ status: 'ready', plan });
    setConfirming(false);
    setNotice(`You’re on ${plan.plan_name} now${plan.price ? ` (${plan.price})` : ''}. No payment was taken.`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancel = async () => {
    setCancelling(true);
    setCancelError(null);
    try {
      const plan = await api.cancelPlan(familyId);
      setLoad({ status: 'ready', plan });
      setConfirming(false);
      setNotice('Your plan is cancelled. You can choose a plan again at any time.');
    } catch (error) {
      setCancelError(error instanceof ApiError ? error.message : 'The plan could not be cancelled. Please try again.');
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="plan-page">
      <header className="plan-head">
        <h1>Plan and billing</h1>
        <p>One plan covers the whole family. This is a demo, so choosing a plan never takes a payment.</p>
      </header>

      {load.status === 'loading' ? (
        <div className="plan-current skeleton" aria-busy="true" aria-label="Loading the plan" />
      ) : load.status === 'missing' ? (
        <div className="plan-alert" role="alert">
          <CircleAlert size={18} aria-hidden="true" />
          <span>We couldn’t find this family. It may have been set up on another server.</span>
          <Link to="/families" className="button button-secondary">
            Your families
          </Link>
        </div>
      ) : load.status === 'error' ? (
        <div className="plan-alert" role="alert">
          <CircleAlert size={18} aria-hidden="true" />
          <span>{load.message}</span>
          <button type="button" className="button button-secondary" onClick={() => setAttempt((count) => count + 1)}>
            <RotateCcw size={16} aria-hidden="true" /> Try again
          </button>
        </div>
      ) : (
        <>
          {notice ? (
            <p className="plan-notice" role="status">
              {notice}
            </p>
          ) : null}

          <CurrentPlan
            plan={load.plan}
            trialDays={pricing?.trial_days ?? null}
            confirming={confirming}
            cancelling={cancelling}
            cancelError={cancelError}
            onAskCancel={() => {
              setConfirming(true);
              setCancelError(null);
            }}
            onKeep={() => setConfirming(false)}
            onCancel={() => void cancel()}
          />

          <section className="plan-choose" aria-labelledby="plan-choose-title">
            <h2 id="plan-choose-title">
              {load.plan.status === 'trialing'
                ? 'Choose a plan for after the trial'
                : load.plan.status === 'canceled'
                  ? 'Choose a plan again'
                  : 'Change your plan'}
            </h2>
            <PlanPicker familyId={familyId} current={load.plan} onChosen={chosen} onPricing={setPricing} />
          </section>
        </>
      )}
    </div>
  );
}

type CurrentProps = {
  plan: FamilyPlanView;
  trialDays: number | null;
  confirming: boolean;
  cancelling: boolean;
  cancelError: string | null;
  onAskCancel: () => void;
  onKeep: () => void;
  onCancel: () => void;
};

function CurrentPlan({ plan, trialDays, confirming, cancelling, cancelError, onAskCancel, onKeep, onCancel }: CurrentProps) {
  const left = trialDaysLeft(plan);
  const trialEnded = plan.status === 'trialing' && left === 0;
  const used = left !== null && trialDays ? Math.min(trialDays, Math.max(0, trialDays - left)) : null;

  return (
    <section className={`plan-current ${plan.status}`} aria-labelledby="plan-current-title">
      <div className="plan-current-main">
        <span className={`plan-status ${plan.status}`}>{STATUS_WORDS[plan.status]}</span>
        {plan.status === 'trialing' ? (
          // The pill already says "Free trial": the heading says how long is left.
          <h2 id="plan-current-title">
            {trialEnded ? 'Your trial has ended' : left !== null ? `${daysWord(left)} left` : 'Free for now'}
          </h2>
        ) : (
          <>
            <h2 id="plan-current-title">{plan.plan_name}</h2>
            {plan.price ? <p className="plan-price">{plan.price}</p> : null}
          </>
        )}

        {plan.status === 'trialing' && left !== null && trialDays ? (
          <div className="plan-trial">
            <div
              className="plan-trial-bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={trialDays}
              aria-valuenow={used ?? 0}
              aria-label={`${used ?? 0} of ${trialDays} trial days used`}
            >
              <span style={{ width: `${((used ?? 0) / trialDays) * 100}%` }} />
            </div>
            <small>
              {trialEnded
                ? `Ended on ${longDate(plan.trial_ends_at)}. Nothing stops working in this demo.`
                : `Day ${(used ?? 0) + 1} of ${trialDays}. Nothing is charged when it ends.`}
            </small>
          </div>
        ) : null}
      </div>

      <dl className="plan-facts">
        {plan.status === 'trialing' ? (
          <div>
            <dt>
              <CalendarClock size={16} aria-hidden="true" /> Trial ends
            </dt>
            <dd>{longDate(plan.trial_ends_at) || 'Not set'}</dd>
          </div>
        ) : null}
        <div>
          <dt>
            <CalendarClock size={16} aria-hidden="true" /> {plan.status === 'trialing' ? 'Trial started' : 'Chosen on'}
          </dt>
          <dd>{longDate(plan.started_at)}</dd>
        </div>
        {plan.bank_code ? (
          <div>
            <dt>
              <Landmark size={16} aria-hidden="true" /> Bank code
            </dt>
            <dd className="plan-code">{plan.bank_code}</dd>
          </div>
        ) : null}
        <div>
          <dt>
            <Info size={16} aria-hidden="true" /> Payment
          </dt>
          <dd>None in this demo, and no card details</dd>
        </div>
      </dl>

      {plan.status === 'active' ? (
        <div className="plan-cancel">
          {confirming ? (
            <div className="plan-confirm" role="group" aria-label="Cancel the plan">
              <p>
                Cancel <strong>{plan.plan_name}</strong>? Drills and the Shield keep working in this demo, and you can
                choose a plan again at any time.
              </p>
              {cancelError ? <small className="plan-error">{cancelError}</small> : null}
              <div className="plan-confirm-buttons">
                <button type="button" className="button button-secondary" onClick={onKeep} disabled={cancelling}>
                  Keep my plan
                </button>
                <button type="button" className="button plan-cancel-button" onClick={onCancel} disabled={cancelling}>
                  {cancelling ? <LoaderCircle size={16} className="pp-spin" aria-hidden="true" /> : null}
                  Yes, cancel the plan
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="plan-text-button" onClick={onAskCancel}>
              Cancel the plan
            </button>
          )}
        </div>
      ) : null}
    </section>
  );
}
