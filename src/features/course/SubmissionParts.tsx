import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import {
  ClipboardCheck,
  ExternalLink,
  FilePen,
  Globe,
  MessageSquare,
  Mic,
  Puzzle,
} from 'lucide-react-native';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import type {
  Assignment,
  Attachment,
  RubricAssessment,
  RubricCriterion,
  SubmissionAttempt,
  SubmissionComment,
} from '@/canvas/api/assignments';
import { Avatar, Badge, Card, Divider, Icon, IconTile, ListGroup, ListItem, Text } from '@/design';
import { sessionUrl } from '@/features/content/browser';
import { RichContent } from '@/features/content/RichContent';
import { AttachmentList } from '@/features/files/AttachmentList';
import { describeFile } from '@/features/files/kinds';
import { useToolAction } from '@/features/lti/action';
import { useLaunchTool } from '@/features/lti/launch';
import { MediaPlayer } from '@/features/submissions/MediaPlayer';

import { useCanvas } from '@/canvas/session';
import { useTranslation } from '@/i18n';
import { createDateContext, useDisplayTimeZone } from '@/lib/dates';
import { useViewerLifetime } from '@/features/submissions/annotationViewer';
import {
  beginFeedbackLaunch,
  revokeFeedback,
  revokeFeedbackSource,
} from '@/features/submissions/feedbackLaunch';
import { feedbackNumber } from '@/features/submissions/feedbackPresentation';
import { assignmentTarget, pushRoute } from './navigation';

const isMedia = (file: Attachment) => {
  const kind = describeFile({ name: file.display_name, contentType: file['content-type'] }).kind;
  return kind === 'audio' || kind === 'video' ? kind : null;
};

