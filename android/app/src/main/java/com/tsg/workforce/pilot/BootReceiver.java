package com.tsg.workforce.pilot;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Log;

/**
 * Relaunches the app after a reboot (or an app update) when the gate tablet is in
 * kiosk mode. The flag is written by DeviceIntegrityPlugin.setKioskMode; phones that
 * never enabled kiosk mode are left alone.
 *
 * Android 10+ blocks activity starts from a background receiver unless the app holds
 * SYSTEM_ALERT_WINDOW ("Display over other apps") or is a device owner. The kiosk
 * tablet needs that toggle granted once; DeviceIntegrityPlugin.requestOverlayPermission
 * opens the right settings page.
 */
public class BootReceiver extends BroadcastReceiver {

    private static final String TAG = "TSGBootReceiver";
    private static final String ACTION_QUICKBOOT = "android.intent.action.QUICKBOOT_POWERON";
    private static final String ACTION_HTC_QUICKBOOT = "com.htc.intent.action.QUICKBOOT_POWERON";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (action == null) return;
        boolean relevant = Intent.ACTION_BOOT_COMPLETED.equals(action)
            || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
            || ACTION_QUICKBOOT.equals(action)
            || ACTION_HTC_QUICKBOOT.equals(action);
        if (!relevant) return;

        SharedPreferences prefs = context.getSharedPreferences(DeviceIntegrityPlugin.PREFS, Context.MODE_PRIVATE);
        if (!prefs.getBoolean(DeviceIntegrityPlugin.KEY_KIOSK, false)) {
            Log.i(TAG, action + " received; kiosk mode off, not launching");
            return;
        }

        try {
            Intent launch = new Intent(context, MainActivity.class);
            launch.setAction(Intent.ACTION_MAIN);
            launch.addCategory(Intent.CATEGORY_LAUNCHER);
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            context.startActivity(launch);
            Log.i(TAG, action + " received; kiosk mode on, launched MainActivity");
        } catch (Exception e) {
            Log.w(TAG, "Could not launch MainActivity after " + action, e);
        }
    }
}
