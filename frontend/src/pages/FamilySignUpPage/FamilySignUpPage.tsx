// Setting up a family plan (/signup), in three steps: the family, the
// invites, the plan. It needs the organiser's account first, so the family
// belongs to them. The address keeps the step (/signup?family=fam_x&step=
// invite|plan), so a reload lands in the same place. The family page's older
// links (&step=voices) open the invites with the voice recorder open.

import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Check, LogIn, RotateCcw, UserPlus } from 'lucide-react';
import { api, ApiError } from '../../api/client';
import type { FamilyCreated, FamilyView } from '../../api/types';
import { authPath, refreshMe, useMe } from '../../layouts/useMe';
import { useDocumentTitle } from '../../layouts/useDocumentTitle';
import { FamilyStep } from './FamilyStep';
import { InviteStep } from './InviteStep';
import { PlanStep } from './PlanStep';
import { saveFamilyId } from './familyStorage';
import './familyShared.scss';
import './FamilySignUpPage.scss';

type Step = 'family' | 'invite' | 'plan';

const STEPS: { key: Step; label: string }[] = [
  { key: 'family', label: 'Your family' },
  { key: 'invite', label: 'Invite everyone' },
  { key: 'plan', label: 'Choose a plan' },
];

const HEADINGS: Record<Step, { title: string; intro: string }> = {
  family: {
    title: 'Set up your family plan',
    intro: 'Add the people you want to protect. Nobody gets a call until they have joined and agreed.',
  },
  invite: {
    title: 'Invite your family',
    intro: 'Send each person their own link. When they open it on their phone and join, their welcome call starts by itself.',
  },
  plan: {
    title: 'Choose a plan',
    intro: 'Everything is free for the first 30 days. This is a demo: no payment, and never any card details.',
  },
};

const REFRESH_MS = 4000;

type LoadError = { notFound: boolean; message: string };

