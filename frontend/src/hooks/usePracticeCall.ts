import { useMemo, useState } from 'react';

export type PracticeStage = 'ringing' | 'in_progress' | 'lesson';

export function usePracticeCall() {
  const [stage, setStage] = useState<PracticeStage>('ringing');

  const stageMessage = useMemo(() => {
    switch (stage) {
      case 'ringing':
        return 'Incoming practice call from Daniel’s cloned voice';
      case 'in_progress':
        return 'The scam script is using urgency and a new number';
      case 'lesson':
        return 'Pause, verify the number, and ask for the safe word';
      default:
        return 'Practice call ready';
    }
  }, [stage]);

  const advance = () => {
    setStage((current) => {
      if (current === 'ringing') return 'in_progress';
      if (current === 'in_progress') return 'lesson';
      return 'lesson';
    });
  };

  return { stage, stageMessage, advance };
}
