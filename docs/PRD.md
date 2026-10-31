# Easel PRD

Product requirements for Easel, a single React Native app that replaces the Canvas Student apps on iOS and Android.

- **Owner:** Evan Yu
- **Status:** draft for review
- **Last updated:** 2026-10-29
- **Related:** [PRODUCT.md](../PRODUCT.md) (product context), [README.md](../README.md) (stack and design system)

## 1. Summary

Easel is an independent Canvas client for students. It must do everything the official Canvas Student apps do, plus the student-facing parts of Canvas on the web that those apps hand off to a browser. A student who installs Easel should never need to open the official app again.

Today Easel is an app shell and design system running on mock data (`src/mocks/canvas.ts`). This document defines what 1.0 contains, what blocks it, and the order to build it in.

The feature inventory comes from the source code of the official apps and the Canvas server in this workspace:

- `../canvas-ios` (Student target and `Core/`)
- `../canvas-android` (`apps/student` and `libs/`)
- `../canvas-lms` (server routes, controllers, and API docs)

Section 13 lists the reference paths.

## 2. Goals and non-goals

### Goals

1. **Full replacement.** Every student feature in the official iOS and Android apps works in Easel. Web-only student features (appointment scheduler, smart search, group self-signup, and similar) work too, natively or in an authenticated in-app web view.
2. **Better where the official apps are weak.** File and attachment viewing, sharing, and saving are first-class on both platforms. Android gets the same quality as iOS.
3. **Any school.** Works against any Canvas instance with the school's normal login, including SSO and MFA.
4. **Several accounts.** A student with accounts at more than one school, or more than one account at a school, switches between them without logging out.
5. **Accessible.** Meets WCAG 2.2 AA, as committed in PRODUCT.md.

### Non-goals for 1.0

- Teacher and parent/observer roles. These are separate Canvas apps; Easel is students only (PRODUCT.md).
- Canvas Career (Horizon) learner experience.
- Course authoring beyond what students can already do: posting discussions, creating planner notes, editing pages when permitted.
- Anything that requires pretending to be an official Instructure app (see 4.1).

## 3. Users and jobs

**Primary user.** A student enrolled in one or more Canvas courses, usually on a phone, often in short sessions.

| Job | What success looks like |
| --- | --- |
| Know what's due | Open the app and see the next deadline and anything missing, without tapping. |
| Do the work | Read instructions, open attachments, take quizzes, launch tools, and submit from the phone. |
| Keep up | See new announcements, grades, comments, and messages, and get notified about them. |
| Plan | See deadlines and events on a calendar and keep a personal to-do list. |
| Use course files | Open any file, read it comfortably, share it to a notes app, and save it to the device. |
| Manage accounts | Switch between schools or accounts in two taps. |

## 4. Platform constraints that shape everything

These come from the Canvas server source and the official apps. Each needs a decision before or during milestone M0 (section 11). Recommendations are marked.

### 4.1 Sign-in credentials (blocking)

The official apps call `sso.canvaslms.com/api/v1/mobile_verify.json`. That endpoint returns Instructure's own OAuth client ID and secret, and it lives in a private Instructure plugin, not in canvas-lms. Canvas only accepts an OAuth client if the school's account allows that developer key (`DeveloperKey#authorized_for_account?`).

**Decision (2026-10-31, user-directed).** Easel now discovers mobile OAuth credentials through `mobile_verify` when no stored, manually supplied, or registered developer key is available. The request uses the reference Android app selector with explicit Easel identification: `candroid Easel/1.0`, in both the query and HTTP User-Agent. Easel remains an independent app.

Discovered credentials use the official Android flow's registered HTTPS redirect (`https://sso.canvaslms.com/canvas/login`) and embedded sign-in. The callback must come from `https://sso.canvaslms.com` at exactly `/canvas/login`, and its state must match. A canonical HTTPS school address returned by the service is used for authorization and token exchange. Credentials and their mobile-flow marker are stored with the account in SecureStore, never committed or logged.

This private service can reject an app or school, change its contract, or rotate credentials. Failures remain visible and students can choose a developer key or personal access token. Embedded login may be rejected by some identity providers; a school-issued Easel key retains the system-browser flow. No claim of Instructure endorsement or guaranteed school compatibility is made.

| Path | Behavior |
| --- | --- |
| Stored / manually supplied / registered developer key | Takes precedence; uses the existing Easel callback and browser flow unless explicitly selecting embedded login. |
| Mobile verification | Discovers credentials at runtime, uses embedded login with the registered HTTPS callback, and stores credentials securely with the account. |
| Personal access token | Explicit alternative for schools permitting student tokens. |
| Easel global developer key | Still a future registration option; none is configured in the checkout. |

See [official Android credentials](OFFICIAL_ANDROID_OAUTH_CREDENTIALS.md) for reference sources and verification limits.

### 4.2 Session lifetime

Canvas gives **public** OAuth clients (PKCE without a secret) a hard 2-hour expiry that rolls forward only when the app refreshes (`Setting public_client_token_ttl`, `developer_key.rb`). An idle student would be logged out after two hours. **Confidential** clients get long-lived refresh tokens.

**Recommendation.** Register Easel as a confidential client and use PKCE as well. Keep the secret in the app binary, which is what the official apps do. If a key is public, the app refreshes in the background and shows a clear "Sign in again" state instead of failing requests.

### 4.3 Push notifications (blocking for real-time push)

Canvas only registers a push device when the token's developer key has an Amazon SNS ARN configured by Instructure (`communication_channels_controller.rb:174-190`). A third-party key without that gets an error.

| Option | Latency | Cost and risk |
| --- | --- | --- |
| Instructure configures SNS for Easel's global key | Real time | Requires the partnership in 4.1. |
| On-device background refresh plus local notifications | Minutes to hours; the OS decides | No server. iOS background refresh is opportunistic; Android WorkManager runs at most every 15 minutes. |
| Easel relay server polling Canvas per user | About a minute | Easel would hold students' tokens on a server. Security and privacy burden. |

