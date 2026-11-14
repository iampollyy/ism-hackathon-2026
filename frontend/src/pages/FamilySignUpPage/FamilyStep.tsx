// Step 1: the family name, the family-word tick and one row per person.
// Sends POST /api/families; the logged-in session links the family to the
// account. The family word itself is never asked for.

import { useState, type FormEvent } from 'react';
import { ArrowRight, KeyRound, LoaderCircle, Plus, Trash2 } from 'lucide-react';
import { api, ApiError } from '../../api/client';
import type { FamilyCreate, FamilyCreated } from '../../api/types';

const MIN_MEMBERS = 2;
/** The Family plan covers up to six people. */
const MAX_MEMBERS = 6;
const RELATIONSHIPS = [
  'grandmother', 'grandfather', 'mother', 'father', 'daughter', 'son',
  'sister', 'brother', 'partner', 'aunt', 'uncle', 'granddaughter', 'grandson', 'friend',
];

type Row = { key: number; name: string; relationship: string; consent: boolean };
type Errors = Record<string, string>;

let nextKey = 0;
const newRow = (name = ''): Row => ({ key: nextKey++, name, relationship: '', consent: false });

type Props = {
  /** The organiser's own name, from their account, to start the first row. */
  organiserName?: string;
  onCreated: (created: FamilyCreated) => void;
};

