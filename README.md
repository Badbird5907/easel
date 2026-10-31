# Easel

A single React Native app for Canvas LMS, replacing the separate native iOS and Android apps.

Built with Expo SDK 58, Expo Router, and NativeWind 4 (Tailwind 3).

> **Status:** Canvas accounts, the API client, daily student workflows, and much
> of M2 parity are implemented. The first build focuses on native builds and
> core workflow verification. Further accessibility and localization work is
> deferred; existing support stays in place. See [the roadmap](docs/ROADMAP.md).

Home, Settings, navigation, Calendar/To Do, course browsing and content, and
discussion threads/checkpoints, reply controls, file browsing/viewer/actions/previews,
downloads/folder uploads, audio recording/inline playback, submission attachment/upload controls,
submission forms/confirmations, comments/draft feedback, group cards, media/tool submission controls,
annotation/feedback viewer routes, attempt/rubric/comment presentation, shared web controls, assignment lists/details/submission screens, peer reviews, quiz browsing/results/history/entry controls, detailed attempt results, quiz timer/navigation/review controls, question inputs/file answers, quiz-attempt screen/engine messages, New Quiz launches, grades/what-if controls, Inbox browsing/conversation actions, message composition/recipients, Inbox media playback, shared attachment descriptions, sign-in/terms controls, profile editing, Inbox signatures, observer pairing, About, Help browsing/reporting, pasted-link controls, shared previews, sharing entry, course/assignment/folder pickers, storage settings, offline course-sync controls, Activity, and document scanning have an initial
English/French/Arabic localization pilot with 3,260 reviewed keys per language. The latest
native language metadata needs a rebuilt development app;
full-app translation and native RTL verification are still pending. See the
[localization guide](src/i18n/README.md).

Offline sync controls now cancel only their own active run. Reentrant starts share
one promise, and delayed progress cannot overwrite a replacement run. These paths
pass headless regression checks; native cancellation behavior still needs testing.

Conference joins/recordings, Outcomes/ePortfolios, calendar event details, Canvas
notification settings, file-viewer error fallbacks and browser-only submission
methods guard delayed browser launches after account, source or screen changes.
Native browser behavior remains part of device acceptance.

Activity respects assignment grade-display restrictions and uses neutral text when
the policy is missing. Activity cached before this fix is shown again only after
a fresh fetch; a first offline launch after upgrading may have no cached Activity.

## Run it

Use pnpm **11.21.0**, pinned by `packageManager` in `package.json`. With Corepack
installed, run `corepack enable pnpm` once to use the project's pinned version.
`pnpm-workspace.yaml` retains hoisted dependencies for the Expo/native toolchain.

```bash
pnpm install --frozen-lockfile
pnpm run fake-canvas   # separate terminal; localhost:3030, token dev
pnpm exec expo start --dev-client
```

Use an Easel development build, not Expo Go: the app includes native modules and
extensions. To create a local development build, use `pnpm exec expo run:ios` or
`pnpm exec expo run:android`. Sign in to the fake Canvas with school `localhost:3030`
and token `dev`. Android emulators need ports 3030 and 8081 forwarded with
`adb reverse tcp:3030 tcp:3030` and `adb reverse tcp:8081 tcp:8081`.

## Checks

```bash
pnpm run typecheck
pnpm run lint
pnpm run check-contrast   # WCAG contrast for every token pairing and course color
```

## Layout

```
src/
  app/                 Expo Router routes
    _layout.tsx        fonts, theme, root stack
    (app)/             signed-in routes and shared detail screens
      (tabs)/          Home, To Do, Calendar, Inbox
      design.tsx       live design system gallery
  design/              the design system — import from '@/design'
    tokens/            colors, typography, radii, motion
    theme/             ThemeProvider, AccentScope, color math
    components/        Button, Card, ListGroup, TextField, …
  components/          app-level components built from the design system
  canvas/              Canvas client, account sessions, API modules and queries
  features/            feature UI, offline sync, uploads and supporting logic
  lib/                 shared date and utility functions
devtools/
  fake-canvas/         local Canvas fixtures and API server
scripts/
  check-contrast.ts
```

## Design system

Feel: ergonomic, sleek, easy to use. In practice:

Static cards can opt into one accessibility element with `accessible` and an
`accessibilityLabel`. Leave grouping unset when a card contains separate controls
or headings; pressable cards retain their native button behavior.

- **Semantic tokens only.** Tailwind's default palette is removed. Use `bg-surface`,
  `text-fg-muted`, `bg-accent-soft`, and so on. Each token resolves per color scheme
  through CSS variables, so components never need `dark:` variants.
- **Light and dark follow the system** live, with no restart.
- **Course colors re-tint everything.** Wrap a subtree in
  `<AccentScope color={course.color}>`. Buttons, switches, progress, and tinted
  icons pick up the color, adjusted to stay legible in both schemes.
- **Native chrome on iOS, Easel chrome on Android.** iOS uses the system tab bar
  and headers (Liquid Glass on iOS 26). Android uses Easel's own tab bar and
  headers, not Material, so both platforms look alike. Tab screens draw their own
  large title with room for a control beside it, like Home's settings button.
- **Ergonomics.** Shared controls reserve 44pt iOS / 48dp Android touch targets,
  respect Reduce Motion, and let text grow. Screen-level and assistive-technology
  verification is tracked in the roadmap.
- **Type.** Inter in iOS-style roles (`display` … `overline`) with size-aware tracking.

Open **Settings → Developer → Design System** to browse components and tokens.
Developer settings are enabled in development builds; in other builds, tap the
version seven times in About to enable them.

Android releases: `pnpm run release:android` builds the `play-internal` profile on
EAS and auto-submits it to the Google Play internal testing track.

OTA updates use Expo app-version runtimes: `play-internal` builds receive the
`production` channel; `preview` builds receive `preview`. Publish reviewed JS/assets
with `pnpm run update:production "Describe the change"`.
Native changes require a new store build; Play version code 5 cannot receive OTA.
Updates apply on the next cold start without interrupting work. Roll back with
`pnpm dlx eas-cli@latest update:rollback`. See [Android distribution](docs/ANDROID_DISTRIBUTION.md#over-the-air-updates).
