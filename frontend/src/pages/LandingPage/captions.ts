// Word-level captions for the two clips, grouped into the display lines from the brief.
// The JSON timings come from ElevenLabs; the display words add the punctuation.
import scamRaw from './captions/scam-call.json';
import revealRaw from './captions/reveal.json';

export interface Word {
  text: string;
  start: number;
  end: number;
  /** Lights green as it is spoken ("Hang up", "call back"). */
  safe?: boolean;
}

export interface Line {
  words: Word[];
  start: number;
  end: number;
  text: string;
}

interface RawWord {
  text: string;
  start: number;
  end: number;
}

const curly = (s: string) => s.replace(/'/g, '’');

function group(raw: RawWord[], lines: string[][], safeWords: Set<number> = new Set()): Line[] {
  let i = 0;
  return lines.map((display) => {
    const words: Word[] = display.map((text) => {
      const w = raw[i] ?? raw[raw.length - 1];
      const word: Word = { text: curly(text), start: w.start, end: w.end, safe: safeWords.has(i) };
      i += 1;
      return word;
    });
    return {
      words,
      start: words[0].start,
      end: words[words.length - 1].end,
      text: words.map((w) => w.text).join(' '),
    };
  });
}

export const SCAM_LINES = group(scamRaw as RawWord[], [
  ['Mum,', "it's", 'me.'],
  ['I', 'dropped', 'my', 'phone,', 'so', 'this', 'is', 'a', 'new', 'number.'],
  ["I'm", 'in', 'a', 'bit', 'of', 'trouble.'],
  ['I', 'need', 'you', 'to', 'send', 'some', 'money', 'today.'],
  ['Please', "don't", 'tell', 'Dad.'],
]);

// Words 20 to 24 are "Hang up and call back": "Hang up" and "call back" light green.
export const REVEAL_LINES = group(
  revealRaw as RawWord[],
  [
    ['That', "wasn't", 'your', 'son.'],
    ['It', 'was', 'an', 'artificial', 'voice,', 'made', 'in', 'seconds.'],
    ['Callback', 'teaches', 'your', 'family', 'what', 'to', 'do', 'next.'],
    ['Hang', 'up,', 'and', 'call', 'back.'],
  ],
  new Set([20, 21, 23, 24]),
);

export const SCAM_DURATION = 11.55;
export const REVEAL_DURATION = 8.91;
export const LESSON_AT = 7.4; // reveal clip time when "Hang up" starts

/** Index of the line showing at time t (the last line that has started), or -1. */
export function lineAt(lines: Line[], t: number): number {
  let idx = -1;
  for (let i = 0; i < lines.length; i += 1) if (t >= lines[i].start - 0.02) idx = i;
  return idx;
}

/** Count of words started by time t, across all lines (a flat index). */
export function wordsStarted(lines: Line[], t: number): number {
  let n = 0;
  for (const line of lines) for (const w of line.words) if (t >= w.start) n += 1;
  return n;
}

export const SCAM_TEXT = SCAM_LINES.map((l) => l.text).join(' ');
export const REVEAL_TEXT = REVEAL_LINES.map((l) => l.text).join(' ');
