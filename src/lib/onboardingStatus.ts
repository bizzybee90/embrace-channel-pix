export type OnboardingRow = {
  onboarding_completed?: boolean | null;
  onboarding_step?: string | null;
};

// Single source of truth for what the UI considers "onboarding complete".
// We intentionally prefer onboarding_step because we've seen cases where
// onboarding_completed=true while onboarding_step is still mid-flow.
export function isOnboardingComplete(row?: OnboardingRow | null): boolean {
  if (!row) return false;
  return row.onboarding_step === "complete";
}
