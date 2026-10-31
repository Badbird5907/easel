import { Stack } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from '@/i18n';

import { groupContext } from '@/canvas/api/discussions';
import { AccentScope, deriveAccent, useTheme } from '@/design';

import { useContextLabel } from './context';

/** Group screens: tinted with the group's course color, header included, like CourseScope. */
export function GroupScope({ groupId, title, children }: { groupId: string; title?: string; children: ReactNode }) {
  const { t } = useTranslation();
  const { color, name } = useContextLabel(groupContext(groupId));
  const { scheme } = useTheme();
  return (
    <AccentScope color={color} className="flex-1">
      <Stack.Screen
        options={{
          title: title ?? name ?? t('groups.title'),
          ...(color && { headerTintColor: deriveAccent(color, scheme).accentFg }),
        }}
      />
      {children}
    </AccentScope>
  );
}