**Recommendation.** Ship 1.0 with on-device refresh and local notifications, plus local due-date reminders, which need no server. Pursue SNS through the partnership. Do not build a token-holding relay without a separate security review.

### 4.4 Features tied to Instructure's domains

- **QR-code login.** Uses the Student Android grant (`code_android`) from Canvas’s “QR for Mobile Login” page, matching the cloned Android app. Discover the school’s mobile credentials, exchange the short-lived code with the QR-specific OOB redirect, and finish through the shared session/terms flow. Scanning and pasted links are supported; availability depends on the school enabling QR login and Instructure’s private service.
- **Universal links / App Links for `*.instructure.com`.** These need Instructure-hosted association files. Easel can't claim them. Easel instead routes Canvas links internally (in rendered content, notifications, and pasted or shared URLs), and offers an `easel://` scheme.

### 4.5 Scoped developer keys

Keys that require scopes lose GraphQL and LTI 1.3 sessionless launches (`lib/authentication_methods.rb:134`, `lti/concerns/sessionless_launches.rb:47`). Easel needs an unscoped key. Every request for a key must say so.

### 4.6 Things the official apps license or improvise

- **PDF annotation.** The official apps annotate PDFs with PSPDFKit (Nutrient), a commercial license. Easel renders PDFs natively and uses Canvas's own DocViewer web UI, opened from a `canvadoc_session` URL, for annotation assignments and instructor feedback. A commercial PDF SDK stays an option (section 12).
- **Web-backed features.** The official apps render discussions, classic quiz taking, and several other features as Canvas web pages. They open those pages through `/login/session_token`, a single-use URL valid for about 30 seconds, plus undocumented query flags (`embed=true`, `persist_headless`, `platform=mobile`). Easel builds native versions where the API allows it, and keeps one shared authenticated web view for the rest.

## 5. Information architecture

Easel keeps the current four tabs. The official apps' Notifications tab becomes a bell on Home.

| Tab | Contains |
| --- | --- |
| Home | Title row with Activity (bell) and Settings (gear). Next-due card, Up next, latest announcements, course cards (no grades), links to All courses and Grades. |
| Calendar | Month, week, day, and agenda views. Events, assignments, planner notes, appointment slots. |
| To Do | Every planner item across courses, grouped by day, plus personal to-dos. |
| Inbox | Conversations, compose, and filters. |

- **Courses.** Course cards on Home and an All courses screen. Each course opens a course home with its navigation tabs.
- **Grades.** An all-courses Grades screen from Home, and a Grades tab inside each course.
- **Announcements.** A combined feed from Home, and a per-course list.
- **Files.** Course files inside courses. My Files from Settings or the Home overflow.

Long-pressing the Home settings button opens the account switcher (ACCT-4).

## 6. Priorities

| Priority | Meaning |
| --- | --- |
| **P0** | Needed for the first daily-driver beta: a student can use Easel instead of the official app for a normal week. |
| **P1** | Needed for 1.0. Together, P0 and P1 equal full parity with the official apps and the student web. |
| **P2** | After 1.0: Easel-only improvements, or features blocked on external decisions. |

## 7. Functional requirements

Requirement IDs are stable so issues and commits can reference them.

### 7.1 Sign-in and session (AUTH)

| ID | Pri | Requirement |
| --- | --- | --- |
| AUTH-1 | P0 | **School search.** Find a school by name or domain, or type a domain directly. Self-hosted domains work. The search source depends on 4.1. If Instructure's `accounts/search` isn't available to Easel, use a bundled list plus direct domain entry. |
| AUTH-2 | P0 | **OAuth sign-in.** Authorization-code flow with PKCE (`/login/oauth2/auth`, `/login/oauth2/token`) and an Easel redirect URI (custom scheme or claimed https). Send `purpose` so the token is labeled "Easel on <device>" in the student's Canvas settings. |
| AUTH-3 | P0 | **Browser session.** Easel-registered developer-key sign-in runs in the system auth browser (ASWebAuthenticationSession on iOS, Auth Tab or Custom Tabs on Android). Mobile-discovered keys require embedded login with the registered HTTPS callback. This lets SAML, CAS, OIDC, Google, Microsoft, Apple, Clever, Duo, passkeys, password managers, and device-certificate SSO work as they do in a browser. |
| AUTH-4 | P0 | **Embedded fallback.** An in-app web view sign-in fallback, for IdPs that break in the system browser. It must handle HTTP Basic and NTLM challenges, popups, and `authentication_provider` hints. |
| AUTH-5 | P0 | **Other login modes.** Support `canvas_login=1` (skip SSO and use Canvas credentials) and site-admin login (`canvas_sa_delegated`), selectable from an "Other ways to sign in" menu, not a hidden gesture. |
| AUTH-6 | P0 | **Manual entry.** Enter a client ID and secret, or paste a personal access token (4.1). |
| AUTH-7 | P0 | **Terms of use.** If `requires_terms_acceptance`, show the school's terms and accept them (`PUT /api/v1/users/:id` with `user[terms_of_use]`). |
| AUTH-8 | P0 | **Token refresh.** Refresh transparently on 401 with request queueing. If the refresh token is dead, show "Sign in again" for the same user. Signing in as a different user there is refused. |
| AUTH-9 | P0 | **Secure storage.** Tokens live in Keychain / Keystore, never in plain storage. |
| AUTH-10 | P0 | **Log out.** Revoke the token (`DELETE /login/oauth2/token?expire_sessions=1`), follow `forward_url` for SSO single logout, and clear that account's caches, reminders, and downloads. Warn if uploads are running. |
| AUTH-11 | P1 | **QR login.** Scan or paste a Canvas Student QR sign-in link. Validate official SSO hosts, discover credentials, and exchange `code_android` as the official Android app does. Handle permission denial, invalid/expired codes, cancellation, duplicate scans, terms, and account identity (4.4). |

