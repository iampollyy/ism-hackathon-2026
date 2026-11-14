// The learning page (/family/:familyId/learn): the core habits first, a short
// "spot the tactic" check, then every pressure tactic and warning sign from
// GET /api/learn/tactics, each with the family's practice calls it came up in
// (GET /api/families/{id}/drills). All words come from the API's content.
// Other screens can link to one tactic with #tactic-<key>.

import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { ArrowRight, BookOpen, Newspaper, RotateCcw } from 'lucide-react';
import { api, ApiError } from '../../api/client';
import { HabitsBand } from './HabitsBand';
import { SpotTheTactic } from './SpotTheTactic';
import { TacticCard } from './TacticCard';
import {
  errorText, loadLearnContent, numberWord, useFamilyName,
  type Drill, type LearnContent, type LearnTactic,
} from './shared';
import './readingShared.scss';
import './LearnPage.scss';

const PAST_STATUSES = new Set(['ended', 'scored']);

export function LearnPage() {
  const { familyId = '' } = useParams();
  const location = useLocation();
  const family = useFamilyName(familyId);

  const [content, setContent] = useState<LearnContent | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [drills, setDrills] = useState<Drill[] | null>(null);
  const [drillsNotFound, setDrillsNotFound] = useState(false);
  const [flashKey, setFlashKey] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setContentError(null);
    loadLearnContent().then(
      (loaded) => live && setContent(loaded),
      (error: unknown) => live && setContentError(errorText(error, 'The learning pages could not be loaded.')),
    );
    return () => {
      live = false;
    };
  }, [attempt]);

  // The family's past practice calls, to link each tactic to where it came up.
  // Not essential: the page reads the same without them.
  useEffect(() => {
    let live = true;
    setDrills(null);
    setDrillsNotFound(false);
    api.drills(familyId, undefined, 100).then(
      (list) => live && setDrills(list.drills.filter((drill) => PAST_STATUSES.has(drill.status))),
      (error: unknown) => {
        if (!live) return;
        setDrills([]);
        setDrillsNotFound(error instanceof ApiError && error.status === 404);
      },
    );
    return () => {
      live = false;
    };
  }, [familyId]);

  const drillsByTactic = useMemo(() => {
    const map = new Map<string, Drill[]>();
    for (const drill of drills ?? []) {
      for (const tactic of drill.tactics) {
        const list = map.get(tactic.key) ?? [];
        if (!list.some((item) => item.call_id === drill.call_id)) list.push(drill);
        map.set(tactic.key, list);
      }
    }
    return map;
  }, [drills]);

  // A link like /family/x/learn#tactic-urgency: scroll there once the content is
  // in, and light the card up for a moment so the eye finds it.
  useEffect(() => {
    if (!content || !location.hash) return;
    const id = decodeURIComponent(location.hash.slice(1));
    const target = document.getElementById(id);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (!id.startsWith('tactic-')) return;
    setFlashKey(id.slice('tactic-'.length));
    const timer = window.setTimeout(() => setFlashKey(null), 2400);
    return () => window.clearTimeout(timer);
  }, [content, location.hash, location.key]);

  const notFound = family.notFound || drillsNotFound;
  const tactics = content?.tactics.filter((item) => item.kind === 'tactic') ?? [];
  const signals = content?.tactics.filter((item) => item.kind === 'signal') ?? [];
  const metInDrills = (content?.tactics ?? []).filter((item) => drillsByTactic.has(item.key)).length;

  return (
    <div className="rd-page lp-page">
      <header className="rd-head">
        <nav className="rd-crumbs" aria-label="Breadcrumb">
          {notFound ? (
            <span>Learn</span>
          ) : (
            <>
              <Link to={`/family/${familyId}`}>{family.name ?? 'Family page'}</Link>
              <span aria-hidden>/</span>
              <span aria-current="page">Learn</span>
            </>
          )}
        </nav>
        <div className="rd-head__row">
          <div className="rd-head__text">
            <h1>Know the tricks before they ring</h1>
            <p className="rd-lede">
              A copied voice can sound just like family. What gives the scam away is the pressure, and a few simple
              habits stop it. Here they are in plain words, with every tactic the practice calls use.
            </p>
          </div>
          <div className="rd-head__actions">
            {notFound ? null : (
              <Link to={`/family/${familyId}/news`} className="button button-secondary">
                <Newspaper size={16} aria-hidden /> This week's scam calls
              </Link>
            )}
          </div>
        </div>
        {notFound ? (
          <p className="rd-note" role="status">
            We couldn't find this family, so the family's practice calls aren't shown. Everything else here still applies.
          </p>
        ) : null}
      </header>

      {contentError ? (
        <section className="rd-empty" role="alert">
          <BookOpen size={28} aria-hidden />
          <h2>The learning pages didn't load</h2>
          <p>{contentError}</p>
          <button type="button" className="button button-primary" onClick={() => setAttempt((n) => n + 1)}>
            <RotateCcw size={16} aria-hidden /> Try again
          </button>
        </section>
      ) : !content ? (
        <LearnSkeleton />
      ) : (
        <>
          <HabitsBand habits={content.habits} familyName={family.name} />

          <SpotTheTactic tactics={content.tactics} habits={content.habits} />

          {tactics.length > 0 ? (
            <section className="lp-section" id="tactics" aria-labelledby="lp-tactics-title">
              <div className="lp-section__head">
                <div>
                  <h2 id="lp-tactics-title">
                    The {numberWord(tactics.length)} pressure tactic{tactics.length === 1 ? '' : 's'}
                  </h2>
                  <p>
                    The tricks a scam call leans on. The family's practice calls use the same ones, so every practice
                    call is a rehearsal.
                  </p>
                </div>
                <DrillsSummary drills={drills} met={metInDrills} familyId={familyId} hidden={notFound} />
              </div>
              <TacticIndex items={content.tactics} drillsByTactic={drillsByTactic} />
              <div className="lp-grid lp-grid--two">
                {tactics.map((tactic) => (
                  <TacticCard
                    key={tactic.key}
                    tactic={tactic}
                    drills={drillsByTactic.get(tactic.key) ?? []}
                    familyId={familyId}
                    flash={flashKey === tactic.key}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {signals.length > 0 ? (
            <section className="lp-section" id="signs" aria-labelledby="lp-signs-title">
              <div className="lp-section__head">
                <div>
                  <h2 id="lp-signs-title">
                    {signals.length === 1 ? 'One more warning sign' : `${capitalise(numberWord(signals.length))} more warning signs`}
                  </h2>
                  <p>What the risk light also listens for on a live call. Any one of these is reason enough to hang up.</p>
                </div>
              </div>
              <div className="lp-grid lp-grid--three">
                {signals.map((tactic) => (
                  <TacticCard
                    key={tactic.key}
                    tactic={tactic}
                    drills={drillsByTactic.get(tactic.key) ?? []}
                    familyId={familyId}
                    flash={flashKey === tactic.key}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {notFound ? null : (
            <Link to={`/family/${familyId}/news`} className="rd-next">
              <span>
                <strong>Next: this week's scam calls</strong>
                <span>What's going around right now, and the tactics each one uses.</span>
              </span>
              <ArrowRight size={20} aria-hidden />
            </Link>
          )}
        </>
      )}
    </div>
  );
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

type DrillsSummaryProps = {
  drills: Drill[] | null;
  met: number;
  familyId: string;
  hidden: boolean;
};

/** One honest line about the family's own practice calls, from the drills list. */
function DrillsSummary({ drills, met, familyId, hidden }: DrillsSummaryProps) {
  if (hidden || drills === null) return null;
  if (drills.length === 0) {
    return (
      <p className="lp-summary">
        No practice calls yet. Once there are some, each tactic shows the calls it came up in.
      </p>
    );
  }
  const calls = drills.length === 1 ? 'practice call' : `${numberWord(drills.length)} practice calls`;
  return (
    <p className="lp-summary">
      <span className="lp-summary__mark" aria-hidden />
      {met === 0
        ? `None of these came up in the family's ${calls} yet.`
        : `${capitalise(numberWord(met))} of these came up in the family's ${calls}.`}{' '}
      <Link to={`/family/${familyId}/drills`}>See every practice call</Link>
    </p>
  );
}

type TacticIndexProps = {
  items: LearnTactic[];
  drillsByTactic: Map<string, Drill[]>;
};

/** Every tactic and sign as a jump link; the ones the family met carry a mark. */
function TacticIndex({ items, drillsByTactic }: TacticIndexProps) {
  return (
    <nav className="lp-index" aria-label="Jump to a tactic">
      {items.map((item) => {
        const count = drillsByTactic.get(item.key)?.length ?? 0;
        return (
          <a key={item.key} href={`#tactic-${item.key}`} className={`lp-index__item lp-index__item--${item.level}`}>
            <span className="lp-index__dot" aria-hidden />
            {item.label}
            {count > 0 ? (
              <span className="lp-index__count" title={`In ${count} of the family's practice calls`}>
                {count}
                <span className="lp-sr"> practice call{count === 1 ? '' : 's'}</span>
              </span>
            ) : null}
          </a>
        );
      })}
    </nav>
  );
}

function LearnSkeleton() {
  return (
    <div className="lp-skeleton" aria-busy="true" aria-label="Loading the learning pages">
      <div className="rd-shimmer lp-skeleton__band" />
      <div className="rd-shimmer lp-skeleton__quiz" />
      <div className="lp-grid lp-grid--two">
        <div className="rd-shimmer lp-skeleton__card" />
        <div className="rd-shimmer lp-skeleton__card" />
      </div>
    </div>
  );
}
