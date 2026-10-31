This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use pnpm 11.21.0, pinned in `package.json` and EAS. Install with `pnpm install --frozen-lockfile`; keep `pnpm-lock.yaml` as the only dependency lockfile. Run local binaries with `pnpm exec` and one-off CLIs with `pnpm dlx`.

```bash
pnpm exec expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
pnpm exec expo start              # start the dev server
pnpm exec expo lint               # lint
pnpm exec tsc --noEmit            # typecheck
pnpm run check                   # all regression checks
pnpm dlx expo-doctor             # diagnose dependency and config issues
pnpm exec expo install --fix      # fix incompatible package versions
pnpm exec expo prebuild --no-install --no-clean # preserve generated native folders (SDK 58)
pnpm dlx eas-cli@latest update --channel production --environment production --message "Describe the change"
pnpm dlx eas-cli@latest update:rollback # select branch/runtime and known-good or embedded update
```

Run lint, typecheck, and `pnpm run check` before declaring any task done.

OTA uses app-version runtimes. `play-internal` receives `production`; `preview` receives
`preview`. Native dependency/config changes require a new store build before matching
updates can run. Play version code 5 has no OTA support. Publish only reviewed JS/assets
from the intended checkout and environment. See `docs/ANDROID_DISTRIBUTION.md` for
validation, delivery timing, and rollback.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Run EAS CLI with `pnpm dlx eas-cli@latest <command>`. Android releases go through `pnpm run release:android`: an EAS cloud build of the `play-internal` profile that auto-submits to the Google Play internal testing track. EAS stores the Play service account key, so no prompt is needed. Every Play build must be submitted that way; don't drop `--auto-submit`. A local build (`--local`) can't auto-submit, so follow it with `eas submit --platform android --profile play-internal --path <aab>`. JS-only changes ship over the air with `pnpm run update:production "<message>"` instead of a new build. See `docs/ANDROID_DISTRIBUTION.md`.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- Preserve `modules/canvas-notification-bridge`: Android notification access is implemented there, never in generated `android/`. Keep release allowlisting Canvas Student only; no network, wake locks, timers or JS startup in the listener.

- Keep `plugins/withAndroidConfigChanges.js` registered in `app.json`: MainActivity must handle `fontScale` so live text resizing preserves navigation.

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `pnpm exec expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md

## Easel design system

All UI comes from `src/design` (import from `@/design`). Read `README.md` for the overview.

- Style with semantic token classes (`bg-surface`, `text-fg-muted`, `border-border`, `bg-accent`). Tailwind's default palette is disabled on purpose. Don't add raw hex colors to components; add a token in `src/design/tokens/colors.ts` and run `pnpm run check-contrast`.
- No `dark:` variants: tokens already switch with the color scheme. For props that need a raw color (icons, native navigation options), use `useTheme().colors`.
- Use `<Text variant tone weight>` rather than raw `Text` with font classes. Font families carry the weight (`font-sans`, `font-sans-medium`, `font-sans-semibold`, `font-sans-bold`). Never set `fontWeight` with Inter; Android fakes the bold.
- Course-colored UI: wrap the subtree in `<AccentScope color={course.color}>` instead of passing colors down.
- Merge classes with `cn()` from `@/lib/cn`. It knows the custom type scale; add new font-size names to `tokens/typography.ts` so it keeps working.
- Reanimated + NativeWind: don't put `className` on Reanimated's `Animated.View`. NativeWind drops the classes when an animated style shares the `style` prop. Use `AnimatedView` / `AnimatedPressable` from `src/design/interop.tsx` and pass animated styles through `animatedStyle`.
- Screens: render `<Screen>` (a ScrollView) as the screen's root so the iOS tab bar minimizes and scrolls to top. Tab roots pass `<Screen title="…" titleAccessory={…}>`: their stack header is hidden and Screen draws the large title row (with an optional control beside it); on scroll the title shrinks and slides into a compact bar, and a released scroll never rests halfway. Pushed screens keep the stack header; set their titles with `<Stack.Screen options={{ title }} />`.
- New components go in `src/design/components`, get exported from `src/design/index.ts`, and get a specimen in `src/app/design.tsx`.
- Tab roots set `disableAutomaticContentInsets` on their `NativeTabs.Trigger`. Without it, NativeTabs forces the first scroll view to automatic insets and the large title sits a status bar too low.
- Navigation chrome differs by platform on purpose (see PRODUCT.md): iOS uses `NativeTabs` and native stack headers; Android uses `TabBar` and `Header` from `src/design/components/NavigationChrome.tsx`. Don't introduce Material components on Android. Tab definitions live once in `src/app/(tabs)/_layout.tsx`.
- Product context lives in `PRODUCT.md`; feature requirements, priorities, and milestones live in `docs/PRD.md` (reference requirement IDs like `FILE-4` in commits). No eyebrow labels above headings.

## Canvas data layer

- All server data goes through `src/canvas/`. Screens never call `fetch` directly.
  - `client.ts`: `CanvasClient` with `get`, `getAll` (follows Link pagination), `post`, `put`, and `delete`. It throws `CanvasAuthError`, `CanvasNetworkError`, and `CanvasError`.
  - `session.tsx`: saved accounts and `useCanvas()`.
  - `query.tsx`: `useCanvasQuery` and `useCanvasMutation`. Keys are prefixed with the account ID automatically.
  - `types.ts`: raw API shapes.
  - `models.ts`: domain models.
- Each feature has `src/canvas/api/<feature>.ts`, exporting fetchers and hooks. Map raw Canvas JSON to models there, not in components. Requests send `Accept: application/json+canvas-string-ids`, so IDs are strings.
- **HTML.** Render Canvas HTML with `<RichContent html>` from `src/features/content/RichContent.tsx`.
- **Links.** Route links with `openCanvasLink(url, baseUrl)` from `src/features/content/links.ts`. When you ship a screen, add its URL pattern to `internalRoutes`.
- **Signed-in browser.** For "open in browser" with the student signed in, use `useOpenSignedIn()` from `src/features/content/browser.ts`.
- **Route layout.** Detail screens live in `src/app/(app)/` beside `(tabs)`, so every tab opens them the same way. Tab stacks hold only their root screen.
- **Fake Canvas.** `pnpm run fake-canvas` serves `http://localhost:3030`; sign in with school `localhost:3030` and token `dev`. Add endpoints in `devtools/fake-canvas/routes/<feature>.mjs`; they reload while the server runs. Copy response shapes from the canvas-lms serializers (`../canvas-lms/lib/api/v1/`).
- **Reference implementations.** `../canvas-ios` and `../canvas-android`. The paths are in `docs/PRD.md` section 13.

## Demo fixtures

Run `pnpm run demo:build` after changing fake Canvas GET responses. The build snapshots curated courses into `src/features/demo/data.json`; Node route handlers are never included in the app. Demo dates shift to local today when the lazy-loaded client starts. Demo membership is session-only and is excluded from stored credentials and background jobs.