### 7.2 Accounts (ACCT)

| ID | Pri | Requirement |
| --- | --- | --- |
| ACCT-1 | P0 | **Multiple accounts.** Several signed-in accounts across schools at once, each with its own token, cache, settings, and course colors. |
| ACCT-2 | P0 | **Account switcher in Settings.** A list with avatar, name, school, and domain. Switching is instant and keeps each account's navigation state. |
| ACCT-3 | P0 | **Add and remove.** Add another account. Remove one, which also logs it out. |
| ACCT-4 | P1 | **Quick switch.** Long-press the Home settings button. |
| ACCT-5 | P1 | **Badges across accounts.** Unread and badge counts per account, visible in the switcher. |
| ACCT-6 | P2 | **Act as User.** Masquerade with `as_user_id`, for users who have `become_user` permission. Shown only when permitted. |

### 7.3 Settings (SET)

| ID | Pri | Requirement |
| --- | --- | --- |
| SET-1 | P0 | **Accounts.** The account switcher (ACCT-2) at the top. |
| SET-2 | P0 | **Appearance.** System / Light / Dark. Already built. |
| SET-3 | P1 | **Landing tab.** Choose which tab opens at launch. |
| SET-4 | P1 | **Canvas notification preferences.** Per category and channel (push, email, SMS), via `communication_channels/:id/notification_preferences`. |
| SET-5 | P0 | **Easel notifications.** Easel's own local notification settings: what triggers alerts, quiet hours, and default due-date reminder offsets. |
| SET-6 | P1 | **Profile.** Name, pronouns, avatar (camera or library), and bio where the school allows edits. |
| SET-7 | P1 | **Inbox signature.** |
| SET-8 | P1 | **Subscribe to calendar feed.** Uses the ICS URL from `users/self/profile`. Offers "Add to device calendar" and copy link. |
| SET-9 | P1 | **Pair with observer.** Generate a pairing code and QR (`users/self/observer_pairing_codes`) when the school allows it. |
| SET-10 | P1 | **Offline and storage.** Cache size, clear cache, downloaded files, and sync settings (7.18). |
| SET-11 | P1 | **Help.** The school's help links (`help_links`), including "Ask your instructor" and "Report a problem" (`error_reports`). |
| SET-12 | P0 | **About and legal.** About (app version, domain, login ID), the school's terms of use and privacy policy, and Easel's privacy policy. |
| SET-13 | P0 | **Developer.** The design system gallery. Hidden in release builds unless enabled. |
| SET-14 | P1 | **Language and time zone.** Follow Canvas's `effective_locale` and time zone. Offer to change them where the API allows. |

### 7.4 Home (HOME)

| ID | Pri | Requirement |
| --- | --- | --- |
| HOME-1 | P0 | **Next-due card.** Built. The next deadline, a missing count, and items due later this week. Opens To Do. |
| HOME-2 | P0 | **Up next.** Overdue and upcoming items with due day and time, linking to each item. |
| HOME-3 | P0 | **Course cards.** Color, code, and name. **Never cumulative grades.** Uses favorites, falling back to all active courses, matching Canvas dashboard rules. |
| HOME-4 | P1 | **Customize courses.** Reorder cards, favorite and unfavorite, set a nickname and color (`users/self/colors`, `course_nicknames`, `favorites/courses`). |
| HOME-5 | P0 | **Global announcements.** Account announcements (`account_notifications`), dismissible. |
| HOME-6 | P0 | **Course invitations.** Accept or decline (`enrollments/:id/accept` or `reject`). |
| HOME-7 | P1 | **Groups.** The student's groups with a link to each group home. |
| HOME-8 | P1 | **Live conferences.** A banner when one is live. |
| HOME-9 | P1 | **Upload and sync progress.** Visible while running. |
| HOME-10 | P0 | **Activity.** The bell opens Activity (7.16). |

### 7.5 Courses and course navigation (COURSE)

| ID | Pri | Requirement |
| --- | --- | --- |
| COURSE-1 | P0 | **All courses.** Current, past, and future enrollments. |
| COURSE-2 | P0 | **Course home.** Honors the course `default_view` (modules, assignments, syllabus, wiki front page, or activity feed). Lists every visible course tab from `courses/:id/tabs`, in Canvas order. |
| COURSE-3 | P0 | **Native tabs.** Announcements, Assignments, Discussions, Grades, Modules, Pages, Files, Syllabus, Quizzes, and People are native. |
| COURSE-4 | P0 | **Other tabs.** External tool tabs launch per 7.7. Collaborations and Outcomes open in the authenticated web view. A native Outcomes view comes later (CONTENT-12). |
| COURSE-5 | P0 | **Hidden tabs.** Disabled or hidden tabs are blocked with an explanation, also when reached from a link. |
| COURSE-6 | P1 | **Smart search.** Course search (`courses/:id/smartsearch`) when the school enables it. |
| COURSE-7 | P1 | **Groups.** Group home with group tabs (announcements, discussions, files, pages, people) and group self-signup and leave where allowed. |
| COURSE-8 | P1 | **Join a course.** Self-enroll with a join code. |

### 7.6 Assignments and submissions (ASSIGN)

