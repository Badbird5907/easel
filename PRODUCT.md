# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Users

Students enrolled in courses on Canvas LMS. They use Easel for what the Canvas Student mobile app does today: seeing what's due, checking grades, reading announcements and messages from instructors, following the calendar, and keeping up with course work.

Teacher and parent/observer roles are out of scope for now. Canvas ships those as separate apps (Teacher, Parent), and Easel does not cover them yet.

## Product Purpose

Easel replaces the Canvas Student apps for iOS and Android with a single React Native app. Instructure maintains those apps as two separate native codebases. Success means a student can do what they do in the Canvas Student app, in one app that behaves consistently on both platforms.

## Positioning

Easel is an independent third-party client, not affiliated with Instructure. It works with any school's Canvas instance through the public Canvas API and the student's own login. One codebase serves both platforms.

## Operating Context

- All data comes from the student's school's Canvas instance: courses, assignments, quizzes, discussions, due dates, grades, announcements, conversations (Inbox), calendar events, and the To Do list.
- Students choose a color for each course in Canvas (the custom colors API). Those colors are the student's own data and identify courses across the app. The palette and dark-mode variants are carried over from Instructure's native apps (`src/design/tokens/colors.ts`).
- Users already know Canvas's vocabulary (Courses, Assignments, To Do, Inbox, Announcements, Grades), and the current tabs use it.

## Capabilities and Constraints

- **Stack (existing):** Expo SDK 58, Expo Router, React Native 0.88, NativeWind 4 on Tailwind 3, TypeScript.
- **Platform chrome:** iOS uses the system tab bar (Liquid Glass on iOS 26) and native headers on pushed screens. Tab roots on both platforms draw their own large-title row so a control, such as Settings, can sit beside the title. Android does **not** use Material Design. It gets Easel's own tab bar and headers, matching the current Easel look, while still respecting Android platform behavior such as the back gesture and edge-to-edge.
- **Authentication:** mobile credential discovery through Instructure's `mobile_verify` service, with developer-key and personal-access-token alternatives sharing one session model. Discovered keys require embedded login; Easel-registered keys retain browser SSO. Easel remains independent. See `docs/PRD.md` section 4.1 for the private-service dependency and compatibility limits.
- **Appearance:** light and dark mode follow the system setting by default. Settings lets the student pin Light or Dark, and the choice persists across launches.
- **Current state:** the design system, account sessions, Canvas API client, and daily student workflows are implemented. M2 parity work is being integrated and verified against the local fake Canvas. Native builds, core device workflows and real-school OAuth coverage remain to verify. Further accessibility/localization work is deferred from the first build; `docs/ROADMAP.md` tracks the evidence and remaining gaps.
- **Feature scope:** `docs/PRD.md` holds the full requirements, priorities, and milestones.
- **Open decisions** (recommendations in `docs/PRD.md` section 12):
  - offline support
  - tablet layouts
  - app store name and listing
  - whether school-specific Canvas branding is honored

## Brand Commitments

- Name: **Easel**.
- How it should feel, in the user's words: ergonomic, sleek, easy to use.
- Easel must not present itself as an official Canvas or Instructure app.

## Evidence on Hand

- Instructure's open-source `canvas-ios`, `canvas-android`, and `canvas-lms` sit beside this project (`../canvas-ios`, `../canvas-android`, `../canvas-lms`). They are reference for feature parity and API behavior.
- No real user data, screenshots, testimonials, or usage numbers exist. Don't fabricate any.
- The app icon is final: a white easel on a blue-to-violet gradient, with a blue-to-violet brushstroke on the canvas. App, adaptive, iOS dark and tinted, splash, notification, and favicon assets are in `assets/images/`; Play Store art and source SVGs are in `assets/store/`.

## Product Principles

1. **Students first.** Every screen answers what a student needs to know or do next. Teacher and parent features wait.
2. **Any school's Canvas.** Assume nothing about a specific institution. Honor what comes from Canvas as-is: course names, course colors, grading schemes.
3. **Native where the OS expects it.** iOS gets system navigation. Android gets Easel's own consistent chrome, not Material.
4. **Fewer taps to what matters.** What's due and what changed are reachable from launch without digging.

## Accessibility & Inclusion

The longer-term target is **WCAG 2.2 AA**. Accessibility and localization work and acceptance are deferred from the first build by user decision (2026-10-30); existing support remains. The following are later acceptance goals:
- text contrast, checked by `pnpm run check-contrast`
- system text scaling (Dynamic Type and Android font scale)
- VoiceOver and TalkBack support
- minimum touch targets
- respect for Reduce Motion