export function FamilyStep({ organiserName = '', onCreated }: Props) {
  const [familyName, setFamilyName] = useState('');
  const [wordAgreed, setWordAgreed] = useState(false);
  const [rows, setRows] = useState<Row[]>(() => [newRow(organiserName), newRow()]);
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
    setErrors(({ [`name-${key}`]: _name, [`relationship-${key}`]: _relationship, ...rest }) => rest);
  };

  const validate = (): Errors => {
    const found: Errors = {};
    if (!familyName.trim()) found.familyName = 'Give your family a name, for example “The Kovacs”.';
    const seen = new Set<string>();
    for (const row of rows) {
      const name = row.name.trim();
      if (!name) found[`name-${row.key}`] = 'Add a name.';
      if (!row.relationship.trim()) found[`relationship-${row.key}`] = 'Add how they are related, like “mother”.';
      const lower = name.toLowerCase();
      if (name && seen.has(lower)) {
        found[`name-${row.key}`] = 'Two people have this name. Add an initial to tell them apart.';
      }
      seen.add(lower);
    }
    if (!rows.some((row) => row.key === organiser)) found.organiser = 'Choose which person is you.';
    return found;
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    setFailure(null);
    if (Object.keys(found).length > 0) {
      // After the fields are marked, take the person to the first one.
      window.requestAnimationFrame(() =>
        document.querySelector<HTMLElement>('.onb-family [aria-invalid="true"]')?.focus(),
      );
      return;
    }

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
      onCreated(await api.createFamily(body));
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : 'Something went wrong. Please try again.');
      setSending(false);
    }
  };

  const errorCount = Object.keys(errors).length;

  return (
    <div className="onb-family-grid">
      <form className="onb-card onb-family" onSubmit={submit} noValidate>
        <div className="onb-field">
          <label htmlFor="family-name">Family name</label>
          <input
            id="family-name"
            type="text"
            value={familyName}
            maxLength={80}
            placeholder="The Kovacs"
            autoFocus
            onChange={(event) => {
              setFamilyName(event.target.value);
              setErrors(({ familyName: _, ...rest }) => rest);
            }}
            aria-invalid={Boolean(errors.familyName)}
            aria-describedby={errors.familyName ? 'family-name-error' : undefined}
          />
          {errors.familyName ? (
            <small className="field-error" id="family-name-error">
              {errors.familyName}
            </small>
          ) : null}
        </div>

        <label className={`onb-word${wordAgreed ? ' on' : ''}`}>
          <input type="checkbox" checked={wordAgreed} onChange={(event) => setWordAgreed(event.target.checked)} />
          <span>
            <strong>We have agreed a family word</strong>
            <small>
              <KeyRound size={14} aria-hidden="true" /> A word only your family knows, to ask for on a strange call. Don’t
              type it anywhere, not even here: Callback never asks for it.
            </small>
          </span>
        </label>

        <fieldset className="onb-people">
          <legend>
            <strong>Who is in the family?</strong>
            <small>
              Up to {MAX_MEMBERS} people. Everyone gets their own invite link next, and agrees to practice calls on their
              own phone when they join.
            </small>
          </legend>

          {rows.map((row, index) => (
            <div key={row.key} className={`onb-person${organiser === row.key ? ' me' : ''}`}>
              <div className="onb-person-fields">
                <div className="onb-field">
                  <label htmlFor={`name-${row.key}`}>Name</label>
                  <input
                    id={`name-${row.key}`}
                    type="text"
                    value={row.name}
                    maxLength={60}
                    placeholder={index === 0 ? 'Jon' : index === 1 ? 'Sara' : ''}
                    autoComplete="off"
                    onChange={(event) => update(row.key, { name: event.target.value })}
                    aria-invalid={Boolean(errors[`name-${row.key}`])}
                  />
                  {errors[`name-${row.key}`] ? <small className="field-error">{errors[`name-${row.key}`]}</small> : null}
                </div>
                <div className="onb-field">
                  <label htmlFor={`relationship-${row.key}`}>Relationship</label>
                  <input
                    id={`relationship-${row.key}`}
                    type="text"
                    value={row.relationship}
                    maxLength={40}
                    list="relationship-options"
                    placeholder={index === 0 ? 'son' : index === 1 ? 'mother' : ''}
                    autoComplete="off"
                    onChange={(event) => update(row.key, { relationship: event.target.value })}
                    aria-invalid={Boolean(errors[`relationship-${row.key}`])}
                  />
                  {errors[`relationship-${row.key}`] ? (
                    <small className="field-error">{errors[`relationship-${row.key}`]}</small>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="onb-remove"
                  onClick={() => remove(row.key)}
                  disabled={rows.length <= MIN_MEMBERS}
                  aria-label={`Remove ${row.name.trim() || `person ${index + 1}`}`}
                  title={rows.length <= MIN_MEMBERS ? 'A family needs at least two people' : 'Remove'}
                >
                  <Trash2 size={17} />
                </button>
              </div>

              <div className="onb-person-ticks">
                <label className="onb-choice">
                  <input
                    type="radio"
                    name="organiser"
                    checked={organiser === row.key}
                    onChange={() => setOrganiser(row.key)}
                  />
                  <span>This is me, the organiser</span>
                </label>
                <label className="onb-choice">
                  <input
                    type="checkbox"
                    checked={row.consent}
                    onChange={(event) => update(row.key, { consent: event.target.checked })}
                  />
                  <span>
                    I agree to receive practice calls without knowing when
                    {organiser !== row.key ? (
                      <em> Only {row.name.trim() || 'they'} should tick this, if they’re with you.</em>
                    ) : null}
                  </span>
                </label>
              </div>
            </div>
          ))}
          <datalist id="relationship-options">
            {RELATIONSHIPS.map((option) => <option key={option} value={option} />)}
          </datalist>
          {errors.organiser ? <small className="field-error">{errors.organiser}</small> : null}

          {rows.length < MAX_MEMBERS ? (
            <button type="button" className="onb-add" onClick={() => setRows((current) => [...current, newRow()])}>
              <Plus size={17} aria-hidden="true" /> Add a person
            </button>
          ) : (
            <small className="onb-max">That’s everyone a family plan covers.</small>
          )}
        </fieldset>

        {failure ? (
          <div className="form-alert" role="alert">
            {failure}
          </div>
        ) : null}
        {errorCount > 0 && !failure ? (
          <div className="form-alert" role="alert">
            A few details are missing. They’re marked in red above.
          </div>
        ) : null}

        <button type="submit" className="button button-primary onb-submit" disabled={sending}>
          {sending ? (
            <>
              <LoaderCircle size={18} className="spin" aria-hidden="true" /> Setting up your family…
            </>
          ) : (
            <>
              Create the family and get invite links <ArrowRight size={18} aria-hidden="true" />
            </>
          )}
        </button>
      </form>

      <aside className="onb-aside" aria-labelledby="onb-next-title">
        <h2 id="onb-next-title">What happens next</h2>
        <ol className="onb-next">
          <li>
            <strong>Everyone gets a link</strong>
            <span>Send it by WhatsApp or show a QR code. They open it on their own phone.</span>
          </li>
          <li>
            <strong>A short welcome call</strong>
            <span>
              A friendly voice explains Callback, asks for their consent out loud and asks a few questions. Their voice
              is only cloned after a clear yes.
            </span>
          </li>
          <li>
            <strong>Practice, now and then</strong>
            <span>
              Once you turn protection on, drills ring at random times in a relative’s voice, and always say at the end
              that it was practice.
            </span>
          </li>
        </ol>
      </aside>
    </div>
  );
}