| ID | Pri | Requirement |
| --- | --- | --- |
| ASSIGN-1 | P0 | **Assignment list.** Grouped by due date, assignment group, or type. Filters for not yet submitted, to be graded, and graded. Grading period picker. |
| ASSIGN-2 | P0 | **Assignment details.** Due, available, and lock dates. Points. Attempts allowed and used. Allowed file types. Rendered description (7.17). Lock explanation. Checkpoints for graded discussions. |
| ASSIGN-3 | P0 | **Text entry.** Online text with a rich editor, plus drafts. |
| ASSIGN-4 | P0 | **File upload.** From Files, photo library, camera, or document scan (to PDF). Respects allowed extensions. Uses Canvas's three-step upload in background-safe transfers, with progress and retry. |
| ASSIGN-5 | P0 | **Website URL.** |
| ASSIGN-6 | P1 | **Media recording.** Audio and video recording and upload as a media submission. |
| ASSIGN-7 | P1 | **Student annotation.** Opens Canvas DocViewer through `canvadoc_session` in the authenticated web view, then submits with `submission_type=student_annotation`. |
| ASSIGN-8 | P0 | **External tool assignments.** Launch per 7.7. |
| ASSIGN-9 | P1 | **Tool-based file pickers.** Deep-link submissions from tools like Studio, Google Drive, and OneDrive, using the `homework_submission` placement in the authenticated web view. |
| ASSIGN-10 | P0 | **Submission history.** Attempt picker. A viewer per type: text, URL, files (7.14), media, quizzes, discussions, and LTI relaunch. |
| ASSIGN-11 | P0 | **Feedback.** Rubric with ratings and comments. Instructor annotations through DocViewer. Submission comments with text, files, and audio/video, both read and written. |
| ASSIGN-12 | P1 | **Peer reviews.** See assigned peer reviews and complete them, including rubric assessment. The official apps lack this. |
| ASSIGN-13 | P1 | **Group assignments.** Show the group and submit on its behalf. |
| ASSIGN-14 | P0 | **Reminders.** Local reminders at chosen offsets before the due date. |
| ASSIGN-15 | P1 | **Mastery paths.** Choose a path when the module offers one. |
| ASSIGN-16 | P1 | **Share into Easel.** From the system share sheet, submit to an assignment or upload to My Files. |

### 7.7 External tools (LTI)

| ID | Pri | Requirement |
| --- | --- | --- |
| LTI-1 | P0 | **Launch flow.** Use sessionless launch (`GET /api/v1/{courses\|accounts}/:id/external_tools/sessionless_launch`) with the right `launch_type`. Pass `assignment_id`, `module_item_id`, `resource_link_lookup_uuid`, or `url` as needed. Append `platform=mobile` for LTI 1.3 on iOS. |
| LTI-2 | P0 | **Where it opens.** Tools open in an in-app browser (SFSafariViewController, or Custom Tabs on Android). Tools that need the Canvas session open in the authenticated in-app web view instead (New Quizzes and other Instructure tools). The choice is per tool and remembered. |
| LTI-3 | P0 | **Open in browser.** Every tool screen has an "Open in browser" action. It wraps the launch in `/login/session_token?return_to=` so the system browser arrives logged in. This is the guaranteed fallback. |
| LTI-4 | P0 | **What the in-app web view supports.** Popups and `window.open`, file downloads (handed to 7.14), file inputs, camera and microphone permissions, and third-party OAuth popups (Google, Microsoft) inside tools. |
| LTI-5 | P0 | **Embedded tools.** Tools inside course content (`external_tools/retrieve` iframes) render inline with authentication. Each has a tap-to-launch fallback. |
| LTI-6 | P1 | **Global navigation tools.** Studio, portfolio tools, and similar, listed in a Tools section reachable from Home overflow or Settings. |
| LTI-7 | P1 | **Module item tools.** Launching one marks it viewed. |

### 7.8 Quizzes (QUIZ)

| ID | Pri | Requirement |
| --- | --- | --- |
| QUIZ-1 | P0 | **Quiz list and details.** Native. Instructions, time limit, attempts, due dates, and lock state. |
| QUIZ-2 | P0 | **Native classic quizzes.** Take Classic Quizzes natively through the Quiz Submissions API: start, questions, answer, flag, timer (`/time`), complete, and the event log. |
| QUIZ-3 | P0 | **Question types.** All of them: multiple choice, true/false, multiple answers, matching, multiple dropdowns, fill in multiple blanks, short answer, numerical, calculated (formula display), essay (rich text), file upload, and text-only. |
| QUIZ-4 | P0 | **Answer safety.** Autosave every answer. Resume after the app is killed. Warn before leaving an attempt in progress. Submit automatically when the time limit ends, as the web does. |
| QUIZ-5 | P0 | **Access codes and IP filters.** Prompt for an access code. Show the server's IP-filter message plainly. |
| QUIZ-6 | P0 | **Web view fallback.** Quizzes the API can't take open in the authenticated web view, with a back-navigation guard. These are one question at a time, can't go back, and LockDown Browser quizzes. |
| QUIZ-7 | P0 | **LockDown Browser.** Explain that the quiz needs Respondus LockDown Browser, and offer to open it if installed. |
| QUIZ-8 | P0 | **New Quizzes.** Launch through sessionless launch with `launch_type=assessment` in the authenticated web view, with a guard against leaving mid-attempt. |
| QUIZ-9 | P1 | **Results and history.** Native where the API allows. Otherwise the `/history` page in the web view. |

### 7.9 Grades (GRADE)

| ID | Pri | Requirement |
| --- | --- | --- |
| GRADE-1 | P0 | **Grades overview.** Every active course with its current grade, unless the course hides totals (`hide_final_grades`). Reached from Home. Home course cards never show grades (HOME-3). |
| GRADE-2 | P0 | **Course grades.** Assignments grouped by assignment group, with weights (`group_weight`, `apply_assignment_group_weights`). Score, letter grade, status (late, missing, excused, custom statuses), and posted/hidden state. |
| GRADE-3 | P0 | **Grading periods.** Picker, plus a "Based on graded assignments" toggle. |
| GRADE-4 | P0 | **Restricted quantitative data.** Show letter grades only and hide points, because the server doesn't strip them. |
| GRADE-5 | P1 | **What-if scores.** Recalculate locally, matching the web calculator (`ui/shared/grading/CourseGradeCalculator.ts`). Reset with one action. Optionally save with the what-if API. Turned off under restricted quantitative data. |
| GRADE-6 | P0 | **Item details.** Tapping a grade opens submission details with feedback (ASSIGN-11). |
| GRADE-7 | P1 | **New grades.** Recent grades appear in Activity, and optionally as a local notification. |

