// Every string on the landing page, in one place so it can be reviewed at once.
// British spelling, curly apostrophes, no em dashes, no invented numbers.
// Facts and their sources: see the brief's fact sheet (docs/idea.md, README.md, backend).

export const SOURCES = [
  {
    id: 1,
    label: 'Scientific Reports, 2025',
    href: 'https://www.nature.com/articles/s41598-025-94170-3',
  },
  {
    id: 2,
    label: 'LRT, February 2026',
    href: 'https://lrt.lt/en/news-in-english/19/2852348/twenty-million-euros-15-million-calls-lithuanian-authorities-tackle-phone-swindlers',
  },
] as const;

export const REPO_URL = 'https://github.com/iampollyy/ism-hackathon-2026';
export const SIGNUP = '/signup';
// The real log-in page on feat/full-app. (This branch has no /login route: the landing
// is shown only once it is merged there; see DESIGN.md, "Before it goes live".)
export const SIGNIN = '/login';

export const head = {
  title: 'Callback: a family plan against voice-clone scams',
  description:
    'Practice calls in a relative’s cloned voice, with everyone’s consent, teach your family one habit: hang up and call back. Free for 30 days.',
  pricingTitle: 'Pricing: Callback, a family plan against voice-clone scams',
};

export const nav = {
  brand: 'Callback',
  skip: 'Skip to the content',
  links: [
    { href: '#how', label: 'How it works' },
    { href: '#shield', label: 'Shield' },
    { href: '#pricing', label: 'Pricing' },
    { href: '#banks', label: 'For banks' },
    { href: '#faq', label: 'Questions' },
  ],
  signIn: 'Sign in',
  cta: 'Start your free trial',
  soundOn: 'Sound on',
  soundOff: 'Sound off',
  menu: 'Menu',
  closeMenu: 'Close menu',
};

export const hero = {
  h1a: 'A family plan against',
  h1b: 'voice-clone scams',
  sub: 'Scammers now call parents in their child’s cloned voice. Callback trains the one habit that works however good the clone is: hang up and call back.',
  cta: 'Start your free trial',
  priceLine: (days: number) => `${days} days free, then €4.99 a month. Cancel any time.`,
  hintSound: 'Answer to hear the call. 11 seconds, sound on.',
  hintMuted: 'Answer to hear the call. 11 seconds, with captions.',
  orAnswer: 'or answer the call',
  disclosure: 'The voices on this page are artificial, made with ElevenLabs. No real person was cloned.',
  unknown: 'Unknown number',
  mobile: 'mobile',
  decline: 'Decline',
  answer: 'Answer',
  end: 'End',
  connecting: 'Connecting…',
  answerLabel: 'Answer the call (plays 11 seconds of sound)',
  declineLabel: 'Decline the call',
  endLabel: 'End the call',
  onCall: 'On a call',
  glitch: 'That voice wasn’t real.',
  hungUp: 'You hung up. That’s the habit.',
  practiceBadge: 'Practice call',
  revealTitle: 'That wasn’t your son.',
  revealSub: 'The voice was artificial.',
  remember: 'Remember',
  lesson: 'Hang up, then call back on the number you know.',
  callSon: 'Call Son',
  son: 'Son',
  calling: 'calling…',
  savedContact: 'mobile · saved contact',
  connectedNote: 'On the number you know',
  doneLine: 'That’s the habit Callback trains: hang up, then call back on the number you know.',
  replay: 'Replay the call',
  seeHow: 'See how Callback works',
  callDeclined: 'Call declined',
  declineBubble: 'Mum, it’s me. New phone, this is my number now. Can you ring me back? x',
  declineTitle: 'Declining was right.',
  declineBody:
    'Scammers often text next and ask you to ring the new number. Call back only on the number you already have.',
  hearAnyway: 'Hear the call anyway',
  noSound: 'Sound didn’t start, so the captions are running on their own.',
  trySound: 'Try sound again',
  stopped: 'The call stopped when you scrolled away.',
  closedEarly: 'You closed the call before the end.',
  closeCall: 'Close the call',
  // While the call plays, the page shows what Callback's risk light picks up (the
  // same tactic labels and risk-light reasons the back end uses).
  riskLabel: 'Callback’s risk light',
  // The done state: send the call to someone it could happen to.
  shareAsk: 'Would your mum have known?',
  share: 'Send her the call',
  shareCopied: 'Link copied. Send it to her.',
  shareFallback: 'Copy this link:',
  shareTitle: 'Callback',
  shareText: 'Would you have known this voice wasn’t real? Hear the call: 11 seconds, sound on.',
  transcriptTitle: 'Read the call as text',
  callerPrefix: 'Caller (artificial voice):',
  callbackPrefix: 'Callback (artificial voice):',
  dialogLabel: 'Call from Unknown number',
  backToPage: 'Back to the page',
  now: 'now',
  messageFrom: 'Message',
  announce: {
    answered: 'Call answered. Captions are on screen.',
    glitch: 'That voice wasn’t real.',
    callingBack: 'Calling your son back.',
    declined: 'Call declined.',
    done: 'Call finished.',
    stopped: 'The call stopped.',
    hungUp: 'You hung up. That’s the habit.',
  },
};

