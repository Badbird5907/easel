import { useQueryClient } from '@tanstack/react-query';

import type { CanvasClient } from '../client';
import { useAccountKey, useCanvasMutation, useCanvasQuery } from '../query';
import { updateAccountUser, useCanvas } from '../session';
import { type LocalFile, uploadToCanvas } from '../uploads';

/**
 * `GET /api/v1/users/:id` (users_controller#api_show, lib/api/v1/user.rb).
 * Always includes `permissions`, `locale`, `effective_locale`, and `avatar_url`.
 */
type CanvasUserDetail = {
  id: string;
  name: string;
  short_name?: string;
  sortable_name?: string;
  avatar_url?: string | null;
  pronouns?: string | null;
  locale?: string | null;
  effective_locale?: string | null;
  email?: string | null;
  permissions?: {
    can_update_name?: boolean;
    can_update_avatar?: boolean;
    limit_parent_app_web_access?: boolean;
  };
};

/** `GET /api/v1/users/self/profile` (lib/api/v1/user_profile.rb). */
type CanvasUserProfile = {
  id: string;
  name: string;
  short_name?: string;
  bio?: string | null;
  title?: string | null;
  pronouns?: string | null;
  primary_email?: string | null;
  login_id?: string | null;
  /** IANA name (`zone.tzinfo.name`): the student's own, or the school's default. */
  time_zone?: string | null;
  /** What the student picked. Null or empty means the school's default. */
  locale?: string | null;
  effective_locale?: string | null;
  calendar?: { ics?: string };
};

export type Profile = {
  id: string;
  name: string;
  shortName: string;
  sortableName: string | null;
  avatarUrl: string | null;
  pronouns: string | null;
  bio: string | null;
  email: string | null;
  loginId: string | null;
  timeZone: string | null;
  /** The language the student chose in Canvas, or null for the school's default. */
  locale: string | null;
  /** The language Canvas actually uses for this student. */
  effectiveLocale: string | null;
  canEditName: boolean;
  canEditAvatar: boolean;
};

/**
 * The student's profile (SET-6, SET-14). Uses the account's user ID rather
 * than `self` for the user record: Canvas treats them the same.
 */
export async function fetchProfile(
  client: CanvasClient,
  userId: string,
  signal?: AbortSignal,
): Promise<Profile> {
  const [user, profile] = await Promise.all([
    client.get<CanvasUserDetail>(`/api/v1/users/${userId}`, undefined, signal),
    client.get<CanvasUserProfile>('/api/v1/users/self/profile', undefined, signal),
  ]);
  return {
    id: String(user.id),
    name: user.name,
    shortName: user.short_name || user.name,
    sortableName: user.sortable_name ?? null,
    avatarUrl: user.avatar_url ?? null,
    pronouns: user.pronouns ?? profile.pronouns ?? null,
    bio: profile.bio?.trim() ? profile.bio : null,
    email: profile.primary_email ?? user.email ?? null,
    loginId: profile.login_id ?? null,
    timeZone: profile.time_zone ?? null,
    locale: profile.locale || user.locale || null,
    effectiveLocale: profile.effective_locale ?? user.effective_locale ?? null,
    // Older Canvas versions don't send permissions; they let students edit both.
    canEditName: user.permissions?.can_update_name ?? true,
    canEditAvatar: user.permissions?.can_update_avatar ?? true,
  };
}

const PROFILE_KEY = ['profile'] as const;

export function useProfile() {
  const { account } = useCanvas();
  return useCanvasQuery([...PROFILE_KEY], (client, signal) => fetchProfile(client, account.user.id, signal), {
    staleTime: 5 * 60_000,
  });
}

/** Fields `PUT /api/v1/users/:id` takes from a student (users_controller#update). */
export type ProfileUpdate = {
  name?: string;
  short_name?: string;
  sortable_name?: string;
  pronouns?: string;
  time_zone?: string;
  locale?: string;
};

