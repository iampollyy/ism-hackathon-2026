// One person's page (/family/:familyId/members/:memberId), for the organiser:
// readiness before and now with its five parts, their drill record, the weak
// spot, when the next drill rings (only the organiser sees this), the lessons
// newest first, and their drills. Consent and the drill pause are shown and
// can be changed here. On GET /api/members/{id}/progress, the family's drills
// for this member, the family and the protection settings.

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ChevronRight, Flame, Lightbulb, LoaderCircle, Mic, Phone, PhoneIncoming, ShieldCheck, Target, Zap,
} from 'lucide-react';
import { api, ApiError } from '../../api/client';
import type {
  DrillList, FamilyView, MemberView, ProgressView, ProtectionView, SurpriseDrillCreated,
} from '../../api/types';
import { DrillListHead, DrillRow } from '../DrillsPage/DrillRow';
import {
  EmptyState, LoadError, LoadingRows, memberIndex, PersonAvatar, ReviewHeader, StaleNotice, useRememberFamily,
} from '../DrillsPage/ReviewParts';
import { isSafeOutcome, lowerFirst, plural, possessive, whenWords, type LessonView } from '../DrillsPage/reviewWords';
import { usePolled } from '../DrillsPage/usePolled';
import { useShieldCalls } from '../DrillsPage/useShieldCalls';
import { Readiness } from './Readiness';
import '../DrillsPage/review.scss';
import './MemberPage.scss';

const REFRESH_MS = 8000;

