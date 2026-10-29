This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md

## Easel design system

All UI comes from `src/design` (import from `@/design`). Read `README.md` for the overview.

- Style with semantic token classes (`bg-surface`, `text-fg-muted`, `border-border`, `bg-accent`). Tailwind's default palette is disabled on purpose. Don't add raw hex colors to components; add a token in `src/design/tokens/colors.ts` and run `npm run check-contrast`.
- No `dark:` variants: tokens already switch with the color scheme. For props that need a raw color (icons, native navigation options), use `useTheme().colors`.
- Use `<Text variant tone weight>` rather than raw `Text` with font classes. Font families carry the weight (`font-sans`, `font-sans-medium`, `font-sans-semibold`, `font-sans-bold`). Never set `fontWeight` with Inter; Android fakes the bold.
- Course-colored UI: wrap the subtree in `<AccentScope color={course.color}>` instead of passing colors down.
- Merge classes with `cn()` from `@/lib/cn`. It knows the custom type scale; add new font-size names to `tokens/typography.ts` so it keeps working.
- Reanimated + NativeWind: don't put `className` on Reanimated's `Animated.View`. NativeWind drops the classes when an animated style shares the `style` prop. Use `AnimatedView` / `AnimatedPressable` from `src/design/interop.tsx` and pass animated styles through `animatedStyle`.
- Screens: render `<Screen>` (a ScrollView) as the screen's root so native large titles collapse and the iOS tab bar minimizes. Set titles with `<Stack.Screen options={{ title }} />`.
- New components go in `src/design/components`, get exported from `src/design/index.ts`, and get a specimen in `src/app/design.tsx`.
