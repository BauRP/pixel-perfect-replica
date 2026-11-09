package kz.soundworld.ar;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

/**
 * The Android WebView is edge-to-edge, but the React shell is inset between
 * the real status/navigation bars. Insets are measured by Android, not guessed
 * from CSS env(safe-area-inset-*), which may be zero in a Capacitor WebView.
 *
 * Updates also account for the software keyboard on settings/search screens.
 */
public class MainActivity extends BridgeActivity {
  @Override public void onCreate(Bundle savedInstanceState) {
    registerPlugin(SoundWorldSensorsPlugin.class);
    registerPlugin(SoundWorldPlaybackPlugin.class);
    registerPlugin(SoundWorldMusicLibraryPlugin.class);
    WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
    super.onCreate(savedInstanceState);

    final WebView web = getBridge().getWebView();
    final WindowInsetsControllerCompat controller =
        WindowCompat.getInsetsController(getWindow(), web);
    controller.setAppearanceLightStatusBars(false);
    controller.setAppearanceLightNavigationBars(false);

    ViewCompat.setOnApplyWindowInsetsListener(web, (view, windowInsets) -> {
      Insets bars = windowInsets.getInsets(
          WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
      Insets keyboard = windowInsets.getInsets(WindowInsetsCompat.Type.ime());
      int left = bars.left;
      int right = bars.right;
      int top = bars.top;
      int bottom = Math.max(bars.bottom, keyboard.bottom);

      // Only integers from Android WindowInsets are interpolated; no app data.
      String css = "(function(){var s=document.documentElement.style;"
          + "s.setProperty('--sw-native-inset-top','" + top + "px');"
          + "s.setProperty('--sw-native-inset-bottom','" + bottom + "px');"
          + "s.setProperty('--sw-native-inset-left','" + left + "px');"
          + "s.setProperty('--sw-native-inset-right','" + right + "px');"
          + "})()";
      web.evaluateJavascript(css, null);
      return windowInsets;
    });
    ViewCompat.requestApplyInsets(web);
  }
}