export function MemberPage() {
  const { familyId = '', memberId = '' } = useParams();
  const progress = usePolled<ProgressView>(() => api.progress(memberId), memberId, REFRESH_MS, 'The progress could not be loaded.');
  const drills = usePolled<DrillList>(() => api.drills(familyId, memberId, 20), `${familyId}:${memberId}`, REFRESH_MS, 'The drills could not be loaded.');
  const family = usePolled<FamilyView>(() => api.getFamily(familyId), familyId, REFRESH_MS, 'The family could not be loaded.');
  const protection = usePolled<ProtectionView>(() => api.protection(familyId), familyId, 15_000, 'The protection settings could not be loaded.');
  const shields = useShieldCalls(drills.data?.drills);
  useRememberFamily(family.data?.id);

  const member = family.data?.members.find((one) => one.id === memberId) ?? null;
  const name = progress.data?.member.name ?? member?.name ?? '';
  const index = memberIndex(family.data, memberId);

  if (progress.notFound || drills.notFound || family.notFound) {
    return (
      <div className="rv">
        <ReviewHeader
          familyId={familyId}
          familyName={family.data?.name ?? null}
          title="We couldn’t find this person"
          lead="The link may be incomplete, or they belong to another family."
          actions={<Link to={`/family/${familyId}`} className="button button-primary rv-button">Open the family page</Link>}
        />
      </div>
    );
  }

  if (!progress.data) {
    return (
      <div className="rv rv-member">
        <ReviewHeader familyId={familyId} familyName={family.data?.name ?? null} title={name || 'Loading…'} />
        <section className="rv-panel">
          {progress.error && !progress.loading
            ? <LoadError message={progress.error} onRetry={progress.reload} />
            : <LoadingRows rows={3} label="Loading their progress" />}
        </section>
      </div>
    );
  }

  const data = progress.data;
  const subtitle = [
    member?.relationship ? capitalise(member.relationship) : null,
    member?.is_organiser ? 'Organiser' : null,
    member?.joined_at ? `Joined ${lowerFirst(whenWords(member.joined_at))}` : member && !member.joined ? 'Hasn’t used their invite yet' : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="rv rv-member">
      <ReviewHeader
        familyId={familyId}
        familyName={family.data?.name ?? null}
        leading={<PersonAvatar name={name} index={index} size="lg" />}
        title={name}
        lead={subtitle || undefined}
        actions={(
          <Link to={`/family/${familyId}/drills?member=${memberId}`} className="button button-secondary rv-button">
            <ShieldCheck size={16} aria-hidden /> All {possessive(name)} drills
          </Link>
        )}
      />

      {progress.stale ? <StaleNotice /> : null}

      <div className="rv-member__grid">
        <div className="rv-member__main">
          <Readiness readiness={data.readiness} name={name} />

          <section className="rv-panel" aria-labelledby="lessons-title">
            <div className="rv-panel__head">
              <h2 id="lessons-title">What {name} has learned</h2>
              {data.lessons.length ? <p>One lesson from each drill, newest first.</p> : null}
            </div>
            {data.lessons.length ? (
              <ol className="rv-lessons">
                {data.lessons.map((lesson) => <LessonItem key={lesson.call_id} lesson={lesson} />)}
              </ol>
            ) : (
              <EmptyState compact icon={<Lightbulb size={20} />} title="No lessons yet">
                <p>After each drill, {name} hears one short tip. Every tip collects here, so you can talk them through together.</p>
              </EmptyState>
            )}
          </section>

          <section className="rv-panel" aria-labelledby="their-drills">
            <div className="rv-panel__head">
              <h2 id="their-drills">{possessive(name)} drills</h2>
              {drills.data?.drills.length ? (
                <Link to={`/family/${familyId}/drills?member=${memberId}`} className="rv-link">
                  See them with everyone’s <ChevronRight size={15} aria-hidden />
                </Link>
              ) : null}
            </div>
            {drills.data === null ? (
              drills.error && !drills.loading
                ? <LoadError message={drills.error} onRetry={drills.reload} />
                : <LoadingRows rows={2} label="Loading their drills" />
            ) : drills.data.drills.length ? (
              <>
                <DrillListHead showWho={false} />
                <ul className="rv-drill-list">
                  {drills.data.drills.map((drill) => (
                    <DrillRow
                      key={drill.call_id}
                      drill={drill}
                      colorIndex={index}
                      showWho={false}
                      showLesson={false}
                      shield={shields.get(drill.call_id)}
                    />
                  ))}
                </ul>
              </>
            ) : (
              <EmptyState compact icon={<PhoneIncoming size={20} />} title="No drills yet">
                <p>When protection is on, {name} gets drills at random times within the family’s hours.</p>
              </EmptyState>
            )}
          </section>
        </div>

        <aside className="rv-member__side">
          <Record progress={data} name={name} />
          <NextDrill
            progress={data}
            protection={protection.data}
            memberId={memberId}
            familyId={familyId}
            name={name}
            onStarted={() => {
              progress.reload();
              drills.reload();
              protection.reload();
            }}
          />
          <ConsentPanel
            member={member}
            protection={protection.data}
            memberId={memberId}
            name={name}
            onChanged={() => {
              family.reload();
              protection.reload();
            }}
          />
        </aside>
      </div>
    </div>
  );
}

