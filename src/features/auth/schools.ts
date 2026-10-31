import { normalizeHost } from '@/canvas/client';

export type School = {
  name: string;
  /** Canvas host, as `normalizeHost` returns it. */
  host: string;
  /** Other names students search for: abbreviations, nicknames. */
  aliases?: string[];
  /** Canvas `authentication_provider` to start with, such as `saml` or `canvas` (AUTH-4). */
  authenticationProvider?: string;
};

/**
 * A small bundled list for search (AUTH-1). Instructure's account search needs
 * its own keys, so Easel doesn't call it. Any other school works by typing its
 * Canvas address. Entries are addresses only: being listed doesn't mean Easel
 * has a developer key there (see keys.ts).
 */
const bundled: School[] = [
  { name: 'Canvas Free for Teachers', host: 'canvas.instructure.com', aliases: ['free', 'instructure'] },
  { name: 'Arizona State University', host: 'canvas.asu.edu', aliases: ['asu'] },
  { name: 'Cornell University', host: 'canvas.cornell.edu' },
  { name: 'Harvard University', host: 'canvas.harvard.edu' },
  { name: 'Massachusetts Institute of Technology', host: 'canvas.mit.edu', aliases: ['mit'] },
  { name: 'Northwestern University', host: 'canvas.northwestern.edu' },
  { name: 'Penn State', host: 'psu.instructure.com', aliases: ['pennsylvania state university', 'psu'] },
  { name: 'Stanford University', host: 'canvas.stanford.edu' },
  { name: 'UC Berkeley', host: 'bcourses.berkeley.edu', aliases: ['university of california berkeley', 'bcourses'] },
  { name: 'UC San Diego', host: 'canvas.ucsd.edu', aliases: ['university of california san diego', 'ucsd'] },
  { name: 'UCLA', host: 'bruinlearn.ucla.edu', aliases: ['university of california los angeles', 'bruin learn'] },
  { name: 'University of Colorado Boulder', host: 'canvas.colorado.edu', aliases: ['cu boulder'] },
  { name: 'University of Michigan', host: 'umich.instructure.com', aliases: ['umich'] },
  { name: 'University of Pennsylvania', host: 'canvas.upenn.edu', aliases: ['upenn', 'penn'] },
  { name: 'University of Washington', host: 'canvas.uw.edu', aliases: ['uw'] },
  { name: 'University of Wisconsin–Madison', host: 'canvas.wisc.edu', aliases: ['uw madison', 'wisconsin'] },
  { name: 'Yale University', host: 'canvas.yale.edu' },
];

/** The fake Canvas, in development builds only. The SSO entry exercises `authentication_provider`. */
const development: School[] = __DEV__
  ? [
      { name: 'Fake Canvas (development)', host: 'localhost:3030', aliases: ['fake', 'dev', 'local'] },
      {
        name: 'Fake Canvas, single sign-on (development)',
        host: 'localhost:3030',
        aliases: ['fake sso', 'dev sso'],
        authenticationProvider: 'saml',
      },
    ]
  : [];

const schools = [...development, ...bundled];

const fold = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9.:]+/g, ' ')
    .trim();

/**
 * Bundled schools matching a name, abbreviation, or address, best first.
 * Whole-name prefixes rank first, then word prefixes, then address matches.
 */
export function searchSchools(input: string, limit = 5): School[] {
  const query = fold(input);
  if (query.length < 2) return [];
  const typedHost = normalizeHost(input)?.host;
  const scored: { school: School; score: number }[] = [];
  for (const school of schools) {
    const names = [school.name, ...(school.aliases ?? [])].map(fold);
    let score = 0;
    if (typedHost && typedHost === school.host) score = 5;
    else if (names.some((n) => n.startsWith(query))) score = 4;
    else if (names.some((n) => n.split(' ').some((word) => word.startsWith(query)))) score = 3;
    else if (names.some((n) => n.includes(query))) score = 2;
    else if (school.host.includes(query.replace(/\s+/g, ''))) score = 1;
    if (score) scored.push({ school, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.school.name.localeCompare(b.school.name))
    .slice(0, limit)
    .map((s) => s.school);
}

/** What a typed address means, if it's an address at all: a dot, a port, or one short word. */
export function typedSchool(input: string): School | null {
  const value = input.trim();
  // A single word ("myschool") is a short name for myschool.instructure.com; several words are a search.
  if (!value || /\s/.test(value)) return null;
  const host = normalizeHost(value);
  return host ? { name: host.host, host: host.host } : null;
}
