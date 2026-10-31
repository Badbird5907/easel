import { Column, LazyColumn, Row, Spacer, Text } from '@expo/ui/jetpack-compose';
import {
  background,
  cornerRadius,
  fillMaxSize,
  fillMaxWidth,
  height,
  paddingAll,
  width,
} from '@expo/ui/jetpack-compose/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

import { plistSafe, WAITING_MESSAGE, widgetTheme } from './theme';
import type { ListWidgetProps, NextDueProps } from './types';

/*
 * Android widgets (SYS-1) in Jetpack Compose through Expo UI, rendered by
 * Glance. Glance supports a subset of components and modifiers (no weights,
 * no click-through links in expo-widgets 58), and Android passes only the
 * color scheme, so each widget is one layout that reads well at its default
 * size. Every helper lives inside the function: the widget runtime sees
 * nothing else.
 */

const NextDueLayout = (props: NextDueProps, environment: WidgetEnvironment) => {
  'widget';
  const dark = environment.colorScheme === 'dark';
  const p = dark ? props.theme.dark : props.theme.light;
  const tint = (color: { light: string; dark: string } | null) =>
    color ? (dark ? color.dark : color.light) : p.accentFg;
  const frame = [fillMaxSize(), background(p.surface), cornerRadius(24), paddingAll(12)];

  if (props.state !== 'ready') {
    return (
      <Column modifiers={frame}>
        <Text color={p.fg} style={{ fontSize: 15, fontWeight: 'bold' }} maxLines={1}>
          Next due
        </Text>
        <Spacer modifiers={[height(6)]} />
        <Text color={p.muted} style={{ fontSize: 13 }} maxLines={4}>
          {props.message}
        </Text>
      </Column>
    );
  }

  return (
    <Column modifiers={frame}>
      <Text color={p.accentFg} style={{ fontSize: 13, fontWeight: 'bold' }} maxLines={2}>
        {props.headline}
      </Text>
      <Spacer modifiers={[height(4)]} />
      {props.title ? (
        <Text color={p.fg} style={{ fontSize: 14, fontWeight: 'bold' }} maxLines={2}>
          {props.title}
        </Text>
      ) : null}
      {props.context ? (
        <Text color={tint(props.color)} style={{ fontSize: 12, fontWeight: 'bold' }} maxLines={1}>
          {props.context}
        </Text>
      ) : null}
    </Column>
  );
};

const ListLayout = (props: ListWidgetProps, environment: WidgetEnvironment) => {
  'widget';
  const dark = environment.colorScheme === 'dark';
  const p = dark ? props.theme.dark : props.theme.light;
  const tint = (color: { light: string; dark: string }) => (dark ? color.dark : color.light);
  const rows = props.rows.slice(0, 7);

  const header = (
    <Column modifiers={[fillMaxWidth()]}>
      <Text color={p.fg} style={{ fontSize: 15, fontWeight: 'bold' }} maxLines={1}>
        {props.title}
      </Text>
      {props.state === 'ready' && props.summary ? <Spacer modifiers={[height(3)]} /> : null}
      {props.state === 'ready' && props.summary ? (
        <Text color={p.muted} style={{ fontSize: 12 }} maxLines={1}>
          {props.summary}
        </Text>
      ) : null}
    </Column>
  );

  const message = props.state !== 'ready' ? props.message : rows.length === 0 ? props.empty : null;

  return (
    <Column modifiers={[fillMaxSize(), background(p.surface), cornerRadius(24), paddingAll(14)]}>
      {header}
      <Spacer modifiers={[height(8)]} />
      {message !== null ? (
        <Text color={p.muted} style={{ fontSize: 13 }} maxLines={3}>
          {message}
        </Text>
      ) : (
        <LazyColumn modifiers={[fillMaxWidth()]}>
          {rows.map((row) => (
            <Row key={row.id} modifiers={[fillMaxWidth(), paddingAll(3)]} verticalAlignment="center">
              <Spacer modifiers={[width(4), height(30), background(tint(row.color)), cornerRadius(2)]} />
              <Spacer modifiers={[width(10)]} />
              <Column>
                <Text color={p.fg} style={{ fontSize: 14, fontWeight: 'bold' }} maxLines={1}>
                  {row.title}
                </Text>
                <Text
                  color={row.flag === 'missing' ? p.dangerFg : p.muted}
                  style={{ fontSize: 12 }}
                  maxLines={1}
                >
                  {[
                    row.flag === 'missing' ? 'Missing' : row.flag === 'unread' ? 'Unread' : '',
                    row.context,
                    row.detail,
                  ]
                    .filter((part) => !!part)
                    .join(' · ')}
                </Text>
              </Column>
            </Row>
          ))}
        </LazyColumn>
      )}
    </Column>
  );
};

const list = (title: string, url: string): ListWidgetProps =>
  plistSafe({
    state: 'waiting',
    theme: widgetTheme,
    url,
    title,
    summary: '',
    rows: [],
    empty: '',
    message: WAITING_MESSAGE,
  });

export const NextDueWidget = createWidget<NextDueProps>(
  'NextDueWidget',
  NextDueLayout,
  plistSafe({
    state: 'waiting',
    theme: widgetTheme,
    url: 'easel://todo',
    headline: 'Next due',
    title: null,
    context: null,
    color: null,
    summary: null,
    inline: 'Open Easel',
    rows: [],
    message: WAITING_MESSAGE,
  }),
);
export const TodoWidget = createWidget<ListWidgetProps>(
  'TodoWidget',
  ListLayout,
  list('To Do', 'easel://todo'),
);
export const AnnouncementsWidget = createWidget<ListWidgetProps>(
  'AnnouncementsWidget',
  ListLayout,
  list('Announcements', 'easel://announcements'),
);
export const GradesWidget = createWidget<ListWidgetProps>(
  'GradesWidget',
  ListLayout,
  list('Grades', 'easel://grades'),
);