function capitalise(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

// ---------------------------------------------------------------- the record

function Record({ progress, name }: { progress: ProgressView; name: string }) {
  const { total, safe, safe_streak: streak, last_outcome: last, last_outcome_label: lastLabel } = progress.drills;
  return (
    <section className="rv-panel rv-record" aria-labelledby="record-title">
      <div className="rv-panel__head">
        <h2 id="record-title">Drill record</h2>
      </div>
      {total ? (
        <>
          <dl className="rv-record__numbers">
            <div>
              <dt>Drills</dt>
              <dd>{total}</dd>
            </div>
            <div className="is-safe">
              <dt>Safe</dt>
              <dd>{safe}</dd>
            </div>
            <div className={streak > 1 ? 'is-streak' : ''}>
              <dt>In a row</dt>
              <dd>{streak > 1 ? <Flame size={18} aria-hidden /> : null}{streak}</dd>
            </div>
          </dl>
          {last ? (
            <p className="rv-record__last">
              Last time:{' '}
              <span className={`rv-outcome ${isSafeOutcome(last) ? 'is-safe' : 'is-tip'}`}>
                {isSafeOutcome(last) ? <ShieldCheck size={14} aria-hidden /> : <Lightbulb size={14} aria-hidden />}
                {lastLabel}
              </span>
            </p>
          ) : null}
        </>
      ) : (
        <p className="rv-muted rv-record__none">No drills with a result yet. {name}’s record starts with the first one.</p>
      )}

      <div className={`rv-weak${progress.weak_spot ? '' : ' is-unknown'}`}>
        <Target size={18} aria-hidden />
        <div>
          <h3>Weak spot</h3>
          <p>{progress.weak_spot ?? `Not known yet: the welcome call or the first drill shows where ${name} could be caught out.`}</p>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- the next drill

type NextDrillProps = {
  progress: ProgressView;
  protection: ProtectionView | null;
  memberId: string;
  familyId: string;
  name: string;
  /** A surprise drill was planned: load the page's numbers again. */
  onStarted: () => void;
};

function NextDrill({ progress, protection, memberId, familyId, name, onStarted }: NextDrillProps) {
  const entry = protection?.members.find((one) => one.member_id === memberId) ?? null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState<SurpriseDrillCreated | null>(null);

  const surprise = async () => {
    setBusy(true);
    setError(null);
    try {
      setStarted(await api.surpriseDrill(familyId, { member_id: memberId, within_seconds: 60 }));
      onStarted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The drill couldn’t be planned. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const next = progress.next_drill_at;
  let line: string;
  let detail: string | null = null;
  if (next) {
    line = whenWords(next);
    detail = `Only you can see this. ${name} is never told when a drill will ring.`;
  } else if (entry && !entry.eligible) {
    line = 'No drill planned';
    detail = entry.reason_if_not ?? null;
  } else if (protection && !protection.enabled) {
    line = 'No drill planned';
    detail = 'Random drills are off for the family. Turn them on in the protection settings.';
  } else if (entry && protection && entry.drills_last_7_days >= protection.drills_per_week) {
    line = 'Not this week';
    detail = `${name} has had ${plural(entry.drills_last_7_days, 'drill')} in the last 7 days, and the family chose ${plural(protection.drills_per_week, 'drill')} a week. The next one is planned when the week allows.`;
  } else {
    line = 'Being planned';
    detail = 'With protection on, the next drill is planned within a minute or so, inside the family’s hours.';
  }
  return (
    <section className="rv-panel rv-next" aria-labelledby="next-title">
      <div className="rv-panel__head">
        <h2 id="next-title">Next drill</h2>
        <Link to={`/family/${familyId}#protection`} className="rv-link">Protection</Link>
      </div>
      <p className="rv-next__when">{line}</p>
      {detail ? <p className="rv-muted">{detail}</p> : null}

      {started ? (
        <div className="rv-next__started" role="status">
          <p>
            <strong>A surprise drill rings {possessive(name)} phone within a minute.</strong> {name} won’t know when,
            and it always says what it was at the end.
          </p>
          <Link to={`/calls/${started.call_id}`} className="rv-link">
            Follow it live <ChevronRight size={15} aria-hidden />
          </Link>
        </div>
      ) : entry?.eligible ? (
        <div className="rv-next__surprise">
          <button type="button" className="button button-secondary rv-button" onClick={surprise} disabled={busy}>
            {busy ? <LoaderCircle size={16} className="rv-spin" aria-hidden /> : <Zap size={16} aria-hidden />}
            {busy ? 'Planning the drill…' : 'Ring a surprise drill'}
          </button>
          <p className="rv-muted">Within a minute, at a moment {name} doesn’t know.</p>
        </div>
      ) : null}
      {error ? <p className="rv-form-error" role="alert">{error}</p> : null}

      {entry ? <p className="rv-next__week">{plural(entry.drills_last_7_days, 'drill')} in the last 7 days</p> : null}
    </section>
  );
}

// ---------------------------------------------------------------- consent

type ConsentPanelProps = {
  member: MemberView | null;
  protection: ProtectionView | null;
  memberId: string;
  name: string;
  onChanged: () => void;
};

function ConsentPanel({ member, protection, memberId, name, onChanged }: ConsentPanelProps) {
  const [busy, setBusy] = useState<'consent' | 'pause' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // What was just set, shown until the next refresh confirms it.
  const [consentOverride, setConsentOverride] = useState<boolean | null>(null);
  const [pauseOverride, setPauseOverride] = useState<boolean | null>(null);
  const entry = protection?.members.find((one) => one.member_id === memberId) ?? null;
  const serverConsent = member?.consent.practice;
  const serverPaused = entry?.paused;
  // Once the server's answer changes (the refresh after a save, or a change
  // made elsewhere), it wins again.
  useEffect(() => setConsentOverride(null), [serverConsent]);
  useEffect(() => setPauseOverride(null), [serverPaused]);
  const consent = consentOverride ?? serverConsent ?? null;
  const paused = pauseOverride ?? serverPaused ?? null;

  const run = async (kind: 'consent' | 'pause', action: () => Promise<unknown>, after: () => void) => {
    setBusy(kind);
    setError(null);
    try {
      await action();
      after();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That didn’t save. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const voice = member?.voice_status === 'ready'
    ? { text: 'Ready for family drills', good: true }
    : member?.voice_status === 'failed'
      ? { text: 'Couldn’t be set up', good: false }
      : { text: 'Not set up', good: false };

  return (
    <section className="rv-panel rv-consent" aria-labelledby="consent-title">
      <div className="rv-panel__head">
        <h2 id="consent-title">Consent and drills</h2>
      </div>
      <dl className="rv-facts">
        <div>
          <dt>Practice calls</dt>
          <dd>
            {consent === null ? '…' : (
              <button
                type="button"
                role="switch"
                aria-checked={consent}
                aria-label={`Practice calls for ${name}`}
                className={`rv-switch${consent ? ' is-on' : ''}`}
                disabled={busy !== null}
                onClick={() => run('consent', () => api.setConsent(memberId, { consent_practice: !consent }), () => setConsentOverride(!consent))}
              >
                {consent ? 'Agreed' : 'Not agreed'}
                <span className="rv-switch__track" aria-hidden />
              </button>
            )}
          </dd>
        </div>
        <div>
          <dt>Drills</dt>
          <dd>
            {paused === null ? '…' : (
              <button
                type="button"
                role="switch"
                aria-checked={!paused}
                aria-label={`Drills for ${name}`}
                className={`rv-switch${!paused ? ' is-on' : ''}`}
                disabled={busy !== null}
                onClick={() => run('pause', () => api.pauseDrills(memberId, { paused: !paused }), () => setPauseOverride(!paused))}
              >
                {paused ? 'Paused' : 'On'}
                <span className="rv-switch__track" aria-hidden />
              </button>
            )}
          </dd>
        </div>
        <div>
          <dt><Mic size={15} aria-hidden /> Voice</dt>
          <dd className={voice.good ? 'is-good' : ''}>{voice.text}</dd>
        </div>
        <div>
          <dt><Phone size={15} aria-hidden /> Phone number</dt>
          <dd>{member?.phone_number || 'Not given'}</dd>
        </div>
      </dl>
      {error ? <p className="rv-form-error" role="alert">{error}</p> : null}
      <p className="rv-muted rv-consent__note">
        {name} can change these too, and can leave Callback at any time. A drill always says what it was at the end.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------- a lesson

function LessonItem({ lesson }: { lesson: LessonView }) {
  const safe = isSafeOutcome(lesson.outcome);
  return (
    <li className={`rv-lesson ${safe ? 'is-safe' : 'is-tip'}`}>
      <div className="rv-lesson__top">
        <span className={`rv-outcome ${safe ? 'is-safe' : 'is-tip'}`}>
          {safe ? <ShieldCheck size={14} aria-hidden /> : <Lightbulb size={14} aria-hidden />}
          {lesson.outcome_label}
        </span>
        <time dateTime={lesson.when}>{whenWords(lesson.when)}</time>
      </div>
      <p>{lesson.lesson}</p>
      <Link to={`/calls/${lesson.call_id}`} className="rv-link">
        Replay the drill <ChevronRight size={15} aria-hidden />
      </Link>
    </li>
  );
}
