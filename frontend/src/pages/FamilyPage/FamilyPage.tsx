// The organiser's home (/family/:familyId). GET /api/families/{id} every
// 3 seconds, the protection settings every 5, each joined member's voice
// from the welcome call every 6, and the plan once.
//
// Laid out as: the family and the way into the other screens; Protection
// (the product's heart) beside the demo buttons; the family, one row each;
// readiness and plans; a practice by hand; this week. In one column the demo
// buttons move up under Protection in the page itself (not only on screen),
// so the keyboard order follows what is shown. The family word itself never
// appears, only whether the family has agreed one.
//
// On a phone (768px and narrower) the page is short: the family's name and
// facts in one scrolling row, Surprise drill and Add a person, then one part
// at a time (People, Protection, Demo, Practice, Progress, This week). The
// layout's tab bar leads to the other screens.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Sparkles, UserPlus } from 'lucide-react';
import { api, ApiError } from '../../api/client';
import type { FamilyPlanView, FamilyView, MemberView, ProtectionView, ScenarioView, VoiceSampleStatus } from '../../api/types';
import { forgetFamilyId, saveFamilyId } from '../FamilySignUpPage/familyStorage';
import { DemoPanel } from './DemoPanel';
import { FamilyHeader } from './FamilyHeader';
import { MemberPlan } from './MemberPlan';
import { MemberRoster } from './MemberRoster';
import { peopleOf } from './people';
import { PracticeForm } from './PracticeForm';
import { ProtectionPanel } from './ProtectionPanel';
import { SEGMENT_PANEL, segmentForHash, Segments, type SegmentKey } from './Segments';
import { useDemo } from './useDemo';
import { useMediaQuery } from './useMediaQuery';
import { usePoll } from './usePoll';
import { WeekList } from './WeekList';
import './FamilyPage.scss';

const FAMILY_MS = 3000;
const PROTECTION_MS = 5000;
const VOICE_MS = 6000;
/** Below this width the page is one column (FamilyPage.scss has the same number). */
const ONE_COLUMN = '(max-width: 1239px)';
/** A phone: the short page in parts (the layout's tab bar uses the same width). */
const PHONE = '(max-width: 768px)';
const SEGMENT_KEY = 'callback.familySegment';
const NO_MEMBERS: MemberView[] = [];

function readSegment(): SegmentKey {
  try {
    return segmentForHash(window.sessionStorage.getItem(SEGMENT_KEY) ?? '') ?? 'people';
  } catch {
    return 'people';
  }
}