/** "github.com/evan/cs225-mp2" from a URL, for the link card. */
function shortUrl(url: string) {
  try {
    const u = new URL(url);
    return `${u.host.replace(/^www\./, '')}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return url.replace(/^https?:\/\//, '');
  }
}

/** What the student turned in for one attempt: a viewer per submission type (ASSIGN-10). */
export function AttemptContent({
  attempt,
  assignment,
}: {
  attempt: SubmissionAttempt;
  assignment: Assignment;
}) {
  const { t } = useTranslation();
  const { account, client } = useCanvas();
  // Value identity tolerates equivalent query objects and locale-only renders.
  const signature = JSON.stringify([
    attempt,
    assignment.courseId,
    assignment.id,
    assignment.kind,
    assignment.quizId,
    assignment.discussionTopicId,
    assignment.name,
    assignment.htmlUrl,
  ]);
  const context = useMemo(
    () => ({ accountId: account.id, client, signature }),
    [account.id, client, signature],
  );
  const current = useViewerLifetime(context);
  const previous = useRef(context);
  useLayoutEffect(() => {
    if (previous.current !== context) revokeFeedbackSource(previous.current);
    previous.current = context;
    // Do not revoke on unmount: pushing the viewer can remove its producer.
  }, [context]);
  const openSignedIn = async (url: string) => {
    if (!current()) return;
    const signed = await sessionUrl(client, url);
    if (current()) await WebBrowser.openBrowserAsync(signed);
  };
  const openAnnotations = (file: Attachment) => {
    const launch = beginFeedbackLaunch(
      context,
      current,
      {
        accountId: account.id,
        client,
        courseId: assignment.courseId,
        assignmentId: assignment.id,
      },
      {
        attempt: attempt.attempt,
        fileId: file.id,
        url: file.preview_url!,
        title: file.display_name,
        canvasUrl: assignment.htmlUrl,
      },
    );
    if (!launch) return;
    if (!current()) {
      revokeFeedback(launch);
      return;
    }
    try {
      router.push({
        pathname: '/course/[courseId]/assignment/[assignmentId]/annotations',
        params: { courseId: assignment.courseId, assignmentId: assignment.id, launch },
      } as never);
    } catch (error) {
      revokeFeedback(launch);
      throw error;
    }
  };
  const launchTool = useLaunchTool();
  // Tool ownership ignores presentation-only attempt metadata and assignment names.
  const toolAction = useToolAction(
    JSON.stringify([
      assignment.courseId, assignment.id, assignment.kind, assignment.htmlUrl, assignment.locked,
      attempt.attempt, attempt.type, attempt.url, attempt.externalToolUrl,
    ]),
    // Assignment locks prevent new submissions; existing attempt content still opens.
    attempt.type === 'basic_lti_launch',
  );
  switch (attempt.type) {
    case 'online_text_entry':
      return attempt.body ? (
        <Card>
          <RichContent html={attempt.body} />
        </Card>
      ) : (
        <Text variant="subhead" tone="muted">
          {t('submissionFeedback.noText')}
        </Text>
      );
    case 'online_url':
      return attempt.url ? (
        <ListGroup>
          <ListItem
            leading={<IconTile icon={Globe} tone="accent" />}
            title={shortUrl(attempt.url)}
            subtitle={t('submissionFeedback.browser')}
            subtitleLines={1}
            accessibilityLabel={t('submissionFeedback.website', { url: shortUrl(attempt.url) })}
            accessibilityHint={t('submissionFeedback.browserHint')}
            trailing={<Icon icon={ExternalLink} size={18} tone="subtle" />}
            chevron={false}
            onPress={() => {
              if (current()) void WebBrowser.openBrowserAsync(attempt.url!).catch(() => {});
            }}
          />
        </ListGroup>
      ) : null;
    case 'online_upload': {
      if (!attempt.attachments.length)
        return (
          <Text variant="subhead" tone="muted">
            {t('submissionFeedback.noFiles')}
          </Text>
        );
      const annotated = attempt.attachments.filter((f) => !!f.preview_url && !isMedia(f));
      return (
        <View className="gap-3">
          <AttachmentList attachments={attempt.attachments} courseId={assignment.courseId} />
          {annotated.length ? (
            <ListGroup footer={t('submissionFeedback.feedbackHelp')}>
              {annotated.map((file) => (
                <ListItem
                  key={file.id}
                  leading={<IconTile icon={FilePen} tone="info" />}
                  title={t('submissionFeedback.feedback')}
                  subtitle={file.display_name}
                  subtitleLines={1}
                  onPress={() => openAnnotations(file)}
                />
              ))}
            </ListGroup>
          ) : null}
        </View>
      );
    }
    case 'media_recording':
      return attempt.media ? (
        <MediaPlayer
          url={attempt.media.url}
          kind={attempt.media.kind}
          title={
            attempt.media.title ??
            t(
              attempt.media.kind === 'audio'
                ? 'submissionFeedback.audio'
                : 'submissionFeedback.video',
            )
          }
        />
      ) : (
        <ListGroup>
          <ListItem
            leading={<IconTile icon={Mic} tone="neutral" />}
            title={t('submissionFeedback.media')}
            subtitle={t('submissionFeedback.signedBrowser')}
            trailing={<Icon icon={ExternalLink} size={18} tone="subtle" />}
            chevron={false}
            onPress={() => openSignedIn(assignment.htmlUrl)}
          />
        </ListGroup>
      );
    case 'online_quiz':
      return (
        <ListGroup>
          <ListItem
            leading={<IconTile icon={ClipboardCheck} tone="neutral" />}
            title={t('submissionFeedback.quiz')}
            subtitle={t('submissionFeedback.quizHelp')}
            onPress={() => {
              if (current()) pushRoute(assignmentTarget(assignment));
            }}
          />
        </ListGroup>
      );
    case 'discussion_topic':
      return (
        <View className="gap-3">
          {attempt.discussionEntries.map((entry, i) => (
            <Card key={i}>
              <RichContent html={entry} />
            </Card>
          ))}
          <ListGroup>
            <ListItem
              leading={<IconTile icon={MessageSquare} tone="neutral" />}
              title={t('submissionFeedback.discussion')}
              onPress={() => {
                if (current()) pushRoute(assignmentTarget(assignment));
              }}
            />
          </ListGroup>
        </View>
      );
    case 'basic_lti_launch': {
      // A tool assignment relaunches itself; a link picked from a tool (ASSIGN-9) launches by its URL.
      const picked = assignment.kind !== 'external_tool' && !!attempt.url;
      return (
        <ListGroup>
          <ListItem
            leading={<IconTile icon={Puzzle} tone="neutral" />}
            title={t(picked ? 'submissionFeedback.picked' : 'submissionFeedback.tool')}
            subtitle={picked ? shortUrl(attempt.url!) : t('submissionFeedback.toolHelp')}
            subtitleLines={1}
            onPress={() =>
              toolAction.run((isCurrent) =>
                launchTool(
                  picked
                  ? {
                      courseId: assignment.courseId,
                      url: attempt.url!,
                      title: assignment.name,
                      fallbackUrl: assignment.htmlUrl,
                    }
                  : {
                      courseId: assignment.courseId,
                      assignmentId: assignment.id,
                      launchType: 'assessment',
                      url: attempt.externalToolUrl ?? undefined,
                      title: assignment.name,
                      fallbackUrl: assignment.htmlUrl,
                    },
                  { isCurrent },
                ),
              )
            }
          />
        </ListGroup>
      );
    }
    case 'student_annotation':
      return (
        <ListGroup>
          <ListItem
            leading={<IconTile icon={FilePen} tone="neutral" />}
            title={t('submissionFeedback.annotations')}
            subtitle={t('submissionFeedback.annotationsHelp')}
            onPress={() =>
              current() &&
              router.push({
                pathname: '/course/[courseId]/assignment/[assignmentId]/annotate',
                params: {
                  courseId: assignment.courseId,
                  assignmentId: assignment.id,
                  attempt: String(attempt.attempt),
                },
              } as never)
            }
          />
        </ListGroup>
      );
    default:
      return (
        <Text variant="subhead" tone="muted">
          {t('submissionFeedback.unsupported')}
        </Text>
      );
  }
}

/**
 * Rubric with the instructor's ratings and comments when graded (ASSIGN-11).
 * Under restricted quantitative data or `hide_points`, only rating names show.
 */
export function RubricView({
  criteria,
  assessment,
  hidePoints,
  hideTotal = false,
}: {
  criteria: RubricCriterion[];
  assessment: RubricAssessment | null;
  hidePoints: boolean;
  hideTotal?: boolean;
}) {
  const { t, locale } = useTranslation();
  const formatNumber = (n: number) => feedbackNumber(n, locale);
  const total = criteria.filter((c) => !c.ignoreForScoring).reduce((sum, c) => sum + c.points, 0);
  const earned = assessment
    ? criteria.reduce(
        (sum, c) => sum + (c.ignoreForScoring ? 0 : (assessment[c.id]?.points ?? 0)),
        0,
      )
    : null;

  return (
    <Card padding="none">
      {criteria.map((c, index) => (
        <Criterion
          key={c.id}
          criterion={c}
          result={assessment?.[c.id] ?? null}
          hidePoints={hidePoints}
          first={index === 0}
        />
      ))}
      {earned !== null && !hidePoints && !hideTotal ? (
        <>
          <Divider />
          <View
            className="flex-row items-center px-4 py-3"
            accessible
            accessibilityLabel={t('submissionFeedback.totalLabel', {
              earned: formatNumber(earned),
              total: formatNumber(total),
            })}
          >
            <Text variant="headline" className="flex-1">
              {t('submissionFeedback.total')}
            </Text>
            <Text variant="headline" tabular>
              {t('submissionFeedback.ratio', {
                earned: formatNumber(earned),
                total: formatNumber(total),
              })}
            </Text>
          </View>
        </>
      ) : null}
    </Card>
  );
}

function Criterion({
  criterion: c,
  result,
  hidePoints,
  first,
}: {
  criterion: RubricCriterion;
  result: RubricAssessment[string] | null;
  hidePoints: boolean;
  first: boolean;
}) {
  const { t, locale } = useTranslation();
  const formatNumber = (n: number) => feedbackNumber(n, locale);
  const formatPoints = (n: number) =>
    t(n === 1 ? 'submissionFeedback.point' : 'submissionFeedback.points', {
      value: formatNumber(n),
    });
  const [expanded, setExpanded] = useState(false);
  const selected = c.ratings.find((r) => r.id === result?.ratingId) ?? null;
  const pointsText = hidePoints
    ? null
    : result?.points != null
      ? t('submissionFeedback.ratio', {
          earned: formatNumber(result.points),
          total: formatNumber(c.points),
        })
      : formatPoints(c.points);
  const spoken = hidePoints
    ? c.description
    : result?.points != null
      ? t('submissionFeedback.score', {
          description: c.description,
          earned: formatNumber(result.points),
          total: formatNumber(c.points),
        })
      : t('submissionFeedback.criterionPoints', {
          description: c.description,
          points: formatPoints(c.points),
        });

  return (
    <View>
      {!first ? <Divider /> : null}
      <View className="gap-2.5 p-4">
        <View
          className="flex-row items-start gap-3"
          accessible
          accessibilityRole="header"
          accessibilityLabel={[
            spoken,
            selected ? t('submissionFeedback.rated', { description: selected.description }) : '',
            c.ignoreForScoring ? t('submissionFeedback.notScored') : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <Text variant="headline" className="flex-1">
            {c.description}
          </Text>
          {pointsText ? (
            <Text variant="subhead" weight="semibold" tone={result ? 'default' : 'muted'} tabular>
              {pointsText}
            </Text>
          ) : null}
        </View>
        {c.longDescription ? (
          <Text variant="subhead" tone="muted">
            {c.longDescription}
          </Text>
        ) : null}
        {c.ratings.length ? (
          <View className="gap-1.5">
            {(expanded || !selected ? c.ratings : [selected]).map((r) => {
              const chosen = r.id === selected?.id;
              return (
                <View
                  key={r.id}
                  accessible
                  accessibilityLabel={[
                    hidePoints
                      ? r.description
                      : t('submissionFeedback.criterionPoints', {
                          description: r.description,
                          points: formatPoints(r.points),
                        }),
                    r.longDescription,
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  accessibilityState={{ selected: chosen }}
                  className={
                    chosen
                      ? 'gap-0.5 rounded-xl border-[1.5px] border-accent bg-accent-soft px-3 py-2'
                      : 'gap-0.5 rounded-xl border-[1.5px] border-transparent bg-surface-sunken px-3 py-2'
                  }
                  style={{ borderCurve: 'continuous' }}
                >
                  <View className="flex-row items-center gap-2">
                    <Text
                      variant="subhead"
                      weight={chosen ? 'semibold' : 'medium'}
                      tone={chosen ? 'accent' : 'default'}
                      className="flex-1"
                    >
                      {r.description}
                    </Text>
                    {!hidePoints ? (
                      <Text variant="footnote" tone={chosen ? 'accent' : 'muted'} tabular>
                        {formatPoints(r.points)}
                      </Text>
                    ) : null}
                  </View>
                  {r.longDescription ? (
                    <Text variant="footnote" tone="muted">
                      {r.longDescription}
                    </Text>
                  ) : null}
                </View>
              );
            })}
            {selected && c.ratings.length > 1 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                onPress={() => setExpanded((e) => !e)}
                hitSlop={{ top: 6, bottom: 6 }}
                className="min-h-9 justify-center self-start active:opacity-60"
              >
                <Text variant="footnote" weight="semibold" tone="accent">
                  {expanded
                    ? t('submissionFeedback.ratingOnly')
                    : t('submissionFeedback.allRatings', { count: c.ratings.length })}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {result?.comments ? (
          <View
            className="flex-row gap-2 rounded-xl bg-surface-sunken p-3"
            style={{ borderCurve: 'continuous' }}
            accessible
            accessibilityLabel={t('submissionFeedback.instructor', { comment: result.comments })}
          >
            <Icon icon={MessageSquare} size={16} tone="muted" />
            <Text variant="subhead" className="flex-1">
              {result.comments}
            </Text>
          </View>
        ) : null}
        {c.ignoreForScoring ? (
          <View className="flex-row">
            <Badge size="sm">{t('submissionFeedback.notScored')}</Badge>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** Submission comments, oldest first, each labeled with its attempt when there are several. */
export function CommentList({
  comments,
  courseId,
  showAttempt,
  selfId,
}: {
  comments: SubmissionComment[];
  courseId: string;
  showAttempt: boolean;
  /** The signed-in student's user ID, to label their own comments. */
  selfId?: string;
}) {
  const { t, locale } = useTranslation();
  const zone = useDisplayTimeZone();
  const dates = createDateContext(locale, zone);
  const dateTime = (date: Date) =>
    t('date.at', { day: dates.formatShortDate(date), time: dates.formatTime(date) });
  return (
    <Card padding="none">
      {comments.map((c, index) => {
        const media = c.attachments.filter((f) => isMedia(f));
        const files = c.attachments.filter((f) => !isMedia(f));
        const mine = !!selfId && c.authorId === selfId;
        return (
          <View key={c.id}>
            {index > 0 ? <Divider inset={64} /> : null}
            <View className="flex-row gap-3 p-4">
              <Avatar name={c.authorName} uri={c.authorAvatarUrl} size="sm" />
              <View className="flex-1 gap-1.5">
                <View className="flex-row flex-wrap items-baseline gap-x-2">
                  <Text variant="subhead" weight="semibold">
                    {mine ? t('submissionFeedback.you') : c.authorName}
                  </Text>
                  <Text variant="caption" tone="subtle">
                    {showAttempt && c.attempt
                      ? t('submissionFeedback.attemptDate', {
                          date: dateTime(c.createdAt),
                          attempt: c.attempt,
                        })
                      : dateTime(c.createdAt)}
                  </Text>
                </View>
                {c.text ? (
                  <Text variant="body" selectable>
                    {c.text}
                  </Text>
                ) : null}
                {c.media ? (
                  <MediaPlayer
                    url={c.media.url}
                    kind={c.media.kind}
                    title={t(
                      c.media.kind === 'audio'
                        ? 'submissionFeedback.audioComment'
                        : 'submissionFeedback.videoComment',
                    )}
                  />
                ) : null}
                {media.map((f) => (
                  <MediaPlayer
                    key={f.id}
                    url={f.url}
                    kind={isMedia(f)!}
                    title={t(
                      isMedia(f) === 'audio'
                        ? 'submissionFeedback.voiceComment'
                        : 'submissionFeedback.videoComment',
                    )}
                  />
                ))}
                {files.length ? (
                  <AttachmentList attachments={files} courseId={courseId} className="mt-1" />
                ) : null}
              </View>
            </View>
          </View>
        );
      })}
    </Card>
  );
}