### 7.10 Calendar (CAL)

| ID | Pri | Requirement |
| --- | --- | --- |
| CAL-1 | P0 | **Month and agenda views.** Month view with day dots in course colors, plus an agenda list. Fast "Today". |
| CAL-2 | P1 | **Week and day views.** Hour grid. |
| CAL-3 | P0 | **What it shows.** Calendar events, assignments, quizzes, discussions, sub-assignments (checkpoints), planner notes, and appointment reservations. Tapping opens the item. |
| CAL-4 | P0 | **Filter by calendar.** Course, group, and personal calendars. Requests are batched because Canvas honors only 10 `context_codes` per request. |
| CAL-5 | P1 | **Personal events.** Create, edit, and delete, including recurrence and rich-text details. |
| CAL-6 | P1 | **Appointment scheduler.** Browse reservable appointment groups, sign up for a slot, cancel, and add comments (`appointment_groups`, `calendar_events/:id/reservations`). |
| CAL-7 | P1 | **Device calendar.** Subscribe to or export to the device calendar (SET-8). |

### 7.11 To Do (TODO)

| ID | Pri | Requirement |
| --- | --- | --- |
| TODO-1 | P0 | **Everything due.** Every planner item across courses (`/api/v1/planner/items`): assignments, quizzes, graded discussions, pages and ungraded items with to-do dates, peer reviews, checkpoints, and planner notes. Grouped Overdue, Today, Tomorrow, then by day. Built on mock data. |
| TODO-2 | P0 | **Mark done.** Swipe or checkbox with undo, through planner overrides (`marked_complete`). This also satisfies module "mark done" requirements, as the server does. |
| TODO-3 | P0 | **Personal to-dos.** Add, edit, and delete planner notes, optionally linked to a course, with a date and time. |
| TODO-4 | P0 | **Filters.** All, To do, Missing, Done, by course, and a date range. Show completed items on demand. |
| TODO-5 | P1 | **Dismiss.** Remove an item from the list without completing it (`dismissed`). |
| TODO-6 | P1 | **Tab badge.** Count of overdue and due-today items. Configurable, off by default. |
| TODO-7 | P1 | **Reminders.** Per item (ASSIGN-14) and for personal to-dos. |

### 7.12 Announcements (ANN)

| ID | Pri | Requirement |
| --- | --- | --- |
| ANN-1 | P0 | **Combined feed.** Announcements from all courses, newest first, with unread state and a course filter. |
| ANN-2 | P0 | **Per-course list.** Inside each course. |
| ANN-3 | P0 | **Announcement details.** Rendered body (7.17), attachments (7.14), and author. Opening it marks it read. |
| ANN-4 | P1 | **Replies.** Read and post replies where the course allows them. |
| ANN-5 | P0 | **Global announcements.** Account announcements appear here and on Home (HOME-5). |

### 7.13 Discussions, modules, pages, syllabus (CONTENT)

| ID | Pri | Requirement |
| --- | --- | --- |
| CONTENT-1 | P0 | **Discussion list.** Pinned, open, and closed. Unread counts. |
| CONTENT-2 | P0 | **Native threads.** Built with GraphQL, not the embedded web page the official apps use. Threading, read/unread tracking, likes, mentions, sorting, search, and "reply before you can see replies". |
| CONTENT-3 | P0 | **Reply and edit.** Reply, edit, and delete your own posts, with attachments and the rich editor. |
| CONTENT-4 | P1 | **Graded discussions.** Checkpoints (reply to topic, required replies), anonymous discussions, and group discussions. |
| CONTENT-5 | P1 | **Start a discussion.** Create a discussion when students are allowed to. |
| CONTENT-6 | P0 | **Modules.** Progress, requirements (view, mark done, submit, score, contribute), prerequisites, locks with explanations, and sequential progress. |
| CONTENT-7 | P0 | **Module sequence.** Previous and next navigation across any item type, marking items viewed as the server expects. |
| CONTENT-8 | P0 | **Pages.** Front page and list. Editing in P1 when the student has permission. |
| CONTENT-9 | P0 | **Syllabus.** Body plus the course summary of dated items. |
| CONTENT-10 | P1 | **People.** Roster with roles. Profile card. Message a person (opens compose). |
| CONTENT-11 | P1 | **Conferences.** List, details, and recordings. "Join" opens the system browser through `session_token`. |
| CONTENT-12 | P2 | **Outcomes.** Native read-only view of outcome mastery. Web view until then (COURSE-4). |
| CONTENT-13 | P2 | **ePortfolios.** Read-only list, opening on the web. |

### 7.14 Files and attachments (FILE)

