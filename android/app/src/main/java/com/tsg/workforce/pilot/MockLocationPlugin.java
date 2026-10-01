package com.tsg.workforce.pilot;

import android.content.Context;
import android.location.Location;
import android.location.LocationManager;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// R10 / BRD control "Punch from outside the site": "Fake GPS apps blocked". The
// @capacitor/geolocation plugin (used for the actual lat/lng) doesn't surface Android's
// own mock-location flag, so this is a small dedicated plugin just for that one signal —
// it does not fetch or replace the location used for the punch itself, only answers
// "was the most recent fix from any provider flagged by the OS as mock/injected".
@CapacitorPlugin(name = "MockLocation")
public class MockLocationPlugin extends Plugin {

    @PluginMethod
    public void checkMockLocation(PluginCall call) {
        LocationManager lm = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        boolean isMock = false;
        try {
            if (lm != null) {
                for (String provider : lm.getProviders(true)) {
                    Location loc = lm.getLastKnownLocation(provider);
                    if (loc != null && isFromMockProvider(loc)) {
                        isMock = true;
                        break;
                    }
                }
            }
        } catch (SecurityException e) {
            // No location permission yet — the Geolocation plugin's own permission flow
            // owns that prompt; just report "not mock" rather than failing the punch here.
        }
        JSObject ret = new JSObject();
        ret.put("isMock", isMock);
        call.resolve(ret);
    }

    @SuppressWarnings("deprecation")
    private boolean isFromMockProvider(Location loc) {
        // isFromMockProvider() was superseded by isMock() in API 31, but is still present
        // (just deprecated) below that — minSdk here is 22, so both paths are needed.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return loc.isMock();
        }
        return loc.isFromMockProvider();
    }
}
