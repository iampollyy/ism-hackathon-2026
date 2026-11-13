import { useState } from 'react';
import {
  ArrowLeft,
  CircleDashed,
  MessageSquareText,
  ShieldCheck,
  Volume2,
} from 'lucide-react';
import { Link } from 'react-router-dom';

const transcriptRows = [
  { speaker: 'AI using Daniel’s voice', time: '0:06', text: 'Hi Mom, it’s me. I’m calling from someone else’s phone—mine was damaged.', tag: 'New phone number', tagClass: 'soft-orange' },
  { speaker: 'Eleanor', time: '0:12', text: 'Daniel? You sound upset. What happened?', tag: null },
  { speaker: 'AI using Daniel’s voice', time: '0:19', text: 'I was in a small accident. I’m okay, but I need to sort something out right now.', tag: 'Emotional manipulation', tagClass: 'soft-orange' },
];

export function PracticeCallPage() {
  const [stage, setStage] = useState<'live' | 'in-progress'>('live');

  return (
    <>
        <header className="practice-header">
          <Link to="/dashboard" className="header-back">
            <ArrowLeft size={18} />
            <span>Back</span>
          </Link>

          <div className="header-center">
            <span className="live-kicker">Live practice</span>
            <h1>Family safety simulation</h1>
          </div>

          <div className="header-badge">
            <ShieldCheck size={15} />
            <span>Safe training environment</span>
          </div>
        </header>

        <div className="practice-grid">
          <section className="call-stage">
            <div className="stage-controls">
              <button
                className={`stage-button ${stage === 'live' ? 'active' : ''}`}
                type="button"
                onClick={() => setStage('live')}
              >
                <Volume2 size={15} />
                <span>Live</span>
              </button>
              <button
                className={`stage-button ${stage === 'in-progress' ? 'active' : ''}`}
                type="button"
                onClick={() => setStage('in-progress')}
              >
                <MessageSquareText size={15} />
                <span>Call in progress</span>
              </button>
            </div>

            <div className="call-visual-wrap">
              <div className="call-circle">
                <span>DM</span>
              </div>
            </div>

            <div className="call-meta">
              <span className="small-label">Simulated voice of</span>
              <h2>Daniel Morgan</h2>
              <p>Calling Eleanor Morgan</p>
            </div>

            <div className="call-footer-row">
              <div className="duration-block">
                <span>Call duration</span>
                <strong>00:20</strong>
            </div>
              <Link to="/result" className="end-simulation">
                <CircleDashed size={17} />
                <span>End simulation</span>
              </Link>
            </div>
          </section>

          <section className="live-transcript">
            <div className="transcript-header">
              <div className="transcript-title-wrap">
                <MessageSquareText size={17} />
                <span>Live transcript</span>
              </div>

              <div className="listening-pill">
                <span className="pulse-dot" />
                <span>Listening</span>
            </div>
            </div>

            <div className="transcript-body">
              {transcriptRows.map((entry) => (
                <div key={`${entry.speaker}-${entry.time}`} className="transcript-row">
                  <div className="row-header">
                    <div className="speaker-badge">{entry.speaker.startsWith('AI') ? 'AI using Daniel’s voice' : entry.speaker}</div>
                    <time>{entry.time}</time>
                </div>
                  <p>{entry.text}</p>
                  {entry.tag ? <span className={`tag-chip ${entry.tagClass ?? ''}`}>{entry.tag}</span> : null}
                </div>
              ))}
            </div>
          </section>
        </div>
    </>
  );
}