export function FamilyPage() {
  const { familyId = '' } = useParams();
  const location = useLocation();

  const family = usePoll<FamilyView>(familyId, () => api.getFamily(familyId), FAMILY_MS, 'The family could not be loaded.');
  const protection = usePoll<ProtectionView>(
    familyId,
    () => api.protection(familyId),
    PROTECTION_MS,
    'The protection settings could not be loaded.',
  );

  // The voice from each joined member's welcome call (and whether it happened).
  const joinedKey = family.data?.members.filter((member) => member.joined).map((member) => member.id).join(',') ?? '';
  const samples = usePoll<Record<string, VoiceSampleStatus>>(
    joinedKey ? `${familyId}:${joinedKey}` : null,
    async () => {
      const ids = joinedKey.split(',');
      const answers = await Promise.all(ids.map((id) => api.memberVoiceSample(id).catch(() => null)));
      return Object.fromEntries(ids.flatMap((id, index) => (answers[index] ? [[id, answers[index]]] : [])));
    },
    VOICE_MS,
    'The voices could not be checked.',
  );

  // The plan (trial, family, bank), once: a small chip in the header.
  const [plan, setPlan] = useState<FamilyPlanView | null>(null);
  useEffect(() => {
    let live = true;
    setPlan(null);
    api.plan(familyId).then(
      (answer) => live && setPlan(answer),
      () => undefined, // the chip simply stays away
    );
    return () => {
      live = false;
    };
  }, [familyId]);

  // The stories for the practice form, retried until they load.
  const [scenarios, setScenarios] = useState<ScenarioView[]>([]);
  const [scenariosError, setScenariosError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let retry: number | undefined;
    const load = async () => {
      try {
        const list = await api.scenarios();
        if (!live) return;
        setScenarios(list);
        setScenariosError(null);
      } catch (error) {
        if (!live) return;
        setScenariosError(`${error instanceof ApiError ? error.message : 'The stories could not be loaded.'} Trying again…`);
        retry = window.setTimeout(() => void load(), FAMILY_MS);
      }
    };
    void load();
    return () => {
      live = false;
      window.clearTimeout(retry);
    };
  }, []);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [segment, setSegmentState] = useState<SegmentKey>(readSegment);
  // Where the focus goes once a part opens from a button at the top.
  const focusNext = useRef<string | null>(null);
  const setSegment = useCallback((key: SegmentKey) => {
    setSegmentState(key);
    try {
      window.sessionStorage.setItem(SEGMENT_KEY, key);
    } catch {
      // only a convenience
    }
  }, []);
  const refreshAll = useCallback(() => {
    family.refresh();
    protection.refresh();
    samples.refresh();
  }, [family.refresh, protection.refresh, samples.refresh]);

  // Remember this family for the sidebar; forget it if it no longer exists.
  const loadedId = family.data?.id;
  const notFound = family.error?.status === 404;
  useEffect(() => {
    if (loadedId) saveFamilyId(loadedId);
  }, [loadedId]);
  useEffect(() => {
    if (notFound) forgetFamilyId(familyId);
  }, [notFound, familyId]);

  const phone = useMediaQuery(PHONE);

  // On a phone, links like /family/x#protection open that part.
  useEffect(() => {
    const key = segmentForHash(location.hash);
    if (phone && key) setSegment(key);
  }, [phone, location.hash, location.key, setSegment]);

  useEffect(() => {
    if (!focusNext.current) return;
    const target = document.querySelector<HTMLElement>(focusNext.current);
    focusNext.current = null;
    target?.focus();
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [segment]);

  // Links like /family/x#protection: scroll there once the page has content.
  useEffect(() => {
    if (!loadedId) return;
    if (!location.hash) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [loadedId, location.hash, location.key]);

  const members = family.data?.members;
  const people = useMemo(() => peopleOf(members ?? NO_MEMBERS), [members]);
  const demo = useDemo(familyId, members ?? NO_MEMBERS, protection.data);
  const oneColumn = useMediaQuery(ONE_COLUMN);

  if (!family.data || !members) {
    if (!family.error) {
      // The page's own shape while the family loads.
      return (
        <div className="fh" aria-busy="true">
          <span className="fh-visually-hidden" role="status">
            Loading your family…
          </span>
          <div className="fh-header" aria-hidden="true">
            <span className="fh-skeleton title" />
            <span className="fh-skeleton line" />
            <div className="fh-quicklinks">
              {[0, 1, 2, 3].map((key) => (
                <span key={key} className="fh-skeleton tile" />
              ))}
            </div>
          </div>
          <div className="fh-layout" aria-hidden="true">
            <div className="fh-main">
              <span className="fh-skeleton dark" />
            </div>
            <div className="fh-side">
              <span className="fh-skeleton side" />
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="fh">
        <div className="fh-state">
          {notFound ? (
            <>
              <h1>We couldn't find this family</h1>
              <p>The link may be from another server, or the family was removed.</p>
              <div className="fh-state-actions">
                <Link to="/families" className="button button-primary">
                  Your families
                </Link>
                <Link to="/signup" className="button button-secondary">
                  Set up a family
                </Link>
              </div>
            </>
          ) : (
            <>
              <h1>Can't reach Callback</h1>
              <p>{family.error.message} Trying again every few seconds.</p>
            </>
          )}
        </div>
      </div>
    );
  }

  const data = family.data;
  const fallbackSelected =
    members.find((member) => !member.is_organiser && member.plan) ?? members.find((member) => !member.is_organiser) ?? members[0];
  const selected = members.find((member) => member.id === selectedId) ?? fallbackSelected;
  // The demo's state lives in useDemo, so moving the panel keeps a drill on its way.
  const demoPanel = <DemoPanel key="demo" members={members} protection={protection.data} demo={demo} />;
  const stale = family.error ? (
    <div className="fh-stale" role="status">
      Can't reach Callback right now. Showing the last update; trying again every few seconds.
    </div>
  ) : null;

  if (phone) {
    const joined = members.filter((member) => member.joined).length;
    const openPart = (key: SegmentKey, focus: string | null) => {
      focusNext.current = focus;
      if (key === segment && focus) {
        const target = document.querySelector<HTMLElement>(focus);
        focusNext.current = null;
        target?.focus();
        target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      setSegment(key);
    };
    let part: React.ReactNode;
    switch (segment) {
      case 'people':
        part = (
          <MemberRoster
            family={data}
            protection={protection.data}
            samples={samples.data ?? {}}
            people={people}
            onChanged={refreshAll}
            adding={adding}
            onAdding={setAdding}
            compact
          />
        );
        break;
      case 'protection':
        part = <ProtectionPanel familyId={data.id} poll={protection} people={people} pageStale={Boolean(family.error)} compact />;
        break;
      case 'demo':
        part = demoPanel;
        break;
      case 'practice':
        part = (
          <PracticeForm familyId={data.id} members={members} week={data.week} scenarios={scenarios} scenariosError={scenariosError} />
        );
        break;
      case 'progress':
        part = selected ? (
          <MemberPlan members={members} selected={selected} week={data.week} scenarios={scenarios} onSelect={setSelectedId} />
        ) : null;
        break;
      case 'week':
        part = (
          <WeekList week={data.week} familyId={data.id} scenarios={scenarios} people={people} zone={protection.data?.timezone ?? null} />
        );
        break;
    }

    return (
      <div className="fh fh-phone">
        {stale}
        <FamilyHeader family={data} plan={plan} protectionOn={protection.data ? protection.data.enabled : null} compact />

        <div className="fh-quick-actions">
          <button type="button" className="button button-primary" onClick={() => openPart('demo', '#demo .fh-demo-block .button-primary')}>
            <Sparkles size={18} aria-hidden="true" /> Surprise drill
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              setAdding(true);
              openPart('people', null);
            }}
          >
            <UserPlus size={18} aria-hidden="true" /> Add a person
          </button>
        </div>

        <Segments value={segment} onChange={setSegment} notes={{ people: `${joined}/${members.length}` }} />
        <div id={SEGMENT_PANEL} role="tabpanel" aria-labelledby={`fh-seg-${segment}`} className="fh-seg-panel">
          {part}
        </div>
      </div>
    );
  }

  return (
    <div className="fh">
      {stale}

      <FamilyHeader family={data} plan={plan} protectionOn={protection.data ? protection.data.enabled : null} />

      <div className="fh-layout">
        <div className="fh-main">
          <ProtectionPanel key="protection" familyId={data.id} poll={protection} people={people} pageStale={Boolean(family.error)} />
          {oneColumn ? demoPanel : null}
          <MemberRoster
            key="roster"
            family={data}
            protection={protection.data}
            samples={samples.data ?? {}}
            people={people}
            onChanged={refreshAll}
            adding={adding}
            onAdding={setAdding}
          />
          {selected ? (
            <MemberPlan
              key="plan"
              members={members}
              selected={selected}
              week={data.week}
              scenarios={scenarios}
              onSelect={setSelectedId}
            />
          ) : null}
        </div>

        <aside className="fh-side" aria-label="Calls">
          {oneColumn ? null : demoPanel}
          <WeekList
            key="week"
            week={data.week}
            familyId={data.id}
            scenarios={scenarios}
            people={people}
            zone={protection.data?.timezone ?? null}
          />
          <PracticeForm
            key="practice"
            familyId={data.id}
            members={members}
            week={data.week}
            scenarios={scenarios}
            scenariosError={scenariosError}
          />
        </aside>
      </div>
    </div>
  );
}
