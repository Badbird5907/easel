import { useQueryClient } from '@tanstack/react-query';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { BookOpen, Bug, CircleCheck, LifeBuoy, MessageCircleQuestion } from 'lucide-react-native';
import { useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Platform, View } from 'react-native';

import { useDashboardCourses } from '@/canvas/api/courses';
import { type HelpLink, type Severity, useHelpLinks, useSendProblemReport } from '@/canvas/api/help';
import { useProfile } from '@/canvas/api/profile';
import { useCanvas } from '@/canvas/session';
import {
  AccentScope,
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  haptics,
  IconTile,
  ListGroup,
  ListItem,
  type Option,
  OptionGroup,
  Screen,
  Sheet,
  Text,
  TextField,
} from '@/design';
import { SettingsHelpEffects, useSettingsHelpOwner } from '@/features/settings/settingsHelpLifetime';
import { type Translate, useTranslation } from '@/i18n';
import { isOnline } from '@/features/offline/connectivity';
import { SettingsReportForm, useSettingsReportOwner } from '@/features/settings/settingsReportLifetime';
import { openCanvasLink, resolveCanvasLink } from '@/features/content/links';
import { ListSkeleton, LoadError } from '@/features/course/states';
import { useOnline } from '@/features/offline/useOnline';

const iconFor = (link: HelpLink) =>
  link.action.kind === 'ask-instructor'
    ? MessageCircleQuestion
    : link.action.kind === 'report-problem'
      ? Bug
      : BookOpen;

const severities: (t: Translate) => Option<Severity>[] = (t) => [
  { value: 'just_a_comment', label: t('settingsReport.comment'), subtitle: t('settingsReport.commentBody') },
  { value: 'not_urgent', label: t('settingsReport.notUrgent'), subtitle: t('settingsReport.notUrgentBody') },
  {
    value: 'workaround_possible',
    label: t('settingsReport.workaround'),
    subtitle: t('settingsReport.workaroundBody'),
  },
  {
    value: 'blocks_what_i_need_to_do',
    label: t('settingsReport.blocking'),
    subtitle: t('settingsReport.blockingBody'),
  },
  {
    value: 'extreme_critical_emergency',
    label: t('settingsReport.emergency'),
    subtitle: t('settingsReport.emergencyBody'),
  },
];

