// The family page (/family/:familyId), on GET /api/families/{id}, refreshed
// every 3 seconds. Laid out like the mock FamilyDashboardPage, with real data:
// readiness out of 10, member cards, one person's plan, this week, starting a
// practice, and the phone links. The family word itself never appears; only
// whether the family has agreed one.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { ArrowRight, KeyRound, Mic, ShieldCheck, Smartphone } from 'lucide-react';
import { api, ApiError } from '../../api/client';
import type { FamilyView, ScenarioView } from '../../api/types';
import { StatCard } from '../../components/molecules/StatCard';
import { forgetFamilyId, saveFamilyId } from '../FamilySignUpPage/familyStorage';
import { FamilyMemberCard } from './FamilyMemberCard';
import { MemberPlan } from './MemberPlan';
import { PhoneLinks } from './PhoneLinks';
import { PracticeForm } from './PracticeForm';
import { WeekList } from './WeekList';
import '../FamilySignUpPage/familyShared.scss';
import './FamilyPage.scss';

const REFRESH_MS = 3000;

type LoadError = { notFound: boolean; message: string };

export function FamilyPage() {
  const { familyId = '' } = useParams();
  const location = useLocation();
  const [family, setFamily] = useState<FamilyView | null>(null);
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [scenarios, setScenarios] = useState<ScenarioView[]>([]);
  const [scenariosError, setScenariosError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const refreshRef = useRef<() => void>(() => undefined);

  // Load the family, then again every few seconds (one request at a time).
  // Answers for a family this page no longer shows are dropped.
  useEffect(() => {
    let live = true;
    let inFlight = false;
    setFamily(null);
    setLoadError(null);
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const next = await api.getFamily(familyId);
        if (!live) return;
        setFamily(next);
        setLoadError(null);
      } catch (error) {
        if (!live) return;
        setLoadError({
          notFound: error instanceof ApiError && error.status === 404,
          message: error instanceof ApiError ? error.message : 'The family could not be loaded.',
        });
      } finally {
        inFlight = false;
      }
    };
    refreshRef.current = () => void load();
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [familyId]);
  const refresh = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    let live = true;
    api.scenarios().then(
      (list) => live && setScenarios(list),
      (error) => live && setScenariosError(error instanceof ApiError ? error.message : 'The stories could not be loaded.'),
    );
    return () => {
      live = false;
    };
  }, []);

  // Remember this family for the sidebar; forget it if it no longer exists.
  const loadedId = family?.id;
  useEffect(() => {
    if (loadedId) saveFamilyId(loadedId);
  }, [loadedId]);
  useEffect(() => {
    if (loadError?.notFound) forgetFamilyId(familyId);
  }, [loadError, familyId]);

  // Sidebar links like /family/x#practice: scroll there once the page has content.
  useEffect(() => {
    if (!loadedId || !location.hash) return;
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [loadedId, location.hash]);

  if (!family) {
    return (
      <div className="family-live">
        <section className="hero-summary surface-card family-hero">
          {loadError?.notFound ? (
            <div>
              <span className="eyebrow">Family page</span>
              <h1>We couldn't find this family</h1>
              <p className="hero-sub">The link may be from another server, or the family was removed.</p>
              <div className="hero-actions">
                <Link to="/signup" className="button button-primary">
                  Set up a family
                </Link>
              </div>
            </div>
          ) : loadError ? (
            <div>
              <span className="eyebrow">Family page</span>
              <h1>Can't reach Callback</h1>
              <p className="hero-sub">{loadError.message} Trying again every few seconds.</p>
            </div>
          ) : (
            <div>
              <span className="eyebrow">Family page</span>
              <h1>Loading your family…</h1>
            </div>
          )}
        </section>
      </div>
    );
  }

  const members = family.members;
  const fallbackSelected =
    members.find((member) => !member.is_organiser && member.plan) ??
    members.find((member) => !member.is_organiser) ??
    members[0];
  const selected = members.find((member) => member.id === selectedId) ?? fallbackSelected;
  const voicesReady = members.filter((member) => member.voice_ready).length;
  const phonesOpen = members.filter((member) => member.phone_online).length;
  const { before, now, max } = family.readiness;

  const select = (memberId: string) => {
    setSelectedId(memberId);
    document.getElementById('plan')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="family-live dashboard-main">
      {loadError ? (
        <div className="refresh-warning" role="status">
          Can't reach Callback right now. Showing the last update; trying again every few seconds.
        </div>
      ) : null}

      <section className="hero-summary surface-card family-hero">
        <div>
          <span className="eyebrow">Family page</span>
          <h1>{family.name}</h1>
          <p className="hero-sub">
            Readiness <strong>{before} → {now}</strong> out of {max} · Family word:{' '}
            <strong>{family.safe_word_set ? 'agreed' : 'not agreed yet'}</strong>
          </p>
        </div>
        <div className="hero-actions">
          <a href="#practice" className="button button-primary" onClick={(event) => {
            event.preventDefault();
            document.getElementById('practice')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}>
            Start a practice <ArrowRight size={16} />
          </a>
          <Link to={`/signup?family=${family.id}&step=voices`} className="button button-secondary">
            <Mic size={16} /> Record voices
          </Link>
        </div>
      </section>

      <div className="dashboard-grid">
        <div className="main-column">
          <section className="content-panel">
            <div className="section-heading-row">
              <div>
                <span className="eyebrow">Family readiness</span>
                <h2>How ready is the family?</h2>
              </div>
            </div>
            <div className="stats-grid family-stats">
              <StatCard
                label="Readiness"
                value={`${before} → ${now}`}
                note={`Out of ${max}: before practice, and now`}
                icon={<ShieldCheck size={18} />}
              />
              <StatCard
                label="Family word"
                value={family.safe_word_set ? 'Agreed' : 'Not yet'}
                note={family.safe_word_set ? 'Only that you have one. Never the word.' : 'Agree one together, out loud'}
                icon={<KeyRound size={18} />}
              />
              <StatCard
                label="Voices ready"
                value={`${voicesReady} of ${members.length}`}
                note="For calls in a family voice"
                icon={<Mic size={18} />}
              />
              <StatCard
                label="Phones open"
                value={`${phonesOpen} of ${members.length}`}
                note="A call can only ring on an open phone page"
                icon={<Smartphone size={18} />}
              />
            </div>
          </section>

          <section id="members" className="content-panel">
            <div className="section-heading-row compact">
              <div>
                <span className="eyebrow">Members</span>
                <h2>Who is in the family</h2>
              </div>
            </div>
            <div className="member-grid family-member-grid">
              {members.map((member, index) => (
                <FamilyMemberCard
                  key={member.id}
                  member={member}
                  index={index}
                  familyId={family.id}
                  safeWordSet={family.safe_word_set}
                  scenarios={scenarios}
                  selected={member.id === selected?.id}
                  onSelect={() => select(member.id)}
                  onChanged={refresh}
                />
              ))}
            </div>
          </section>

          {selected ? (
            <MemberPlan members={members} selected={selected} scenarios={scenarios} onSelect={setSelectedId} />
          ) : null}
        </div>

        <div className="sidebar-column">
          <PracticeForm
            familyId={family.id}
            members={members}
            week={family.week}
            scenarios={scenarios}
            scenariosError={scenariosError}
          />
          <WeekList week={family.week} />
          <PhoneLinks members={members} />
        </div>
      </div>
    </div>
  );
}
