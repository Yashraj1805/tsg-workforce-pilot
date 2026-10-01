package com.tsg.workforce.pilot;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App-local plugin (fake-GPS flag + tamper-proof clock); npm plugins register themselves.
        registerPlugin(DeviceIntegrityPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