/** The school's help menu (SET-11): guides, asking an instructor, and reporting a problem. */
function HelpLinks() {
  const { account, client } = useCanvas();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const help = useHelpLinks();
  const courses = useDashboardCourses();
  const [effects] = useState(() => new SettingsHelpEffects());
  const identity = useMemo(
    () => ({
      accountId: account.id,
      userId: account.user.id,
      baseUrl: account.baseUrl,
      host: account.host,
      expired: account.expired,
      client,
      queryClient,
      data: help.data,
      pending: help.isPending,
      failed: help.isError,
      error: help.error,
      refetch: help.refetch,
    }),
    [
      account.id,
      account.user.id,
      account.baseUrl,
      account.host,
      account.expired,
      client,
      queryClient,
      help.data,
      help.isPending,
      help.isError,
      help.error,
      help.refetch,
    ],
  );
  const owner = useSettingsHelpOwner(identity);
  useLayoutEffect(() => {
    owner.setTeachers(t('settingsHelp.teachers'));
  }, [owner, t]);
  const courseIdentity = useMemo(
    () => ({
      data: courses.data,
      pending: courses.isPending,
      failed: courses.isError,
      error: courses.error,
      refetch: courses.refetch,
    }),
    [courses.data, courses.isPending, courses.isError, courses.error, courses.refetch],
  );
  const courseOwner = useSettingsHelpOwner(courseIdentity, owner);
  const [ask, setAsk] = useState<{ owner: typeof owner; ticket: object } | null>(null);
  const ready = !account.expired && !help.isPending && !help.isError && !!help.data;
  const askOpen = ready && ask?.owner === owner;
  const ticket = askOpen ? ask.ticket : null;

  const open = (link: HelpLink) => {
    if (!ready || !help.data?.links.includes(link) || !owner.current()) return;
    switch (link.action.kind) {
      case 'ask-instructor': {
        const next = owner.openSheet();
        if (next) setAsk({ owner, ticket: next });
        return;
      }
      case 'report-problem':
        return owner.navigate(() => router.push({ pathname: '/help', params: { report: '1' } }));
      case 'url': {
        const { url } = link.action;
        // Preserve the existing same-school native routing and external browser boundary.
        const sameSchool = (() => {
          try {
            return new URL(url, account.baseUrl).host === new URL(account.baseUrl).host;
          } catch {
            return false;
          }
        })();
        if (sameSchool && resolveCanvasLink(url, account.baseUrl)) {
          return owner.navigate(() => openCanvasLink(url, account.baseUrl));
        }
        return owner.run(effects, 'browser', () =>
          sameSchool ? openCanvasLink(url, account.baseUrl) : WebBrowser.openBrowserAsync(url),
        );
      }
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          title:
            help.data && help.data.nameOrigin !== 'generated-help' ? help.data.name : t('settingsHelp.title'),
        }}
      />
      <Screen contentClassName="gap-6">
        {help.isPending || (!help.data && !help.isError) ? (
          <View accessible accessibilityLabel={t('settingsHelp.loading')}>
            <ListSkeleton rows={3} />
          </View>
        ) : help.isError ? (
          <LoadError
            title={t('settingsHelp.loadError')}
            error={help.error}
            onRetry={() => {
              if (!account.expired) void owner.run(effects, 'help-retry', () => help.refetch());
            }}
          />
        ) : help.data!.links.length === 0 ? (
          <Card padding="none">
            <EmptyState
              icon={LifeBuoy}
              title={t('settingsHelp.empty')}
              description={t('settingsHelp.emptyBody', { host: account.host })}
            />
          </Card>
        ) : (
          <ListGroup footer={t('settingsHelp.footer', { host: account.host })}>
            {help.data!.links.map((link) => {
              const details = [link.isNew ? t('settingsHelp.new') : null, link.subtitle]
                .filter(Boolean)
                .join(t('settingsHelp.separator'));
              return (
                <ListItem
                  key={link.id}
                  leading={<IconTile icon={iconFor(link)} tone={link.featured ? 'accent' : 'neutral'} />}
                  title={link.title}
                  subtitle={link.subtitle ?? undefined}
                  trailing={
                    link.isNew ? (
                      <Badge tone="accent" size="sm">
                        {t('settingsHelp.new')}
                      </Badge>
                    ) : null
                  }
                  accessibilityLabel={t('settingsHelp.linkLabel', {
                    title: link.title,
                    details: details ? t('settingsHelp.separator') + details : '',
                  })}
                  onPress={() => open(link)}
                />
              );
            })}
          </ListGroup>
        )}
      </Screen>

      <Sheet
        visible={askOpen}
        title={t('settingsHelp.ask')}
        onClose={() => {
          if (courseOwner.current() && owner.closeSheet(ticket)) setAsk(null);
        }}
      >
        {courses.isError ? (
          <LoadError
            title={t('settingsHelp.coursesError')}
            error={courses.error}
            onRetry={() => {
              if (owner.ownsSheet(ticket))
                void courseOwner.run(effects, 'courses-retry', () => courses.refetch());
            }}
          />
        ) : !courses.isPending && courses.data?.length ? (
          <ListGroup header={t('settingsHelp.whichCourse')} footer={t('settingsHelp.courseFooter')}>
            {courses.data.map((course) => (
              <ListItem
                key={course.id}
                leading={
                  <AccentScope color={course.color}>
                    <IconTile icon={MessageCircleQuestion} tone="accent" />
                  </AccentScope>
                }
                title={course.name}
                subtitle={course.code}
                onPress={() => {
                  if (!courseOwner.current() || !owner.ownsSheet(ticket) || !courses.data?.includes(course))
                    return;
                  if (!owner.closeSheet(ticket)) return;
                  setAsk(null);
                  owner.navigate(() =>
                    router.push({
                      pathname: '/compose',
                      params: {
                        courseId: course.id,
                        recipientIds: `course_${course.id}_teachers`,
                        // Composer treats supplied names as launch-language snapshots.
                        recipientNames: owner.teacherLabel(),
                      },
                    }),
                  );
                }}
              />
            ))}
          </ListGroup>
        ) : (
          <Text variant="subhead" tone="muted" align="center" className="py-6">
            {courses.isPending || !courses.data
              ? t('settingsHelp.coursesLoading')
              : t('settingsHelp.coursesEmpty')}
          </Text>
        )}
      </Sheet>
    </>
  );
}

