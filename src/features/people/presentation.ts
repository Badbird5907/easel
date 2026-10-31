import type { Person, PersonProfile } from '@/canvas/api/people';
import type { Translate } from '@/i18n';

/** Old cached strings are opaque: a school can name a custom role “Teacher”. */
export function profileRoles(person: Person, profile: PersonProfile | null, t: Translate): string[] {
  if (!profile) return [person.customRole ?? t(`people.role.${person.role}`)];
  return profile.roles.map((label, index) => {
    const builtin = profile.builtinRoles?.[index];
    return builtin ? t(`people.role.${builtin}`) : label;
  });
}
