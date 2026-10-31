import type { ClientCredentials } from '@/canvas/session';

/**
 * Developer keys Easel knows, by Canvas host (PRD 4.1, AUTH-2). Easel never
 * uses Instructure's own app keys or `mobile_verify`.
 *
 * Adding a school:
 * 1. The school's Canvas admin opens Admin > Developer Keys > + Developer Key > + API Key.
 * 2. Redirect URIs: `easel://oauth/callback`. Leave "Enforce scopes" off: scoped keys lose
 *    GraphQL and LTI sessionless launches (PRD 4.5).
 * 3. Client type: Public, so no secret has to ship in the app. Canvas then expires tokens
 *    after two hours and Easel refreshes them (PRD 4.2).
 * 4. Turn the key on, then add `'<host>': { clientId: '<id>' }` below, using the host
 *    exactly as `normalizeHost` returns it (lowercase, no scheme).
 *
 * Never commit a client secret. A school that only offers a confidential key can hand its
 * ID and secret to students, who enter them under "Use a developer key"; Easel keeps them
 * in the keychain with the account.
 */
const registry: Record<string, ClientCredentials> = __DEV__
  ? {
      // The fake Canvas in devtools/fake-canvas. Its secret is a development placeholder.
      'localhost:3030': { clientId: 'easel-dev', clientSecret: 'dev-secret' },
      '127.0.0.1:3030': { clientId: 'easel-dev', clientSecret: 'dev-secret' },
      '10.0.2.2:3030': { clientId: 'easel-dev', clientSecret: 'dev-secret' },
    }
  : {};

/** The registered key for a host, or null when Easel doesn't have one there. */
export function developerKeyFor(host: string): ClientCredentials | null {
  return registry[host.toLowerCase()] ?? null;
}
