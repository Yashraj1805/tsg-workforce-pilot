package com.tsg.workforce.pilot;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.location.Location;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.SystemClock;
import android.provider.Settings;
import android.view.Window;
import android.view.WindowManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Signals the web layer can't get on its own:
 *  - mockLocation (BRD R10 "fake GPS"): whether the phone's latest location fixes came from
 *    a mock-location app. Android marks such fixes (Location.isMock / isFromMockProvider).
 *    The server makes the decision; this only reports.
 *  - clock (BRD R19 offline punch): elapsedRealtime + boot count. Unlike the wall clock,
 *    elapsedRealtime can't be changed by the user, so the server can work out when an
 *    offline punch really happened (server receive time minus elapsed time since capture).
 *  - keep-awake / kiosk mode: the gate tablet runs the app unattended. setKeepAwake holds
 *    the screen on; setKioskMode persists a flag that BootReceiver reads so the app
 *    relaunches itself after a reboot or an app update.
 */
@CapacitorPlugin(name = "DeviceIntegrity")
public class DeviceIntegrityPlugin extends Plugin {

    private static final long RECENT_MS = 2 * 60 * 1000;

    /** SharedPreferences file + key shared with BootReceiver. */
    static final String PREFS = "tsg_prefs";
    static final String KEY_KIOSK = "kiosk_mode";

    /**
     * Keep the screen on (gate tablet) or let it time out again. Window flags must be
     * touched on the UI thread; plugin methods run on Capacitor's bridge thread.
     */
    @PluginMethod
    public void setKeepAwake(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        final Activity activity = getActivity();
        if (activity == null) { call.reject("No activity"); return; }
        activity.runOnUiThread(() -> {
            try {
                Window w = activity.getWindow();
                if (on) w.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else w.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("on", on);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        });
    }

    /**
     * Persist kiosk mode so BootReceiver relaunches the app after BOOT_COMPLETED /
     * MY_PACKAGE_REPLACED. Also reports whether "Display over other apps" is granted:
     * on Android 10+ a BroadcastReceiver may only start an activity from the background
     * when the app holds SYSTEM_ALERT_WINDOW (or is a device owner), so the kiosk
     * tablet needs that toggle switched on once (see requestOverlayPermission).
     */
    @PluginMethod
    public void setKioskMode(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        try {
            SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            prefs.edit().putBoolean(KEY_KIOSK, on).apply();
        } catch (Exception e) {
            call.reject(e.getMessage());
            return;
        }
        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("kiosk", on);
        ret.put("overlayPermission", canDrawOverlays());
        call.resolve(ret);
    }

    /**
     * Opens the system "Display over other apps" page for this app so the operator can
     * grant SYSTEM_ALERT_WINDOW (needed for auto-start after reboot on Android 10+).
     */
    @PluginMethod
    public void requestOverlayPermission(PluginCall call) {
        JSObject ret = new JSObject();
        boolean granted = canDrawOverlays();
        ret.put("granted", granted);
        if (granted || Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            ret.put("ok", true);
            call.resolve(ret);
            return;
        }
        try {
            Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            ret.put("ok", true);
            ret.put("opened", true);
        } catch (Exception e) {
            ret.put("ok", false);
            ret.put("error", e.getMessage());
        }
        call.resolve(ret);
    }

    private boolean canDrawOverlays() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        try { return Settings.canDrawOverlays(getContext()); } catch (Exception e) { return false; }
    }

    @PluginMethod
    public void mockLocation(PluginCall call) {
        JSObject ret = new JSObject();
        boolean mock = false;
        int checked = 0;
        try {
            LocationManager lm = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
            String[] providers = Build.VERSION.SDK_INT >= 31
                ? new String[] { LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER, LocationManager.FUSED_PROVIDER }
                : new String[] { LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER, "fused" };
            long nowElapsed = SystemClock.elapsedRealtimeNanos();
            for (String p : providers) {
                Location loc;
                try { loc = lm.getLastKnownLocation(p); } catch (SecurityException | IllegalArgumentException e) { continue; }
                if (loc == null) continue;
                long ageMs = (nowElapsed - loc.getElapsedRealtimeNanos()) / 1_000_000L;
                if (ageMs > RECENT_MS) continue;
                checked++;
                boolean isMock = Build.VERSION.SDK_INT >= 31 ? loc.isMock() : loc.isFromMockProvider();
                if (isMock) mock = true;
            }
        } catch (Exception e) {
            ret.put("error", e.getMessage());
        }
        ret.put("mock", mock);
        ret.put("fixesChecked", checked);
        // Developer option "Allow mock locations" (only readable this way before Android 6).
        try {
            String legacy = Settings.Secure.getString(getContext().getContentResolver(), "mock_location");
            ret.put("legacyMockSetting", "1".equals(legacy));
        } catch (Exception e) { ret.put("legacyMockSetting", false); }
        call.resolve(ret);
    }

    @PluginMethod
    public void clock(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("elapsedMs", SystemClock.elapsedRealtime());
        int bootCount = -1;
        try { bootCount = Settings.Global.getInt(getContext().getContentResolver(), Settings.Global.BOOT_COUNT); } catch (Exception e) { /* not available */ }
        ret.put("bootCount", bootCount);
        call.resolve(ret);
    }
}