export const problem = {
  h2: 'Scam calls now come in your child’s voice',
  body: 'A few seconds of someone’s voice is enough to clone it. The voice sounds right, the panic sounds real, and caller ID can’t help when it’s ‘a new number’.',
  facts: [
    {
      pre: 'In a 2025 study, listeners took a cloned voice for the real person about ',
      num: '80%',
      post: ' of the time.',
      source: 1,
    },
    { pre: 'Fraudsters took more than ', num: '€20 million', post: ' from people in Lithuania last year.', source: 2 },
  ],
};

export const habit = {
  h2: 'A habit doesn’t expire',
  a: 'Hang up.',
  b: 'Call back.',
  or: 'Or ask for the family word.',
  body: 'Detectors have to catch every new cloning model, and phones don’t let apps listen to ordinary calls. A habit works however good the clone is. If your mum hangs up and calls you back on the number she knows, it doesn’t matter how good the clone was.',
};

export const story = {
  h2: 'How Callback works',
  intro:
    'One practice call from start to finish, with an example family: Rasa, her husband Jonas, and their son Lukas, who set it up.',
  rail: ['Consent', 'The call', 'Risk light', 'The reveal', 'Family page'],
  chapters: [
    {
      h3: 'Everyone says yes first',
      body: 'Lukas adds his parents and sends each of them a link. Each person agrees on their own phone, then says yes out loud on a short welcome call. Only after that yes is their voice copied from their side of the call. Without consent, no call can start.',
    },
    {
      h3: 'The phone rings on an ordinary day',
      body: 'Rasa has agreed to practice calls but doesn’t know when they’ll come. The phone rings from a new number. It’s Lukas’s voice, cloned, using the pressure real scammers use, one tactic at a time.',
    },
    {
      h3: 'A risk light reads the caller',
      body: 'A separate model hears only what the caller says. Code turns its signals into green, yellow or red as the scam builds, and Lukas can follow it live.',
      small:
        'On ten written test transcripts, it matched the tactics our agent used with 0.80 precision and 0.87 recall, in about 1.2 seconds a check.',
    },
    {
      h3: 'Every call ends with the truth',
      body: 'The moment Rasa asks for the family word, hangs up or agrees to pay, the act stops. The call tells her it was practice, gives her one line to remember and puts the real Lukas one tap away.',
    },
    {
      h3: 'The family page shows the habit growing',
      body: 'Each call is scored on what Rasa did, never on whether the voice fooled her. Her next practice targets her weak spot, and every week brings one scam doing the rounds, with what to do about it.',
    },
  ],
  cta: 'Start your free trial',
  // Chapter 1 screen: Lukas's own welcome call, with the agent's real question
  // (backend/voice_agents/welcome.md).
  rec: {
    title: 'Welcome call',
    read: 'Callback asks:',
    sentence: '‘May Callback use your voice from this call to make practice calls to your family, in your voice?’',
    recording: 'Recording your side of the call',
    people: [
      { initial: 'R', name: 'Rasa', role: 'Mum', status: 'Agreed to practice calls', done: true },
      { initial: 'J', name: 'Jonas', role: 'Dad', status: 'Agreed to practice calls', done: true },
      { initial: 'L', name: 'Lukas', role: 'You', status: 'On the welcome call…', done: false },
    ],
  },
  // Chapter 2 transcript; t is the scroll-time (seconds) the line appears at.
  transcript: [
    { who: 'Caller', text: 'Mum, it’s me. I dropped my phone, so this is a new number.', t: 0.4, chip: 'New number', chipAt: 4.24 },
    { who: 'Caller', text: 'I’m in a bit of trouble.', t: 5.62, chip: 'Emotional appeal', chipAt: 6.32 },
    { who: 'Caller', text: 'I need you to send some money today.', t: 7.5, chip: 'Urgency', chipAt: 8.88 },
    { who: 'Caller', text: 'Please don’t tell Dad.', t: 10.36, chip: 'Secrecy', chipAt: 10.7 },
    { who: 'Caller', text: 'Can you pay with gift cards? It’s quicker.', t: 11.6, chip: 'Unusual payment', chipAt: 12.4 },
    { who: 'Rasa', text: 'Before I do anything, what’s our family word?', t: 12.9, chip: null, chipAt: 0 },
  ],
  callerName: 'Unknown number',
  risk: {
    title: 'Risk light · what Lukas sees',
    green: 'Nothing worrying yet',
    yellow: 'Caller calls from a new number and plays on your feelings',
    red1: 'Caller asks for money and rushes you',
    red2: 'Caller asks for money and wants it kept secret',
    levels: { green: 'Green', yellow: 'Yellow', red: 'Red' },
  },
  reveal: {
    badge: 'Practice call from Callback',
    title: 'That was a practice. The voice was artificial.',
    praise: 'You asked for the family word. That’s exactly right.',
    remember: 'Remember',
    lesson: 'A new number and a rush for money: hang up and call back on the number you know.',
    call: 'Call Lukas',
    calling: 'calling…',
    notifyApp: 'Callback',
    notify: 'Mum called the family number after a practice.',
  },
  family: {
    title: 'Your family',
    rows: [
      {
        initial: 'R',
        name: 'Rasa',
        role: 'Mum',
        did: 'Asked for the family word · challenged in 6 s',
        next: 'Next practice: a ‘bank security’ call',
        before: 0.34,
        now: 0.78,
      },
      {
        initial: 'J',
        name: 'Jonas',
        role: 'Dad',
        did: 'Hung up and called back · challenged in 21 s',
        next: 'Next practice: a ‘police’ call',
        before: 0.22,
        now: 0.56,
      },
      { initial: 'L', name: 'Lukas', role: 'You', did: 'Voice from his welcome call · consent given', next: null, before: 0, now: 0 },
    ],
    weekTitle: 'This week’s scam',
    week: 'Callers posing as a bank’s security team ask people to move money to a ‘safe account’. Hang up and call the number on your card.',
    progressLabel: 'Habit',
  },
};

