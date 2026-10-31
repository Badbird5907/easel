import {
  ArrowRight,
  Bell,
  BookOpen,
  Download,
  GraduationCap,
  Lock,
  Mail,
  Megaphone,
  Paperclip,
  Plus,
  Send,
  Settings,
  Sparkles,
  Star,
  Trash2,
} from 'lucide-react-native';
import { Redirect } from 'expo-router';
import { type ComponentRef, type ReactNode, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import {
  AccentScope,
  Avatar,
  Badge,
  type BadgeTone,
  Button,
  type ButtonVariant,
  Callout,
  Card,
  Chip,
  type ColorToken,
  courseColors,
  EmptyState,
  IconButton,
  IconTile,
  ListGroup,
  ListItem,
  OptionGroup,
  palettes,
  ProgressBar,
  ProgressRing,
  Screen,
  SearchField,
  Section,
  SegmentedControl,
  Sheet,
  Skeleton,
  Switch,
  Text,
  TextField,
  textVariants,
  type Tone,
  typeScale,
  useSchemePreference,
  useTheme,
  useToast,
} from '@/design';
import { useDeveloperMode } from '@/features/settings/developer';
import { cn } from '@/lib/cn';

const tones: Tone[] = ['accent', 'success', 'warning', 'danger', 'info'];
const buttonVariants: ButtonVariant[] = ['primary', 'secondary', 'tonal', 'outline', 'ghost', 'destructive'];

const tokenGroups: { title: string; tokens: ColorToken[] }[] = [
  { title: 'Surfaces', tokens: ['bg', 'surface', 'surfaceRaised', 'surfaceSunken'] },
  { title: 'Text', tokens: ['fg', 'fgMuted', 'fgSubtle'] },
  { title: 'Lines', tokens: ['border', 'borderStrong'] },
];

const accentChoices = [
  { id: 'brand', name: 'Ultramarine', color: null as string | null, swatch: palettes.light.accent },
  ...courseColors.map((c) => ({
    id: c.id,
    name: c.name,
    color: c.light as string | null,
    swatch: c.light as string,
  })),
];

export default function DesignScreen() {
  // Release builds hide the gallery unless developer mode is on (SET-13), even from a deep link.
  if (!useDeveloperMode().enabled) return <Redirect href="/settings" />;
  return <DesignGallery />;
}

function DesignGallery() {
  const [accentId, setAccentId] = useState('brand');
  const accent = accentChoices.find((c) => c.id === accentId) ?? accentChoices[0];
  const toast = useToast();

  return (
    <AccentScope color={accent.color} className="flex-1">
      <Screen>
        <ThemeSection accentId={accentId} onAccentChange={setAccentId} accentName={accent.name} />
        <ColorsSection />
        <TypographySection />
        <ButtonsSection />
        <InputsSection />
        <SelectionSection />
        <BadgesSection />
        <ListsSection />
        <CardsSection />
        <ProgressSection />
        <FeedbackSection showToast={toast.show} />
      </Screen>
      {toast.element}
    </AccentScope>
  );
}

function Specimen({
  label,
  children,
  className,
}: {
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className="gap-4">
      {label ? (
        <Text variant="overline" tone="subtle">
          {label}
        </Text>
      ) : null}
      <View className={className}>{children}</View>
    </Card>
  );
}

function ThemeSection({
  accentId,
  accentName,
  onAccentChange,
}: {
  accentId: string;
  accentName: string;
  onAccentChange: (id: string) => void;
}) {
  const { scheme } = useTheme();
  const { preference } = useSchemePreference();
  const showing = scheme === 'dark' ? 'Dark' : 'Light';
  return (
    <Section title="Theme">
      <Callout
        tone="accent"
        title={preference === 'system' ? `Appearance: System (${showing})` : `Appearance: ${showing}`}
      >
        Change it in Settings. Every token switches immediately, no restart.
      </Callout>
      <Specimen label={`Accent: ${accentName}`} className="gap-3">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="-mx-4"
          contentContainerClassName="gap-2.5 px-4"
        >
          {accentChoices.map((choice) => {
            const selected = choice.id === accentId;
            return (
              <Pressable
                key={choice.id}
                accessibilityRole="button"
                accessibilityLabel={choice.name}
                accessibilityState={{ selected }}
                onPress={() => onAccentChange(choice.id)}
                className={cn(
                  'h-11 w-11 items-center justify-center rounded-full border-2',
                  selected ? 'border-fg' : 'border-transparent',
                )}
              >
                <View className="h-8 w-8 rounded-full" style={{ backgroundColor: choice.swatch }} />
              </Pressable>
            );
          })}
        </ScrollView>
        <Text variant="footnote" tone="muted">
          Course screens wrap content in {'<AccentScope color={course.color}>'}. Pick a color to re-tint this
          page.
        </Text>
      </Specimen>
    </Section>
  );
}

function Swatch({ color, name, value }: { color: string; name: string; value?: string }) {
  return (
    <View className="flex-1 gap-1.5">
      <View
        className="h-12 rounded-lg border-hairline border-border"
        style={{ backgroundColor: color, borderCurve: 'continuous' }}
      />
      <View>
        <Text variant="caption" numberOfLines={1}>
          {name}
        </Text>
        {value ? (
          <Text variant="caption" tone="subtle" weight="regular" numberOfLines={1}>
            {value}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function ColorsSection() {
  const { colors } = useTheme();
  return (
    <Section title="Color">
      {tokenGroups.map((group) => (
        <Specimen key={group.title} label={group.title} className="flex-row gap-3">
          {group.tokens.map((token) => (
            <Swatch key={token} name={token} value={colors[token]} color={colors[token]} />
          ))}
          {group.tokens.length < 4 ? <View className="flex-1" /> : null}
          {group.tokens.length < 3 ? <View className="flex-1" /> : null}
        </Specimen>
      ))}
      <Specimen label="Tones: fill, soft, foreground" className="gap-3">
        {tones.map((tone) => (
          <View key={tone} className="flex-row items-center gap-3">
            <Text variant="subhead" weight="medium" className="w-16">
              {tone}
            </Text>
            <View className="h-8 flex-1 rounded-md" style={{ backgroundColor: colors[tone] }} />
            <View className="h-8 flex-1 rounded-md" style={{ backgroundColor: colors[`${tone}Soft`] }} />
            <View
              className="h-8 flex-1 items-center justify-center rounded-md"
              style={{ backgroundColor: colors[`${tone}Soft`] }}
            >
              <Text variant="caption" weight="semibold" tone="inherit" style={{ color: colors[`${tone}Fg`] }}>
                Aa
              </Text>
            </View>
          </View>
        ))}
      </Specimen>
    </Section>
  );
}

function TypographySection() {
  return (
    <Section title="Typography">
      <Specimen label="Inter · iOS text styles" className="gap-3">
        {textVariants.map((variant) => (
          <View key={variant} className="flex-row items-baseline justify-between gap-3">
            <Text variant={variant} numberOfLines={1} className="flex-1">
              {variant === 'overline' ? 'Overline label' : variant.charAt(0).toUpperCase() + variant.slice(1)}
            </Text>
            <Text variant="caption" tone="subtle" tabular>
              {typeScale[variant].size}/{typeScale[variant].lineHeight}
            </Text>
          </View>
        ))}
      </Specimen>
      <Specimen label="Tones">
        <Text>
          Default, <Text tone="muted">muted</Text>, <Text tone="subtle">subtle</Text>,{' '}
          <Text tone="accent">accent</Text>, <Text tone="success">success</Text>,{' '}
          <Text tone="warning">warning</Text>, <Text tone="danger">danger</Text>.
        </Text>
      </Specimen>
    </Section>
  );
}

function ButtonsSection() {
  const [loading, setLoading] = useState(false);
  return (
    <Section title="Buttons">
      <Specimen label="Variants" className="flex-row flex-wrap gap-2.5">
        {buttonVariants.map((variant) => (
          <Button key={variant} variant={variant}>
            {variant.charAt(0).toUpperCase() + variant.slice(1)}
          </Button>
        ))}
      </Specimen>
      <Specimen label="Sizes and icons" className="gap-3">
        <View className="flex-row flex-wrap items-center gap-2.5">
          <Button size="sm" leadingIcon={Plus}>
            Small
          </Button>
          <Button size="md" variant="tonal" leadingIcon={Paperclip}>
            Medium
          </Button>
        </View>
        <Button size="lg" trailingIcon={Send}>
          Submit assignment
        </Button>
      </Specimen>
      <Specimen label="States" className="flex-row flex-wrap gap-2.5">
        <Button
          loading={loading}
          leadingIcon={Download}
          onPress={() => {
            setLoading(true);
            setTimeout(() => setLoading(false), 1600);
          }}
        >
          Tap to load
        </Button>
        <Button disabled variant="secondary">
          Disabled
        </Button>
      </Specimen>
      <Specimen label="Icon buttons" className="flex-row items-center gap-3">
        <IconButton icon={Settings} accessibilityLabel="Settings" />
        <IconButton icon={Bell} variant="secondary" accessibilityLabel="Notifications" />
        <IconButton icon={Star} variant="tonal" accessibilityLabel="Favorite" />
        <IconButton icon={Plus} variant="primary" size="lg" accessibilityLabel="Add" />
      </Specimen>
    </Section>
  );
}

function InputsSection() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [comment, setComment] = useState('');
  const [query, setQuery] = useState('');
  return (
    <Section title="Inputs">
      <Specimen className="gap-4">
        <TextField
          label="School email"
          placeholder="you@university.edu"
          leadingIcon={Mail}
          keyboardType="email-address"
          autoCapitalize="none"
          clearable
          value={email}
          onChangeText={setEmail}
          helperText="Use the address your school gave you."
        />
        <TextField
          label="Password"
          placeholder="Password"
          leadingIcon={Lock}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          error={password.length > 0 && password.length < 8 ? 'At least 8 characters.' : null}
        />
        <TextField
          label="Comment"
          placeholder="Add a comment for your instructor"
          multiline
          value={comment}
          onChangeText={setComment}
        />
        <SearchField value={query} onChangeText={setQuery} placeholder="Search courses" />
      </Specimen>
    </Section>
  );
}

function SelectionSection() {
  const [view, setView] = useState<'week' | 'month' | 'agenda'>('week');
  const [chips, setChips] = useState<string[]>(['Assignments']);
  const toggle = (c: string) =>
    setChips((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));
  return (
    <Section title="Selection">
      <Specimen label="Segmented control">
        <SegmentedControl
          options={[
            { value: 'week', label: 'Week' },
            { value: 'month', label: 'Month' },
            { value: 'agenda', label: 'Agenda' },
          ]}
          value={view}
          onChange={setView}
        />
      </Specimen>
      <Specimen label="Chips" className="flex-row flex-wrap gap-2">
        {['Assignments', 'Quizzes', 'Discussions', 'Events'].map((c) => (
          <Chip key={c} selected={chips.includes(c)} onPress={() => toggle(c)}>
            {c}
          </Chip>
        ))}
        <Chip icon={Sparkles}>With icon</Chip>
      </Specimen>
    </Section>
  );
}

function BadgesSection() {
  const badgeTones: BadgeTone[] = ['neutral', ...tones];
  return (
    <Section title="Badges">
      <Specimen label="Soft" className="flex-row flex-wrap gap-2">
        {badgeTones.map((tone) => (
          <Badge key={tone} tone={tone}>
            {tone}
          </Badge>
        ))}
      </Specimen>
      <Specimen label="Solid, small, dot" className="flex-row flex-wrap gap-2">
        {badgeTones.map((tone) => (
          <Badge key={tone} tone={tone} variant="solid" size="sm">
            {tone}
          </Badge>
        ))}
        <Badge tone="warning" dot>
          Due today
        </Badge>
        <Badge tone="success" icon={GraduationCap}>
          Graded
        </Badge>
      </Specimen>
    </Section>
  );
}

function ListsSection() {
  const [push, setPush] = useState(true);
  const [digest, setDigest] = useState(false);
  return (
    <Section title="Lists">
      <ListGroup header="Notifications" footer="Separators align to the text, not the icon.">
        <ListItem
          leading={<IconTile icon={Bell} tone="danger" />}
          title="Push notifications"
          trailing={<Switch accessibilityLabel="Push notifications" value={push} onValueChange={setPush} />}
        />
        <ListItem
          leading={<IconTile icon={Megaphone} tone="warning" />}
          title="Weekly digest"
          subtitle="A Sunday summary of what's due"
          trailing={<Switch accessibilityLabel="Weekly digest" value={digest} onValueChange={setDigest} />}
        />
        <ListItem
          leading={<IconTile icon={BookOpen} tone="info" />}
          title="Course activity"
          value="All courses"
          onPress={() => {}}
        />
      </ListGroup>
      <ListGroup>
        <ListItem
          leading={<Avatar name="Amara Osei" size="md" />}
          leadingAlignment="top"
          titleLines={2}
          subtitleLines={3}
          title="Amara Osei"
          subtitle="Instructor · BIO 201"
          onPress={() => {}}
        />
        <ListItem
          leading={<Avatar name="Lucas Moreau" size="md" />}
          title="Lucas Moreau"
          subtitle="Instructor · HIST 150"
          onPress={() => {}}
        />
        <ListItem
          leading={<IconTile icon={Trash2} tone="danger" />}
          title="Remove download"
          destructive
          onPress={() => {}}
        />
      </ListGroup>
      <Specimen label="Avatars" className="flex-row items-end gap-3">
        <Avatar name="Hannah Kim" size="xs" />
        <Avatar name="Daniel Reyes" size="sm" />
        <Avatar name="Priya Natarajan" size="md" />
        <Avatar name="Marco Bellini" size="lg" />
        <Avatar name="Easel Student" size="xl" />
      </Specimen>
    </Section>
  );
}

function CardsSection() {
  return (
    <Section title="Cards">
      <Card onPress={() => {}} className="flex-row items-center gap-3">
        <IconTile icon={Sparkles} size="lg" />
        <View className="flex-1">
          <Text variant="headline">Elevated, pressable</Text>
          <Text variant="subhead" tone="muted">
            Shadow in light mode, a lighter surface in dark.
          </Text>
        </View>
        <IconButton icon={ArrowRight} variant="secondary" size="sm" accessibilityLabel="Open" />
      </Card>
      <View className="flex-row gap-3">
        <Card variant="outlined" className="flex-1">
          <Text variant="headline">Outlined</Text>
          <Text variant="subhead" tone="muted">
            For dense grids.
          </Text>
        </Card>
        <Card variant="filled" className="flex-1">
          <Text variant="headline">Filled</Text>
          <Text variant="subhead" tone="muted">
            Inside other cards.
          </Text>
        </Card>
      </View>
    </Section>
  );
}

function ProgressSection() {
  const { colors } = useTheme();
  return (
    <Section title="Progress">
      <Specimen className="gap-4">
        {tones.map((tone, i) => (
          <ProgressBar key={tone} tone={tone} value={0.25 + i * 0.15} size={i === 0 ? 'lg' : 'md'} />
        ))}
      </Specimen>
      <Specimen label="Rings" className="flex-row items-center justify-between">
        <ProgressRing value={0.92}>
          <Text variant="footnote" weight="semibold" tabular>
            92%
          </Text>
        </ProgressRing>
        <ProgressRing value={0.64} tone="warning" size={48} thickness={4} />
        <ProgressRing value={0.38} tone="danger" size={40} thickness={4} />
        <ProgressRing value={0.75} color={courseColors[6].light} size={72} thickness={7}>
          <Text variant="headline" tone="inherit" style={{ color: colors.fg }}>
            B+
          </Text>
        </ProgressRing>
      </Specimen>
    </Section>
  );
}

const sortOptions = [
  { value: 'due', label: 'Due date' },
  { value: 'course', label: 'Course' },
  { value: 'title', label: 'Title', subtitle: 'A to Z' },
] as const;

function FeedbackSection({ showToast }: { showToast: ReturnType<typeof useToast>['show'] }) {
  const sheetTrigger = useRef<ComponentRef<typeof View>>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sort, setSort] = useState<(typeof sortOptions)[number]['value']>('due');
  return (
    <Section title="Feedback">
      <Specimen label="Sheet and toast" className="flex-row flex-wrap gap-2">
        <Button ref={sheetTrigger} variant="secondary" size="sm" onPress={() => setSheetOpen(true)}>
          Open sheet
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onPress={() => showToast('Marked “Lab report” done', { label: 'Undo', onPress: () => {} })}
        >
          Show toast
        </Button>
      </Specimen>
      <Sheet returnFocusRef={sheetTrigger} visible={sheetOpen} title="Sort by" onClose={() => setSheetOpen(false)}>
        <OptionGroup
          options={[...sortOptions]}
          selected={sort}
          onSelect={(value) => {
            setSort(value);
            setSheetOpen(false);
          }}
        />
      </Sheet>
      <Callout tone="info" title="Module locked">
        Finish “Unit 2 Quiz” to unlock this module.
      </Callout>
      <Callout tone="danger" title="Couldn’t sync grades" action={{ label: 'Try again', onPress: () => {} }}>
        Check your connection. We’ll keep showing your last saved grades.
      </Callout>
      <Callout tone="success">Submission received. Your instructor will be notified.</Callout>
      <Specimen label="Loading">
        <View className="flex-row items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-full" />
          <View className="flex-1 gap-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </View>
        </View>
      </Specimen>
      <Card padding="none">
        <EmptyState
          icon={Sparkles}
          title="You're all caught up"
          description="New assignments and announcements will appear here."
          action={{ label: 'Browse courses', onPress: () => {} }}
        />
      </Card>
    </Section>
  );
}
