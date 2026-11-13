// Sign-up in three steps: the family, everyone's voice, each phone's link.
// The address keeps the step (/signup?family=fam_x&step=voices), so a reload
// or the family page's "Record a voice" link lands on the right step.

import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Check } from 'lucide-react';
import { api, ApiError } from '../../api/client';
import type { FamilyCreated } from '../../api/types';
import { FamilyStep } from './FamilyStep';
import { VoiceStep } from './VoiceStep';
import { LinksStep } from './LinksStep';
import { saveFamilyId, useStoredFamilyId } from './familyStorage';
import type { SignUpMember } from './signUpTypes';
import './familyShared.scss';
import './FamilySignUpPage.scss';

type Step = 'family' | 'voices' | 'links';

const STEPS: { key: Step; label: string }[] = [
  { key: 'family', label: 'The family' },
  { key: 'voices', label: 'Voices' },
  { key: 'links', label: 'Phone links' },
];

type Loaded = { familyId: string; familyName: string; members: SignUpMember[] };

export function FamilySignUpPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const familyParam = params.get('family');
  const step: Step = !familyParam ? 'family' : params.get('step') === 'links' ? 'links' : 'voices';
  const storedFamily = useStoredFamilyId();

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Resumed from the address: load the family's members.
  useEffect(() => {
    if (!familyParam) {
      setLoaded(null);
      setLoadError(null);
      return;
    }
    let live = true;
    setLoadError(null);
    api.getFamily(familyParam).then(
      (family) => {
        if (!live) return;
        setLoaded({
          familyId: family.id,
          familyName: family.name,
          members: family.members.map((member) => ({
            id: member.id,
            name: member.name,
            phone_link: member.phone_link,
            relationship: member.relationship,
            voiceStatus: member.voice_status,
            phoneOnline: member.phone_online,
          })),
        });
      },
      (error) => {
        if (!live) return;
        setLoadError(
          error instanceof ApiError && error.status === 404
            ? 'We could not find this family. It may have been set up on another server.'
            : error instanceof ApiError
              ? error.message
              : 'The family could not be loaded. Please try again.',
        );
      },
    );
    return () => {
      live = false;
    };
  }, [familyParam]);

  const created = (result: FamilyCreated, familyName: string, relationships: string[]) => {
    saveFamilyId(result.family_id);
    setLoaded({
      familyId: result.family_id,
      familyName,
      members: result.members.map((member, index) => ({
        ...member,
        relationship: relationships[index],
        voiceStatus: 'none',
      })),
    });
    setParams({ family: result.family_id, step: 'voices' });
    window.scrollTo({ top: 0 });
  };

  const goTo = (next: Step) => {
    if (!loaded) return;
    setParams({ family: loaded.familyId, step: next });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const ready = loaded !== null && loaded.familyId === familyParam;
  const stepIndex = STEPS.findIndex((item) => item.key === step);

  return (
    <div className="signup-flow">
      <header className="signup-header">
        <div>
          <span className="eyebrow">{ready ? loaded.familyName : 'Set up Callback'}</span>
          <h1>
            {step === 'family' ? 'Set up your family' : step === 'voices' ? 'Record everyone’s voice' : 'Open Callback on each phone'}
          </h1>
        </div>
        <ol className="stepper" aria-label="Sign-up steps">
          {STEPS.map((item, index) => (
            <li
              key={item.key}
              className={index < stepIndex ? 'done' : index === stepIndex ? 'current' : undefined}
              aria-current={index === stepIndex ? 'step' : undefined}
            >
              <span className="stepper-number">{index < stepIndex ? <Check size={14} /> : index + 1}</span>
              <span>{item.label}</span>
            </li>
          ))}
        </ol>
      </header>

      {step === 'family' ? (
        <>
          {storedFamily ? (
            <div className="signup-existing">
              <span>This browser already set up a family.</span>
              <Link to={`/family/${storedFamily}`} className="text-link">
                Open its family page
              </Link>
            </div>
          ) : null}
          <FamilyStep onCreated={(result, name, relationships) => created(result, name, relationships)} />
        </>
      ) : loadError ? (
        <div className="auth-card signup-card">
          <div className="form-alert" role="alert">{loadError}</div>
          <div className="step-footer">
            <Link to="/signup" className="button button-primary">
              Start a new family
            </Link>
          </div>
        </div>
      ) : !ready ? (
        <div className="auth-card signup-card signup-loading">Loading the family…</div>
      ) : step === 'voices' ? (
        <VoiceStep
          key={loaded.familyId}
          members={loaded.members}
          onNext={() => goTo('links')}
          onBack={() => navigate(`/family/${loaded.familyId}`)}
          onReady={(memberId) =>
            setLoaded((current) =>
              current && {
                ...current,
                members: current.members.map((member) =>
                  member.id === memberId ? { ...member, voiceStatus: 'ready' } : member,
                ),
              },
            )
          }
        />
      ) : (
        <LinksStep
          familyId={loaded.familyId}
          members={loaded.members}
          onBack={() => goTo('voices')}
          onDone={() => navigate(`/family/${loaded.familyId}`)}
        />
      )}
    </div>
  );
}