This is where Easel must be clearly better than the official Android app. That app labels files with raw MIME strings like `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (`FileDetailsFragment.setupTextViews`). It downloads files without a bearer token, relying on URL verifiers or web cookies, so downloads fail on some schools. It routes taps through three handlers that behave differently. And it has no way to share a file out.

**Principle.** Every file opens to something useful, the same way, from every entry point. That means a real preview, or a clear file card with working actions. Never a MIME string. Never a silent failure.

| ID | Pri | Requirement |
| --- | --- | --- |
| FILE-1 | P0 | **One viewer.** A single file viewer used by course files, My Files, module items, assignment and submission attachments, comment attachments, discussion and announcement attachments, inbox attachments, links in rendered content, and files shared into Easel. |
| FILE-2 | P0 | **Download pipeline.** Authenticated downloads that try, in order: the verifier URL, the bearer token, then a `session_token` web session. If the server returns an HTML login page instead of the file, the app detects it and never saves it as the file. Real error states: not found, no permission, locked (with unlock date), offline, and server error. |
| FILE-3 | P0 | **Previews by type.** Per the matrix below. |
| FILE-4 | P0 | **Share.** The system share sheet with the actual file, not a link, so notes apps (Apple Notes, GoodNotes, Notion, Obsidian, OneNote, Google Keep, and others) receive it. A separate "Share link" shares the Canvas URL. |
| FILE-5 | P0 | **Save to device.** iOS saves to Files through the document export picker, and images and videos can save to Photos. Android uses a "Save to…" picker (Storage Access Framework) and also offers quick save to Downloads. Progress, and a notification when done. |
| FILE-6 | P0 | **Open in another app.** iOS through the share sheet. Android through an `ACTION_VIEW` chooser with a FileProvider URI and read permission granted, never a bare remote URL. |
| FILE-7 | P0 | **File card.** Every file shows a type icon, a human-readable type ("Word document", "PDF", "MP4 video"), size, modified date, course, and lock state. MIME strings appear nowhere in the UI. |
| FILE-8 | P0 | **Swipe between attachments.** When a message, comment, or post has several attachments, swipe between them in the viewer. |
| FILE-9 | P0 | **File browser.** Course, group, and user files. Folders, search, sort, and lock and availability state. Upload and create folders in My Files and wherever the student has permission. |
| FILE-10 | P1 | **Offline files.** Downloaded files are kept and available offline, and listed and manageable in Settings (SET-10). |
| FILE-11 | P1 | **Print.** For PDFs, images, and documents with a PDF rendition. |
| FILE-12 | P2 | **Local PDF markup.** Highlight and draw on PDFs and export a flattened copy. |

**Preview matrix**

| Type | Preview | Notes |
| --- | --- | --- |
| PDF | Native renderer with zoom, page thumbnails, search, text selection, and page position memory | Annotation assignments use DocViewer (ASSIGN-7). |
| Images (JPEG, PNG, GIF, HEIC, WebP, SVG) | Native viewer with pinch zoom, pan, and animated GIF | Save to Photos (FILE-5). |
| Video | Native player with captions (`media_tracks`), picture in picture, scrubbing, and playback speed | Canvas media objects and Studio videos too. |
| Audio | Native player with background playback and lock-screen controls | |
| Word, Excel, PowerPoint, ODF, RTF | Canvas DocViewer preview (`preview_url` / `canvadoc_session`) when the school has it. On iOS, also QuickLook on the downloaded file. Otherwise a file card with "Open in…" | Server-side previews depend on the school's Canvadocs or Google Docs setup. |
| Plain text, code, CSV, Markdown | Native text viewer (monospace for code). CSV as a table. Markdown rendered | |
| HTML | Sandboxed web view with the file's relative assets resolved | |
| Web links | In-app browser with "Open in browser" | |
| ZIP and others | File card with Share, Save, and Open in… | ZIP contents listing in P2. |

### 7.15 Inbox (INBOX)

| ID | Pri | Requirement |
| --- | --- | --- |
| INBOX-1 | P0 | **Scopes and filter.** Inbox, Unread, Starred, Sent, and Archived. Filter by course. |
| INBOX-2 | P0 | **Conversations.** Read with attachments (FILE-1) and media messages. Reply, reply all, and forward. |
| INBOX-3 | P0 | **Compose.** Pick a course, search recipients by person, role, section, or group, add a subject and body, and send. "Send individually" option. |
| INBOX-4 | P0 | **Attachments.** Add files and photos to messages. |
| INBOX-5 | P1 | **Media.** Record audio or video in a message. |
| INBOX-6 | P0 | **Actions.** Star, mark read or unread, archive and unarchive, delete a conversation or a single message. |
| INBOX-7 | P1 | **Signature.** Settings (SET-7). |
| INBOX-8 | P1 | **Submission comments.** The web inbox's "Submission comments" scope. |

### 7.16 Notifications and activity (NOTIF)

| ID | Pri | Requirement |
| --- | --- | --- |
| NOTIF-1 | P0 | **Activity.** The activity stream (`users/self/activity_stream`): announcements, discussions, grades, submission comments, conversations, conferences, and messages. Filter by type. Opening an item routes into the app. |
| NOTIF-2 | P0 | **Local notifications.** For due-date reminders (ASSIGN-14, TODO-7). |
| NOTIF-3 | P0 | **Background refresh.** Checks for new grades, announcements, inbox messages, submission comments, and newly posted assignments, and posts local notifications per SET-5 (4.3). |
| NOTIF-4 | P2 | **Real-time push.** If Instructure configures SNS for Easel's key (4.3). |
| NOTIF-6 | P0 | **Android Canvas Student bridge.** Explicitly opt in to on-device notification access. Native event-driven delivery, category/quiet-hour settings, account/course routing, optional hide-copy (default on), bounded foreground-refresh markers and reduced activity/inbox polling while connected. No network, timers, wake locks or JS startup in the listener. Canvas Student required. |
| NOTIF-5 | P0 | **Routing.** Notification taps and badge counts route to the right account and screen. |

### 7.17 Rich content rendering (HTML)

Canvas content is author-written HTML. Rendering it well is most of what makes a Canvas client feel good or bad.

| ID | Pri | Requirement |
| --- | --- | --- |
| HTML-1 | P0 | **One renderer.** One shared content renderer for pages, assignment descriptions, announcements, discussions, syllabus, and quiz questions. |
| HTML-2 | P0 | **Easel styling.** Easel's type, colors, and spacing, with real dark mode (CSS that respects authored colors and keeps contrast), not the official apps' color inversion. Tables scroll horizontally. Images fit the width and zoom on tap. |
| HTML-3 | P0 | **Math.** MathJax or KaTeX, loaded only when content contains math. Equation images display. |
| HTML-4 | P0 | **Media and iframes.** Embedded media (Canvas media, Studio, YouTube, Vimeo) and iframes play inline. LTI iframes authenticate (LTI-5). |
| HTML-5 | P0 | **Link routing.** Canvas links (assignments, pages, files, modules, discussions, quizzes, courses, and user content) open natively in Easel. Other links open in the in-app browser. |
| HTML-6 | P0 | **Session upkeep.** Keep the web session alive for authenticated iframes and media, using `session_token` refresh. |
| HTML-7 | P0 | **Text scaling and RTL.** Content follows system text size, and right-to-left languages lay out correctly. |
| HTML-8 | P1 | **Theme injection.** Honor the school's mobile theme CSS and JS only where it doesn't break accessibility or Easel's styles. |

### 7.18 Offline and caching (OFF)

| ID | Pri | Requirement |
| --- | --- | --- |
| OFF-1 | P0 | **Cache-first reads.** Every screen shows cached data immediately, then refreshes. Offline, it shows the last data with an offline banner and disables actions that need the network. |
| OFF-2 | P1 | **Queued writes.** Marking done, planner notes, and drafts sync when back online. |
| OFF-3 | P1 | **Course sync.** Choose courses and tabs to download fully, including pages, files, modules, assignments, grades, syllabus, announcements, discussions, and media. Daily or weekly auto-sync, Wi-Fi only option. This matches the official apps' offline mode. |

### 7.19 System integration (SYS)

| ID | Pri | Requirement |
| --- | --- | --- |
| SYS-1 | P1 | **Home screen widgets.** On both platforms: To Do, Next due, Announcements, and Grades. Grades is opt-in and off by default, consistent with HOME-3. |
| SYS-2 | P1 | **Share into Easel.** The share target (ASSIGN-16). |
| SYS-3 | P1 | **Open Canvas links in Easel.** Handle `easel://` links, and Canvas URLs shared to Easel, by routing them in-app (4.4). |
| SYS-4 | P2 | **Shortcuts.** App shortcuts or quick actions (To Do, Calendar, Inbox), and Siri / App Intents for "What's due?". |
| SYS-5 | P2 | **Tablet layouts.** iPad and Android tablet layouts with split views. Phones in portrait are the 1.0 baseline. |