/**
 * `PUT /api/v1/users/:id`. Canvas refuses the whole request when it includes
 * a field the student may not change (a name at a school that locks names),
 * so callers send only what changed and what's allowed.
 */
export async function updateProfile(client: CanvasClient, userId: string, user: ProfileUpdate) {
  return client.put<CanvasUserDetail>(`/api/v1/users/${userId}`, { user });
}

/** Canvas answered, but didn't take these pronouns: the school doesn't offer them. */
export class PronounsNotOfferedError extends Error {
  constructor() {
    super(
      'Your school doesn’t offer those pronouns in Canvas. Choose another option, or ask your school to add them.',
    );
    this.name = 'PronounsNotOfferedError';
  }
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  const key = useAccountKey();
  const { account } = useCanvas();
  return useCanvasMutation(
    async (client, user: ProfileUpdate) => {
      const updated = await updateProfile(client, account.user.id, user);
      // Canvas only keeps pronouns the school lists, and says nothing when it drops them.
      if (user.pronouns !== undefined && (updated.pronouns ?? '') !== user.pronouns)
        throw new PronounsNotOfferedError();
      return updated;
    },
    {
      onSuccess: (updated) => {
        if (updated?.name)
          updateAccountUser(account.id, {
            name: updated.name,
            shortName: updated.short_name || updated.name,
          }).catch(() => {});
      },
      onSettled: () => queryClient.invalidateQueries({ queryKey: [key, ...PROFILE_KEY] }),
    },
  );
}

/** `GET /api/v1/users/:id/avatars` (profile_controller#profile_pics). */
type CanvasAvatar = { type: string; id?: string; url: string; token: string; display_name?: string };

/** Retirement is not a successful null avatar, and does not undo entered effects. */
export class ObsoleteAvatarOperationError extends Error {
  constructor() {
    super('This avatar operation is no longer current.');
    this.name = 'ObsoleteAvatarOperationError';
  }
}

function assertAvatarCurrent(isCurrent?: () => boolean) {
  if (isCurrent && !isCurrent()) throw new ObsoleteAvatarOperationError();
}

/** Guard belongs to this invocation, never to a newer hook render. */
export type AvatarUpload = LocalFile | { file: LocalFile; isCurrent: () => boolean };

/** The token Canvas wants for an uploaded profile picture. */
async function avatarToken(
  client: CanvasClient,
  userId: string,
  fileId: string,
  isCurrent?: () => boolean,
): Promise<string> {
  assertAvatarCurrent(isCurrent);
  const avatars = await client.get<CanvasAvatar[]>(`/api/v1/users/${userId}/avatars`).catch((error) => {
    if (error instanceof ObsoleteAvatarOperationError) throw error;
    return [];
  });
  assertAvatarCurrent(isCurrent);
  const match = avatars.find((a) => a.type === 'attachment' && String(a.id) === fileId);
  if (match) return match.token;
  // Files in the profile pictures folder carry their avatar token too (files_controller#api_show).
  assertAvatarCurrent(isCurrent);
  const file = await client.get<{ avatar?: { token?: string } }>(`/api/v1/files/${fileId}`, {
    include: ['avatar'],
  });
  assertAvatarCurrent(isCurrent);
  if (file.avatar?.token) return file.avatar.token;
  throw new Error('Canvas didn’t accept that picture as a profile picture. Try a different photo.');
}

/**
 * New profile picture (SET-6): upload into "profile pictures", look up the
 * avatar token Canvas gives that file, then set it with `user[avatar][token]`.
 * Optional eligibility stops subsequent stages, not an entered transfer or PUT.
 */
