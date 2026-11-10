package kz.soundworld.ar;

import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

/**
 * Safe Android edge-to-edge layout.
 *
 * Do not evaluate JavaScript from WindowInsets callbacks. Insets can arrive
 * during Activity creation, before the Capacitor WebView/JS context is ready.
 * Instead, pad the native content container so the web app always lives
 * between the system status/navigation bars and the on-screen keyboard.
 *
 * The framework receives a copy of the insets with already handled types
 * zeroed, preventing the WebView from adding a second layer of padding.
 */
public class MainActivity extends BridgeActivity {
  @Override public void onCreate(Bundle savedInstanceState) {
    registerPlugin(SoundWorldSensorsPlugin.class);
    registerPlugin(SoundWorldPlaybackPlugin.class);
    registerPlugin(SoundWorldMusicLibraryPlugin.class);

    // Android 15+ enforces edge-to-edge. Some cutout/splash configurations
    // throw on a real phone before the WebView exists (Pixel 4 emulator has
    // no display cutout). Set ALWAYS before Capacitor creates its splash.
    // This changes no app feature or visual theme.
    WindowManager.LayoutParams params = getWindow().getAttributes();
    params.layoutInDisplayCutoutMode =
        WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS;
    getWindow().setAttributes(params);

    super.onCreate(savedInstanceState);
    WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

    final View contentRoot = findViewById(android.R.id.content);
    if (contentRoot == null) return;

    final int systemTypes = WindowInsetsCompat.Type.systemBars()
        | WindowInsetsCompat.Type.displayCutout();
    final int keyboardType = WindowInsetsCompat.Type.ime();

    ViewCompat.setOnApplyWindowInsetsListener(contentRoot, (view, insets) -> {
      Insets bars = insets.getInsets(systemTypes);
      Insets keyboard = insets.getInsets(keyboardType);

      // Absolute values, not incremental padding: repeated dispatch is safe.
      view.setPadding(
          bars.left,
          bars.top,
          bars.right,
          Math.max(bars.bottom, keyboard.bottom));

      // Pass through all other insets. Do not prevent keyboard updates.
      return new WindowInsetsCompat.Builder(insets)
          .setInsets(systemTypes, Insets.NONE)
          .setInsets(keyboardType, Insets.NONE)
          .build();
    });
    ViewCompat.requestApplyInsets(contentRoot);
  }
}
