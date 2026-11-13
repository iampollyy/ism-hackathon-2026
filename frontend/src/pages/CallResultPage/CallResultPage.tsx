import { CheckCircle2, Phone, ShieldCheck, TrendingUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import { practiceCallData } from '../../data/mockData';
import { Button } from '../../components/atoms/Button';

export function CallResultPage() {
  return (
    <div className="result-page container">
      <div className="result-card surface-card">
        <div className="result-header">
          <span className="status-pill good">Call complete</span>
          <div className="result-title">
            <h1>Safe action completed</h1>
            <p>Martha hung up and called the family line. The voice was an AI simulation.</p>
          </div>
        </div>

        <div className="result-grid">
          <div className="result-score">
            <ShieldCheck size={42} />
            <div>
              <small>Outcome</small>
              <strong>Asked for the safe word</strong>
            </div>
          </div>
          <div className="result-score muted-point">
            <TrendingUp size={28} />
            <div>
              <small>Challenge time</small>
              <strong>{practiceCallData.result.secondsToChallenge}s</strong>
            </div>
          </div>
        </div>

        <div className="lesson-box">
          <div className="lesson-label">Lesson</div>
          <p>{practiceCallData.result.lesson}</p>
        </div>

        <div className="checklist">
          <div className="check-item"><CheckCircle2 size={18} /> The caller used a new number.</div>
          <div className="check-item"><CheckCircle2 size={18} /> The call created urgency and pressure.</div>
          <div className="check-item"><CheckCircle2 size={18} /> The family callback was the safe verification step.</div>
        </div>

        <div className="result-actions">
          <Link to="/dashboard"><Button>Back to family plan</Button></Link>
          <Link to="/practice" className="link-button secondary">Run another drill</Link>
        </div>
      </div>
    </div>
  );
}
