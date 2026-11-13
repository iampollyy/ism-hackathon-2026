// Step 1: the family name, the family-word tick and one row per member.
// Sends POST /api/families. The family word itself is never asked for.

import { useState, type FormEvent } from 'react';
import { ArrowRight, KeyRound, Plus, Trash2 } from 'lucide-react';
import { api, ApiError } from '../../api/client';
import type { FamilyCreate, FamilyCreated } from '../../api/types';

const MIN_MEMBERS = 2;
const MAX_MEMBERS = 12;
const RELATIONSHIPS = [
  'grandmother', 'grandfather', 'mother', 'father', 'daughter', 'son',
  'sister', 'brother', 'partner', 'aunt', 'uncle', 'granddaughter', 'grandson', 'friend',
];

type Row = { key: number; name: string; relationship: string; consent: boolean };
type Errors = Record<string, string>;

let nextKey = 0;
const newRow = (): Row => ({ key: nextKey++, name: '', relationship: '', consent: false });

type Props = { onCreated: (created: FamilyCreated, familyName: string, relationships: string[]) => void };

export function FamilyStep({ onCreated }: Props) {
  const [familyName, setFamilyName] = useState('');
  const [wordAgreed, setWordAgreed] = useState(false);
  const [rows, setRows] = useState<Row[]>(() => [newRow(), newRow()]);
  const [organiser, setOrganiser] = useState<number>(() => rows[0].key);
  const [errors, setErrors] = useState<Errors>({});
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const update = (key: number, change: Partial<Row>) => {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)));
    setErrors((current) => {
      const next = { ...current };
      if ('name' in change) delete next[`name-${key}`];
      if ('relationship' in change) delete next[`relationship-${key}`];
      return next;
    });
  };

  const remove = (key: number) => {
    const remaining = rows.filter((row) => row.key !== key);
    setRows(remaining);
    if (organiser === key && remaining.length > 0) setOrganiser(remaining[0].key);
  };

  const validate = (): Errors => {
    const found: Errors = {};
    if (!familyName.trim()) found.familyName = 'Give your family a name, for example "The Kovacs".';
    const seen = new Map<string, number>();
    for (const row of rows) {
      const name = row.name.trim();
      if (!name) found[`name-${row.key}`] = 'Add a name.';
      if (!row.relationship.trim()) found[`relationship-${row.key}`] = 'Add how they are related.';
      const lower = name.toLowerCase();
      if (name && seen.has(lower)) {
        found[`name-${row.key}`] = 'Two people have this name. Add an initial to tell them apart.';
      }
      seen.set(lower, row.key);
    }
    if (!rows.some((row) => row.key === organiser)) found.organiser = 'Choose who the organiser is.';
    return found;
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    setFailure(null);
    if (Object.keys(found).length > 0) return;

    const body: FamilyCreate = {
      name: familyName.trim(),
      safe_word_set: wordAgreed,
      members: rows.map((row) => ({
        name: row.name.trim(),
        relationship: row.relationship.trim(),
        is_organiser: row.key === organiser,
        consent_practice: row.consent,
      })),
    };
    setSending(true);
    try {
      const created = await api.createFamily(body);
      onCreated(created, body.name, body.members.map((member) => member.relationship));
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : 'Something went wrong. Please try again.');
      setSending(false);
    }
  };

  return (
    <div className="signup-family-grid">
      <form className="auth-card signup-card" onSubmit={submit} noValidate>
        <div className="auth-card-header">
          <div>
            <small>Step 1 of 3</small>
            <h2>Your family</h2>
          </div>
          <span className="mini-badge">{rows.length} people</span>
        </div>

        <div className="auth-form">
          <label className="input-stack">
            <span>Family name</span>
            <input
              type="text"
              value={familyName}
              maxLength={80}
              placeholder="The Kovacs"
              onChange={(event) => {
                setFamilyName(event.target.value);
                setErrors(({ familyName: _, ...rest }) => rest);
              }}
              aria-invalid={Boolean(errors.familyName)}
            />
            {errors.familyName ? <small className="field-error">{errors.familyName}</small> : null}
          </label>

          <div className={`family-word-tick${wordAgreed ? ' on' : ''}`}>
            <label className="checkbox-row">
              <input type="checkbox" checked={wordAgreed} onChange={(event) => setWordAgreed(event.target.checked)} />
              <span>
                <strong>Our family has agreed a family word</strong>
                <small>
                  <KeyRound size={13} /> Don't type it anywhere, not even here. Callback never asks for it.
                </small>
              </span>
            </label>
          </div>

          <div className="member-rows">
            <div className="member-rows-head">
              <strong>Who is in the family?</strong>
              <small>
                Hand the laptop over so each person ticks their own box. Without the tick, no practice call reaches them.
              </small>
            </div>

            {rows.map((row, index) => (
              <fieldset key={row.key} className="member-row">
                <legend>Person {index + 1}</legend>
                <div className="member-row-fields">
                  <label className="input-stack">
                    <span>Name</span>
                    <input
                      type="text"
                      value={row.name}
                      maxLength={60}
                      placeholder={index === 0 ? 'Jon' : 'Sara'}
                      onChange={(event) => update(row.key, { name: event.target.value })}
                      aria-invalid={Boolean(errors[`name-${row.key}`])}
                    />
                    {errors[`name-${row.key}`] ? <small className="field-error">{errors[`name-${row.key}`]}</small> : null}
                  </label>
                  <label className="input-stack">
                    <span>Relationship</span>
                    <input
                      type="text"
                      value={row.relationship}
                      maxLength={40}
                      list="relationship-options"
                      placeholder={index === 0 ? 'son' : 'grandmother'}
                      onChange={(event) => update(row.key, { relationship: event.target.value })}
                      aria-invalid={Boolean(errors[`relationship-${row.key}`])}
                    />
                    {errors[`relationship-${row.key}`] ? (
                      <small className="field-error">{errors[`relationship-${row.key}`]}</small>
                    ) : null}
                  </label>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => remove(row.key)}
                    disabled={rows.length <= MIN_MEMBERS}
                    aria-label={`Remove person ${index + 1}`}
                    title={rows.length <= MIN_MEMBERS ? 'A family needs at least two people' : 'Remove'}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>

                <div className="member-row-ticks">
                  <label className="choice">
                    <input
                      type="radio"
                      name="organiser"
                      checked={organiser === row.key}
                      onChange={() => setOrganiser(row.key)}
                    />
                    <span>This is me (the organiser)</span>
                  </label>
                  <label className="choice">
                    <input
                      type="checkbox"
                      checked={row.consent}
                      onChange={(event) => update(row.key, { consent: event.target.checked })}
                    />
                    <span>I agree to receive practice calls without knowing when</span>
                  </label>
                </div>
              </fieldset>
            ))}
            <datalist id="relationship-options">
              {RELATIONSHIPS.map((option) => <option key={option} value={option} />)}
            </datalist>
            {errors.organiser ? <small className="field-error">{errors.organiser}</small> : null}

            <button
              type="button"
              className="button button-ghost add-member"
              onClick={() => setRows((current) => [...current, newRow()])}
              disabled={rows.length >= MAX_MEMBERS}
            >
              <Plus size={16} /> Add a family member
            </button>
          </div>

          {failure ? <div className="form-alert" role="alert">{failure}</div> : null}
          {Object.keys(errors).length > 0 ? (
            <div className="form-alert" role="alert">Some details are missing. Check the fields marked in red.</div>
          ) : null}

          <button type="submit" className="button button-primary auth-submit" disabled={sending}>
            {sending ? 'Creating your family…' : 'Create the family'}
            <ArrowRight size={16} />
          </button>
        </div>
      </form>

      <aside className="auth-panel auth-copy-panel signup-aside">
        <span className="eyebrow">How it works</span>
        <ol className="signup-how">
          <li>
            <strong>Everyone agrees first.</strong>
            <span>Each person ticks their own box, and records a minute of their voice that starts with their consent.</span>
          </li>
          <li>
            <strong>A practice call, now and then.</strong>
            <span>Callback rings someone in a relative's voice, with a made-up story. It always says at the end that it was a practice.</span>
          </li>
          <li>
            <strong>One habit to learn.</strong>
            <span>Hang up and call back on the family number, or ask for the family word.</span>
          </li>
        </ol>
      </aside>
    </div>
  );
}
