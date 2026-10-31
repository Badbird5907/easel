import { Capsule, Circle, HStack, Link, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  containerBackground,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  padding,
  widgetURL,
} from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

import { plistSafe, WAITING_MESSAGE, widgetTheme } from './theme';
import type { ListWidgetProps, NextDueProps } from './types';

/*
 * iOS widgets (SYS-1) in SwiftUI through Expo UI. Each layout runs in the
 * widget extension's own runtime: it sees only its props and `environment`,
 * so every helper lives inside the function. Text uses system text styles,
 * which follow Dynamic Type. Lock Screen sizes leave colors to the system.
 */

const NextDueLayout = (props: NextDueProps, environment: WidgetEnvironment) => {
  'widget';
  const dark = environment.colorScheme === 'dark';
  const p = dark ? props.theme.dark : props.theme.light;
  const family = environment.widgetFamily;
  const tint = (color: { light: string; dark: string } | null) =>
    color ? (dark ? color.dark : color.light) : p.accentFg;

  if (family === 'accessoryInline') {
    return (
      <Text modifiers={[widgetURL(props.url)]}>{props.inline}</Text>
    );
  }

  if (family === 'accessoryRectangular') {
    if (props.state !== 'ready') {
      return (
        <Text modifiers={[font({ textStyle: 'headline' }), lineLimit(3), widgetURL(props.url)]}>
          {props.message}
        </Text>
      );
    }
    return (
      <VStack
        alignment="leading"
        spacing={1}
        modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), widgetURL(props.url)]}
      >
        <Text modifiers={[font({ textStyle: 'headline' }), lineLimit(1)]}>{props.headline}</Text>
        {props.title ? (
          <Text modifiers={[font({ textStyle: 'body' }), lineLimit(1)]}>{props.title}</Text>
        ) : null}
        {props.context ? (
          <Text modifiers={[font({ textStyle: 'caption' }), lineLimit(1)]}>{props.context}</Text>
        ) : null}
      </VStack>
    );
  }

  const background = containerBackground(p.surface, 'widget');

  if (props.state !== 'ready') {
    return (
      <VStack
        alignment="leading"
        spacing={4}
        modifiers={[
          frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'topLeading' }),
          background,
          widgetURL(props.url),
        ]}
      >
        <Text modifiers={[font({ textStyle: 'headline' }), foregroundStyle(p.fg)]}>Next due</Text>
        <Spacer />
        <Text modifiers={[font({ textStyle: 'subheadline' }), foregroundStyle(p.muted), lineLimit(4)]}>
          {props.message}
        </Text>
      </VStack>
    );
  }

  const main = (
    <VStack
      alignment="leading"
      spacing={4}
      modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'topLeading' })]}
    >
      <Text
        modifiers={[
          font({ textStyle: 'subheadline', weight: 'semibold' }),
          foregroundStyle(p.accentFg),
          lineLimit(2),
        ]}
      >
        {props.headline}
      </Text>
      {props.title ? (
        <Text modifiers={[font({ textStyle: 'headline' }), foregroundStyle(p.fg), lineLimit(2)]}>
          {props.title}
        </Text>
      ) : null}
      {props.context ? (
        <Text
          modifiers={[
            font({ textStyle: 'caption', weight: 'medium' }),
            foregroundStyle(tint(props.color)),
            lineLimit(1),
          ]}
        >
          {props.context}
        </Text>
      ) : null}
      <Spacer minLength={0} />
      {props.summary ? (
        <Text modifiers={[font({ textStyle: 'caption' }), foregroundStyle(p.muted), lineLimit(2)]}>
          {props.summary}
        </Text>
      ) : null}
    </VStack>
  );

  if (family !== 'systemMedium' || props.rows.length === 0) {
    return (
      <VStack
        modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity }), background, widgetURL(props.url)]}
      >
        {main}
      </VStack>
    );
  }

  return (
    <HStack
      alignment="top"
      spacing={14}
      modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity }), background, widgetURL(props.url)]}
    >
      {main}
      <VStack
        alignment="leading"
        spacing={8}
        modifiers={[frame({ maxWidth: Infinity, alignment: 'topLeading' })]}
      >
        {props.rows.slice(0, 3).map((row) => (
          <Link key={row.id} destination={row.url}>
            <HStack
              spacing={8}
              alignment="center"
              modifiers={[accessibilityLabel(`${row.title}, ${row.context}, ${row.detail}`)]}
            >
              <Capsule modifiers={[frame({ width: 4, height: 30 }), foregroundStyle(tint(row.color))]} />
              <VStack alignment="leading" spacing={1}>
                <Text
                  modifiers={[
                    font({ textStyle: 'footnote', weight: 'medium' }),
                    foregroundStyle(p.fg),
                    lineLimit(1),
                  ]}
                >
                  {row.title}
                </Text>
                <Text modifiers={[font({ textStyle: 'caption2' }), foregroundStyle(p.muted), lineLimit(1)]}>
                  {row.detail}
                </Text>
              </VStack>
            </HStack>
          </Link>
        ))}
        <Spacer minLength={0} />
      </VStack>
    </HStack>
  );
};

