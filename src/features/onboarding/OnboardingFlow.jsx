// ============================================================================
// OnboardingFlow — orchestrates the onboarding sequence
// ============================================================================
//
//  WELCOME  →  NEW_BUSINESS (full-page, amber)  →  SUPER_ADMIN (full-page, violet)
//           →     →  COMPLETE
//           →  RESTORE_ID  →  RESTORE_PROGRESS  →  COMPLETE (linked)
//
// Resume behaviour:
//   If the app is closed after create_business but before setup_super_admin,
//   the backend returns { needs_super_admin: true, business_id, business_name }.
//   App.jsx passes those as props and we skip straight to the super-admin step.
//
// ============================================================================

import { useState } from 'react';
import { WelcomeStep }          from './steps/WelcomeStep';
import { RestoreIdStep }        from './steps/RestoreIdStep';
import { RestoreProgressStep }  from './steps/RestoreProgressStep';
import { CompleteStep }         from './steps/CompleteStep';
import { SuperAdminStep }       from './steps/SuperAdminStep';
import BusinessCreationPage     from '@/pages/BusinessCreationPage';

export function OnboardingFlow({
  onComplete,
  resumeAtSuperAdmin = false,
  resumeBusinessName = '',
  resumeBusinessId   = '',
}) {
  // If we're resuming mid-flow, start directly at the super-admin step.
  const [step,          setStep]          = useState(resumeAtSuperAdmin ? 'super-admin' : 'welcome');
  const [businessName,  setBusinessName]  = useState(resumeBusinessName);
  const [businessId,    setBusinessId]    = useState(resumeBusinessId);
  const [isNewBusiness, setIsNewBusiness] = useState(resumeAtSuperAdmin);

  // Called by BusinessCreationPage when the business has been created.
  // Instead of going to complete, we move to the super-admin creation step.
  function handleBusinessCreated(name, id) {
    setBusinessName(name ?? '');
    setBusinessId(id   ?? '');
    setIsNewBusiness(true);
    setStep('super-admin');
  }

  // Called by SuperAdminStep after the admin account is set up.
  function handleSuperAdminCreated() {
    setStep('complete');
  }

  // Called by RestoreIdStep once the ID is verified against the cloud.
  function handleIdVerified(name, id) {
    setBusinessName(name ?? '');
    setBusinessId(id   ?? '');
    setStep('restore-progress');
  }

  // Called by RestoreProgressStep when the pull completes successfully.
  function handleRestoreSuccess(name, id) {
    setBusinessName(name ?? '');
    setBusinessId(id   ?? '');
    setIsNewBusiness(false);
    setStep('complete');
  }

  // ── Full-page steps (bypass the card wrapper) ─────────────────────────────
  if (step === 'new') {
    return (
      <BusinessCreationPage
        onSuccess={handleBusinessCreated}
        onBack={  () => setStep('welcome')}
      />
    );
  }

  if (step === 'super-admin') {
    return (
      <SuperAdminStep
        businessName={businessName}
        onSuccess={  handleSuperAdminCreated}
      />
    );
  }

  // ── Card-based steps ──────────────────────────────────────────────────────
  return (
    <div className="min-h-screen w-full bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-border bg-card shadow-2xl shadow-black/40 p-8">
          {step === 'welcome' && (
            <WelcomeStep
              onNew={     () => setStep('new')        }
              onRestore={ () => setStep('restore-id') }
            />
          )}
          {step === 'restore-id' && (
            <RestoreIdStep
              onVerified={handleIdVerified}
              onBack={    () => setStep('welcome') }
            />
          )}
          {step === 'restore-progress' && (
            <RestoreProgressStep
              businessId={  businessId}
              businessName={businessName}
              onSuccess={   handleRestoreSuccess}
              onBack={      () => setStep('restore-id') }
            />
          )}
          {step === 'complete' && (
            <CompleteStep
              businessName={  businessName}
              businessId={    businessId}
              isNewBusiness={ isNewBusiness}
              onEnter={       onComplete}
            />
          )}
        </div>
      </div>
    </div>
  );
}
