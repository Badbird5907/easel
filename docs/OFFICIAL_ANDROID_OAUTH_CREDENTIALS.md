# Official Canvas Android OAuth credentials

In the Canvas Android source checked out alongside Easel, the official app fetches its OAuth client ID and client secret from Instructure, then stores them locally. These are application credentials, separate from a student's access and refresh tokens.

## Where the credentials come from

`MobileVerifyAPI` calls:

```text
https://sso.canvaslms.com/api/v1/mobile_verify.json
```

The request includes the school domain and app user agent. The response model, `DomainVerificationResult`, includes `client_id` and `client_secret`. On successful verification, `BaseLoginSignInActivity` copies those values into `ApiPrefs` and starts the OAuth login flow.

For beta school domains, a remote configuration flag can switch the service to `https://canvas.beta.instructure.com/api/v1/`.

Source files, relative to this document:

- [MobileVerifyAPI.kt](../../canvas-android/libs/login-api-2/src/main/java/com/instructure/loginapi/login/api/MobileVerifyAPI.kt)
- [DomainVerificationResult.kt](../../canvas-android/libs/login-api-2/src/main/java/com/instructure/loginapi/login/model/DomainVerificationResult.kt)
- [BaseLoginSignInActivity.kt](../../canvas-android/libs/login-api-2/src/main/java/com/instructure/loginapi/login/activities/BaseLoginSignInActivity.kt)

## Where the app stores them

`ApiPrefs` stores the values under the keys `client_id` and `client_secret` in the SharedPreferences file named `canvas-kit-sp`.

Its `PrefManager` implementation uses Android's ordinary `getSharedPreferences(..., Context.MODE_PRIVATE)`, and `StringPref` writes the values with `putString`. This storage path uses app-private SharedPreferences, with no additional encryption implemented by this wrapper.

The account-switching model, `SignedInUser`, also contains client credentials. `PreviousUsersUtils` persists saved accounts as JSON in the app-private SharedPreferences file named `signedInUsersList`.

- [ApiPrefs.kt](../../canvas-android/libs/canvas-api-2/src/main/java/com/instructure/canvasapi2/utils/ApiPrefs.kt)
- [PrefUtils.kt](../../canvas-android/libs/canvas-api-2/src/main/java/com/instructure/canvasapi2/utils/PrefUtils.kt)
- [SignedInUser.kt](../../canvas-android/libs/login-api-2/src/main/java/com/instructure/loginapi/login/model/SignedInUser.kt)
- [PreviousUsersUtils.kt](../../canvas-android/libs/login-api-2/src/main/java/com/instructure/loginapi/login/util/PreviousUsersUtils.kt)

## What this means for Easel

Easel now uses this discovery service when it has no stored, manually supplied, or registered developer key. It sends `candroid Easel/1.0` as both the `user_agent` query value and HTTP User-Agent: `candroid` is the official Android service selector; `Easel/1.0` identifies this client explicitly. Easel is not an official Instructure app.

The returned credentials use embedded OAuth with `https://sso.canvaslms.com/canvas/login`, because the official key does not register Easel's custom callback. Easel intercepts the exact registered `https://sso.canvaslms.com/canvas/login?code=…&state=…` callback before navigation and exchanges the code with PKCE. The service's canonical HTTPS school address is honored. Credentials and the mobile-flow marker are kept in SecureStore with the account, not Android SharedPreferences.

Manual developer-key and access-token sign-in remain available. Existing keys take precedence over discovery. Network failures and service rejections are shown without exposing response bodies or secrets.

On October 31, 2026, a credential-discovery-only request for `canvas.instructure.com` using `candroid Easel/1.0` returned HTTP 200, result 0, authorized true, and nonempty client credentials. An `Easel/1.0` request without the compatibility selector returned result 3 (unknown user agent). No live credentials were printed or saved during this check. The production discovery parser also passed this live check. The initial implementation used the legacy OOB redirect, but a user encountered “redirect uri does not match client settings.” The implementation now matches the registered HTTPS callback used by the official Android flow for both authorization and code exchange. The earlier anonymous OOB probe returned HTTP 503 and did not establish callback compatibility. This does not verify a complete student login, MFA, identity-provider compatibility, token refresh, or acceptance at other schools.

The service is private and may change or reject this client. An Easel global developer key remains an alternative, requiring school enablement.

- [Easel developer-key registry](../src/features/auth/keys.ts)
- [Easel sign-in flow](../src/features/auth/SignInFlow.tsx)
- [Canvas developer-key documentation](https://k12.instructure.com/doc/api/file.developer_keys.html)
- [Instructure's developer-key administration guide](https://community.instructure.com/en/kb/articles/661518-how-do-i-manage-developer-keys-for-an-account)

This describes the local source checkout inspected on October 31, 2026, rather than a verification of a particular installed Android release.

## QR sign-in

Easel follows `QRLogin.kt` in the Android reference: read `domain` and `code_android` from an HTTPS link on `sso.canvaslms.com` (or its official beta/test hosts), discover the mobile credentials, and exchange the code at the canonical school's token endpoint. Both Easel platforms use the Android Student code because discovery selects the Android Student client. Teacher, parent, and iOS-only codes are not accepted.

This grant was already issued by Canvas, so the exchange follows Android `OAuthAPI.getToken`: `redirect_uri=urn:ietf:wg:oauth:2.0:oob`, without inventing a PKCE verifier. This differs from starting a new browser authorization, which uses the registered HTTPS callback described above. QR contents stay in memory; the resulting account uses the existing SecureStore, terms, refresh, and identity checks.

The sign-in screen offers camera scanning and a paste-link alternative. In Canvas on another device, choose Account → QR for Mobile Login. Generate a new code if it expires or has already been used. Some schools disable this option. Synthetic protocol and lifetime tests cover the flow; a real Canvas-generated code is still required to verify end-to-end sign-in.

## Duo Mobile on Android

On October 31, 2026, physical-device testing reproduced a stalled “Open Duo Mobile” screen. Duo's current [prompt JavaScript](https://api-832cdf07.duosecurity.com/frame/static/v4/App.js), `TrustedEndpointsCollectionPrompt`, explicitly calls `copyAndroidLinkToClipboard(androidLink)` for Android WebViews instead of navigating. Its `copyAndroidLinkToClipboard` function only calls `navigator.clipboard.writeText`; it does not launch the app. This explains why intercepting navigation and allowing automatic windows did not fix that flow. Duo also documents its clipboard use in [Duo Mobile Privacy Information](https://help.duo.com/s/article/4683?language=en_US).

Easel bridges that specific clipboard write to native `Linking.openURL`. The bridge runs only on Android, in the main frame of HTTPS `api-xxxxxxxx.duosecurity.com` prompts. Both the page script and native receiver validate the Duo link; the native receiver also checks the source page and active sign-in lifetime. Other clipboard writes retain their normal behavior. The handoff URL remains in memory and is neither copied nor logged by Easel. Injection runs before content and after load, idempotently, because Android's early injection is best effort.

`auth-embedded.check.cjs` reproduces the clipboard-only path through the shipped script and native handler, including origin rejection, ordinary copies, duplicate installation, and retired sign-ins. Physical-device verification remains necessary after OTA delivery.
