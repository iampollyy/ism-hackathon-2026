// Every drill for the family (/family/:familyId/drills), newest first, on
// GET /api/families/{id}/drills: who, the story and the voice, what they did,
// the highest the risk light went, the tactics and the lesson. A row opens
// the replay. Filter by person (?member=mem_…). Refreshed every few seconds,
// so a drill that rings while the page is open shows up by itself.

import { useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { PhoneIncoming, ShieldCheck } from 'lucide-react';
import { api } from '../../api/client';
import type { DrillList, FamilyView } from '../../api/types';
import { DrillListHead, DrillRow } from './DrillRow';
import {
  EmptyState, LoadError, LoadingRows, memberIndex, PersonFilter, ReviewHeader, StaleNotice, useRememberFamily,
} from './ReviewParts';
import { drillState, plural, type DrillView } from './reviewWords';
import { usePolled } from './usePolled';
import './review.scss';

const REFRESH_MS = 5000;

export function DrillsPage() {
  const { familyId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const memberId = params.get('member');

  const family = usePolled<FamilyView>(() => api.getFamily(familyId), familyId, 30_000, 'The family could not be loaded.');
  const all = usePolled<DrillList>(() => api.drills(familyId, undefined, 100), familyId, REFRESH_MS, 'The drills could not be loaded.');
  const one = usePolled<DrillList | null>(
    () => (memberId ? api.drills(familyId, memberId, 100) : Promise.resolve(null)),
    `${familyId}:${memberId ?? ''}`,
    memberId ? REFRESH_MS : null,
    'The drills could not be loaded.',
  );

  const members = family.data?.members ?? [];
  const allDrills = all.data?.drills ?? [];
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const drill of allDrills) map.set(drill.member.id, (map.get(drill.member.id) ?? 0) + 1);
    return map;
  }, [allDrills]);

  const source = memberId ? one : all;
  const drills = memberId ? one.data?.drills ?? null : all.data?.drills ?? null;
  const selected = members.find((member) => member.id === memberId) ?? null;
  const familyName = family.data?.name ?? null;
  useRememberFamily(family.data?.id);

  const choose = (next: string | null) => {
    const copy = new URLSearchParams(params);
    if (next) copy.set('member', next);
    else copy.delete('member');
    setParams(copy, { replace: true });
  };

  const protectionLink = (
    <Link to={`/family/${familyId}#protection`} className="button button-secondary rv-button">
      <ShieldCheck size={16} aria-hidden /> Protection settings
    </Link>
  );

  if (family.notFound || all.notFound) {
    return (
      <div className="rv">
        <ReviewHeader
          familyId={familyId}
          familyName={null}
          title="We couldn’t find this family"
          lead="The link may be from another server, or the family was removed."
          actions={<Link to="/families" className="button button-primary rv-button">See your families</Link>}
        />
      </div>
    );
  }

  return (
    <div className="rv rv-drills">
      <ReviewHeader
        familyId={familyId}
        familyName={familyName}
        title="Drills"
        lead="Every practice call, newest first. Open one to replay it with the conversation, the tactics and the risk light."
        actions={protectionLink}
      />

      {source.stale || (all.stale && memberId) ? <StaleNotice /> : null}

      <section className="rv-panel" aria-label="Drills">
        <div className="rv-toolbar">
          {members.length ? (
            <PersonFilter
              members={members}
              value={memberId}
              onChange={choose}
              counts={counts}
              total={allDrills.length}
              label="Show drills for"
            />
          ) : <span />}
          {drills && drills.length ? <Tally drills={drills} /> : null}
        </div>

        {drills === null ? (
          source.error && !source.loading ? (
            <LoadError message={source.error} onRetry={source.reload} />
          ) : (
            <LoadingRows label="Loading the drills" />
          )
        ) : drills.length === 0 ? (
          memberId ? (
            <EmptyState
              compact
              icon={<PhoneIncoming size={20} />}
              title={`No drills for ${selected?.name ?? 'this person'} yet`}
              action={<button type="button" className="button button-ghost rv-button" onClick={() => choose(null)}>Show everyone’s drills</button>}
            >
              <p>
                When protection is on, {selected?.name ?? 'they'} will get drills at random times within the family’s
                hours, as long as they have agreed to practice calls.
              </p>
            </EmptyState>
          ) : (
            <NoDrillsYet familyId={familyId} />
          )
        ) : (
          <DrillGroups drills={drills} family={family.data} />
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- groups

function DrillGroups({ drills, family }: { drills: DrillView[]; family: FamilyView | null }) {
  const now = drills.filter((drill) => ['live', 'reviewing'].includes(drillState(drill)));
  const upcoming = drills.filter((drill) => drillState(drill) === 'upcoming')
    // soonest first
    .sort((a, b) => (a.scheduled_for ?? a.created_at).localeCompare(b.scheduled_for ?? b.created_at));
  const past = drills.filter((drill) => !['live', 'reviewing', 'upcoming'].includes(drillState(drill)));
  const relationship = (id: string) => family?.members.find((member) => member.id === id)?.relationship;

  const rows = (list: DrillView[]) => (
    <ul className="rv-drill-list">
      {list.map((drill) => (
        <DrillRow
          key={drill.call_id}
          drill={drill}
          colorIndex={memberIndex(family, drill.member.id)}
          relationship={relationship(drill.member.id)}
        />
      ))}
    </ul>
  );

  return (
    <div className="rv-groups">
      {now.length ? (
        <section className="rv-group rv-group--now" aria-labelledby="drills-now">
          <h2 id="drills-now"><span className="rv-live-dot" aria-hidden /> Happening now</h2>
          {rows(now)}
        </section>
      ) : null}

      {upcoming.length ? (
        <section className="rv-group" aria-labelledby="drills-upcoming">
          <div className="rv-group__head">
            <h2 id="drills-upcoming">Coming up</h2>
            <p>Only you can see these times. Nobody is told when a drill will ring.</p>
          </div>
          {rows(upcoming)}
        </section>
      ) : null}

      {past.length ? (
        <section className="rv-group" aria-labelledby="drills-past">
          <div className="rv-group__head">
            <h2 id="drills-past">Past drills</h2>
            <p>{plural(past.length, 'drill')}, newest first.</p>
          </div>
          <DrillListHead />
          {rows(past)}
        </section>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- the tally

/** How the finished drills went, as one thin bar and its legend. */
function Tally({ drills }: { drills: DrillView[] }) {
  let safe = 0;
  let tips = 0;
  let unanswered = 0;
  for (const drill of drills) {
    const state = drillState(drill);
    if (state === 'safe') safe += 1;
    else if (state === 'tip') tips += 1;
    else if (state === 'unanswered') unanswered += 1;
  }
  const total = safe + tips + unanswered;
  if (!total) return null;
  const width = (count: number) => `${(count / total) * 100}%`;
  return (
    <div className="rv-tally">
      <div className="rv-tally__bar" aria-hidden>
        {safe ? <span className="is-safe" style={{ width: width(safe) }} /> : null}
        {tips ? <span className="is-tip" style={{ width: width(tips) }} /> : null}
        {unanswered ? <span className="is-quiet" style={{ width: width(unanswered) }} /> : null}
      </div>
      <ul className="rv-tally__legend">
        <li><span className="is-safe" aria-hidden />{safe} handled the safe way</li>
        {tips ? <li><span className="is-tip" aria-hidden />{plural(tips, 'tip')} for next time</li> : null}
        {unanswered ? <li><span className="is-quiet" aria-hidden />{unanswered} not answered</li> : null}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- empty

function NoDrillsYet({ familyId }: { familyId: string }) {
  return (
    <EmptyState
      icon={<PhoneIncoming size={22} />}
      title="No drills yet"
      action={(
        <Link to={`/family/${familyId}#protection`} className="button button-primary rv-button">
          <ShieldCheck size={16} aria-hidden /> Turn on protection
        </Link>
      )}
    >
      <p>
        A drill is a practice scam call. It rings at a random moment, in a relative’s copied voice or a stranger’s,
        and uses the same pressure real scammers use. It always says what it was at the end, with one tip and a
        button to call the family number.
      </p>
      <p>
        Turn on protection to choose how many drills a week and the hours they may ring. Each one shows up here,
        ready to replay.
      </p>
    </EmptyState>
  );
}