## 8. Non-functional requirements

**First-build exception (user decision, 2026-10-30):** accessibility and localization work and acceptance are deferred until after the first build. Existing support stays in place; English is sufficient for first-build language acceptance. This includes deferring assistive-technology, large-text and RTL audits, additional translations and human language review. Canvas time-zone correctness, account isolation and other functional requirements still apply. The table below remains the longer-term product target.

| Area | Requirement |
| --- | --- |
| Accessibility | WCAG 2.2 AA. VoiceOver and TalkBack names, roles, and states on every control. Dynamic Type and Android font scale up to the largest sizes without clipping. 44pt / 48dp touch targets. Reduce Motion respected. `pnpm run check-contrast` passes. |
| Performance | Cold start to cached Home in under 2 seconds on a 3-year-old mid-range phone. 60fps scrolling in long lists. Lists virtualized. Images cached and resized. |
| Reliability | Crash-free sessions of 99.8% or better. Every network error has a retry. Uploads survive app backgrounding. Quiz answers are never lost (QUIZ-4). |
| Security | Tokens in Keychain / Keystore. No tokens in logs. Certificate validation is never disabled. Web views share cookies only with the account's Canvas domain. |
| Privacy | No third-party analytics by default. Crash reporting is opt-in. Easel's servers, if any ever exist, never store Canvas tokens without a separate review (4.3). |
| Localization | Follow Canvas's `effective_locale`. Launch with English. Target the languages the official apps ship (about 45 locales) for 1.0, including right-to-left support. Dates and times use the user's Canvas time zone. |
| Compatibility | The last two major iOS versions and Android 10 or later. Any Canvas instance, Instructure-hosted or self-hosted. |
| Design | Follows the Easel design system and PRODUCT.md. Native chrome on iOS, Easel chrome on Android, no Material components. |

## 9. Technical approach

These are recommendations to settle in M0, not requirements.

- **Builds.** Leave Expo Go for development builds (`pnpm exec expo run:ios|android`, EAS). Web views, PDF rendering, background tasks, and widgets all need native modules.
- **API layer.** A typed REST client handling Link-header pagination, `as_user_id`, and rate-limit backoff. GraphQL for discussions, inbox, and submission data where it's richer.
- **Server state.** TanStack Query, with persistence to SQLite or MMKV for OFF-1.
- **Auth.** `expo-auth-session` / `expo-web-browser` for AUTH-3, and `expo-secure-store` for AUTH-9.
- **Web views.** `react-native-webview`, wrapped once as `AuthenticatedWebView`. It handles `session_token` setup, cookies, downloads, popups, permissions, and link routing, and is used by LTI, quizzes, DocViewer, and HTML.
- **Files.**
  - `expo-file-system` for downloads.
  - `expo-sharing` or a native share module for FILE-4.
  - The iOS document export picker and Android Storage Access Framework for FILE-5.
  - `expo-video` and `expo-audio` for media.
  - A native PDF view (PDFKit on iOS, PdfRenderer or PDFium on Android) for FILE-3.
- **Background work.** `expo-background-task` and `expo-notifications` for NOTIF-2 and NOTIF-3.
- **Development Canvas.** Run the local `../canvas-lms` checkout with seeded courses and a locally created developer key. All flows can then be built and tested without production credentials. A shared Canvas test instance is used for SSO cases.

## 10. Success criteria

