import { MessageSquareText } from 'lucide-react';
import type { NewsView } from '../../api/types';
import { possessive, shortDate } from '../LearnPage/shared';

type Note = NewsView['notes'][number];

// Brand colours for the initials, in turn (accent, good, navy-soft, warning ink).
const AVATAR_COLOURS = ['#e0475e', '#138653', '#4e38b2', '#9a6a12'];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : name.slice(0, 2);
  return letters.toUpperCase();
}

/** Each member's latest weekly note, as it arrived on their phone. */
export function NotesPanel({ notes }: { notes: Note[] }) {
  return (
    <section className="np-panel np-notes" aria-labelledby="np-notes-title">
      <h2 id="np-notes-title">Notes to the family</h2>
      {notes.length === 0 ? (
        <div className="np-notes__empty">
          <MessageSquareText size={22} aria-hidden />
          <p>
            No notes yet. Once a week, Callback may send each person a short note on their phone, written from this
            briefing. The latest one for each person shows here.
          </p>
        </div>
      ) : (
        <>
          <p className="np-panel__lede">Each person's latest weekly note, as it arrived on their phone.</p>
          <ul className="np-notes__list">
            {notes.map((note, index) => (
              <li key={note.member.id} className="np-note">
                <span
                  className="np-note__avatar"
                  style={{ background: AVATAR_COLOURS[index % AVATAR_COLOURS.length] }}
                  aria-hidden
                >
                  {initials(note.member.name)}
                </span>
                <div className="np-note__body">
                  <p className="np-note__head">
                    <strong>{possessive(note.member.name)} phone</strong>
                    <time dateTime={note.when}>{shortDate(note.when)}</time>
                  </p>
                  <p className="np-note__text">{note.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
