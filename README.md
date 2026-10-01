# TSG Workforce — Android app

An Android app implementing the flows in `Developer_Handoff_Spec` /
`TSG_Contract_Manpower_Attendance_BRD.pdf`, now talking to a real backend
(`../tsg-workforce-backend`) instead of local-only mock data.

**Install:** copy `TSG-Workforce-Pilot.apk` to an Android phone and open it (allow
"install unknown apps" for the file source). Grant camera and location permission
when prompted.

**Before first use, start the backend** (see `../tsg-workforce-backend/README.md`)
and, on first launch, enter its address under "Server settings" — the phone needs a
network path to wherever it's running (see below).

## What the app does (BRD v1.0 screens + design rules)

Worker (Hindi first, English below; every screen read aloud — voice can be switched off in Menu):
- Login with mobile + OTP (resend after 30 s; server locks 15 min after 3 wrong OTPs).
- Registration in 8 one-task screens (BRD §10): consent (versioned, read aloud) → live
  photo (server checks one live face) → **Aadhaar QR scan** (fills name, DOB, gender,
  father's name, address) → **PAN photo** (number read automatically) + Aadhaar OTP via
  DigiLocker → job tiles → vendor tiles + **site found by GPS** → education/experience
  tiles → review & submit.
- Punch in/out: inside/outside site shown automatically, hands-free face capture, fake-GPS
  signal sent, full-screen green tick / red cross read aloud, hours worked on punch-out.
- **No network**: inside the site the punch is saved on the phone and sent within 12 h
  with its real time (Android's tamper-proof clock).
- **My days** calendar (green / red / yellow / grey); missed punch → call Site HR.

Admin portal (each role sees only its screens — see backend README "Roles and access"):
dashboard with brand/vendor filters, approvals (face-check result, reporting manager),
workers directory, worker detail (day-wise history with selfie + map, transfer / exit /
blacklist / phone change, change requests), attendance, missed punches, exceptions,
Time Guard, vendor bill check + month lock, Excel reports, automatic emails, gate check
(Security), gate tablets, masters (vendors with contract dates, sites with weekly off,
jobs), users, audit log, database backups. Site HR can register a worker on their own
phone with the worker's OTP and face.

**Gate tablet (kiosk) mode** — splash → "Gate tablet (kiosk)" → pairing code from HR.
Workers without phones type the last 4 digits of their mobile, tap their photo and
look at the camera.

Native pieces (`src/native.js` + `android/.../DeviceIntegrityPlugin.java`): camera,
ML Kit QR scanner, rear-camera document photos, live face preview, GPS, mock-location
flag, tamper-proof clock, Android text-to-speech.

Needs outside setup before go-live: see the backend README (Setu, UIDAI certificate,
SMS, SMTP, WATI, hosting, legal sign-off of the consent text). Until then OTPs show
on screen in dev mode and KYC can be skipped with the dev-only button.

## Connecting the app to the backend

The backend runs on your dev machine; the phone needs to reach it over the network:

1. Start the backend (`cd ../tsg-workforce-backend && npm start`) — it listens on
   port 4000.
2. Make sure the phone and the machine running the backend are on the **same Wi-Fi**
   (corporate/guest Wi-Fi with client isolation will block this — use a phone hotspot
   or home Wi-Fi if that happens).
3. Find the machine's local IP (Windows: `ipconfig`, look for the Wi-Fi adapter's
   IPv4 address — e.g. `172.16.75.205`).
4. On first app launch, it opens "Server settings" automatically. Enter
   `http://<that-ip>:4000`, tap "Test connection," then "Save."

This address is stored on the phone (not rebuilt into the APK), so it survives
reinstalls and can be changed any time from HR → Account → "Server settings," or by
clearing app data to see the setup screen again.

## Demo walkthrough

- First launch → server settings (see above) → role picker: worker or HR.
- Worker: enter any 10-digit mobile number → OTP screen shows the code directly
  (dev mode, no real SMS yet) → registration wizard (personal details → vendor/site/
  photo → Aadhaar via DigiLocker + PAN) → submit → HR approval → punch in/out.
- HR / admin portal: enter a company email + name → OTP shown directly (dev mode),
  with a role picker for a first-time email → the screens that role is allowed
  (BRD §5): e.g. Central HR gets dashboard, approvals, attendance register, AI Time
  Guard, regularisations; System Admin gets vendor/location masters (with the map
  picker), users and audit log; Security gets blocked punches and audit log. The
  backend enforces all of this — see "Roles and access" in its README; the app only
  hides what the role can't use.
- Aadhaar/PAN verification will fail with a clear "Setu credentials not configured"
  error until real sandbox credentials are added to the backend's `.env` — that's
  expected right now, not a bug.

## Project layout

- `www/` — the app (plain HTML/CSS/JS, no framework):
  - `api.js` — talks to the backend (fetch wrapper, session/token storage, one
    function per endpoint).
  - `calc.js` — pure helpers (geofence distance, attendance-status-for-a-day) shared
    between screens.
  - `i18n.js` — EN/HI strings.
  - `app.js` — screens/router, now built around async data fetching with loading and
    error states.
- `src/native.js` — bundled separately: wraps `@capacitor/camera` and
  `@capacitor/geolocation` into `window.TSGNative`.
- `android/` — generated Capacitor Android project. `AndroidManifest.xml` has
  `usesCleartextTraffic="true"` for now, since the dev backend runs plain HTTP on a
  LAN IP — tighten this before any real deployment (see the comment in the manifest).

## Rebuilding the APK

Requires Node.js, JDK 17 and an Android SDK (platform 34, build-tools 34). Point
`android/local.properties` at the SDK with forward slashes, e.g.
`sdk.dir=C:/Users/<you>/android-sdk`, and set `JAVA_HOME` to the JDK.

```
npm install
npm run apk
```

This bundles `src/native.js`, copies `www/` into the Android project
(`npx cap sync android`), and runs a debug Gradle build. The output APK is at
`android/app/build/outputs/apk/debug/app-debug.apk`.

To test on a phone over USB when phone and PC aren't on the same Wi-Fi:
`adb reverse tcp:4000 tcp:4000`, then use `http://localhost:4000` as the server.

## What a production build still needs on top of this

1. Real Setu credentials, then live sandbox testing of the DigiLocker/PAN flows.
2. SMS gateway + SMTP + WATI accounts (backend `.env`) — OTPs and emails are only
   logged until then.
3. A certified face-match/liveness API if Gemini's judgement isn't accepted for go-live.
4. HTTPS between app and backend, then remove `usesCleartextTraffic` from the manifest.
5. A release-signed APK (this builds a debug APK).
6. Legal sign-off of the consent text; hosting in India; HRMS / Zoho Books links if wanted.
7. The BRD's open points (build vs. buy, split shifts / more than 2 punches, half-day
   rule per location, KYC budget owner).
