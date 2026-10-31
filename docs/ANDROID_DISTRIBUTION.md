# Android distribution

- Android application ID: `dev.evanyu.easel`.
- Expo project: [badbird5907/easel](https://expo.dev/accounts/badbird5907/projects/easel).
- EAS project ID: `377a9eb4-3d50-4ecd-a2e9-9ebdcf7e75a1`.
- [Google Play app](https://play.google.com/console/u/0/developers/5619064695815356086/app/4974697871940096272/app-dashboard).
- [Internal testing track](https://play.google.com/console/u/0/developers/5619064695815356086/app/4974697871940096272/tracks/4699358353549547820).

## Current internal release

Version **1.0.0 (6)** was built on EAS and auto-submitted to the internal testing
track on October 31, 2026. The Google Play Developer API reports the internal track
release `1.0.0` with version code 6 as **completed** (rolled out to internal testers).

- [EAS build](https://expo.dev/accounts/badbird5907/projects/easel/builds/5560759d-1c61-4bc5-9d6c-f1fc5a125c8c)
  (`play-internal`, update channel `production`, runtime `1.0.0`) and
  [submission](https://expo.dev/accounts/badbird5907/projects/easel/submissions/c92cb7c0-7345-47cb-b0cc-c0a3d73e9b9d).
- First build with expo-updates: testers on version code 6 receive `production`
  OTA updates for runtime `1.0.0`.
- Also new in this build: the final app icons (adaptive, themed, and notification
  icons), a live-font-scale fix (`plugins/withAndroidConfigChanges.js`), and the
  October 31 QA fixes.

### Over-the-air updates for 1.0.0 (6)

| Date | Update group | Commit | Contents |
| --- | --- | --- | --- |
| 2026-10-31 | [`72213c1d`](https://expo.dev/accounts/badbird5907/projects/easel/updates/72213c1d-577c-409b-b049-a2f3a57a17be) | `4abe13f` | Cache-first screens and cold starts, faster retries with backoff, To Do swipe and optimistic submissions, instant Settings |
| 2026-10-31 | [`0347f975`](https://expo.dev/accounts/badbird5907/projects/easel/updates/0347f975-1ebe-4115-ab65-008b53ddcbe7) | `cb12bc4` | Demo mode under Settings → Developer; sign-in discovers Canvas credentials via mobile_verify |
| 2026-10-31 | [`917bcdff`](https://expo.dev/accounts/badbird5907/projects/easel/updates/917bcdff-86f0-42df-8078-f9a6695d5d74) | `b889b86` | Pull-to-refresh spinner starts below the title on Android |
| 2026-10-31 | [`f2149776`](https://expo.dev/accounts/badbird5907/projects/easel/updates/f2149776-1dc8-4e33-b91a-ef4f3c4785a7) | `13153bd` | Fix mobile sign-in redirect URI to match the official Android callback; matching authorization and token exchange |
| 2026-10-31 | [`67985750`](https://expo.dev/accounts/badbird5907/projects/easel/updates/67985750-0aaa-49fa-b730-553696f524c2) | `713e214` | Open Duo Mobile verification links directly from embedded sign-in while preserving the login session |
| 2026-10-31 | [`fa6f3fc2`](https://expo.dev/accounts/badbird5907/projects/easel/updates/fa6f3fc2-1139-4fe3-805f-2bfef0ce64e9) | `a9b82f5` | Enable automatic JavaScript window launches in sign-in so scripted Duo app handoffs can reach native navigation |

### Version 5

Version **1.0.0 (5)** was published on October 31, 2026, before OTA support. It
was built locally with EAS and uploaded manually through Play Console.

- Local bundle: `dist/easel-1.0.0-5-play-internal.aab`.
- SHA-256: `64ac1c262d0ad9aff29bd3d16cb75422369ba12201ae581e970f6cfad49de574`.
- The selected `Easel internal testers` list contains two users. Until app setup
  and review are complete, Play displays the temporary name
  `dev.evanyu.easel (unreviewed)`.

This replaces version 2, whose launch crash was reproduced on a Samsung Android
17 device. `createTranslator` constructed a missing `Intl.PluralRules` API.
The shared locale runtime now synchronously installs missing Intl APIs before
initialization, including the relative-time and list formatters used elsewhere.
Existing native number/date formatting is preserved. `expo-asset` is also now
declared directly, satisfying `expo-audio`'s native peer dependency.

Regression checks: `node --import tsx src/i18n/checks/hermes-startup.check.mjs`
and the same command with `--native`. The missing-API check reproduced the
constructor error before the fix. Locale/render checks, typecheck, zero-warning
lint, and all 20 Expo Doctor checks passed.

## Build for Google Play

```sh
pnpm run release:android
```

This runs `eas build --platform android --profile play-internal --auto-submit`:
an EAS cloud build that produces a signed Android App Bundle (`.aab`), then submits
it to the **internal testing** track through the `submit.play-internal` profile.
EAS manages the upload keystore and automatically increments the remote Android
version code. Google Play App Signing manages the key used for delivered apps.

Submission uses the Google service account
`easel-255@android-apps-513307.iam.gserviceaccount.com` (Google Cloud project
`android-apps-513307`), stored on EAS as the Play submission key. In Play Console it
has Easel permissions to release to testing tracks. Every Play build is submitted
this way; don't build for Play without `--auto-submit`.

To build on this Mac instead, export the SDK paths and submit the bundle afterwards
(local builds can't auto-submit):

```sh
export ANDROID_HOME="$HOME/Library/Android/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
GRADLE_OPTS='-Dorg.gradle.jvmargs=-Xmx8192m' pnpm dlx eas-cli@latest build --local \
  --platform android --profile play-internal --output dist/easel-play-internal.aab
pnpm dlx eas-cli@latest submit --platform android --profile play-internal \
  --path dist/easel-play-internal.aab
```

Do not use a debug-signed APK for a Play release.

The tester opt-in URL is
<https://play.google.com/apps/internaltest/4699358353549547820>. Installation is
available only after an active release exists and the user signs in with an
account included in the selected tester list.

## Direct APK previews

```sh
pnpm dlx eas-cli@latest build --platform android --profile preview
```

The `preview` profile produces an APK for installation through Expo's internal
distribution flow. It is separate from Google Play's internal testing track.

## Follow-up review

[Store policy review](./STORE_POLICY_REVIEW.md) records unresolved policy and
release-readiness findings. The owner explicitly chose to proceed with the first
limited internal test and address those findings later. This is not a full
compliance or public-release approval.

## Over-the-air updates

`expo-updates` is enabled starting with the next native build. The currently
installed Play internal version **1.0.0 (5) cannot receive OTA updates**: it does
not contain the native module. Build and manually upload a new `play-internal`
AAB using the command above first.

Build profiles select their update channel: `play-internal` → `production`,
`preview` → `preview`, and the simulator-only `qa-ota-test` → `qa-ota-test`.
Channels point to same-named EAS branches. The Play track does not select an OTA
channel: any build from `play-internal`, even if later promoted to another Play
track, continues receiving `production` updates with a matching platform and
runtime. Development clients use Metro/the development launcher; automatic
updates are disabled there.

### Ship JavaScript or asset changes

From a reviewed checkout with dependencies installed and validation passing:

```sh
pnpm exec tsc --noEmit
pnpm exec expo lint
pnpm dlx eas-cli@latest update --channel production --environment production --message "Describe the change"
```

For preview testing use `--channel preview --environment preview` instead.
SDK 58 requires the explicit environment flag. Keep build and update environment
variables aligned. Only publish reviewed changes: the command bundles the local
working tree. No production or preview updates were published during OTA setup.

The app checks on cold launch, downloads in the background, and applies a
downloaded update on the next cold launch. About shows the channel, runtime,
current update ID (or Built-in), pending status, and a manual check. It never
reloads a quiz, draft, or upload to apply an update. Close and reopen twice when
testing: once to download and once to run it.

### Local Release delivery checks

A local Expo build does not consume the channel from `eas.json`. For an iOS
simulator check, temporarily set `expo.updates.requestHeaders` in `app.json` to
`{ "expo-channel-name": "qa-ota-test" }`, then run:

```sh
pnpm exec expo prebuild --platform ios --no-install --no-clean
(cd ios && pod install)
pnpm exec expo run:ios --configuration Release --device <simulator-uuid> --no-bundler
pnpm dlx eas-cli@latest update --branch qa-ota-test --platform ios --environment preview --message "QA delivery check"
```

Record About → Updates before publishing, after download, and after another cold
launch. The running update ID must match the published iOS ID. A pending download
must leave the current session running. Restore the temporary header and run the
iOS prebuild again after testing. The already installed binary keeps its QA channel.

EAS Build injects the profile's channel into AndroidManifest.xml and Expo.plist
at build time, including when using `eas build --local`. `app.json` sets no
`android.versionCode`: with `cli.appVersionSource: remote`, EAS's remote counter and
`autoIncrement` control Play builds, and EAS warns about a local value. A local Gradle
build defaults to version code 1, so to install it over a newer QA build on the
emulator, set `android.versionCode` temporarily, prebuild with `--no-clean`, build,
then remove it again. The emulator QA build is version code 9.
See [standalone channel configuration](https://docs.expo.dev/eas-update/standalone-service/)
and [remote version sources](https://docs.expo.dev/build-reference/app-versions/).

### Verified delivery

On October 31, 2026, a local iOS Release build on iPhone 17 (iOS 26.5),
version 1.0.0 (1), received QA group `33fe68ca-7497-4d64-95ad-248af97521fd`
from `qa-ota-test`. About first showed Built-in, then a pending download while
remaining on Built-in, then running update
`01a1909e-8932-7a1e-a3ee-224cc7fed23f` after another cold launch. The manual
check returned “You’re up to date.” No automatic reload occurred during download.
This proves iOS Release delivery; Android's generated update URL/runtime and
EAS production profile were checked statically, not through a Play OTA install.

### Native compatibility

Expo’s deployment guide recommends the `appVersion` runtime policy. It uses
`expo.version` (currently `1.0.0`), independently of EAS’s remote Android version
code. This works with local EAS builds, CNG, and manually uploaded Play bundles.
Do not use `nativeVersion`: remote version codes and local update exports can
differ. Before changing native dependencies, SDKs, plugins, or native config,
bump `expo.version` and create a new store build. Never publish a native change
under an existing app version. OTA cannot install native code. JavaScript/asset-only changes
can update existing builds only when their platform and runtime match. Keep the
same dependency/config inputs used for the build; inspect the runtime in About
and the EAS update output before rollout. Generated `ios/` and `android/` remain
untracked. SDK 58 defaults to clearing native folders; preserve incremental builds with `pnpm exec expo prebuild --no-install --no-clean`.

### Roll back

```sh
pnpm dlx eas-cli@latest update:rollback
```

Select the production branch and affected runtime, then either a previously
working update or the embedded (built-in) bundle. To republish a known good group:

```sh
pnpm dlx eas-cli@latest update:republish --group <known-good-update-group-id> --destination-channel production
```

The known-good update must match the affected runtime. Rollbacks also take effect
on subsequent launches; they do not interrupt active work. Pausing a channel
stops new deliveries but does not undo an update already installed.

References: [SDK 58 Updates](https://docs.expo.dev/versions/v58.0.0/sdk/updates/),
[runtime versions](https://docs.expo.dev/eas-update/runtime-versions/),
[local build integration](https://docs.expo.dev/eas-update/standalone-service/),
[rollbacks](https://docs.expo.dev/eas-update/rollbacks/).
