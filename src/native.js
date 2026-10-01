import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Geolocation } from '@capacitor/geolocation';
import { CameraPreview } from '@capacitor-community/camera-preview';
import { App } from '@capacitor/app';
import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { registerPlugin } from '@capacitor/core';

// Small custom native plugin (android/app/.../MockLocationPlugin.java) — see its header
// comment for why @capacitor/geolocation can't answer this on its own (R10).
const MockLocation = registerPlugin('MockLocation');

// Exposes a small, promise-based bridge the plain app.js script can call.
// Falls back gracefully if running in a plain desktop browser during development.

async function takeSelfie() {
  try {
    const photo = await Camera.getPhoto({
      quality: 70,
      allowEditing: false,
      resultType: CameraResultType.DataUrl,
      source: CameraSource.Camera, // forces live camera, never the gallery (FR-K05)
      direction: 'FRONT',
      saveToGallery: false,
    });
    return { ok: true, dataUrl: photo.dataUrl };
  } catch (err) {
    return { ok: false, error: (err && err.message) || 'Camera unavailable or permission denied' };
  }
}

// ---- Live camera preview, for hands-free punch selfies. The native preview renders
// BEHIND the WebView (toBack: true); app.js makes the page background transparent
// over the preview area so it shows through, with an HTML circle guide on top. ----

async function startFacePreview() {
  try {
    await CameraPreview.start({
      position: 'front',
      toBack: true,
      width: Math.round(window.innerWidth),
      height: Math.round(window.innerHeight),
      x: 0,
      y: 0,
      enableOpacity: false,
      disableAudio: true,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err && err.message) || 'Could not start camera preview' };
  }
}

async function stopFacePreview() {
  try { await CameraPreview.stop(); } catch (err) { /* already stopped, ignore */ }
}

// This plugin's capture()/captureSample() return the raw sensor frame without the
// orientation correction Capacitor's own Camera plugin applies, so these frames often
// come back rotated. Tried correcting it with a client-side canvas rotation first, but
// the exact rotation needed didn't come out consistent across capture calls on-device
// (guessing the transform blind cost two build cycles without landing on upright).
// Gemini's vision judgement turned out to be reliably tolerant of a rotated/upside-down
// frame when explicitly told to expect one (see compareFaces'/detectFace's prompts in
// geminiClient.js) — that's a more robust fix than fighting device-specific rotation
// behavior blind, so the frame is sent through as-is.

// captureSample() has no width/height option (unlike capture()), so it comes back at
// roughly the full preview resolution — needlessly large and slow to upload+process for
// a "is a face visible" poll that runs every second or two. Downscaled client-side
// before it ever leaves the phone; this is the single biggest lever on scan speed since
// it shrinks both the network upload and Gemini's own processing time.
function downscaleDataUrl(dataUrl, maxDim, quality) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl); // fall back to the full-size frame rather than fail the poll
    img.src = dataUrl;
  });
}

async function grabPreviewSample() {
  try {
    const result = await CameraPreview.captureSample({ quality: 50 });
    const dataUrl = await downscaleDataUrl('data:image/jpeg;base64,' + result.value, 360, 0.6);
    return { ok: true, dataUrl };
  } catch (err) {
    return { ok: false, error: (err && err.message) || 'Could not sample preview frame' };
  }
}

// Full-quality frame once a face has been detected, used as the actual punch selfie.
async function capturePreviewPhoto() {
  try {
    const result = await CameraPreview.capture({ quality: 80 });
    return { ok: true, dataUrl: 'data:image/jpeg;base64,' + result.value };
  } catch (err) {
    return { ok: false, error: (err && err.message) || 'Could not capture photo' };
  }
}

async function getPosition() {
  try {
    const perm = await Geolocation.requestPermissions().catch(() => null);
    const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000 });
    // Best-effort — if this native check itself fails for any reason, don't fail the
    // whole punch over it; the server treats a missing flag the same as "not mock".
    const mock = await MockLocation.checkMockLocation().catch(() => ({ isMock: false }));
    return {
      ok: true,
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
      isMockLocation: !!mock.isMock,
    };
  } catch (err) {
    return { ok: false, error: (err && err.message) || 'Location unavailable or permission denied' };
  }
}

// ---- Hardware/gesture back button. Capacitor's default behaviour, with nothing
// listening, is to just close the app whenever there's no browser history entry to
// pop — and several of our screens (login sub-steps, registration wizard steps)
// render by directly swapping content rather than changing location.hash, so there's
// often no history entry at all. app.js registers one handler here that owns all
// back-button decisions instead. ----
function onBackButton(handler) {
  App.addListener('backButton', () => handler());
}
async function minimizeApp() {
  try { await App.minimizeApp(); } catch (err) { /* web/dev fallback: no-op */ }
}

// ---- Voice (R11 / design rule 2: "a voice reads every screen"). Goes through the
// device's own TTS engine rather than the WebView's speechSynthesis — a lot of real
// Android devices either lack a Hindi voice there or don't implement it at all, while
// the OS-level engine (used here) is what Hindi language packs actually install into. ----
async function speak(text, lang) {
  try { await TextToSpeech.speak({ text, lang: lang || 'en-IN', rate: 0.95, category: 'ambient' }); } catch (err) { /* no-op: voice is a convenience, never block on it */ }
}
async function stopSpeaking() {
  try { await TextToSpeech.stop(); } catch (err) { /* already stopped */ }
}

window.TSGNative = { takeSelfie, getPosition, startFacePreview, stopFacePreview, grabPreviewSample, capturePreviewPhoto, onBackButton, minimizeApp, speak, stopSpeaking };
