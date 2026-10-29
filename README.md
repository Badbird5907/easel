# Easel

A single React Native app for Canvas LMS, replacing the separate native iOS and Android apps.

Built with Expo SDK 58, Expo Router, and NativeWind 4 (Tailwind 3).

> **Status:** app shell and design system only. All screen content comes from
> `src/mocks/canvas.ts`; there is no Canvas login or API client yet.

## Run it

```bash
npm install
npx expo start        # then press i (iOS) or a (Android), or scan with Expo Go
```

Every dependency so far ships in Expo Go. Once a library with custom native code
is added, switch to a development build: `npx expo run:ios` / `npx expo run:android`.

## Checks

```bash
npm run typecheck
npm run lint
npm run check-contrast   # WCAG contrast for every token pairing and course color
```

## Layout

```
src/
  app/                 Expo Router routes
    _layout.tsx        fonts, theme, root stack
    (tabs)/            native tab bar; each tab has its own stack
    design.tsx         live design system gallery (palette icon on Home)
  design/              the design system — import from '@/design'
    tokens/            colors, typography, radii, motion
    theme/             ThemeProvider, AccentScope, color math
    components/        Button, Card, ListGroup, TextField, …
  components/          app-level components built from the design system
  mocks/               placeholder Canvas data
scripts/
  check-contrast.ts
```

## Design system

Feel: ergonomic, sleek, easy to use. In practice:

- **Semantic tokens only.** Tailwind's default palette is removed. Use `bg-surface`,
  `text-fg-muted`, `bg-accent-soft`, and so on. Each token resolves per color scheme
  through CSS variables, so components never need `dark:` variants.
- **Light and dark follow the system** live, with no restart.
- **Course colors re-tint everything.** Wrap a subtree in
  `<AccentScope color={course.color}>`. Buttons, switches, progress, and tinted
  icons pick up the color, adjusted to stay legible in both schemes.
- **Native where it counts.** Tab bars and headers are platform-native (Liquid
  Glass on iOS 26, Material on Android). Large titles collapse on scroll.
- **Ergonomics.** Minimum 44pt touch targets, press feedback that respects Reduce
  Motion, sparse haptics, and Dynamic Type support (heights grow with text).
- **Type.** Inter in iOS-style roles (`display` … `overline`) with size-aware tracking.

Open **Home → palette icon** in the app to browse every component and token.
