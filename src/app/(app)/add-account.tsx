import { router } from 'expo-router';

import { authFormsClaim, useAuthFormsLifetime } from '@/features/auth/authFormsLifetime';
import { SignInFlow } from '@/features/auth/SignInFlow';

/** Signs in to another school or account without leaving the current one (ACCT-3). */
export default function AddAccountScreen() {
  const owner = useAuthFormsLifetime('add-account');
  const revision = owner.revision;
  return <SignInFlow addingAccount onSignedIn={() => {
    if (authFormsClaim(owner, revision)) router.back();
  }} />;
}
