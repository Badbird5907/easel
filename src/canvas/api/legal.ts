import { useQuery } from '@tanstack/react-query';

import type { CanvasClient } from '../client';
import { useCanvasQuery } from '../query';

/** `GET /api/v1/accounts/:id/terms_of_service` (accounts_controller.rb#terms_of_service). */
type CanvasTermsOfService = {
  id?: string;
  /** `default`, `custom`, `no_terms`, or `built_in:<name>`. */
  terms_type?: string;
  passive?: boolean;
  content?: string | null;
};

/** `GET /api/v1/acceptable_use_policy` (accounts_controller.rb#acceptable_use_policy). */
type CanvasAcceptableUsePolicy = { content?: string | null; redirectUrl?: string | null };

export type Terms = {
  /** The school's own terms as HTML, when it wrote them in Canvas. */
  html: string | null;
  /** Where the terms live on the web, for schools that link out or use Canvas's defaults. */
  url: string;
  /** The school turned terms off. */
  none: boolean;
};

/** The school's terms of use (AUTH-7, SET-12). */
export async function fetchTerms(client: CanvasClient, signal?: AbortSignal): Promise<Terms> {
  // `/terms_of_use` redirects to whatever the school configured (legal_information_controller.rb).
  const fallback = `${client.baseUrl}/terms_of_use`;
  const tos = await client
    .get<CanvasTermsOfService>('/api/v1/accounts/self/terms_of_service', undefined, signal)
    .catch((): CanvasTermsOfService => ({}));
  if (tos.terms_type === 'no_terms') return { html: null, url: fallback, none: true };
  if (tos.content?.trim()) return { html: tos.content, url: fallback, none: false };
  const policy = await client
    .get<CanvasAcceptableUsePolicy>('/api/v1/acceptable_use_policy', undefined, signal)
    .catch((): CanvasAcceptableUsePolicy => ({}));
  return {
    html: policy.content?.trim() ? policy.content : null,
    url: policy.redirectUrl || fallback,
    none: false,
  };
}

/**
 * Whether Canvas wants the terms accepted before the student continues.
 * Canvas reports it with the web session token (login_controller.rb#session_token).
 */
export async function fetchRequiresTerms(client: CanvasClient): Promise<boolean> {
  try {
    const result = await client.get<{ requires_terms_acceptance?: boolean }>('/api/v1/login/session_token', {
      return_to: `${client.baseUrl}/`,
    });
    return result.requires_terms_acceptance === true;
  } catch {
    // Some schools block session tokens. Canvas will still ask on the web if it needs to.
    return false;
  }
}

/** `PUT /api/v1/users/self` with `user[terms_of_use]` (users_controller.rb#update). */
export async function acceptTerms(client: CanvasClient): Promise<void> {
  await client.put('/api/v1/users/self', { user: { terms_of_use: true } });
}

/** Terms during sign-in, before the account is saved: no account-scoped cache yet. */
export function useSignInTerms(client: CanvasClient) {
  return useQuery({
    queryKey: ['sign-in', 'terms', client.baseUrl],
    queryFn: ({ signal }) => fetchTerms(client, signal),
    staleTime: 5 * 60_000,
    gcTime: 0,
  });
}

/** The active school's terms, for About. */
export function useTerms() {
  return useCanvasQuery(['about', 'terms'], fetchTerms, { staleTime: 60 * 60_000 });
}

/** The school's privacy policy. Canvas redirects to the URL the school set (legal_information_controller.rb). */
export const privacyPolicyUrl = (baseUrl: string) => `${baseUrl}/privacy_policy`;

/** `GET /api/v1/users/self/profile` (lib/api/v1/user_profile.rb), the fields About shows. */
type CanvasProfile = { login_id?: string | null; primary_email?: string | null };

export type SignInProfile = { loginId: string | null; email: string | null };

export async function fetchSignInProfile(client: CanvasClient, signal?: AbortSignal): Promise<SignInProfile> {
  const profile = await client.get<CanvasProfile>('/api/v1/users/self/profile', undefined, signal);
  return { loginId: profile.login_id ?? null, email: profile.primary_email ?? null };
}

export function useSignInProfile() {
  return useCanvasQuery(['about', 'profile'], fetchSignInProfile, { staleTime: 60 * 60_000 });
}