const ListLayout = (props: ListWidgetProps, environment: WidgetEnvironment) => {
  'widget';
  const dark = environment.colorScheme === 'dark';
  const p = dark ? props.theme.dark : props.theme.light;
  const large = environment.widgetFamily === 'systemLarge' || environment.widgetFamily === 'systemExtraLarge';
  const tint = (color: { light: string; dark: string }) => (dark ? color.dark : color.light);
  const rows = props.rows.slice(0, large ? 7 : 3);

  const header = (
    <HStack alignment="firstTextBaseline" spacing={8} modifiers={[frame({ maxWidth: Infinity })]}>
      <Text modifiers={[font({ textStyle: 'headline' }), foregroundStyle(p.fg), lineLimit(1)]}>
        {props.title}
      </Text>
      <Spacer />
      {props.state === 'ready' && props.summary ? (
        <Text modifiers={[font({ textStyle: 'caption' }), foregroundStyle(p.muted), lineLimit(1)]}>
          {props.summary}
        </Text>
      ) : null}
    </HStack>
  );

  let body;
  if (props.state !== 'ready') {
    body = (
      <VStack
        alignment="leading"
        spacing={4}
        modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'leading' })]}
      >
        <Text modifiers={[font({ textStyle: 'subheadline' }), foregroundStyle(p.muted), lineLimit(3)]}>
          {props.message}
        </Text>
      </VStack>
    );
  } else if (rows.length === 0) {
    body = (
      <VStack
        alignment="leading"
        modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'leading' })]}
      >
        <Text modifiers={[font({ textStyle: 'subheadline' }), foregroundStyle(p.muted), lineLimit(3)]}>
          {props.empty}
        </Text>
      </VStack>
    );
  } else {
    body = (
      <VStack
        alignment="leading"
        spacing={large ? 10 : 7}
        modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'topLeading' })]}
      >
        {rows.map((row) => (
          <Link key={row.id} destination={row.url}>
            <HStack
              spacing={10}
              alignment="center"
              modifiers={[
                frame({ maxWidth: Infinity }),
                accessibilityLabel(
                  [
                    row.title,
                    row.context,
                    row.flag === 'missing' ? 'Missing' : row.flag === 'unread' ? 'Unread' : '',
                    row.detail,
                  ]
                    .filter((part) => !!part)
                    .join(', '),
                ),
              ]}
            >
              <Capsule modifiers={[frame({ width: 4, height: 30 }), foregroundStyle(tint(row.color))]} />
              <VStack alignment="leading" spacing={1}>
                <Text
                  modifiers={[
                    font({ textStyle: 'subheadline', weight: 'medium' }),
                    foregroundStyle(p.fg),
                    lineLimit(1),
                  ]}
                >
                  {row.title}
                </Text>
                <Text modifiers={[font({ textStyle: 'caption' }), foregroundStyle(p.muted), lineLimit(1)]}>
                  {row.context}
                </Text>
              </VStack>
              <Spacer minLength={4} />
              {row.flag === 'unread' ? (
                <Circle modifiers={[frame({ width: 8, height: 8 }), foregroundStyle(p.accent)]} />
              ) : null}
              {row.flag === 'missing' ? (
                <Text
                  modifiers={[
                    font({ textStyle: 'caption', weight: 'semibold' }),
                    foregroundStyle(p.dangerFg),
                  ]}
                >
                  Missing
                </Text>
              ) : null}
              <Text
                modifiers={[
                  font({ textStyle: 'footnote', weight: 'medium' }),
                  foregroundStyle(p.fg),
                  lineLimit(1),
                ]}
              >
                {row.detail}
              </Text>
            </HStack>
          </Link>
        ))}
        <Spacer minLength={0} />
      </VStack>
    );
  }

  return (
    <VStack
      alignment="leading"
      spacing={large ? 12 : 8}
      modifiers={[
        frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'topLeading' }),
        padding({ vertical: 2 }),
        containerBackground(p.surface, 'widget'),
        widgetURL(props.url),
      ]}
    >
      {header}
      {body}
    </VStack>
  );
};

// Shown before Easel has published anything: the widget gallery, or right after install.
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