export const shield = {
  h2: 'Callback Shield warns during the call',
  lead: 'Practice builds the habit. Shield is there when a call that sounds like a scam is still going: it warns the person on screen and alerts the family automatically.',
  points: [
    { icon: 'shield', text: 'A clear warning mid-call: ‘This sounds like a scam. Hang up and call Lukas on his usual number.’' },
    { icon: 'bell', text: 'The family hears about it at once, without anyone pressing a button.' },
    { icon: 'hand', text: 'A ‘Something’s wrong’ button alerts the family any time, call or no call.' },
  ],
  note: 'Today Shield works on calls that come through Callback. Forwarding ordinary phone calls to it is next.',
  screen: {
    caller: 'Unknown number',
    time: '1:12',
    banner: 'Callback Shield',
    warning: 'This sounds like a scam. Hang up and call Lukas on his usual number.',
    hangUp: 'Hang up',
    wrong: 'Something’s wrong',
  },
  lock: {
    time: '18:42',
    date: 'Saturday 14 November',
    app: 'Callback',
    when: 'now',
    text: 'Shield alert: Mum is on a call that sounds like a scam. Call her on her usual number.',
  },
};

export const rules = {
  h2: 'The rules every call follows',
  lead: 'Practice only works if it’s fair. These rules are enforced in Callback’s code, not left to a promise.',
  items: [
    {
      icon: 'user',
      title: 'Consent from both sides',
      text: 'Each person agrees on their phone and again out loud on the welcome call. A voice is copied only after its owner says yes. A ‘no’ stops every practice call.',
    },
    { icon: 'phone', title: 'Every call reveals itself', text: 'The reveal uses fixed words, spoken in full, however the call ends.' },
    {
      icon: 'hand',
      title: 'Nothing that harms',
      text: 'No emergencies, injuries, arrests or kidnappings, and no real bank or company names. Calls last two minutes at most and stop at once if someone is upset.',
    },
    { icon: 'key', title: 'No secrets collected', text: 'We never ask for your family word. We only store whether you have one.' },
    {
      icon: 'lock',
      title: 'Voices stay in the family',
      text: 'Each clone is used only for your family’s practice calls, and deleted on request or when that person opts out.',
    },
    { icon: 'check', title: 'Scored on actions', text: 'Each call is scored on what the person did. Nobody sees a list of who was fooled.' },
  ],
  // The same question the welcome agent asks, and Lukas's answer.
  consentLabel: 'A spoken yes on the welcome call',
  consentAsker: 'Callback',
  consentSentence: '‘May Callback use your voice from this call to make practice calls to your family, in your voice?’',
  consentWho: 'Lukas',
  consentAnswer: '‘Yes.’',
  consentDone: 'Spoken yes on the welcome call',
};

