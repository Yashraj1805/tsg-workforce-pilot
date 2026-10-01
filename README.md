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

## What's real vs. still simulated

Real:
- Live camera capture for the profile photo and every punch selfie (gallery upload
  blocked, per FR-K05).
- Real GPS, checked **server-side** against the worker's assigned location (the app
  can no longer fake this by editing local data — the backend recomputes distance
  itself).
- Full worker lifecycle over the network: self-registration → HR approval → gated
  punch-in/out → attendance register; HR approvals, regularisation (maker ≠ checker
  enforced server-side), exceptions log, vendor/location masters, audit log, AI Time
  Guard pattern alerts.
- Worker and HR devices now see the **same shared data** — this was the pilot's
  biggest earlier gap.
- Real OTP login flow (generate → verify → JWT) — see "What's not wired up" for what's
  missing from it.
- Real Setu (Pinelabs) Aadhaar (DigiLocker) + PAN verification calls, built against
  Setu's actual current API contract — see the backend README for exactly what's
  tested vs. what still needs real credentials.

Still simulated / not wired up:
- **OTP delivery** — the backend generates and verifies real OTPs but doesn't send
  them anywhere yet (no SMS/email provider sourced). In dev mode the OTP is shown
  directly on the "enter OTP" screen so the flow is testable end-to-end.
- **Face-match/liveness on punch selfies** — still nobody's confirmed a vendor for
  this. The selfie is captured and stored but not verified against anything.
- **Setu credentials** — the KYC screens call the real Setu sandbox endpoints, but
  until `SETU_CLIENT_ID`/`SECRET`/`PRODUCT_INSTANCE_ID` are set in the backend's
  `.env`, they'll return a clear "not configured" error instead of succeeding.
- Mock-GPS/rooted-device detection, HRMS/Zoho/WATI integration, report exports,
  India hosting/backups, legal sign-off on the DPDP consent flow.

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
- HR: enter a company email + name → OTP shown directly (dev mode) → dashboard,
  approvals, attendance register, AI Time Guard, vendor/location masters (with the
  map picker), regularisations, audit log.
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

Requires Node.js, JDK 17, and an Android SDK (this machine already has
`C:\Users\Galaxy\Android` with platform 34 / build-tools 34.0.0 / Gradle 8.7).

```
npm install
npm run apk
```

This bundles `src/native.js`, copies `www/` into the Android project
(`npx cap sync android`), and runs a debug Gradle build. The output APK is at
`android/app/build/outputs/apk/debug/app-debug.apk`.

## What a production build still needs on top of this

Straight from the BRD's own scope and open questions, now scoped against real code:
1. A face-match/liveness vendor — still completely unsourced, and the single biggest
   gap versus the BRD's core anti-fraud requirement (BR-02).
2. Real Setu credentials, then live sandbox testing of the DigiLocker/PAN flows.
3. An SMS gateway (worker OTP) and email provider (HR OTP) — currently OTPs work but
   aren't delivered anywhere.
4. Mock-GPS/rooted-device detection — needs native Android checks, not doable in a
   plain web view.
5. HRMS, Zoho Books and WATI integrations, MIS report exports (Excel/PDF), data
   hosted in India with backups, DPDP Act consent/notice text signed off by legal,
   and Aadhaar Data Vault-compliant storage (the backend currently stores only the
   masked number from Setu, which is the right shape, but hasn't been reviewed by
   legal).
6. HTTPS between the app and backend, and restricting `usesCleartextTraffic` — fine
   for a LAN dev setup, not for anything real.
7. The open questions the BRD lists on its last page (build vs. buy, half-day
   threshold, vendor coordinator access, KYC budget owner) still need answers.
