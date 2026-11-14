import type { FamilySummary, PracticeCall } from '../types/family';

export const familyData: FamilySummary = {
  id: 'fam-204',
  name: 'The Parkers',
  safeWord: 'Sunset Stag',
  familyNumber: '+44 20 7946 2081',
  readiness: {
    before: 62,
    now: 81,
  },
  members: [
    {
      id: 'm-1',
      name: 'Martha',
      relationship: 'Mum',
      consent: true,
      voiceReady: true,
      readiness: {
        before: 55,
        now: 76,
        items: [
          { label: 'Hang up quickly', before: 50, now: 80, max: 100 },
          { label: 'Safe word habit', before: 44, now: 74, max: 100 },
          { label: 'Tell family first', before: 68, now: 82, max: 100 },
        ],
      },
      weakSpot: 'Urgent requests by text and voice.',
      quote: '“I hate to be rushed, so I need a beat to stop and check.”',
      nextPractice: 'Wednesday · Bank security story',
      accent: '#735ac8',
      plan: {
        thisWeek: 'Practice the “hang up, then call back” habit while the call is still active.',
        steps: [
          {
            when: 'Tonight',
            scenario: 'Pretend the caller says they need a payment verification code.',
            why: 'Rehearses the pause before handing over anything.',
            status: 'next',
          },
          {
            when: 'Thursday',
            scenario: 'Use the family safe word in a short role-play.',
            why: 'Builds confidence for the real call-back step.',
            status: 'scheduled',
          },
          {
            when: 'Friday',
            scenario: 'Review the family number saved in favourites.',
            why: 'Removes delay when something feels urgent.',
            status: 'done',
          },
        ],
      },
    },
    {
      id: 'm-2',
      name: 'Daniel',
      relationship: 'Adult son',
      consent: true,
      voiceReady: true,
      readiness: {
        before: 71,
        now: 88,
        items: [
          { label: 'Hang up quickly', before: 70, now: 92, max: 100 },
          { label: 'Safe word habit', before: 74, now: 89, max: 100 },
          { label: 'Tell family first', before: 69, now: 87, max: 100 },
        ],
      },
      weakSpot: 'Trusting caller ID when the voice sounds familiar.',
      quote: '“The voice sounds like my mum, so I need a clear reset step.”',
      nextPractice: 'Thursday · Policed call script',
      accent: '#4e38b2',
      plan: {
        thisWeek: 'Keep using the family number as the verification step after any suspicious call.',
        steps: [
          {
            when: 'Tonight',
            scenario: 'Practice a “new number” call from a loved one.',
            why: 'Builds the reflex to verify the number, not the voice.',
            status: 'done',
          },
          {
            when: 'Thursday',
            scenario: 'Role-play a fake police follow-up.',
            why: 'Helps spot authority pressure in real time.',
            status: 'scheduled',
          },
          {
            when: 'Friday',
            scenario: 'Share the safe word in the family chat.',
            why: 'Makes it visible and easy to recall.',
            status: 'next',
          },
        ],
      },
    },
    {
      id: 'm-3',
      name: 'Lucy',
      relationship: 'Daughter',
      consent: true,
      voiceReady: true,
      readiness: {
        before: 66,
        now: 79,
        items: [
          { label: 'Hang up quickly', before: 60, now: 78, max: 100 },
          { label: 'Safe word habit', before: 61, now: 81, max: 100 },
          { label: 'Tell family first', before: 72, now: 80, max: 100 },
        ],
      },
      weakSpot: 'Pressure to help with a “family emergency”.',
      quote: '“I need a rule for not acting while feeling worried.”',
      nextPractice: 'Friday · Family emergency story',
      accent: '#5b469b',
      plan: {
        thisWeek: 'Use a one-minute pause and safe word check before transferring money or helping.',
        steps: [
          {
            when: 'Tonight',
            scenario: 'Mock a call saying someone is arrested and needs money now.',
            why: 'Targets the emotional-pressure trigger.',
            status: 'scheduled',
          },
          {
            when: 'Thursday',
            scenario: 'Answer the family number from the practice call.',
            why: 'Reinforces that callback is part of the routine.',
            status: 'next',
          },
          {
            when: 'Friday',
            scenario: 'Review the saved family number and safe word.',
            why: 'Removes any friction during a stressful moment.',
            status: 'done',
          },
        ],
      },
    },
  ],
  week: {
    recent: ['Martha passed the “new number” drill.', 'Family safe word shared in group chat.', 'Daniel answered the bank-security practice call confidently.'],
    planned: ['Set a reminder for Friday night practice.', 'Save the family number to the top of contacts.', 'Review the scam script and safe-word check.'],
  },
};

export const practiceCallData: PracticeCall = {
  id: 'call-914',
  kind: 'practice',
  target: 'Martha',
  voiceOf: 'Daniel',
  scenario: 'relative_new_number',
  status: 'ended',
  turns: [
    { speaker: 'caller', text: 'Mum, it’s me. I’ve lost my phone and I’m calling from a new number.', t: 1, tactic: 'new_number' },
    { speaker: 'member', text: 'Daniel, is this really you? I’m not sure.', t: 6 },
    { speaker: 'caller', text: 'It’s me. I need you to send a quick code so I can get back into my account.', t: 9, tactic: 'urgency' },
    { speaker: 'member', text: 'I’m going to hang up and call the family number to be sure it’s you.', t: 14, tactic: 'safe_word' },
  ],
  tactics: [
    { key: 'new_number', label: 'New number', t: 1 },
    { key: 'urgency', label: 'Urgency', t: 9 },
    { key: 'authority', label: 'Authority', t: 12 },
  ],
  result: {
    outcome: 'asked_safe_word',
    secondsToChallenge: 11,
    lesson: 'You paused on the new number, asked for a check, and used the family safe word.',
  },
  callbackSeconds: 18,
};
