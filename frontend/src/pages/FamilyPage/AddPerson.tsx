// Adding a person to the family later (organiser only): a name and how they
// are related, then their invite straight away (the link, Copy, Share and a
// QR code). They start with no consent at all: they open the link on their
// own phone, agree there, and their welcome call starts, exactly like the
// people added at sign-up.

import { useEffect, useId, useRef, useState } from 'react';
import { CircleCheck, UserPlus } from 'lucide-react';
import { api, ApiError } from '../../api/client';
import type { MemberAdded } from '../../api/types';
import { CopyButton, fullUrl, LinkQrCode, ShareButton } from './links';
import { errorText } from './words';

const RELATIONSHIPS = [
  'grandmother', 'grandfather', 'mother', 'father', 'daughter', 'son',
  'sister', 'brother', 'partner', 'aunt', 'uncle', 'granddaughter', 'grandson', 'friend',
];

type Props = {
  familyId: string;
  familyName: string;
  /** The organiser's first name, who sends the invite. */
  organiserName: string | null;
  /** The pasted address for phones (links.tsx). */
  base: string;
  open: boolean;
  onOpen: (open: boolean) => void;
  /** Refresh the family view. */
  onAdded: () => void;
};

function addErrorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'family_full') return `${error.message} Someone has to leave before another person can join.`;
    if (error.status === 422) return 'Add their name and how they are related, like “mother”.';
  }
  return errorText(error, "That person wasn't added. Please try again.");
}

export function AddPerson({ familyId, familyName, organiserName, base, open, onOpen, onAdded }: Props) {
  const id = useId();
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [added, setAdded] = useState<MemberAdded | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const result = useRef<HTMLDivElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open && !added) nameInput.current?.focus();
  }, [open, added]);

  useEffect(() => {
    if (added) result.current?.focus();
  }, [added]);

  const reset = () => {
    setName('');
    setRelationship('');
    setError(null);
    setTried(false);
  };

  const close = () => {
    reset();
    setAdded(null);
    onOpen(false);
    window.requestAnimationFrame(() => addButton.current?.focus());
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (!name.trim() || !relationship.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const answer = await api.addMember(familyId, { name: name.trim(), relationship: relationship.trim() });
      reset();
      setAdded(answer);
      onAdded();
    } catch (failure) {
      setError(addErrorText(failure));
    } finally {
      setBusy(false);
    }
  };

  if (added) {
    const url = fullUrl(added.invite_link, base);
    return (
      <div ref={result} className="fh-add fh-add-done" role="group" tabIndex={-1} aria-labelledby={`${id}-done`}>
        <div className="fh-add-done-head">
          <CircleCheck size={22} aria-hidden="true" />
          <div>
            <strong id={`${id}-done`}>{added.name} is in the family. Send them their invite.</strong>
            <span>They open it on their phone, agree there, and their welcome call starts.</span>
          </div>
        </div>
        <div className="fh-add-invite">
          <div className="fh-add-qr">
            <LinkQrCode url={url} owner={added.name} size={140} />
          </div>
          <div className="fh-add-link">
            <code className="fh-link-text">{url}</code>
            <div className="fh-invite-actions">
              <CopyButton text={url} owner={added.name} what="invite link" />
              <ShareButton url={url} name={added.name} familyName={familyName} from={organiserName} />
            </div>
          </div>
        </div>
        <div className="fh-add-buttons">
          <button
            type="button"
            className="fh-chip-button"
            onClick={() => {
              setAdded(null);
              onOpen(true);
            }}
          >
            <UserPlus size={15} aria-hidden="true" /> Add another person
          </button>
          <button type="button" className="fh-chip-button strong" onClick={close}>
            Done
          </button>
        </div>
      </div>
    );
  }

  if (!open) {
    return (
      <button ref={addButton} type="button" className="fh-chip-button fh-add-open" onClick={() => onOpen(true)}>
        <UserPlus size={16} aria-hidden="true" /> Add a person
      </button>
    );
  }

  const nameMissing = tried && !name.trim();
  const relationshipMissing = tried && !relationship.trim();

  return (
    <form className="fh-add" onSubmit={(event) => void submit(event)} aria-labelledby={`${id}-title`} noValidate>
      <div className="fh-add-head">
        <strong id={`${id}-title`}>Add a person</strong>
        <span>You get their invite link straight away. Nothing is decided for them: they agree on their own phone.</span>
      </div>
      <div className="fh-add-fields">
        <label className="fh-field">
          <span>Name</span>
          <input
            ref={nameInput}
            value={name}
            maxLength={60}
            autoComplete="off"
            autoCapitalize="words"
            placeholder="For example Rūta"
            onChange={(event) => setName(event.target.value)}
            aria-invalid={nameMissing}
            aria-describedby={nameMissing ? `${id}-name-error` : undefined}
          />
          {nameMissing ? (
            <small className="fh-field-error" id={`${id}-name-error`}>
              Add their name.
            </small>
          ) : null}
        </label>
        <label className="fh-field">
          <span>How they are related to you</span>
          <input
            value={relationship}
            maxLength={40}
            autoComplete="off"
            list={`${id}-relationships`}
            placeholder="mother, son, friend…"
            onChange={(event) => setRelationship(event.target.value)}
            aria-invalid={relationshipMissing}
            aria-describedby={relationshipMissing ? `${id}-relationship-error` : undefined}
          />
          {relationshipMissing ? (
            <small className="fh-field-error" id={`${id}-relationship-error`}>
              Add how they are related, like “mother”.
            </small>
          ) : null}
        </label>
        <datalist id={`${id}-relationships`}>
          {RELATIONSHIPS.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      </div>
      {error ? (
        <div className="fh-alert" role="alert">
          {error}
        </div>
      ) : null}
      <div className="fh-add-buttons">
        <button type="submit" className="fh-chip-button strong" disabled={busy}>
          <UserPlus size={15} aria-hidden="true" /> {busy ? 'Adding…' : 'Add and get the invite'}
        </button>
        <button type="button" className="fh-chip-button" onClick={close} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
