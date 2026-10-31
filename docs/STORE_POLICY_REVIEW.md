# Easel store policy review

**Date:** 2026-10-31. **Scope:** read-only review of `/Users/evanyu/canvas-rewrite/easel`, installed native modules, generated native configuration, and current official Google/Apple documentation. Android package: `dev.evanyu.easel`; iOS identifier remains `dev.badbird.easel`. No app files, account settings, credentials, builds, or devices were changed by this audit.

## Decision for the current Android internal test

**A blanket statement that Easel is fully compliant is not supported.** There are concrete media-permission and privacy-disclosure gaps, and the required safeguards for its discussions and direct messages have not been demonstrated. These are separate from store setup fields that can legitimately remain incomplete during internal testing.

Google permits internal testing before completing all app setup, may omit ordinary policy/security review, and exempts internal-only apps from the Data safety section. Its documentation does **not** grant a general exemption from the substantive privacy, permission, or user-generated-content rules. The absence of a Console rejection would therefore not establish compliance. [Internal testing](https://support.google.com/googleplay/android-developer/answer/9845334?hl=en).

The table below gives **audit recommendations**, not a prediction that Console will technically block each action. Creating a draft listing and releasing an artifact are different actions; a draft does not resolve a declaration that explicitly asserts the app currently complies.

| Issue | Evidence level | Internal Android release recommendation | Smallest credible resolution |
|---|---|---|---|
| Broad photo/video permissions without a demonstrated broad-library use case | Confirmed in config and generated manifest | Hold this artifact until corrected or a valid policy exception is established | Use system pickers; remove/block unnecessary read permissions; preserve legacy add-only saving; rebuild and inspect the actual AAB |
| No complete Easel privacy policy found; inaccurate “only Canvas” claim | Confirmed in inspected in-app surfaces | Resolve before distribution/affirmative compliance claim | Publish and link an accurate Easel policy, including actual third parties and retention/deletion/contact details; correct existing text |
| In-app content/user reporting and direct-message blocking not found | High-confidence implementation gap; institution operations unknown | Resolve or demonstrate an effective existing institution-backed implementation before claiming compliance | Contextual report flow reaching accountable moderators, effective block behavior, applicable accepted user policy, and an actual response process |
| Data safety form | Explicit internal-only exemption | Does not itself hold an internal-only rollout | Complete before moving to closed/open/production; do not infer “no data collected” from “no Easel server” |
| Reviewer account, store copy, audience/rating, foreground-service declarations, signing/export fields | Console/business facts not independently inspected | Supply fields that Console requires now; remaining review material can be prepared before review | Use truthful, tested details and the final release artifact |
| Apple review, privacy labels, archived SDK manifests | Not part of the current Android release | Does not hold Android testing | Complete before Apple beta/review as applicable |

## 1. Media permissions: exact remediation

[`app.json:34`](/Users/evanyu/canvas-rewrite/easel/app.json:34) explicitly requests `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO`, `READ_MEDIA_AUDIO`, `READ_MEDIA_VISUAL_USER_SELECTED`, `READ_EXTERNAL_STORAGE`, and `WRITE_EXTERNAL_STORAGE`. The generated [`AndroidManifest.xml:8`](/Users/evanyu/canvas-rewrite/easel/android/app/src/main/AndroidManifest.xml:8) contains them; legacy read/write permissions are capped at API 32.

The inspected workflows select specific attachments/avatars through system pickers. In particular, [`attachments.tsx:161`](/Users/evanyu/canvas-rewrite/easel/src/features/inbox/attachments.tsx:161) first requests media-library access and refuses to open the picker if it is denied. That extra gate is unnecessary for Android's picker flow. The installed image-picker implementation uses Android `PickVisualMedia`/system contracts, including platform fallbacks.

Google restricts broad **photo/video** permission to core use cases that cannot be adequately served by a system picker. Repeated attachment selection alone does not establish that qualification. `READ_MEDIA_AUDIO` is a separate unused-access/minimization concern, not a permission covered by the photo/video-specific rule. The enterprise/private-app exception must not be confused with an ordinary app temporarily placed on the internal test track. [Photo/video and permission policy](https://support.google.com/googleplay/android-developer/answer/16935362).

Recommended bounded change:

1. Remove the Android non-camera `requestMediaLibraryPermissionsAsync()` gate. Preserve camera/microphone permission handling for actual capture.
2. Remove the explicit broad read declarations; set the media-library plugin's `granularPermissions` to `[]`. Also use Android `blockedPermissions` for unused `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO`, `READ_MEDIA_AUDIO`, `READ_EXTERNAL_STORAGE`, and `READ_MEDIA_VISUAL_USER_SELECTED`, so transitive/plugin manifests cannot restore them.
3. Keep the add-only save path and necessary capped legacy **write** permission until its supported older-Android behavior is verified.
4. Rebuild and check the **merged release AAB** manifest, then exercise picking and gallery saving on API 24–29, 30–32, and 33+ with library permission denied.

Removing entries only from `android.permissions` is insufficient: the installed [`withMediaLibrary.ts:18`](/Users/evanyu/canvas-rewrite/easel/node_modules/expo-media-library/plugin/src/withMediaLibrary.ts:18) defaults to all three granular permissions, and its lines 89–96 also add legacy read/write and selected-visual access. [Expo SDK 58 MediaLibrary](https://docs.expo.dev/versions/v58.0.0/sdk/media-library/).

### Saving to the gallery does not justify broad read access

[`actions.ts:206`](/Users/evanyu/canvas-rewrite/easel/src/features/files/actions.ts:206) already calls `requestPermissionsAsync(true)` and `Asset.create(local.uri)`. The installed SDK's `SystemPermissionsDelegate` excludes `READ_MEDIA_*` and `READ_EXTERNAL_STORAGE` when `writeOnly` is true. Its modern asset factory inserts/copies/publishes a new app-owned asset without reading the user's library. Its legacy factory requires write permission.

Android generally needs no storage permission to create/access the app's own shared-media entries on Android 10/API 29 and later. **SDK-specific nuance:** this installed Expo implementation selects its modern factory starting at API 30, so API 29 still follows its legacy write-permission path. Do not blindly remove legacy `WRITE_EXTERNAL_STORAGE` while retaining that implementation. Neither legacy creation nor modern creation establishes a need for library-wide **read** permission. [Android shared media](https://developer.android.com/training/data-storage/shared/media).

Native evidence: `node_modules/expo-media-library/android/src/main/java/expo/modules/medialibrary/next/MediaLibraryNextModule.kt:90`; `permissions/SystemPermissionsDelegate.kt:114`; `objects/asset/factories/AssetModernFactory.kt:61`; `objects/asset/factories/AssetLegacyFactory.kt:56` (the latter paths are relative to that module's `next/` directory).

## 2. Privacy policy and accurate data disclosures

[`about.tsx:208`](/Users/evanyu/canvas-rewrite/easel/src/app/(app)/about.tsx:208) links to the school's policy; [`legal.ts:83`](/Users/evanyu/canvas-rewrite/easel/src/canvas/api/legal.ts:83) constructs the school's `/privacy_policy`. The Easel-specific card at About lines 213–226 is a short assurance, not a complete Easel policy. [`en.ts:3239`](/Users/evanyu/canvas-rewrite/easel/src/i18n/en.ts:3239) says Easel has no servers/analytics and “talks only” to the school's Canvas.

The last claim is inaccurate for inspected code. The rich editor/content loads Google Fonts, RichContent loads MathJax from jsDelivr, and PDF previews load PDF.js from cdnjs. See [`editorDocument.ts:379`](/Users/evanyu/canvas-rewrite/easel/src/features/editor/editorDocument.ts:379), [`RichContent.tsx:412`](/Users/evanyu/canvas-rewrite/easel/src/features/content/RichContent.tsx:412), and [`WebPreviews.tsx:144`](/Users/evanyu/canvas-rewrite/easel/src/features/files/previews/WebPreviews.tsx:144). Canvas-authored embeds and LTI tools can introduce further destinations. This establishes third-party requests, **not** that these vendors receive assignments or operate analytics. At minimum, network metadata exposure must be assessed.

Google requires a public, accessible privacy-policy URL and an in-app policy/link. Its content must identify the app/developer, contact route, data practices/parties, handling, and retention/deletion. A school's policy does not by itself explain Easel's local storage, external resources, diagnostics/reporting, or developer practices. [User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311?hl=en&rd=1).

Minimal policy work should cover authentication tokens; profile/course/grade/message/submission content; attachments/media; offline caches/drafts; local notifications/widgets; optional calendar exports; school support reports; third-party resources/tools; account removal/local cleanup; school-controlled retention; and a real developer contact. Distinguish automatic processing from explicit user sharing. Bundle fonts/scripts locally if the desired product promise really is no incidental external resource requests.

No obvious advertising/analytics SDK was found in package.json. Notification code uses local scheduling rather than a discovered Expo push-token registration flow. Those are useful observations, **not** a complete traffic or vendor-retention audit. Google Data safety and Apple privacy labels require an actual data-flow inventory; primary Canvas content cannot automatically be excluded merely because its destination is a school rather than an Easel-owned server. [Google Data safety](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en), [Apple privacy disclosures](https://developer.apple.com/app-store/app-privacy-details/).

## 3. Discussions, Inbox, and institution-backed moderation

Easel exposes native discussions and direct messaging. Searches of their implementation and Canvas API adapters found no working report-content/report-user or block-user feature. Inbox archive/delete and local upload “blocked” state are not user blocking. The existing [`help.ts:109`](/Users/evanyu/canvas-rewrite/easel/src/canvas/api/help.ts:109) sends a generic problem report to Canvas `/api/v1/error_reports`; that alone does not demonstrate a contextual abuse-reporting route, accountable moderation, or blocking.

Google's UGC rule expressly includes specialized clients. A restricted school/company user group still needs in-app reporting of content and users; one-to-one interactions need blocking. It also expects accepted terms/user policy and ongoing moderation. School-hosted content is therefore not a categorical exemption. [Google UGC policy](https://support.google.com/googleplay/android-developer/answer/9876937?hl=en).

The school can own investigation and enforcement; Easel does **not** necessarily need its own content-moderation backend. A credible integration must show how a report identifies the offending content/user, reaches a monitored institution channel, receives action, and how a user blocks an abusive correspondent in Easel. Validate the effectiveness of any client-side suppression and school escalation before describing it as blocking. Accepted school conduct rules may satisfy the user-policy component if their content and acceptance actually meet requirements; an extra Easel checkbox is not automatically necessary. Existing Canvas terms flows only prove acceptance when Canvas itself requests it.

Apple also expects filtering, reporting, responsive moderation, blocking, and contact information for UGC. Document how institution services plus the client provide those safeguards. [Apple guidelines §1.2](https://developer.apple.com/app-store/review/guidelines/#user-generated-content).

## 4. Accounts, authentication, and reviewer access

**Account deletion is conditional.** The inspected app signs into existing Canvas accounts; no Easel account-creation feature was found. Removing a local saved account is not deleting the school's student record, and the app should not pretend otherwise. Both stores tie their account-deletion requirement to apps that support account creation. Confirm that embedded school sign-up links or an automatically created service account do not change the facts. If creation is added, provide the required deletion initiation and associated data handling. [Google account deletion](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en), [Apple account deletion](https://developer.apple.com/support/offering-account-deletion-in-your-app/).

[`session.tsx:865`](/Users/evanyu/canvas-rewrite/easel/src/canvas/session.tsx:865) performs sign-out/credential removal and account cleanup. OAuth grants are revoked; user-provided PATs are deliberately forgotten rather than globally revoked. This is a reasonable distinction to explain in the privacy policy. Native storage deletion/completion and all cached-data paths were not independently exercised.

Sign in with Apple is **not automatically required** for this client: Apple's login guideline has exceptions for existing education/enterprise accounts and specific third-party-service clients. Reassess if independent consumer accounts/social login are added. [Apple §4.8](https://developer.apple.com/app-store/review/guidelines/#login-services).

[`keys.ts:20`](/Users/evanyu/canvas-rewrite/easel/src/features/auth/keys.ts:20) has an empty production school-key registry. Reviewers/testers therefore need a working school configuration and supported credentials/PAT flow. Provide a reachable, non-production-data demo institution/account with clear instructions, no expiring OTP dependency, and access to representative courses, submissions, Inbox, and browser tools. Localhost fake Canvas alone is not reachable by store reviewers. Google requires access to restricted functionality for review. [Google review preparation](https://support.google.com/googleplay/android-developer/answer/9859455?hl=en).

The public OAuth-client approach documented in keys.ts is preferable. Its fallback documentation suggesting schools distribute a confidential client secret deserves security review; no secret was inspected or exposed in this audit. Credentials are stored using SecureStore; [`client.ts:106`](/Users/evanyu/canvas-rewrite/easel/src/canvas/client.ts:106) normalizes non-local school endpoints to HTTPS. These are positives, not a penetration-test result.

## 5. Other permissions, services, and release-artifact checks

Camera/microphone uses are supported by capture/recording functionality and explicit purpose strings in [`app.json:95`](/Users/evanyu/canvas-rewrite/easel/app.json:95). Calendar export lists writable calendars and updates app-exported events, so read/write access has a concrete use; minimize it further if switching to a system add-event interface. No contacts, location, or advertising-ID permission was found in the inspected main configuration. WebView media capture and native permission-denial paths still need runtime verification.

`FOREGROUND_SERVICE_MEDIA_PLAYBACK` has a plausible user-facing purpose: [`MediaPreviews.tsx:101`](/Users/evanyu/canvas-rewrite/easel/src/features/files/previews/MediaPreviews.tsx:101) intentionally keeps audio playing and shows playback controls. Google requires correct service type/declarations and supporting description/video where requested. Verify it starts only for user-initiated playback and stops appropriately; do not remove it solely because it is a foreground service. [Foreground-service requirements](https://support.google.com/googleplay/android-developer/answer/13392821?hl=en).

The generated main Android manifest also contains `SYSTEM_ALERT_WINDOW` at line 14 and `exp+easel` at line 48. These may be development-configuration residue; the final store AAB was not available to this audit. Inspect the actual artifact for unnecessary overlay/debug/dev-launcher capabilities and remove them if present without a production purpose. Source manifest inspection is not a substitute for manifest merging.

Current Google documentation requires new mobile submissions to target API 36 or later. The installed Expo defaults specify 36, but verify the built artifact rather than infer its final target from defaults. [Target API policy](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en-EN). React Native/native libraries also require 16-KB compatibility assessment; use the final native-library alignment report and a compatible device/emulator. Current Android documentation describes the requirement and a February 1, 2027 update-enforcement date. [16-KB guidance](https://developer.android.com/guide/practices/page-sizes).

Background work is OS-scheduled, and Android uploads are not guaranteed to complete after process termination. Existing source acknowledges this. Store copy and tester instructions must not promise guaranteed background/terminated-app submission completion. No native background reliability claim is made here.

## 6. Children, branding, payments, and distribution facts

Education does not automatically mean a child-directed app, but Canvas can serve minors. The owner must choose an audience based on the actual intended product and marketing. If children are included, Google Families obligations apply; do not select an older audience merely to bypass them. No advertising SDK was found, which reduces one category of risk. Age suitability, school contracts, parental consent, and regional student-data obligations cannot be certified from source. [Target audience](https://support.google.com/googleplay/android-developer/answer/9867159?hl=en), [Families requirements](https://support.google.com/googleplay/android-developer/answer/9893335?hl=en).

[`en.ts:3234`](/Users/evanyu/canvas-rewrite/easel/src/i18n/en.ts:3234) clearly describes Easel as independent from Instructure. Carry that distinction into store copy/screenshots; do not imply an official replacement or institutional endorsement. Verify rights to icons, fonts, names, screenshots/course material and third-party service access. Apple's intellectual-property rule covers third-party service authorization. [Apple §5.2](https://developer.apple.com/app-store/review/guidelines/#intellectual-property).

No paid Easel digital feature or subscription purchase was found in the inspected scope. This is not an audit of every externally hosted course/LTI purchase flow. Reassess store payment rules if monetization is introduced.

For Google's current two-person internal test, the special new-personal-account production gate is not an internal-track prerequisite. If the account falls under that program, production access later requires the qualifying closed test (currently at least 12 opted-in testers continuously for 14 days) and an application; two internal testers do not satisfy it. [Personal-account testing](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en-FO).

Play App Signing acceptance, package ownership, identity verification, content rating, ads declaration, target audience, support contact, and export answers are owner/Console facts. User authorization to submit a declaration is not independent evidence of its factual answer. Do not assert a particular export exemption without classifying the actual app and destinations.

## 7. Apple-specific work before Apple distribution

This work does not block the present Android-only setup:

- **Privacy manifest packaging:** [`ios/Easel/PrivacyInfo.xcprivacy:5`](/Users/evanyu/canvas-rewrite/easel/ios/Easel/PrivacyInfo.xcprivacy:5) declares UserDefaults `CA92.1`, FileTimestamp `C617.1`, and SystemBootTime `35F9.1`; it has empty collected-data types and tracking false. Dependency manifests are present for several Expo/React Native/AsyncStorage modules. Generate the Xcode archive privacy report and verify all required SDK manifests/signatures and actual required-reason API uses. An empty collected-data array does not establish that App Store privacy labels should say no collection. [Apple SDK requirements](https://developer.apple.com/support/third-party-SDK-requirements/).
- **Release plist:** current generated Info.plist contains Expo development network text and unused-looking Face ID/reminder descriptions. Audit the actual release archive, remove unnecessary capabilities/purposes, and ensure purpose text describes real behavior.
- **Functionality/access:** the native courses, assignments, calendars, files, offline support, and messaging provide substantial functionality; this is not merely a website wrapper. Nevertheless, verify working review access, stable native/browser flows, and accurate metadata before submission. [Apple review guidelines](https://developer.apple.com/app-store/review/guidelines/).
- **Encryption:** TLS/secure-storage use still requires answering Apple's encryption questions correctly. Determine whether an exemption applies to the complete dependency stack and relevant regions; do not guess `ITSAppUsesNonExemptEncryption`. [Apple export compliance](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance).
- **TestFlight access:** internal testers must be eligible App Store Connect users. Friends with email addresses normally belong in external testing; do not grant account roles merely to avoid external beta review. External testing can require beta review and usable test instructions. [Internal testers](https://developer.apple.com/help/glossary/internal-testers/), [External testers](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers).

## Validation and limits

- `npm run typecheck` — **PASS**, exit 0.
- `npm run lint -- --max-warnings 0` — **PASS**, exit 0.
- Static inspection of app/config/generated-native files and installed SDK implementations; official policy/documentation review.
- **Not verified:** final AAB/IPA manifests, Play/App Store form answers, signed build capabilities, network captures, on-device permission prompts, gallery saving after remediation, moderation operations, real-school OAuth, all deletion/backup paths, native security, accessibility/RTL, translation accuracy, legal rights, or regional educational/privacy law compliance.

These checks establish code health and the evidence above. They do not certify store approval or legal compliance. No accessibility/localization expansion is recommended as part of this bounded first-build policy remediation.

## Owner decision for first internal build

The owner reviewed the findings and explicitly chose to proceed with the limited Google Play internal test, deferring remediation. This decision does not resolve the findings or establish full policy compliance. Public release and Apple submission remain separate follow-up work.