export const pricing = {
  h2: 'Family plans from €4.99 a month',
  lead: (days: number) =>
    `Every plan starts with ${days} days free. Pay monthly or yearly, or get Callback free through a partner bank.`,
  partnerRow: 'For banks: priced per enrolled family.',
  // Overrides the server's note on the bank card: no partner bank is signed yet.
  bankNote: 'Free when your bank partners with Callback. Enter the code from your bank.',
  partnerLink: 'See Callback for banks',
  demoNote: 'This is a demo: choosing a plan takes no payment and asks for no card details.',
  pageIntro: 'One plan for the whole family. Every plan starts free.',
};

export const banks = {
  h2: 'Callback for banks',
  lead: 'Banks are being made liable for scam losses. Callback is the practice you can give your customers’ families.',
  body: 'The UK has required scam refunds since October 2024. In February 2026, Lithuania’s central bank proposed that banks compensate customers when they fail to stop a suspicious payment.',
  gets: ['Free enrolment for your customers’ families', 'A prevention step you can show customers and your regulator'],
  priceLine: 'Priced per enrolled family.',
  pilot: {
    title: 'How a pilot works',
    steps: [
      'You give each customer a Callback code in your app or online banking.',
      'Their family joins free with the code and practises at home.',
      'Each month you get a report, and you pay only for families who joined with your code.',
    ],
  },
  // The measures Callback already records for every practice call; no figures until a pilot has them.
  report: {
    title: 'What your report shows',
    items: [
      'Families enrolled with your code',
      'Practice calls completed',
      'The share of calls handled the safe way',
      'The median seconds to challenge the caller',
      'Shield alerts raised',
    ],
    countsOnly: 'Counts only: never names, recordings or transcripts.',
  },
  evaluation:
    'In a pilot we compare enrolled customers with a matched group on your own scam claims. We don’t claim a drop in losses yet.',
  form: {
    title: 'Talk to the Callback team',
    email: 'Work email',
    org: 'Bank or organisation',
    message: 'Message (optional)',
    messageHint: 'Your name, your role and what you’d like to know',
    submit: 'Talk to us',
    sending: 'Sending…',
    under: 'We’ll reply to this email.',
    successTitle: (org: string) => `Thanks, ${org}.`,
    success: (email: string) => `Your note is saved. We’ll reply to ${email}.`,
  },
};

// Inside the banks section (#data), linked from the footer. Every line is what the code
// does today (backend/app/models.py, routers/voice.py, services/voice_sample.py, config.py).
export const dataProtection = {
  title: 'Data protection',
  lead: 'What Callback keeps about every family, who handles it, and what a bank sees.',
  items: [
    {
      term: 'What we store',
      text: 'Names, the organiser’s email, phone numbers if given, consent and survey answers, call transcripts and results, and each person’s voice clone with the recording it came from. A voice is kept only after its owner’s spoken yes. Never the family word.',
    },
    {
      term: 'Who processes it',
      text: 'ElevenLabs runs the voices and the calls. Anthropic and OpenAI read transcripts to plan practice, score calls and run the risk light. Firecrawl reads only public news.',
    },
    { term: 'Deleting a voice', text: 'A clone is deleted on request, or when that person opts out.' },
    { term: 'What a bank receives', text: 'Aggregate counts only, for the families who joined with its code.' },
  ],
  next: 'Before any bank pilot: EU hosting, a data processing agreement and a fixed retention period.',
};