/** "Report a problem" (SET-11): `POST /api/v1/error_reports`, which reaches the school's Canvas support. */
function ReportProblem() {
  const { account, client } = useCanvas();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const profile = useProfile();
  const send = useSendProblemReport();
  const online = useOnline();
  const identity = useMemo(
    () => ({
      accountId: account.id,
      userId: account.user.id,
      baseUrl: account.baseUrl,
      host: account.host,
      client,
      queryClient,
    }),
    [account.id, account.user.id, account.baseUrl, account.host, client, queryClient],
  );
  const form = useMemo(() => new SettingsReportForm(identity), [identity]);
  const owner = useSettingsReportOwner(identity);
  const state = useSyncExternalStore(form.subscribe, form.get, form.get);
  const profileEmail = profile.data?.email ?? '';
  useLayoutEffect(() => {
    form.setProfileEmail(profileEmail);
  }, [form, profileEmail]);
  const { subject, description, severity, email } = state.draft;
  const { tried } = state;
  const replyTo = email ?? profileEmail;
  const errors = {
    subject: !subject.trim() ? t('settingsReport.subjectRequired') : null,
    description: !description.trim() ? t('settingsReport.descriptionRequired') : null,
    severity: !severity ? t('settingsReport.severityRequired') : null,
  };
  const submit = () =>
    form.submit(owner, {
      online: isOnline,
      host: account.host,
      warning: haptics.warning,
      success: haptics.success,
      error: haptics.error,
      send: (draft) => {
        const result = send.mutateAsync({
          ...draft,
          context: {
            Hostname: account.baseUrl,
            User: account.user.id,
            'App Version': `Easel ${Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? ''} (${Application.nativeBuildVersion ?? 'dev'})`,
            Platform: Platform.OS === 'ios' ? 'iOS' : 'Android',
            'OS Version': String(Platform.Version),
          },
        });
        // Detach immediately: pending MutationObserver options otherwise change on
        // later account renders. This does not cancel an already-entered request.
        send.reset();
        return result;
      },
    });
  const success = state.success?.current() ? state.success : null;
  if (success)
    return (
      <>
        <Stack.Screen options={{ title: t('settingsReport.title') }} />
        <Screen>
          <Card padding="none">
            <EmptyState
              icon={CircleCheck}
              title={t('settingsReport.sent')}
              description={
                success.email
                  ? t('settingsReport.sentReply', { host: success.host, email: success.email })
                  : t('settingsReport.sentBody', { host: success.host })
              }
              action={{
                label: t('settingsReport.done'),
                onPress: () => form.done(success, () => router.back()),
              }}
            />
          </Card>
        </Screen>
      </>
    );

  return (
    <>
      <Stack.Screen options={{ title: t('settingsReport.title') }} />
      <Screen contentClassName="gap-6">
        <Text variant="body" tone="muted">
          {t('settingsReport.instructions', { host: account.host })}
        </Text>
        <Card className="gap-4">
          <TextField
            label={t('settingsReport.subject')}
            value={subject}
            onChangeText={(value) => form.change(owner, { subject: value })}
            error={tried ? errors.subject : null}
            returnKeyType="next"
          />
          <TextField
            label={t('settingsReport.description')}
            value={description}
            onChangeText={(value) => form.change(owner, { description: value })}
            multiline
            placeholder={t('settingsReport.placeholder')}
            error={tried ? errors.description : null}
          />
          <TextField
            label={t('settingsReport.replyTo')}
            value={replyTo}
            onChangeText={(value) => form.change(owner, { email: value })}
            onSubmitEditing={submit}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            textContentType="emailAddress"
            helperText={t('settingsReport.replyHelp')}
          />
        </Card>
        <View className="gap-2">
          <OptionGroup
            header={t('settingsReport.severity')}
            options={severities(t)}
            selected={severity}
            onSelect={(value) => form.change(owner, { severity: value })}
          />
          {tried && errors.severity ? (
            <Text variant="footnote" tone="danger" className="px-4" accessibilityLiveRegion="polite">
              {errors.severity}
            </Text>
          ) : null}
        </View>
        {state.error?.current() ? (
          <Callout tone="danger" title={t('settingsReport.failed')}>
            {state.error.message}
          </Callout>
        ) : null}
        <Button size="lg" loading={state.pending?.owner === owner} disabled={!online} onPress={submit}>
          {t('settingsReport.send')}
        </Button>
      </Screen>
    </>
  );
}

export default function HelpScreen() {
  const { report } = useLocalSearchParams<{ report?: string }>();
  return report === '1' ? <ReportProblem /> : <HelpLinks />;
}
