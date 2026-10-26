# Parkez: Project Status

_Last updated: 2026-10-18_

## Current phase
Phase 2: prototype foundations. Test runner ready. Next: session state machine with tests.

## Completed
- [x] Research: EasyPark, Skopje SMS parking, Play Store SMS policy
- [x] GitHub repository created and cloned
- [x] Git installed (2.37.3, old but working; update is optional)
- [x] Node.js upgraded to v24.22.0 (was v18.15.0, too old); npm 11.19.1 verified
- [x] VS Code installed
- [x] Android Studio installed; ANDROID_HOME and adb verified (platform-tools 37.0.1)
- [x] First commit pushed (README.md and PROJECT_STATUS.md)
- [x] Empty Expo app (in `/mobile`) running on real phone via Expo Go
- [x] Project reset to blank Expo Router app (src/app); demo code removed
- [x] Jest (jest-expo) installed; sanity test and tsc type check pass
- [x] Domain: operator profile types and SMS message builder (operators.ts) with tests
- [x] Domain: session state machine (session.ts) with tests: sms_sent never paid, no skipped states, time from confirmed end, duplicate guard
- [x] SmsSender interface, MockSmsSender, ReplyParser interface (stub parser), SessionService (in-memory) with tests: ambiguous send failures treated as possibly sent, double-tap protection, stop flow

## Decisions
- Project name: Parkez.
- Platform: Android first, iOS later.
- Stack: Expo (React Native) with TypeScript (recommended, not final).
- Payment (for now): SMS only. Card payment (like Parking.MK) is parked for later.
- SMS design: swappable `SmsSender` with mock, compose-screen and direct-send versions.
- A "sent" SMS is never treated as a paid or confirmed session.
- SMS Plan A (preferred): direct background sending via SEND_SMS, subject to Google Play approval. Plan B: compose-screen fallback. Not planned: split sender/receiver apps, server-side SMS gateways (operator requires the user's own Macedonian number).
- Reddit thread evidence (unofficial): one app approved under a different exception, one (MIT App Inventor Companion) rejected. Approval is not guaranteed.

## Environment notes
- Windows PowerShell blocked npm.ps1 ("running scripts is disabled"). Fixed with:
  `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`
- Android emulator (Pixel) was too slow on this PC. Primary testing will be on a real Android phone.

## Known unknowns (to verify)
- Whether Google Play will approve direct SEND_SMS for our app.
- Whether Skopje's SMS format and prices on City Parking's page are current.
- Which operators and cities beyond Skopje use SMS parking.
- Whether Expo's current SDK works cleanly with Node 24 (check when creating the app).
- Competitor SMS Parking uses the SMS permission (not Accessibility), but how it got Play approval is unknown.
- npm audit (--omit=dev) reports 5 high issues (node-forge, zod) inside Expo CLI tooling. Not forced-fixed (the suggested fix downgrades Expo to 44). Accepted for now; re-check before release.
- npm blocked install scripts for `unrs-resolver` and `@parcel/watcher` (allowScripts warning). Not approved; revisit only if tooling breaks.
- Skopje has two operators with different models: Градски паркинг (144 144, zone+plate, stop with "S", per-zone max) and ПОЦ (14 14 14, zone+plate+hours, extendable). Source data is partly 2017 and conflicting; verify numbers, formats, prices and limits before coding as constants. Zones will be editable data with a last-verified date.
- Confirmation SMS reply texts are unknown (needed for parsing).
- Macedonian SIM required; check SIM before sending.
- CONFIRMATION_TIMEOUT_MS = 3 min is an assumption; tune after real tests.
- Reply parser is a stub: real confirmation reply formats are unknown. Replies are matched to sessions by id for now; real matching (operator number, plate) needs real reply texts.

## Next steps
1. First screen on phone with the mock sender. 
2. Android SMS spike.