/**
 * The rich text editor used for submissions, discussion replies, announcement
 * replies, and messages (ASSIGN-3, CONTENT-3). Values are HTML in and out,
 * sanitized to the tags Canvas keeps.
 *
 * A WebView holds one `contenteditable` region styled like Easel text; the
 * toolbar is native. The editor grows with its content inside a screen's
 * scroll view. While it has focus and the keyboard is up, it stops growing at
 * the space above the keyboard and scrolls inside, so the toolbar and caret
 * stay in view. Pass `scrollViewRef` (the screen's ScrollView) to have the
 * editor scroll itself above the keyboard when it gains focus.
 */
import {
  Bold,
  Heading,
  Italic,
  Link2,
  List,
  ListOrdered,
  type LucideIcon,
  Redo2,
  Underline,
  Undo2,
} from 'lucide-react-native';
import {
  type ComponentRef,
  type Ref,
  type RefObject,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AccessibilityInfo,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PixelRatio,
  Platform,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { Button, Divider, haptics, IconButton, Text, TextField, useTheme } from '@/design';
import { useTranslation, type MessageKey } from '@/i18n';
import { scriptJson } from '@/features/content/presentation';

import { cn } from '@/lib/cn';

import { buildEditorDocument, emptyFormat, type FormatState, themeVariables } from './editorDocument';

export type RichEditorProps = {
  /** HTML. */
  value: string;
  onChange: (html: string) => void;
  /** Visible label above the editor. Also its accessibility label. */
  label?: string;
  placeholder?: string;
  /** Used when there's no visible label. */
  accessibilityLabel?: string;
  /** Height of the empty editor's writing area in points. */
  minHeight?: number;
  autoFocus?: boolean;
  editable?: boolean;
  /** Hint below the editor. Replaced by `error`. */
  helperText?: string;
  error?: string | null;
  onFocus?: () => void;
  onBlur?: () => void;
  /** The screen's scroll view, so the editor can bring itself above the keyboard. */
  scrollViewRef?: RefObject<ComponentRef<typeof ScrollView> | null>;
  ref?: Ref<RichEditorHandle>;
};

export type RichEditorHandle = {
  focus: () => void;
  blur: () => void;
  /** Inserts an image at the caret, e.g. after uploading it to Canvas. */
  insertImage: (src: string, alt?: string) => void;
};

/** Runs a script in the editor page. */
const inject = (web: RefObject<WebView<object> | null>, js: string) =>
  web.current?.injectJavaScript(`${js};true;`);

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Plain paragraphs to HTML, for callers that start from plain text. */
export const textToHtml = (text: string) =>
  text.trim()
    ? text
        .split(/\n{2,}/)
        .map((p) => `<p>${escape(p).replace(/\n/g, '<br>')}</p>`)
        .join('')
    : '';

/** True when the HTML has no visible text or images. */
export function isBlankHtml(html: string): boolean {
  if (/<img\s/i.test(html)) return false;
  return (
    html
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;|&#160;/g, ' ')
      .trim().length === 0
  );
}

type ToolbarItem = {
  key: keyof FormatState | 'link';
  command: string;
  icon: LucideIcon;
  label: MessageKey;
  /** Format state that marks the button selected. */
  selected?: keyof FormatState;
  /** Format state that enables the button. */
  enabledBy?: keyof FormatState;
};

const toolbar: ToolbarItem[][] = [
  [
    { key: 'bold', command: 'bold', icon: Bold, label: 'editor.bold', selected: 'bold' },
    { key: 'italic', command: 'italic', icon: Italic, label: 'editor.italic', selected: 'italic' },
    {
      key: 'underline',
      command: 'underline',
      icon: Underline,
      label: 'editor.underline',
      selected: 'underline',
    },
    { key: 'heading', command: 'heading', icon: Heading, label: 'editor.heading', selected: 'heading' },
  ],
  [
    {
      key: 'bulleted',
      command: 'insertUnorderedList',
      icon: List,
      label: 'editor.bulleted',
      selected: 'bulleted',
    },
    {
      key: 'numbered',
      command: 'insertOrderedList',
      icon: ListOrdered,
      label: 'editor.numbered',
      selected: 'numbered',
    },
    { key: 'link', command: 'link', icon: Link2, label: 'editor.link', selected: 'link' },
  ],
  [
    { key: 'canUndo', command: 'undo', icon: Undo2, label: 'editor.undo', enabledBy: 'canUndo' },
    { key: 'canRedo', command: 'redo', icon: Redo2, label: 'editor.redo', enabledBy: 'canRedo' },
  ],
];

/** Room for the stack header above a focused editor, and a little air. */
const HEADER_ALLOWANCE = Platform.OS === 'ios' ? 56 : 64;
const TOOLBAR_HEIGHT = 48;

export function RichEditor({
  value,
  onChange,
  label,
  placeholder = '',
  accessibilityLabel,
  minHeight = 140,
  autoFocus,
  editable = true,
  helperText,
  error,
  onFocus,
  onBlur,
  scrollViewRef,
  ref,
}: RichEditorProps) {
  const { t, locale, direction } = useTranslation();
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const webRef = useRef<WebView<object>>(null);
  const boxRef = useRef<ComponentRef<typeof View>>(null);
  const fontScale = PixelRatio.getFontScale();
  const name = label ?? accessibilityLabel ?? t('editor.defaultLabel');

  const [ready, setReady] = useState(false);
  const [focused, setFocused] = useState(false);
  const [contentHeight, setContentHeight] = useState(minHeight);
  const [format, setFormat] = useState<FormatState>(emptyFormat);
  const [keyboardTop, setKeyboardTop] = useState<number | null>(null);
  const [link, setLink] = useState<{ text: string; href: string; editing: boolean } | null>(null);

  // What the editor reported and the parent hasn't caught up with yet. While typing fast, a
  // render can carry an older value than the editor already sent (its effect runs after the
  // next 'change' arrives); that's an echo, not a new document, so it must not reset the text.
  const emitted = useRef<string[]>([value]);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  // Built once: later value and theme changes are applied in place, keeping the caret and undo history.
  const [document] = useState(() =>
    buildEditorDocument({
      html: value,
      theme: { colors, fontScale },
      dark: scheme === 'dark',
      placeholder,
      label: name,
      locale,
      direction,
      editable,
    }),
  );

  const source = useMemo(() => ({ html: document }), [document]);

  const run = (js: string) => inject(webRef, js);

  useEffect(() => {
    if (!ready) return;
    const sent = emitted.current;
    if (value === sent[sent.length - 1]) {
      // Caught up with the editor.
      emitted.current = [value];
      return;
    }
    const echo = sent.indexOf(value);
    if (echo >= 0) {
      // An older value the editor sent; the newer ones are still on their way.
      emitted.current = sent.slice(echo);
      return;
    }
    // A change from outside the editor: a restored draft, or clearing after submit.
    emitted.current = [value];
    inject(webRef, `window.easel.setHTML(${scriptJson(value)})`);
  }, [value, ready]);

  useEffect(() => {
    if (!ready) return;
    inject(
      webRef,
      `window.easel.setTheme(${scriptJson(themeVariables({ colors, fontScale }))}, ${scheme === 'dark'})`,
    );
  }, [colors, scheme, fontScale, ready]);

  useEffect(() => {
    if (ready) inject(webRef, `window.easel.setEditable(${editable})`);
  }, [editable, ready]);

  useEffect(() => {
    if (ready)
      inject(
        webRef,
        `window.easel.setPresentation(${scriptJson({ label: name, placeholder, locale, direction })})`,
      );
  }, [name, placeholder, locale, direction, ready]);

  useEffect(() => {
    if (ready && autoFocus) inject(webRef, 'window.easel.focus()');
    // Only on first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => inject(webRef, 'window.easel.focus()'),
      blur: () => inject(webRef, 'window.easel.blur()'),
      insertImage: (src, alt) =>
        inject(webRef, `window.easel.insertImage(${scriptJson(src)}, ${scriptJson(alt ?? '')})`),
    }),
    [],
  );

  // Keyboard position, for capping the focused editor above it.
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) =>
      setKeyboardTop(e.endCoordinates.screenY),
    );
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () =>
      setKeyboardTop(null),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const natural = Math.max(minHeight, contentHeight);
  const cap =
    focused && keyboardTop !== null
      ? Math.max(minHeight, keyboardTop - insets.top - HEADER_ALLOWANCE - TOOLBAR_HEIGHT - 16)
      : Infinity;
  const height = Math.min(natural, cap, windowHeight * 4);
  const scrollsInside = natural > height;

  // Once the keyboard is up, bring the whole editor above it.
  useEffect(() => {
    if (!focused || keyboardTop === null || !scrollViewRef?.current || !boxRef.current) return;
    const timer = setTimeout(() => {
      if (boxRef.current)
        scrollViewRef.current?.scrollResponderScrollNativeHandleToKeyboard(boxRef.current, 12, true);
    }, 60);
    return () => clearTimeout(timer);
  }, [focused, keyboardTop, scrollViewRef]);

  const onMessage = (event: WebViewMessageEvent) => {
    let message: { type: string; [key: string]: unknown };
    try {
      message = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    switch (message.type) {
      case 'ready':
        setReady(true);
        break;
      case 'change': {
        const html = String(message.html ?? '');
        emitted.current = [...emitted.current.slice(-50), html];
        onChangeRef.current(html);
        break;
      }
      case 'height':
        setContentHeight(Math.ceil(Number(message.value) || 0));
        break;
      case 'state':
        setFormat(message.state as FormatState);
        break;
      case 'focus':
        setFocused(true);
        onFocus?.();
        break;
      case 'blur':
        setFocused(false);
        onBlur?.();
        break;
      case 'link': {
        const href = String(message.href ?? '');
        Keyboard.dismiss();
        setLink({ text: String(message.text ?? ''), href, editing: !!href });
        break;
      }
    }
  };

  const press = (item: ToolbarItem) => {
    haptics.selection();
    if (item.command === 'link') {
      run('window.easel.requestLink()');
      return;
    }
    run(`window.easel.exec(${scriptJson(item.command)})`);
    if (item.selected) {
      const turnedOn = !format[item.selected];
      AccessibilityInfo.announceForAccessibility(
        t(turnedOn ? 'editor.formatOn' : 'editor.formatOff', { name: t(item.label) }),
      );
    }
  };

  const applyLink = (href: string, text: string) => {
    setLink(null);
    run(`window.easel.applyLink(${scriptJson(href)}, ${scriptJson(text)})`);
  };

  const note = error || helperText;

  return (
    <View className="gap-1.5" style={{ direction }}>
      {label ? (
        <Text variant="subhead" weight="medium" tone="muted" className="px-1">
          {label}
        </Text>
      ) : null}
      <View
        ref={boxRef}
        className={cn(
          'overflow-hidden rounded-xl border-[1.5px] border-transparent bg-surface-sunken',
          focused && 'border-accent bg-surface',
          !!error && 'border-danger',
          !editable && 'opacity-50',
        )}
        style={{ borderCurve: 'continuous' }}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="always"
          accessibilityRole="toolbar"
          accessibilityLabel={t('editor.formatting', { name })}
          contentContainerClassName="items-center gap-0.5 px-1.5"
          style={{ minHeight: TOOLBAR_HEIGHT, flexGrow: 0 }}
        >
          {toolbar.map((group, g) => (
            <View key={g} className="flex-row items-center gap-0.5">
              {g > 0 ? <View className="w-hairline mx-1 h-5 bg-border-strong" /> : null}
              {group.map((item) => {
                const selected = item.selected ? format[item.selected] : false;
                const disabled = !editable || !ready || (item.enabledBy ? !format[item.enabledBy] : false);
                return (
                  <IconButton
                    key={item.key}
                    icon={item.icon}
                    accessibilityLabel={t(item.label)}
                    accessibilityState={{ selected, disabled }}
                    variant={selected ? 'tonal' : 'ghost'}
                    iconColor={selected ? colors.accentFg : colors.fgMuted}
                    disabled={disabled}
                    onPress={() => press(item)}
                  />
                );
              })}
            </View>
          ))}
        </ScrollView>
        <Divider />
        <View style={{ height }}>
          <WebView
            ref={webRef}
            source={source}
            originWhitelist={['*']}
            style={{ backgroundColor: 'transparent' }}
            containerStyle={{ backgroundColor: 'transparent' }}
            scrollEnabled={scrollsInside}
            nestedScrollEnabled={scrollsInside}
            showsVerticalScrollIndicator={scrollsInside}
            showsHorizontalScrollIndicator={false}
            bounces={false}
            overScrollMode="never"
            hideKeyboardAccessoryView
            keyboardDisplayRequiresUserAction={false}
            automaticallyAdjustContentInsets={false}
            contentInsetAdjustmentBehavior="never"
            allowsLinkPreview={false}
            // iOS only; Android's Fabric props crash on the string form.
            {...(Platform.OS === 'ios' && { dataDetectorTypes: ['none'] as const })}
            textZoom={100}
            javaScriptEnabled
            setSupportMultipleWindows={false}
            accessibilityLabel={name}
            onMessage={onMessage}
            onShouldStartLoadWithRequest={(request) =>
              request.url === 'about:blank' || request.url.startsWith('data:') || !ready
            }
          />
        </View>
      </View>
      {note ? (
        <Text
          variant="footnote"
          tone={error ? 'danger' : 'muted'}
          className="px-1"
          accessibilityLiveRegion={error ? 'polite' : undefined}
        >
          {note}
        </Text>
      ) : null}
      <LinkSheet
        link={link}
        onCancel={() => {
          setLink(null);
          run('window.easel.focus()');
        }}
        onApply={applyLink}
      />
    </View>
  );
}