- **Parity.** Every P0 and P1 row in section 7 is shipped and checked off in the parity tracker before 1.0. The test is a full semester week of real coursework done only in Easel, with no trip to the official app or the browser except through Easel's own "Open in browser" actions.
- **Files.** Every file type in the preview matrix opens, shares to Apple Notes and one Android notes app, and saves to the device, on both platforms, at a school with Canvadocs and one without.
- **Login.** Sign-in works at schools using Canvas login, SAML with Duo MFA, Microsoft, and Google SSO, and on a self-hosted instance.
- **Accessibility.** An audit with VoiceOver, TalkBack, and the largest text size finds no blocking issues.

## 11. Milestones

| Milestone | Scope | Exit criteria |
| --- | --- | --- |
| M0 Foundation | Decisions in section 12; dev builds; API client; data layer and cache; AuthenticatedWebView; AUTH-1 to AUTH-10; ACCT-1 to ACCT-3; local canvas-lms dev environment | Sign in with SSO at a test school, switch between two accounts, and see real courses on Home. |
| M1 Daily driver (P0) | All P0 rows: Home, courses, assignments and submissions, classic and New Quizzes, LTI with browser fallback, grades, calendar month and agenda, To Do, announcements, discussions, modules, files viewer with share and save, inbox, activity, local notifications, HTML renderer, cache-first offline | A student uses Easel instead of the official app for one week. |
| M2 Parity (P1) | All P1 rows: media submissions, annotations, peer reviews, scheduler, week and day calendar, what-if, course sync, widgets, share extension, preferences, profile, localization | Parity tracker fully checked. Accessibility audit passes. 1.0 release. |
| M3 Beyond parity (P2) | Push via SNS if available, QR login if available, tablets, PDF markup, shortcuts, Outcomes native, Act as User | Driven by user feedback. |

## 12. Open decisions

| # | Decision | Recommendation |
| --- | --- | --- |
| 1 | Credential strategy (4.1) | **Decided (2026-10-31).** Discover mobile credentials when no developer key is available; preserve developer-key and access-token alternatives. An Easel global key remains a future option. |
| 2 | Push notifications (4.3) | Local and background-refresh notifications in 1.0. SNS through the partnership later. No token-holding relay server. |
| 3 | PDF engine | Native renderers (free). Use DocViewer web for annotation assignments. Revisit a commercial SDK (Nutrient, Apryse) only if FILE-12 or quality demands it. |
| 4 | Tablet layouts in 1.0 | Not in 1.0 (SYS-5 is P2). Phones in portrait. |
| 5 | Canvas for Elementary (K5 Homeroom) | Out of scope for 1.0. The official apps support it, so revisit if Easel targets K-12. |
| 6 | School branding (`brand_variables`) | Don't recolor Easel's chrome. Optionally show the school logo in the account switcher. |
| 7 | Crash reporting | Opt-in Sentry, or none. |
| 8 | Store listing | Name "Easel". Describe Canvas compatibility without implying an Instructure affiliation (PRODUCT.md brand commitments). |

## 13. Reference

Where the official implementations live, for parity checks. Paths are relative to the workspace root.

| Area | iOS | Android | Server |
| --- | --- | --- | --- |
| Login | `canvas-ios/Core/Core/Features/Login/` | `canvas-android/libs/login-api-2/.../login/` | `canvas-lms/app/controllers/oauth2_provider_controller.rb`, `lib/canvas/oauth/` |
| Session refresh | `Core/Core/Features/TokenRefresh/` | `libs/canvas-api-2/.../utils/CanvasAuthenticator.kt` | `lib/canvas/oauth/grant_types/refresh_token.rb` |
| Dashboard | `Core/Core/Features/Dashboard/`, `Student/Student/LearnerDashboard/` | `apps/student/.../features/dashboard/` | `dashboard/dashboard_cards` API |
| Assignments and submissions | `Student/Student/Assignments/`, `Student/Student/Submissions/` | `apps/student/.../mobius/assignmentDetails/` | `submissions_api_controller.rb` |
| Quizzes | `Core/Core/Features/Quizzes/` | `apps/student/.../fragment/BasicQuizViewFragment.kt` | `app/controllers/quizzes/`, `quiz_submission_service.rb` |
| LTI | `Core/Core/Features/LTI/` | `libs/pandautils/.../features/lti/` | `external_tools_controller.rb`, `lti/concerns/sessionless_launches.rb` |
| Files | `Core/Core/Features/Files/`, `Core/Core/Features/DocViewer/` | `libs/pandautils/.../loaders/OpenMediaAsyncTaskLoader.kt`, `apps/student/.../features/files/` | `files_controller.rb`, `app/models/canvadoc.rb` |
| Grades | `Core/Core/Features/Grades/` | `libs/pandautils/.../features/grades/` | `what_if_grades_api_controller.rb`, `lib/api/v1/course_json.rb` |
| Calendar and planner | `Core/Core/Features/Planner/`, `Core/Core/Features/Todos/` | `libs/pandautils/.../features/calendar/`, `features/todolist/` | `planner_controller.rb`, `calendar_events_api_controller.rb` |
| Discussions | `Core/Core/Features/Discussions/` | `libs/pandautils/.../features/discussion/` | GraphQL `app/graphql/types/` |
| Inbox | `Core/Core/Features/Inbox/` | `libs/pandautils/.../features/inbox/` | `conversations_controller.rb`, GraphQL |
| Notifications | `Core/Core/Features/Notifications/` | `libs/pandautils/.../services/PushNotificationRegistrationWorker.kt` | `communication_channels_controller.rb`, `notification_endpoint.rb` |
| Rich content | `Core/Core/Common/CommonUI/CoreWebView/` | `libs/pandautils/.../views/CanvasWebView.kt`, `utils/HtmlContentFormatter.kt` | `lib/api/html/content.rb` |
| Offline | `Core/Core/Features/CourseSync/` | `libs/pandautils/.../features/offline/sync/` | n/a |