export async function uploadAvatar(
  client: CanvasClient,
  userId: string,
  file: LocalFile,
  onProgress?: (fraction: number | null) => void,
  isCurrent?: () => boolean,
): Promise<string | null> {
  assertAvatarCurrent(isCurrent);
  let reporting = true;
  try {
    const uploaded = await uploadToCanvas(client, '/api/v1/users/self/files', file, {
      params: { parent_folder_path: 'profile pictures', on_duplicate: 'rename' },
      onProgress: isCurrent
        ? (fraction) => {
            if (reporting && isCurrent()) onProgress?.(fraction);
          }
        : onProgress,
    });
    assertAvatarCurrent(isCurrent);
    const token = await avatarToken(client, userId, uploaded.id, isCurrent);
    assertAvatarCurrent(isCurrent);
    const updated = await client.put<CanvasUserDetail>(`/api/v1/users/${userId}`, {
      user: { avatar: { token } },
    });
    assertAvatarCurrent(isCurrent);
    return updated.avatar_url ?? null;
  } finally {
    reporting = false;
  }
}

/** Existing LocalFile calls remain unguarded; opt in with { file, isCurrent }. */
export function useUploadAvatar(onProgress?: (fraction: number | null) => void) {
  const queryClient = useQueryClient();
  const key = useAccountKey();
  const { account } = useCanvas();
  return useCanvasMutation(
    (client, input: AvatarUpload) => {
      const { file, isCurrent } = 'file' in input ? input : { file: input, isCurrent: undefined };
      return uploadAvatar(client, account.user.id, file, onProgress, isCurrent);
    },
    {
      onSuccess: (avatarUrl, input) => {
        // Query lifecycle callbacks can await between the PUT result and here.
        assertAvatarCurrent('file' in input ? input.isCurrent : undefined);
        updateAccountUser(account.id, { avatarUrl }).catch(() => {});
      },
      // Even a retired PUT may have changed Canvas. Keep the original account's
      // invalidation on every settlement; never publish an invented null avatar.
      onSettled: () => queryClient.invalidateQueries({ queryKey: [key, ...PROFILE_KEY] }),
    },
  );
}

// --- Pair with an observer (SET-9) -----------------------------------------------------

/** `GET /api/v1/accounts/self/terms_of_service`: the parts that decide pairing. */
type CanvasTermsForPairing = { account_id?: string; self_registration_type?: string | null };

export type PairingAvailability = { allowed: boolean; accountId: string | null };

/**
 * Canvas lets students make pairing codes when the school lets observers sign
 * themselves up (observer_pairing_codes_api_controller.rb). Canvas reports
 * that as `self_registration_type` on the terms of service, as the official
 * app checks it.
 */
export async function fetchPairingAvailability(
  client: CanvasClient,
  signal?: AbortSignal,
): Promise<PairingAvailability> {
  const terms = await client.get<CanvasTermsForPairing>(
    '/api/v1/accounts/self/terms_of_service',
    undefined,
    signal,
  );
  const type = terms.self_registration_type;
  return {
    allowed: type === 'all' || type === 'observer',
    accountId: terms.account_id ? String(terms.account_id) : null,
  };
}

export function usePairingAvailability() {
  return useCanvasQuery(['profile', 'pairing'], fetchPairingAvailability, { staleTime: 60 * 60_000 });
}

/** `POST /api/v1/users/self/observer_pairing_codes`. */
type CanvasPairingCode = { user_id: string; code: string; expires_at: string; workflow_state: string };

export type PairingCode = { code: string; expiresAt: Date };

export async function createPairingCode(client: CanvasClient): Promise<PairingCode> {
  const result = await client.post<CanvasPairingCode>('/api/v1/users/self/observer_pairing_codes');
  return { code: result.code, expiresAt: new Date(result.expires_at) };
}

export function useCreatePairingCode() {
  return useCanvasMutation((client) => createPairingCode(client));
}

/** What the Canvas Parent app scans: the same link the official Student app encodes. */
export function pairingLink(host: string, code: string, accountId: string): string {
  return `canvas-parent://${host}/pair?code=${encodeURIComponent(code)}&account_id=${encodeURIComponent(accountId)}`;
}