export const errors = {
  email: 'That email address doesn’t look complete. Check it and send again.',
  emailEmpty: 'Add your email.',
  workEmailEmpty: 'Add your work email.',
  org: 'Add the name of your bank or organisation.',
  limit: 'We’ve had more messages than we can take today. Please try again tomorrow.',
  network: 'We couldn’t reach Callback. Check your connection and try again.',
  other: 'Something went wrong on our side. Please try again in a minute.',
};

export const faq = {
  h2: 'Questions families ask',
  items: [
    {
      q: 'Is it all right to call my parents in a cloned voice?',
      a: 'Only with everyone’s agreement. Each person agrees on their phone and again out loud on the welcome call, and a voice is copied only after its owner says yes. Every call says it was practice before it ends.',
    },
    {
      q: 'Won’t a practice call frighten my mum?',
      a: 'It’s short, and it ends kindly. Calls last two minutes at most, never involve injuries, arrests or kidnappings, and stop at once if she sounds upset or says stop. Then she can ring you straight away.',
    },
    {
      q: 'Do you need our family word?',
      a: 'No. We never ask for it and never store it, only whether your family has one. That’s why the practice voice can’t answer when she asks for it.',
    },
    {
      q: 'Do my parents need a smartphone?',
      a: 'Today, yes. Each person keeps a Callback page open on their phone, and the practice call rings there. Ringing ordinary phone calls, with nothing to install, comes next.',
    },
    {
      q: 'What happens to the voice recordings?',
      a: 'Each clone is used only for your family’s practice calls. You can delete it at any time, and it’s deleted when that person opts out.',
    },
    { q: 'Which languages does it speak?', a: 'English for now. European languages come next, starting with Lithuanian.' },
    {
      q: 'Why not just block or detect fake calls?',
      a: 'Phones don’t let apps listen to ordinary calls, and every new cloning model resets a detector. A habit still works when the fake is perfect. Callback Shield adds a warning on calls that come through Callback.',
    },
    {
      q: 'Does practice stop people losing money?',
      a: 'Nobody has shown that for families yet, and we don’t claim it. We measure one habit, call by call: what each person did, and how many seconds it took them to challenge the caller.',
    },
    {
      q: 'What does it cost?',
      a: '€4.99 a month or €49 a year after a 30-day free trial, or free through a partner bank. This demo takes no payment and asks for no card details.',
    },
  ],
};

export const close = {
  h2: 'Practice calls for your family, free for 30 days',
  body: 'Add your family and send their links. Each person takes a short welcome call, and Callback handles the rest. Cancel any time.',
  cta: 'Start your free trial',
  waitText:
    'Today Callback rings a web page on each person’s phone. Join the waitlist to hear when it rings real phones, and when it speaks Lithuanian.',
  email: 'Email',
  submit: 'Join the waitlist',
  sending: 'Joining…',
  successTitle: 'You’re on the list.',
  success: (email: string) => `We’ll email ${email} when Callback rings real phones.`,
  phone: {
    name: 'Mum',
    sub: 'mobile · saved contact',
    answerLabel: 'Answer the call from Mum',
    note: 'On the number you know',
  },
};

export const footer = {
  tagline: 'A family plan against voice-clone scams.',
  links: [
    { href: '#how', label: 'How it works' },
    { href: '#shield', label: 'Callback Shield' },
    { href: '#pricing', label: 'Pricing' },
    { href: '#banks', label: 'For banks' },
    { href: '#faq', label: 'Questions' },
    { href: '#data', label: 'Data protection' },
  ],
  signIn: 'Sign in',
  source: 'Source code',
  disclosure: 'The voices on this page are artificial, made with ElevenLabs library voices. No real person was cloned.',
  sourcesTitle: 'Sources',
  built: 'Built at Unfair Weekend 2026 in Vilnius by team Plan C.',
  copyright: '© 2026 Callback',
};

export const mobileBar = { cta: 'Start your free trial' };
