package io.shengji.recorder;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeRecorderPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
