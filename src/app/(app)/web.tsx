import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { useCanvas } from '@/canvas/session';
import { Screen, Text } from '@/design';
import { useTranslation } from '@/i18n';
import type { ToolLaunch } from '@/features/lti/launch';
import { WebScreen } from '@/features/web/WebScreen';

type Params = {
  url?: string;
  /** Set instead of `url` when a Canvas link resolved here (`features/content/links.ts`). */
  canvasUrl?: string;
  title?: string;
  guard?: string;
  signed?: string;
  launch?: string;
  tool?: string;
  courseId?: string;
};

function parse<T>(value: string | undefined): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

/**
 * Easel's signed-in web view as a screen (PRD 9 "Web views"): tools, New
 * Quizzes, quiz fallbacks, Collaborations, Outcomes, DocViewer. Open it with
 * `openWebView()` from `features/web/open.ts`.
 */
export default function WebRoute() {
  const { account } = useCanvas();
  const { t } = useTranslation();
  const params = useLocalSearchParams<Params>();
  const launch = useMemo(() => parse<ToolLaunch>(params.launch), [params.launch]);
  const tool = useMemo(() => parse<{ id: string | null; name: string | null }>(params.tool), [params.tool]);
  if (account.authMethod === 'demo')
    return (
      <Screen>
        <Text>{t('demo.unavailable')}</Text>
      </Screen>
    );
  return (
    <WebScreen
      url={params.url ?? params.canvasUrl ?? ''}
      title={params.title}
      guard={params.guard}
      signed={params.signed === '1'}
      launch={launch}
      tool={tool}
      courseId={params.courseId}
    />
  );
}
