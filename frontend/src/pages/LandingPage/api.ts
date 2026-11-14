// The landing page's two calls to the back end, kept here so the shared
// src/api client (changed by other tracks) stays untouched.
// Error shape follows the back end: { error: { code, message } }.

export interface PricePlan {
  key: string;
  name: string;
  price: string;
  price_eur: number | null;
  period: string | null;
  note: string;
  features: string[];
  cta: string;
  choosable: boolean;
}

export interface Pricing {
  trial_days: number;
  currency: string;
  plans: PricePlan[];
  demo_note: string;
}

// Identical to backend/app/routers/billing.py today; shown at once, replaced when the server answers.
export const FALLBACK_PRICING: Pricing = {
  trial_days: 30,
  currency: 'EUR',
  demo_note: 'This is a demo: choosing a plan takes no payment and asks for no card details.',
  plans: [
    {
      key: 'family_monthly',
      name: 'Family',
      price: '€4.99 a month',
      price_eur: 4.99,
      period: 'month',
      note: 'After a 30-day free trial. Cancel any time.',
      features: [
        'Up to 6 family members',
        'Practice drills in your family’s own voices',
        'Callback Shield on calls',
        'Weekly scam news and lessons',
      ],
      cta: 'Choose monthly',
      choosable: true,
    },
    {
      key: 'family_yearly',
      name: 'Family, yearly',
      price: '€49 a year',
      price_eur: 49,
      period: 'year',
      note: 'Two months free compared with monthly.',
      features: ['Everything in Family', 'Best value for a whole year of practice'],
      cta: 'Choose yearly',
      choosable: true,
    },
    {
      key: 'bank',
      name: 'Through your bank',
      price: 'Free',
      price_eur: null,
      period: null,
      note: 'Free for customers of partner banks. Enter the code from your bank.',
      features: ['Everything in Family', 'Paid for by your bank'],
      cta: 'Enter bank code',
      choosable: true,
    },
    {
      key: 'partner',
      name: 'For banks',
      price: 'Per enrolled family',
      price_eur: null,
      period: null,
      note: 'Banks are being made liable for scam losses. Give your customers’ families the practice.',
      features: ['Your customers enrol for free', 'Habit reports per enrolled family', 'Your brand on the welcome call'],
      cta: 'Talk to us',
      choosable: false,
    },
  ],
};

const curly = (s: string) => s.replace(/'/g, '’');

function isPricing(v: unknown): v is Pricing {
  const p = v as Pricing;
  return !!p && typeof p.trial_days === 'number' && Array.isArray(p.plans) && typeof p.demo_note === 'string';
}

export async function getPricing(signal?: AbortSignal): Promise<Pricing> {
  const res = await fetch('/api/pricing', { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`pricing ${res.status}`);
  const body: unknown = await res.json();
  if (!isPricing(body)) throw new Error('pricing shape');
  return {
    ...body,
    demo_note: curly(body.demo_note),
    plans: body.plans.map((p) => ({
      ...p,
      name: curly(p.name),
      note: curly(p.note),
      features: p.features.map(curly),
    })),
  };
}

export type WaitlistError = 'email' | 'limit' | 'network' | 'other';

export interface WaitlistInput {
  email: string;
  kind: 'family' | 'bank';
  source: string;
  organisation?: string;
  message?: string;
}

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function emailLooksValid(email: string) {
  return email.length >= 5 && email.length <= 200 && EMAIL_RE.test(email);
}

/** Resolves on a 2xx; otherwise rejects with one of the WaitlistError codes. */
export async function joinWaitlist(input: WaitlistInput): Promise<void> {
  const body: Record<string, string> = { email: input.email, kind: input.kind, source: input.source };
  if (input.organisation) body.organisation = input.organisation;
  if (input.message) body.message = input.message;
  let res: Response;
  try {
    res = await fetch('/api/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw 'network' satisfies WaitlistError;
  }
  if (res.ok) return;
  if (res.status === 422) throw 'email' satisfies WaitlistError;
  if (res.status === 429) throw 'limit' satisfies WaitlistError;
  throw 'other' satisfies WaitlistError;
}
