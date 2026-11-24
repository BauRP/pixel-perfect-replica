package kz.soundworld.ar;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.webkit.WebView;
import java.lang.ref.WeakReference;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Local evidence of Android MAIN vs WebView/Capacitor stalls. Unlike a system
 * logcat this only records the app's own responsiveness and a bounded Java
 * main-thread stack. It does not touch audio, sensors or the music player.
 * All persistence happens on one daemon watchdog, never Android MAIN.
 */
public final class SoundWorldFreezeMonitor {
  public static final String PREFS = "soundworld_freeze_report_v1";
  public static final String REPORT = "lastReport";
  public static final String AT = "recordedAt";
  public static final String ISSUE = "lastJsIssue";
  public static final String ISSUE_AT = "lastJsIssueAt";
  private static final long MAIN_STALL_MS = 6500L;
  private static final long WEBVIEW_STALL_MS = 12000L;
  private static final Handler MAIN = new Handler(Looper.getMainLooper());
  private static final AtomicLong mainHeartbeat = new AtomicLong();
  private static final AtomicLong jsHeartbeat = new AtomicLong();
  private static final AtomicLong rendererReplied = new AtomicLong();
  private static final AtomicLong lastProbe = new AtomicLong();
  private static final AtomicBoolean mainPending = new AtomicBoolean();
  private static final AtomicBoolean probePending = new AtomicBoolean();
  private static final AtomicBoolean recordedMain = new AtomicBoolean();
  private static final AtomicBoolean recordedWeb = new AtomicBoolean();
  private static volatile boolean foreground = false;
  private static volatile String lastScreen = "startup";
  private static volatile WeakReference<WebView> webViewRef = new WeakReference<>(null);
  private static volatile Context app;
  private static ScheduledExecutorService watchdog;
  private SoundWorldFreezeMonitor() {}

  public static synchronized void start(Context context, WebView webView) {
    stop();
    app = context.getApplicationContext();
    webViewRef = new WeakReference<>(webView);
    lastScreen = "startup";
    setForeground(true);
    watchdog = Executors.newSingleThreadScheduledExecutor(r -> {
      Thread t = new Thread(r, "SoundWorld-Freeze-Watchdog");
      t.setDaemon(true);
      return t;
    });
    watchdog.scheduleWithFixedDelay(SoundWorldFreezeMonitor::check, 2000, 2000, TimeUnit.MILLISECONDS);
  }

  public static void setForeground(boolean visible) {
    foreground = visible;
    long now = SystemClock.uptimeMillis();
    mainHeartbeat.set(now);
    jsHeartbeat.set(now);
    rendererReplied.set(0L);
    lastProbe.set(0L);
    mainPending.set(false);
    probePending.set(false);
    recordedMain.set(false);
    recordedWeb.set(false);
  }

  public static synchronized void stop() {
    foreground = false;
    if (watchdog != null) {
      watchdog.shutdown();
      watchdog = null;
    }
    webViewRef.clear();
  }

  public static void pulse() { jsHeartbeat.set(SystemClock.uptimeMillis()); }

  public static void traceScreen(String screen) {
    if ("player".equals(screen) || "studio".equals(screen) ||
        "settings".equals(screen) || "diagnostics".equals(screen) ||
        "history".equals(screen) || "onboarding".equals(screen) ||
        "help".equals(screen)) lastScreen = screen;
  }

  public static void recordJsIssue(Context context, String kind) {
    if (!"javascript-error".equals(kind) && !"unhandled-rejection".equals(kind)) return;
    Context safe = context.getApplicationContext();
    Thread t = new Thread(() -> {
      safe.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        .putString(ISSUE, kind).putLong(ISSUE_AT, System.currentTimeMillis()).commit();
    }, "SoundWorld-JS-Issue");
    t.setDaemon(true);
    t.start();
  }

  /** A renderer probe bypasses the plugin callback queue. Only run when the
   * JavaScript heartbeat is already missing, and never queue multiple probes. */
  private static void probeRenderer(long now) {
    if (webViewRef.get() == null || now - lastProbe.get() < 4000 ||
        !probePending.compareAndSet(false, true)) return;
    lastProbe.set(now);
    MAIN.post(() -> {
      WebView web = webViewRef.get();
      if (!foreground || web == null) { probePending.set(false); return; }
      try {
        web.evaluateJavascript("0", value -> {
          rendererReplied.set(SystemClock.uptimeMillis());
          probePending.set(false);
        });
      } catch (RuntimeException ex) {
        probePending.set(false);
      }
    });
  }

  private static void persist(String evidence) {
    Context context = app;
    if (context == null) return;
    String data = evidence.length() <= 5500 ? evidence : evidence.substring(0, 5500);
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putString(REPORT, data).putLong(AT, System.currentTimeMillis()).commit();
  }

  private static void check() {
    if (!foreground) return;
    try {
      long now = SystemClock.uptimeMillis();
      if (mainPending.compareAndSet(false, true)) {
        MAIN.post(() -> {
          mainHeartbeat.set(SystemClock.uptimeMillis());
          mainPending.set(false);
        });
      }
      long mainDelay = Math.max(0, now - mainHeartbeat.get());
      if (mainDelay >= MAIN_STALL_MS && recordedMain.compareAndSet(false, true)) {
        // Only names/line numbers of Java stack frames. No arguments, URLs,
        // paths, device identifiers, microphone audio or user content.
        StackTraceElement[] stack = Looper.getMainLooper().getThread().getStackTrace();
        StringBuilder report = new StringBuilder();
        report.append("SoundWorld AR: android-main-stall\n")
          .append("Blocked milliseconds: ").append(mainDelay).append('\n')
          .append("Last screen: ").append(lastScreen).append('\n')
          .append("Android SDK: ").append(android.os.Build.VERSION.SDK_INT).append('\n')
          .append("Android main stack:");
        for (int i = 0; i < Math.min(stack.length, 26); i++) {
          report.append('\n').append(stack[i].toString());
        }
        persist(report.toString());
        return;
      }
      if (mainDelay >= MAIN_STALL_MS) return;
      long webDelay = Math.max(0, now - jsHeartbeat.get());
      if (webDelay >= 5000) probeRenderer(now);
      if (webDelay >= WEBVIEW_STALL_MS && recordedWeb.compareAndSet(false, true)) {
        long replyAge = now - rendererReplied.get();
        boolean independentProbeReplied = rendererReplied.get() > 0 && replyAge < 5500;
        persist("SoundWorld AR: webview-heartbeat-stall\n" +
          "Missing JavaScript heartbeat milliseconds: " + webDelay + "\n" +
          "Android main thread: responsive\n" +
          "Independent renderer probe: " + (independentProbeReplied ? "responsive" : "not confirmed") + "\n" +
          "Possible area: " + (independentProbeReplied ? "Capacitor callback queue" : "WebView/JS/renderer") + "\n" +
          "Last screen: " + lastScreen + "\n" +
          "Android SDK: " + android.os.Build.VERSION.SDK_INT + "\n" +
          "This is diagnostic evidence, not a confirmed root cause.");
      }
    } catch (Exception ignored) {
      // Monitoring must never crash or disable the application.
    }
  }
}