/**
 * Add, change, or remove a link on the selection. A bottom panel like Sheet,
 * but it rides above the keyboard, since both of its fields are for typing.
 */
function LinkSheet({
  link,
  onCancel,
  onApply,
}: {
  link: { text: string; href: string; editing: boolean } | null;
  onCancel: () => void;
  onApply: (href: string, text: string) => void;
}) {
  const { t, direction } = useTranslation();
  const insets = useSafeAreaInsets();
  const [href, setHref] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState<'invalid' | null>(null);
  const [shownFor, setShownFor] = useState<typeof link>(null);
  if (link !== shownFor) {
    setShownFor(link);
    setHref(link?.href ?? '');
    setText(link?.text ?? '');
    setError(null);
  }

  const save = () => {
    const trimmed = href.trim();
    if (!trimmed) {
      onApply('', text);
      return;
    }
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
    if (!/^(https?:\/\/[^\s]+\.[^\s]+|mailto:\S+@\S+)$/i.test(withScheme)) {
      setError('invalid');
      return;
    }
    onApply(withScheme, text.trim());
  };

  return (
    <Modal
      visible={!!link}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onCancel}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 justify-end"
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('editor.close')}
          onPress={onCancel}
          className="absolute inset-0 bg-overlay/40"
        />
        <View
          accessibilityViewIsModal
          className="gap-4 rounded-t-3xl border-x-hairline border-t-hairline border-border bg-bg px-4 pt-4"
          style={{ direction, paddingBottom: Math.max(insets.bottom, 16), borderCurve: 'continuous' }}
        >
          <View className="min-h-11 flex-row items-center gap-3 px-1">
            <Text variant="headline" accessibilityRole="header" className="flex-1">
              {t(link?.editing ? 'editor.editLink' : 'editor.addLink')}
            </Text>
            <Pressable
              accessibilityRole="button"
              hitSlop={12}
              onPress={onCancel}
              className="active:opacity-60"
            >
              <Text variant="body" weight="semibold" tone="accent">
                {t('editor.cancel')}
              </Text>
            </Pressable>
          </View>
          <TextField
            label={t('editor.webAddress')}
            placeholder={t('editor.addressPlaceholder')}
            value={href}
            onChangeText={(v) => {
              setHref(v);
              setError(null);
            }}
            error={error ? t('editor.linkInvalid') : null}
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            returnKeyType="next"
            onSubmitEditing={save}
          />
          <TextField
            label={t('editor.linkText')}
            placeholder={t('editor.linkTextPlaceholder')}
            value={text}
            onChangeText={setText}
            returnKeyType="done"
            onSubmitEditing={save}
          />
          <View className="flex-row gap-3">
            {link?.editing ? (
              <Button variant="secondary" className="flex-1" onPress={() => onApply('', text)}>
                {t('editor.removeLink')}
              </Button>
            ) : null}
            <Button className="flex-1" onPress={save}>
              {t(link?.editing ? 'editor.save' : 'editor.addLink')}
            </Button>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
