package kz.soundworld.ar;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/** Generated Capacitor Android host registers the native SoundWorld plugin. */
public class MainActivity extends BridgeActivity {
  @Override public void onCreate(Bundle savedInstanceState) {
    registerPlugin(SoundWorldSensorsPlugin.class);
    registerPlugin(SoundWorldPlaybackPlugin.class);
    super.onCreate(savedInstanceState);
  }
}