export function FamilySignUpPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const meState = useMe();
  const [params, setParams] = useSearchParams();
  const familyParam = params.get('family');
  const stepParam = params.get('step');
  const step: Step = !familyParam ? 'family' : stepParam === 'plan' ? 'plan' : 'invite';
  const [voicesOpen, setVoicesOpen] = useState(stepParam === 'voices');
  useDocumentTitle(HEADINGS[step].title);

  const [family, setFamily] = useState<FamilyView | null>(null);
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [attempt, setAttempt] = useState(0);

  // The family being set up: loaded, then refreshed every few seconds while
  // the invites show, so each card turns green when that person joins. A
  // family that does not exist is an answer; anything else is retried.
  useEffect(() => {
    if (!familyParam) {
      setFamily(null);
      setLoadError(null);
      return;
    }
    let live = true;
    let timer: number | undefined;
    const load = async () => {
      try {
        const next = await api.getFamily(familyParam);
        if (!live) return;
        setFamily(next);
        setLoadError(null);
        if (step === 'invite') timer = window.setTimeout(() => void load(), REFRESH_MS);
      } catch (error) {
        if (!live) return;
        const notFound = error instanceof ApiError && error.status === 404;
        setLoadError({
          notFound,
          message: notFound
            ? 'We couldn’t find this family. It may have been set up on another server.'
            : error instanceof ApiError
              ? error.message
              : 'Callback could not be reached.',
        });
        if (!notFound) timer = window.setTimeout(() => void load(), REFRESH_MS);
      }
    };
    void load();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [familyParam, step, attempt]);

  useEffect(() => {
    if (stepParam === 'voices') setVoicesOpen(true);
  }, [stepParam]);

  const created = (result: FamilyCreated) => {
    saveFamilyId(result.family_id);
    void refreshMe(); // the menu and the list of families pick it up
    setParams({ family: result.family_id, step: 'invite' });
    window.scrollTo({ top: 0 });
  };

  const goTo = (next: Step) => {
    if (!familyParam) return;
    setParams({ family: familyParam, step: next });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const stepIndex = STEPS.findIndex((item) => item.key === step);
  const ready = family !== null && family.id === familyParam;
  const heading = HEADINGS[step];
  const here = location.pathname + location.search;

  return (
    <div className="signup-flow onb">
      <header className="onb-head">
        <div className="onb-head-text">
          <h1>{heading.title}</h1>
          <p>
            {ready && step !== 'family' ? <strong>{family.name}. </strong> : null}
            {heading.intro}
          </p>
        </div>
        <ol className="onb-steps" aria-label="Steps">
          {STEPS.map((item, index) => {
            const state = index < stepIndex ? 'done' : index === stepIndex ? 'current' : 'todo';
            const canGo = familyParam !== null && item.key !== 'family' && state !== 'current';
            const content = (
              <>
                <span className="onb-step-number">{state === 'done' ? <Check size={14} aria-hidden="true" /> : index + 1}</span>
                <span>{item.label}</span>
              </>
            );
            return (
              <li key={item.key} className={state} aria-current={state === 'current' ? 'step' : undefined}>
                {canGo ? (
                  <button type="button" onClick={() => goTo(item.key)}>
                    {content}
                  </button>
                ) : (
                  <span className="onb-step-static">{content}</span>
                )}
              </li>
            );
          })}
        </ol>
      </header>

      {meState.status === 'loading' ? (
        <div className="onb-card onb-skeleton" aria-busy="true" aria-label="Loading" />
      ) : meState.status === 'out' ? (
        <div className="onb-card onb-gate">
          <h2>First, your organiser account</h2>
          <p>
            The family plan belongs to your account, so you can come back to it, see who has joined, and change things
            later. It takes a minute.
          </p>
          <div className="onb-gate-actions">
            <Link to={authPath('register', here)} className="button button-primary">
              <UserPlus size={18} aria-hidden="true" /> Create an account
            </Link>
            <Link to={authPath('login', here)} className="button button-secondary">
              <LogIn size={18} aria-hidden="true" /> I already have one
            </Link>
          </div>
        </div>
      ) : step === 'family' ? (
        <>
          {meState.status === 'in' && meState.me.families.length > 0 ? (
            <p className="onb-existing">
              You already have {meState.me.families.length === 1 ? 'a family plan' : 'family plans'}:{' '}
              {meState.me.families.map((item, index) => (
                <span key={item.id}>
                  {index > 0 ? ', ' : ''}
                  <Link to={`/family/${item.id}`}>{item.name}</Link>
                </span>
              ))}
              . Only set up another for a different family.
            </p>
          ) : null}
          <FamilyStep
            organiserName={meState.status === 'in' ? meState.me.account.name : ''}
            onCreated={created}
          />
        </>
      ) : !ready && loadError?.notFound ? (
        <div className="onb-card">
          <div className="form-alert" role="alert">
            {loadError.message}
          </div>
          <div className="onb-footer">
            <Link to="/signup" className="button button-primary">
              Start a new family plan
            </Link>
          </div>
        </div>
      ) : !ready && loadError ? (
        <div className="onb-card">
          <div className="form-alert" role="alert">
            {loadError.message} Trying again every few seconds.
          </div>
          <div className="onb-footer">
            <span>No need to set the family up again.</span>
            <button type="button" className="button button-primary" onClick={() => setAttempt((count) => count + 1)}>
              <RotateCcw size={16} aria-hidden="true" /> Try again now
            </button>
          </div>
        </div>
      ) : !ready ? (
        <div className="onb-card onb-skeleton" aria-busy="true" aria-label="Loading the family" />
      ) : step === 'invite' ? (
        <InviteStep
          family={family}
          voicesOpen={voicesOpen}
          onVoicesOpen={setVoicesOpen}
          onVoiceReady={() => setAttempt((count) => count + 1)}
          onNext={() => goTo('plan')}
        />
      ) : (
        <PlanStep familyId={family.id} onBack={() => goTo('invite')} onDone={() => navigate(`/family/${family.id}`)} />
      )}
    </div>
  );
}
