// ============================================================================
// OnboardingFlow — orchestrates the 4-step onboarding sequence
// ============================================================================
//
//  WELCOME  →  NEW_BUSINESS  →  COMPLETE
//           →  EXISTING      →  COMPLETE
//
// Wrapped in the same card shell used by SetupWizard so the UI is consistent.
// ============================================================================

import { useState } from 'react';
import { WelcomeStep }        from './steps/WelcomeStep';
import { NewBusinessStep }    from './steps/NewBusinessStep';
import { ExistingBusinessStep } from './steps/ExistingBusinessStep';
import { CompleteStep }       from './steps/CompleteStep';

export function OnboardingFlow({ onComplete }) {
  const [step,         setStep]         = useState('welcome');
  const [businessName, setBusinessName] = useState('');

  function handleSuccess(name) {
    setBusinessName(name ?? '');
    setStep('complete');
  }

  return (
    <div className="min-h-screen w-full bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-border bg-card shadow-2xl shadow-black/40 p-8">
          {step === 'welcome'  && (
            <WelcomeStep
              onNew={      () => setStep('new')      }
              onExisting={ () => setStep('existing') }
            />
          )}
          {step === 'new'      && (
            <NewBusinessStep
              onSuccess={handleSuccess}
              onBack={() => setStep('welcome')}
            />
          )}
          {step === 'existing' && (
            <ExistingBusinessStep
              onSuccess={handleSuccess}
              onBack={() => setStep('welcome')}
            />
          )}
          {step === 'complete' && (
            <CompleteStep
              businessName={businessName}
              onEnter={onComplete}
            />
          )}
        </div>
      </div>
    </div>
  );
}
