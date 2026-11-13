// Start a practice: who to call, the story, whose voice, how hard, and when.
// POST /api/practice-calls, then the live call screen.

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PhoneCall } from 'lucide-react';
import { api } from '../../api/client';
import type { MemberView, ScenarioKey, ScenarioView, WeekItem } from '../../api/types';
import { callErrorText, DIFFICULTY_WORDS } from './words';

type Props = {
  familyId: string;
  members: MemberView[];
  week: WeekItem[];
  scenarios: ScenarioView[];
  scenariosError: string | null;
};

type When = 'now' | 'later';

const VOICE_GROUPS: { voice: ScenarioView['voice']; label: string }[] = [
  { voice: 'clone', label: 'In a family voice (cloned)' },
  { voice: 'library', label: "In a stranger's voice" },
];

function defaultTarget(members: MemberView[]): string {
  const candidates = members.filter((member) => !member.is_organiser);
  const pick =
    candidates.find((member) => member.consent.practice && member.phone_online) ??
    candidates.find((member) => member.consent.practice) ??
    candidates[0] ??
    members[0];
  return pick?.id ?? '';
}

export function PracticeForm({ familyId, members, week, scenarios, scenariosError }: Props) {
  const navigate = useNavigate();
  const [targetId, setTargetId] = useState('');
  const [scenarioKey, setScenarioKey] = useState<ScenarioKey | ''>('');
  const [voiceId, setVoiceId] = useState('');
  const [difficulty, setDifficulty] = useState(1);
  const [when, setWhen] = useState<When>('now');
  const [minutes, setMinutes] = useState(2);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // Sensible first choices once the family and the scenarios arrive.
  useEffect(() => {
    if (!targetId && members.length > 0) setTargetId(defaultTarget(members));
  }, [members, targetId]);
  useEffect(() => {
    if (!scenarioKey && scenarios.length > 0) {
      setScenarioKey((scenarios.find((scenario) => scenario.voice === 'clone') ?? scenarios[0]).key);
    }
  }, [scenarios, scenarioKey]);

  const target = members.find((member) => member.id === targetId);
  const scenario = scenarios.find((item) => item.key === scenarioKey);
  const usesClone = scenario?.voice === 'clone';
  const voices = useMemo(
    () => members.filter((member) => member.voice_ready && member.id !== targetId),
    [members, targetId],
  );

  // Keep the chosen voice valid when the person called or the voices change.
  useEffect(() => {
    if (voices.length === 0) {
      if (voiceId) setVoiceId('');
    } else if (!voices.some((member) => member.id === voiceId)) {
      setVoiceId(voices[0].id);
    }
  }, [voices, voiceId]);

  // An old error goes once anything it was about changes (a choice, or the phone opening).
  const targetOnline = target?.phone_online;
  const targetConsent = target?.consent.practice;
  useEffect(() => {
    setFailure(null);
  }, [targetId, scenarioKey, voiceId, difficulty, when, minutes, targetOnline, targetConsent]);

  const voiceMember = members.find((member) => member.id === voiceId);
  const activeCall = week.find(
    (item) =>
      item.member_id === targetId &&
      item.call_id &&
      (item.kind === 'practice' || item.kind === 'welcome') &&
      (item.status === 'ringing' || item.status === 'in_progress'),
  );
  const missingVoice = usesClone && voices.length === 0;
  const delayMinutes = Math.min(120, Math.max(1, Math.round(minutes) || 1));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!target || !scenario || missingVoice) return;
    setSending(true);
    setFailure(null);
    try {
      const call = await api.startPractice({
        target_member_id: target.id,
        voice_member_id: usesClone ? voiceId || null : null,
        scenario: scenario.key,
        difficulty,
        delay_seconds: when === 'now' ? 0 : delayMinutes * 60,
      });
      navigate(`/calls/${call.call_id}`);
    } catch (error) {
      setFailure(callErrorText(error, target.name, usesClone ? voiceMember?.name : undefined));
      setSending(false);
    }
  };

  return (
    <section id="practice" className="content-panel practice-panel">
      <div className="section-heading-row compact">
        <div>
          <span className="eyebrow">Start a practice</span>
          <h2>Ring someone now</h2>
        </div>
      </div>

      <form className="practice-form" onSubmit={submit}>
        <label className="input-stack">
          <span>Who to call</span>
          <select value={targetId} onChange={(event) => setTargetId(event.target.value)}>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name} ({member.relationship})
              </option>
            ))}
          </select>
        </label>
        {target && activeCall ? (
          <small className="form-hint warn">
            {target.name} {activeCall.status === 'ringing' ? 'has a call ringing now.' : 'is on a call now.'}{' '}
            <Link to={`/calls/${activeCall.call_id}`} className="text-link">
              Watch it
            </Link>
          </small>
        ) : target && !target.consent.practice ? (
          <small className="form-hint warn">{target.name} hasn't agreed to practice calls yet.</small>
        ) : target && !target.phone_online ? (
          <small className="form-hint warn">{target.name}'s phone page isn't open. Open it first, or the call can't ring.</small>
        ) : target ? (
          <small className="form-hint good">{target.name}'s phone is open.</small>
        ) : null}

        <label className="input-stack">
          <span>The story</span>
          <select
            value={scenarioKey}
            onChange={(event) => setScenarioKey(event.target.value as ScenarioKey)}
            disabled={scenarios.length === 0}
          >
            {scenarios.length === 0 ? <option value="">{scenariosError ? 'Stories not loaded yet' : 'Loading…'}</option> : null}
            {VOICE_GROUPS.map(({ voice, label }) => {
              const group = scenarios.filter((item) => item.voice === voice);
              return group.length > 0 ? (
                <optgroup key={voice} label={label}>
                  {group.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.title}
                    </option>
                  ))}
                </optgroup>
              ) : null;
            })}
          </select>
        </label>
        {scenariosError ? <small className="field-error">{scenariosError}</small> : null}
        {scenario ? (
          <small className="form-hint">
            {usesClone
              ? 'Uses a cloned family voice: the caller sounds like someone in the family.'
              : "Uses a stranger's voice, so no family voice is cloned."}
          </small>
        ) : null}

        <label className="input-stack">
          <span>Whose voice</span>
          {usesClone ? (
            <select value={voiceId} onChange={(event) => setVoiceId(event.target.value)} disabled={voices.length === 0}>
              {voices.length === 0 ? <option value="">No family voice is ready</option> : null}
              {voices.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}'s voice
                </option>
              ))}
            </select>
          ) : (
            <select value="" disabled>
              <option value="">None: a stranger's voice</option>
            </select>
          )}
        </label>
        {missingVoice ? (
          <small className="form-hint warn">
            This story needs a family voice.{' '}
            <Link to={`/signup?family=${familyId}&step=voices`} className="text-link">
              Record one
            </Link>{' '}
            or choose a stranger's story.
          </small>
        ) : null}

        <fieldset className="segmented">
          <legend>How hard the caller pushes</legend>
          {[1, 2, 3].map((level) => (
            <label key={level} className={difficulty === level ? 'on' : undefined}>
              <input
                type="radio"
                name="difficulty"
                value={level}
                checked={difficulty === level}
                onChange={() => setDifficulty(level)}
              />
              <span>{level} · {DIFFICULTY_WORDS[level]}</span>
            </label>
          ))}
        </fieldset>

        <fieldset className="when-choice">
          <legend>When</legend>
          <label className="choice">
            <input type="radio" name="when" checked={when === 'now'} onChange={() => setWhen('now')} />
            <span>Now</span>
          </label>
          <label className="choice">
            <input type="radio" name="when" checked={when === 'later'} onChange={() => setWhen('later')} />
            <span>In</span>
            <input
              type="number"
              min={1}
              max={120}
              value={minutes}
              aria-label="Minutes from now"
              onFocus={() => setWhen('later')}
              onChange={(event) => setMinutes(Number(event.target.value))}
            />
            <span>minutes</span>
          </label>
        </fieldset>
        {when === 'later' ? (
          <small className="form-hint">
            The phone rings without warning, so {target?.name ?? 'they'} won't know when. Keep their phone page open.
          </small>
        ) : null}

        {failure ? <div className="form-alert" role="alert">{failure}</div> : null}

        <button
          type="submit"
          className="button button-primary practice-submit"
          disabled={sending || !target || !scenario || missingVoice}
        >
          <PhoneCall size={16} />
          {sending
            ? 'Starting…'
            : when === 'now'
              ? `Ring ${target?.name ?? ''} now`.replace('  ', ' ')
              : `Ring ${target?.name ?? ''} in ${delayMinutes} min`}
        </button>
      </form>
    </section>
  );
}
