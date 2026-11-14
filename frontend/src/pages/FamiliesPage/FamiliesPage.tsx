// /families: the logged-in account's family plans (GET /api/families), each
// with how many people have joined and its plan, and a way to make another.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CircleAlert, KeyRound, LogIn, Plus, RotateCcw, UsersRound } from 'lucide-react';
import { api, ApiError } from '../../api/client';
import type { FamilyList, FamilyPlanView } from '../../api/types';
import { familyInitial } from '../../components/organisms/Sidebar';
import { authPath, firstName, refreshMe, useMe } from '../../layouts/useMe';
import { useDocumentTitle } from '../../layouts/useDocumentTitle';
import { planLine } from '../PlanPage/planWords';
import './FamiliesPage.scss';

type FamilySummary = FamilyList['families'][number];

type Load =
  | { status: 'loading' }
  | { status: 'out' }
  | { status: 'error'; message: string }
  | { status: 'ready'; families: FamilySummary[] };

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function shortDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : dateFormat.format(date);
}

export function FamiliesPage() {
  useDocumentTitle('Your families');
  const meState = useMe();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [plans, setPlans] = useState<Record<string, FamilyPlanView>>({});
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setLoad((current) => (current.status === 'ready' ? current : { status: 'loading' }));
    api.myFamilies().then(
      ({ families }) => {
        if (!live) return;
        setLoad({ status: 'ready', families });
        // Each family's plan, side by side; a plan that does not load is simply not shown.
        families.forEach((family) =>
          api.plan(family.id).then(
            (plan) => live && setPlans((current) => ({ ...current, [family.id]: plan })),
            () => undefined,
          ),
        );
      },
      (error) => {
        if (!live) return;
        if (error instanceof ApiError && error.status === 401) {
          setLoad({ status: 'out' });
          void refreshMe();
        } else {
          setLoad({ status: 'error', message: error instanceof ApiError ? error.message : 'Callback could not be reached.' });
        }
      },
    );
    return () => {
      live = false;
    };
  }, [attempt, meState.status]);

  const greeting = meState.status === 'in' ? `${firstName(meState.me.account.name)}’s families` : 'Your families';

  if (load.status === 'out') {
    return (
      <div className="fam-page">
        <div className="fam-gate">
          <span className="fam-gate-icon" aria-hidden="true">
            <UsersRound size={22} />
          </span>
          <h1>Log in to see your families</h1>
          <p>Your family plans belong to your organiser account. Log in on this browser to open them.</p>
          <div className="fam-gate-actions">
            <Link to={authPath('login', '/families')} className="button button-primary">
              <LogIn size={17} aria-hidden="true" /> Log in
            </Link>
            <Link to={authPath('register', '/signup')} className="button button-secondary">
              Create an account
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fam-page">
      <header className="fam-head">
        <div>
          <h1>{load.status === 'ready' && load.families.length > 0 ? greeting : 'Your families'}</h1>
          <p>Each family plan has its own people, drills and progress.</p>
        </div>
        {load.status === 'ready' && load.families.length > 0 ? (
          <Link to="/signup" className="button button-primary fam-new">
            <Plus size={18} aria-hidden="true" /> Create a family plan
          </Link>
        ) : null}
      </header>

      {load.status === 'loading' ? (
        <ul className="fam-list" aria-busy="true" aria-label="Loading your families">
          {[0, 1].map((index) => (
            <li key={index} className="fam-row skeleton" aria-hidden="true">
              <span className="fam-mark" />
              <span className="fam-main">
                <i />
                <i />
              </span>
            </li>
          ))}
        </ul>
      ) : load.status === 'error' ? (
        <div className="fam-alert" role="alert">
          <CircleAlert size={18} aria-hidden="true" />
          <span>{load.message}</span>
          <button type="button" className="button button-secondary" onClick={() => setAttempt((count) => count + 1)}>
            <RotateCcw size={16} aria-hidden="true" /> Try again
          </button>
        </div>
      ) : load.families.length === 0 ? (
        <div className="fam-empty">
          <h2>No family plan yet</h2>
          <p>
            Add the people you want to protect, then send each of them their own link. When they open it on their phone,
            a short welcome call explains everything and asks for their consent.
          </p>
          <ol className="fam-empty-steps">
            <li>Name your family and add everyone</li>
            <li>Send each person their invite link</li>
            <li>Turn on protection when they have joined</li>
          </ol>
          <Link to="/signup" className="button button-primary">
            <Plus size={18} aria-hidden="true" /> Create a family plan
          </Link>
        </div>
      ) : (
        <ul className="fam-list">
          {load.families.map((family) => {
            const all = family.member_count;
            const joined = Math.min(family.joined_count, all);
            const everyone = all > 0 && joined === all;
            const plan = plans[family.id];
            return (
              <li key={family.id}>
                <Link to={`/family/${family.id}`} className="fam-row">
                  <span className="fam-mark" aria-hidden="true">{familyInitial(family.name)}</span>
                  <span className="fam-main">
                    <strong className="fam-name">{family.name}</strong>
                    <span className="fam-meta">
                      {all === 1 ? '1 person' : `${all} people`}
                      {shortDate(family.created_at) ? ` · set up ${shortDate(family.created_at)}` : ''}
                    </span>
                  </span>
                  <span className={`fam-joined${everyone ? ' all' : ''}`}>
                    <span className="fam-joined-label">
                      {everyone ? (
                        'Everyone has joined'
                      ) : (
                        <>
                          <strong>{joined}</strong> of {all} joined
                        </>
                      )}
                    </span>
                    <span
                      className="fam-bar"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={all}
                      aria-valuenow={joined}
                      aria-label={`${joined} of ${all} joined`}
                    >
                      <span style={{ width: `${all > 0 ? (joined / all) * 100 : 0}%` }} />
                    </span>
                  </span>
                  <span className="fam-chips">
                    <span className={`fam-chip${family.safe_word_set ? ' good' : ''}`}>
                      <KeyRound size={14} aria-hidden="true" />
                      {family.safe_word_set ? 'Family word agreed' : 'No family word yet'}
                    </span>
                    {plan ? <span className="fam-chip">{planLine(plan)}</span> : null}
                  </span>
                  <ArrowRight size={18} className="fam-arrow" aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
