// The organiser's home (/family/:familyId). GET /api/families/{id} every
// 3 seconds, the protection settings every 5, each joined member's voice
// from the welcome call every 6, and the plan once.
//
// Laid out as: the family and the way into the other screens; Protection
// (the product's heart) beside the demo buttons; the family, one row each;
// readiness and plans; a practice by hand; this week. The family word itself
// never appears, only whether the family has agreed one.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import type { FamilyPlanView, FamilyView, ProtectionView, ScenarioView, VoiceSampleStatus } from '../../api/types';
import { forgetFamilyId, saveFamilyId } from '../FamilySignUpPage/familyStorage';
import { DemoPanel } from './DemoPanel';
import { FamilyHeader } from './FamilyHeader';
import { MemberPlan } from './MemberPlan';
import { MemberRoster } from './MemberRoster';
import { PracticeForm } from './PracticeForm';
import { ProtectionPanel } from './ProtectionPanel';
import { usePoll } from './usePoll';
import { WeekList } from './WeekList';
import './FamilyPage.scss';

const FAMILY_MS = 3000;
const PROTECTION_MS = 5000;
const VOICE_MS = 6000;

const AVATAR_COLORS = ['#e76d52', '#1d8d64', '#213d52', '#b77a15', '#2f7ea8', '#8a5a44'];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
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
  const people = useMemo(
    () =>
      Object.fromEntries(
        (members ?? []).map((member, index) => [
          member.id,
          { initials: initials(member.name), color: AVATAR_COLORS[index % AVATAR_COLORS.length] },
        ]),
      ),
    [members],
  );

  if (!family.data || !members) {
    return (
      <div className="fh">
        <div className="fh-state" aria-busy={!family.error}>
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
          ) : family.error ? (
            <>
              <h1>Can't reach Callback</h1>
              <p>{family.error.message} Trying again every few seconds.</p>
            </>
          ) : (
            <>
              <span className="fh-skeleton title" />
              <span className="fh-skeleton line" />
              <span className="fh-skeleton block" />
              <span className="fh-visually-hidden">Loading your family…</span>
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

  return (
    <div className="fh">
      {family.error ? (
        <div className="fh-stale" role="status">
          Can't reach Callback right now. Showing the last update; trying again every few seconds.
        </div>
      ) : null}

      <FamilyHeader family={data} plan={plan} protectionOn={protection.data ? protection.data.enabled : null} />

      <div className="fh-layout">
        <div className="fh-main">
          <ProtectionPanel familyId={data.id} poll={protection} people={people} />
          <MemberRoster
            family={data}
            protection={protection.data}
            samples={samples.data ?? {}}
            people={people}
            onChanged={refreshAll}
          />
          {selected ? (
            <MemberPlan members={members} selected={selected} scenarios={scenarios} onSelect={setSelectedId} />
          ) : null}
        </div>

        <aside className="fh-side" aria-label="Calls">
          <DemoPanel familyId={data.id} members={members} protection={protection.data} />
          <WeekList week={data.week} familyId={data.id} scenarios={scenarios} />
          <PracticeForm
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
