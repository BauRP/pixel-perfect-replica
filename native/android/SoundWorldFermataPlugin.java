package kz.soundworld.ar;

import android.content.Context;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.RejectedExecutionException;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * First native integration step for the genuine Fermata/MNN pipeline.
 * Inspects only packaged, previously hash-verified local artifacts.
 * It NEVER loads unverified weights, invokes a placeholder generator,
 * starts a network request, or marks music generation as available.
 *
 * Music synthesis remains disabled until the original tokenizer, an actual
 * Fermata->MNN inference path and licensed MIDI->PCM rendering are connected.
 */
@CapacitorPlugin(name = "SoundWorldFermata")
public final class SoundWorldFermataPlugin extends Plugin {
  private final ThreadPoolExecutor inspector = new ThreadPoolExecutor(
    1, 1, 0L, TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(2), r -> {
      Thread t = new Thread(r, "SoundWorld-Fermata-Package");
      t.setDaemon(true);
      return t;
    }, new ThreadPoolExecutor.AbortPolicy());

  private static boolean assetPresent(Context context, String path) {
    if (path.isEmpty() || path.startsWith("/") || path.contains("..") ||
        path.contains("\\") || path.contains(":")) return false;
    try (InputStream stream=context.getAssets().open("offline-music/"+path)) {
      return stream.read()!=-1;
    } catch (Exception ignored) { return false; }
  }

  private static boolean isArm64() {
    for (String abi : Build.SUPPORTED_ABIS) {
      if ("arm64-v8a".equals(abi)) return true;
    }
    return false;
  }

  private static JSObject inspectPackage(Context context) {
    JSObject out = new JSObject();
    out.put("model", "haster/Fermata-0.2B-v1");
    out.put("runtime", "Alibaba/MNN");
    out.put("manifestPresent", false);
    out.put("modelPackaged", false);
    out.put("tokenizerPackaged", false);
    out.put("mnnPackaged", false);
    out.put("synthPackaged", false);
    out.put("soundbankPackaged", false);
    out.put("licenseEvidencePackaged", false);
    out.put("packageComplete", false);
    out.put("arm64Supported", isArm64());
    // This field must change ONLY when real native inference and 60s+ audio
    // generation work end-to-end; mere presence of assets cannot enable Play.
    out.put("generationReady", false);
    try (InputStream stream=context.getAssets().open("offline-music/manifest.json")) {
      // The build-time gate already SHA256-checks every staged artifact.
      // Do not hash ~900MB of assets on a Capacitor or Android UI thread.
      byte[] data = new byte[256 * 1024 + 1];
      int length=0;
      while(length<data.length) {
        int n=stream.read(data,length,data.length-length);
        if(n<0)break;
        length+=n;
      }
      if(length>256 * 1024)return out;
      JSONObject manifest=new JSONObject(new String(data,0,length,StandardCharsets.UTF_8));
      if(manifest.optInt("schemaVersion")!=1 ||
         !"haster/Fermata-0.2B-v1".equals(manifest.optString("model")) ||
         !"Alibaba/MNN".equals(manifest.optString("runtime")))return out;
      out.put("manifestPresent",true);
      JSONArray files=manifest.optJSONArray("files");
      if(files==null || files.length()<6 || files.length()>128)return out;
      Set<String> roles=new HashSet<>();
      boolean filesPresent=true;
      for(int i=0;i<files.length();i++) {
        JSONObject item=files.optJSONObject(i);
        if(item==null){filesPresent=false;break;}
        String role=item.optString("role");
        String path=item.optString("path");
        if(!"Apache-2.0".equals(item.optString("license")) ||
           !item.has("sha256") || item.optString("sha256").length()!=64) {
          filesPresent=false;
          break;
        }
        final boolean exists;
        if("mnn-arm64".equals(role) || "synth-arm64".equals(role)) {
          if(!path.matches("lib[A-Za-z0-9_]+\\.so")) {filesPresent=false;break;}
          exists=new File(context.getApplicationInfo().nativeLibraryDir,path).isFile();
        } else {
          exists=assetPresent(context,path);
        }
        if(!exists){filesPresent=false;break;}
        roles.add(role);
      }
      out.put("modelPackaged", roles.contains("model"));
      out.put("tokenizerPackaged", roles.contains("tokenizer"));
      out.put("mnnPackaged", roles.contains("mnn-arm64"));
      out.put("synthPackaged", roles.contains("synth-arm64"));
      out.put("soundbankPackaged", roles.contains("soundbank"));
      out.put("licenseEvidencePackaged", roles.contains("notice"));
      out.put("packageComplete", filesPresent && roles.contains("model") &&
        roles.contains("tokenizer") && roles.contains("mnn-arm64") &&
        roles.contains("synth-arm64") && roles.contains("soundbank") &&
        roles.contains("notice"));
    }catch(Exception ignored) {
      // Missing or corrupt package: fail closed; never claim that Fermata ran.
    }
    return out;
  }

  @PluginMethod public void inspect(PluginCall call) {
    final Context context=getContext().getApplicationContext();
    try {
      inspector.execute(() -> {
        try {call.resolve(inspectPackage(context));}
        catch(Exception ignored){call.reject("Не удалось проверить пакет Fermata");}
      });
    }catch(RejectedExecutionException ignored) {
      call.reject("Проверка модели занята");
    }
  }

  @Override protected void handleOnDestroy() {
    inspector.shutdownNow();
    super.handleOnDestroy();
  }
}
