import { PhaseGateView } from '@/types';

interface PhaseProgressBarProps {
  phases: PhaseGateView[];
  currentPhase: string;
}

function PhaseProgressBar({ phases: _phases, currentPhase }: PhaseProgressBarProps): JSX.Element {
  const phaseOrder = ['Phase 0', 'Phase 1', 'Phase 2', 'Phase 3', 'Phase 4'];

  const getPhaseStatus = (phase: string): 'completed' | 'current' | 'future' => {
    const currentIndex = phaseOrder.indexOf(currentPhase);
    const phaseIndex = phaseOrder.indexOf(phase);

    if (phaseIndex < currentIndex) return 'completed';
    if (phaseIndex === currentIndex) return 'current';
    return 'future';
  };

  const getPhaseColors = (
    status: 'completed' | 'current' | 'future'
  ): { bg: string; border: string; text: string } => {
    switch (status) {
      case 'completed':
        return { bg: 'bg-success-500', border: 'border-success-500', text: 'text-white' };
      case 'current':
        return { bg: 'bg-white', border: 'border-primary-500', text: 'text-primary-700' };
      case 'future':
        return { bg: 'bg-neutral-200', border: 'border-neutral-300', text: 'text-neutral-500' };
    }
  };

  return (
    <div className="flex items-center justify-between">
      {phaseOrder.map((phase, index) => {
        const status = getPhaseStatus(phase);
        const colors = getPhaseColors(status);

        return (
          <div key={phase} className="flex items-center flex-1">
            {/* Circle */}
            <div
              className={`w-12 h-12 rounded-full border-2 flex items-center justify-center font-semibold text-sm transition-all ${colors.bg} ${colors.border} ${colors.text}`}
            >
              {status === 'completed' ? '✓' : index}
            </div>

            {/* Line */}
            {index < phaseOrder.length - 1 && (
              <div
                className={`flex-1 h-1 mx-2 ${
                  status === 'completed'
                    ? 'bg-success-500'
                    : status === 'current'
                      ? 'bg-primary-300'
                      : 'bg-neutral-200'
                }`}
              ></div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default PhaseProgressBar;
