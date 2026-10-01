package com.tsg.workforce.pilot;

import android.content.Context;
import android.location.Location;
import android.location.LocationManager;
import android.os.Build;
import android.os.SystemClock;
import android.provider.Settings;

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
 */
@CapacitorPlugin(name = "DeviceIntegrity")
public class DeviceIntegrityPlugin extends Plugin {

    private static final long RECENT_MS = 2 * 60 * 1000;

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
