package kz.soundworld.ar;

import android.content.Context;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.ByteArrayOutputStream;
import java.io.FileOutputStream;
import java.io.FileInputStream;
import java.util.Iterator;
import java.security.MessageDigest;
import java.io.InputStream;
import java.util.zip.ZipFile;
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

  /** Modern Android may map native libraries directly from APK instead of
   * extracting them to nativeLibraryDir. Both layouts are genuine packaged
   * native code; a random external file must never count as installed. */
  private static boolean nativeLibraryPresent(Context context, String fileName) {
    if(!fileName.matches("lib[A-Za-z0-9_]+\\.so"))return false;
    if(new File(context.getApplicationInfo().nativeLibraryDir,fileName).isFile())
      return true;
    try(ZipFile apk=new ZipFile(context.getApplicationInfo().sourceDir)) {
      return apk.getEntry("lib/arm64-v8a/"+fileName)!=null;
    }catch(Exception ignored) { return false; }
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
          exists=nativeLibraryPresent(context,path);
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

  private static byte[] readBounded(Context context,String path,int maximum) throws Exception {
    try(InputStream in=context.getAssets().open("offline-music/"+path);
        ByteArrayOutputStream out=new ByteArrayOutputStream()) {
      byte[] buffer=new byte[8192];
      int n;
      while((n=in.read(buffer))!=-1) {
        if(out.size()+n>maximum)throw new IllegalArgumentException("Fermata asset too large");
        out.write(buffer,0,n);
      }
      return out.toByteArray();
    }
  }

  // This checkpoint was trained on atomic tokens (the author's known BPE
  // training issue). Use the actual upstream dictionary, not generic Llama
  // text tokenization. Do not guess a mapping if the format differs.
  private static JSONObject loadAtomicVocabulary(Context context) throws Exception {
    JSONObject manifest=new JSONObject(new String(
        readBounded(context,"manifest.json",256*1024),StandardCharsets.UTF_8));
    if(manifest.optInt("schemaVersion")!=1 ||
       !"haster/Fermata-0.2B-v1".equals(manifest.optString("model")) ||
       !"Alibaba/MNN".equals(manifest.optString("runtime")))
      throw new IllegalArgumentException("Wrong Fermata manifest");
    JSONArray files=manifest.getJSONArray("files");
    JSONObject item=null;
    for(int i=0;i<files.length();i++) {
      JSONObject candidate=files.getJSONObject(i);
      String path=candidate.optString("path");
      if("tokenizer".equals(candidate.optString("role")) &&
         ("tokenizer/vocab.json".equals(path)||"vocab.json".equals(path))) {
        if(item!=null)throw new IllegalArgumentException("Ambiguous Fermata vocabulary");
        item=candidate;
      }
    }
    if(item==null||!"Apache-2.0".equals(item.optString("license")))
      throw new IllegalArgumentException("Original Fermata vocabulary missing");
    byte[] bytes=readBounded(context,item.getString("path"),2*1024*1024);
    if(bytes.length!=item.getLong("sizeBytes"))throw new IllegalArgumentException("Wrong vocabulary size");
    byte[] digest=MessageDigest.getInstance("SHA-256").digest(bytes);
    StringBuilder hex=new StringBuilder();
    for(byte b:digest)hex.append(String.format(java.util.Locale.ROOT,"%02x",b&255));
    if(!hex.toString().equals(item.getString("sha256")))
      throw new IllegalArgumentException("Wrong vocabulary checksum");
    JSONObject map=new JSONObject(new String(bytes,StandardCharsets.UTF_8));
    if(map.length()!=9507)throw new IllegalArgumentException("Unsupported Fermata vocabulary format");
    Set<Integer> ids=new HashSet<>();
    Iterator<String> keys=map.keys();
    while(keys.hasNext()) {
      Object value=map.get(keys.next());
      if(!(value instanceof Integer))throw new IllegalArgumentException("Invalid vocabulary ID");
      int id=(Integer)value;
      if(id<0||id>=9507||!ids.add(id))throw new IllegalArgumentException("Invalid vocabulary ID");
    }
    return map;
  }

  /** Convert existing conditioning strings into the original model's IDs.
   * This is only the input tokenizer stage; generationReady stays false. */
  @PluginMethod public void encodeHeader(PluginCall call) {
    final JSONArray tokens=call.getArray("tokens");
    if(tokens==null||tokens.length()<8||tokens.length()>32) {
      call.reject("Некорректный музыкальный заголовок Fermata");return;
    }
    final Context context=getContext().getApplicationContext();
    try {
      inspector.execute(()->{
        try {
          JSONObject vocab=loadAtomicVocabulary(context);
          if(!"<BOS>".equals(tokens.getString(0)) ||
             !"<PLAN_END>".equals(tokens.getString(tokens.length()-1)))
            throw new IllegalArgumentException("Invalid Fermata header");
          JSONArray ids=new JSONArray();
          for(int i=0;i<tokens.length();i++) {
            String token=tokens.getString(i);
            if(!vocab.has(token))throw new IllegalArgumentException("Unknown original musical token");
            ids.put(vocab.getInt(token));
          }
          JSObject result=new JSObject();
          result.put("tokenIds",ids);
          call.resolve(result);
        }catch(Exception e){call.reject("Оригинальный словарь Fermata недоступен или несовместим");}
      });
    }catch(RejectedExecutionException e){call.reject("Музыкальный токенизатор занят");}
  }

  /** Reverse the actual model output IDs. Musical parsing is a separate
   * stage; never reinterpret numeric IDs using a guessed token grammar. */
  @PluginMethod public void decodeTokens(PluginCall call) {
    final JSONArray ids=call.getArray("tokenIds");
    if(ids==null||ids.length()<1||ids.length()>4096) {
      call.reject("Некорректная длина результата Fermata");return;
    }
    final Context context=getContext().getApplicationContext();
    try {
      inspector.execute(()->{
        try {
          JSONObject vocab=loadAtomicVocabulary(context);
          String[] byId=new String[9507];
          Iterator<String> keys=vocab.keys();
          while(keys.hasNext()) {
            String token=keys.next();
            byId[vocab.getInt(token)]=token;
          }
          JSONArray tokens=new JSONArray();
          for(int i=0;i<ids.length();i++) {
            Object value=ids.get(i);
            if(!(value instanceof Integer))throw new IllegalArgumentException("Invalid token ID");
            int id=(Integer)value;
            if(id<0||id>=byId.length||byId[id]==null)
              throw new IllegalArgumentException("Unknown token ID");
            tokens.put(byId[id]);
          }
          JSObject result=new JSObject();
          result.put("tokens",tokens);
          call.resolve(result);
        }catch(Exception e){call.reject("Не удалось прочитать оригинальные музыкальные токены");}
      });
    }catch(RejectedExecutionException e){call.reject("Музыкальный токенизатор занят");}
  }

  /** Materialize actual verified model files to app-private storage for MNN.
   * Assets compressed inside an APK are not ordinary mmap-able files.
   * Never run on startup/UI thread; no network or shared storage. */
  @PluginMethod public void prepareModel(PluginCall call) {
    final Context context=getContext().getApplicationContext();
    try {
      inspector.execute(()->{
        try {
          JSONObject manifest=new JSONObject(new String(
            readBounded(context,"manifest.json",256*1024),StandardCharsets.UTF_8));
          if(manifest.optInt("schemaVersion")!=1 ||
             !"haster/Fermata-0.2B-v1".equals(manifest.optString("model")) ||
             !"Alibaba/MNN".equals(manifest.optString("runtime")))
            throw new IllegalArgumentException("Wrong model manifest");
          JSONArray entries=manifest.getJSONArray("files");
          if(entries.length()>128)throw new IllegalArgumentException("Too many assets");
          File dir=new File(context.getFilesDir(),"fermata-mnn-v1");
          if(!dir.isDirectory()&&!dir.mkdirs())throw new java.io.IOException("Model directory unavailable");
          Set<String> names=new HashSet<>();
          for(int i=0;i<entries.length();i++) {
            JSONObject item=entries.getJSONObject(i);
            if(!"model".equals(item.optString("role")))continue;
            String path=item.getString("path");
            // MNN model files are stored as model/<flat filename>.
            if(!path.matches("model/[A-Za-z0-9_.-]+")||path.contains("..")||
               !"Apache-2.0".equals(item.optString("license")))
              throw new IllegalArgumentException("Invalid MNN asset");
            String name=path.substring(6);
            if(!names.add(name))throw new IllegalArgumentException("Duplicate MNN asset");
            long size=item.getLong("sizeBytes");
            String expected=item.getString("sha256");
            if(size<1||size>900000000L||!expected.matches("[a-f0-9]{64}"))
              throw new IllegalArgumentException("Invalid MNN asset inventory");
            File dest=new File(dir,name);
            if(dest.isFile()&&dest.length()==size&&expected.equals(hashFile(dest)))continue;
            if(dir.getUsableSpace()<size+16L*1024*1024)
              throw new java.io.IOException("Not enough local storage for Fermata");
            File temp=new File(dir,name+".tmp");
            try {
              MessageDigest digest=MessageDigest.getInstance("SHA-256");
              long copied=0;
              byte[] buffer=new byte[65536];
              try(InputStream in=context.getAssets().open("offline-music/"+path);
                  FileOutputStream out=new FileOutputStream(temp)) {
                int n;
                while((n=in.read(buffer))!=-1) {
                  if(Thread.currentThread().isInterrupted())throw new java.io.IOException("Cancelled");
                  copied+=n;
                  if(copied>size)throw new java.io.IOException("Unexpected model size");
                  out.write(buffer,0,n);
                  digest.update(buffer,0,n);
                }
              }
              if(copied!=size||!expected.equals(hexDigest(digest.digest())))
                throw new java.io.IOException("MNN asset checksum mismatch");
              if(!temp.renameTo(dest))throw new java.io.IOException("Cannot install verified model file");
            }finally {if(temp.exists())temp.delete();}
          }
          if(!names.contains("config.json")||!names.contains("llm_config.json")||
             !names.contains("llm.mnn")||!names.contains("llm.mnn.weight"))
            throw new java.io.IOException("Incomplete MNN model");
          // Refuse old unlisted artifacts in this dedicated private directory.
          File[] installed=dir.listFiles();
          if(installed==null)throw new java.io.IOException("Cannot list model directory");
          for(File file:installed)if(!names.contains(file.getName())&&
             (!file.isFile()||!file.delete()))throw new java.io.IOException("Stale model asset");
          JSObject result=new JSObject();
          result.put("modelDirectory",dir.getAbsolutePath());
          result.put("generationReady",false);
          call.resolve(result);
        }catch(Exception e){call.reject("Не удалось подготовить локальные файлы MNN");}
      });
    }catch(RejectedExecutionException e){call.reject("Музыкальный движок занят");}
  }

  private static String hexDigest(byte[] bytes) {
    StringBuilder result=new StringBuilder();
    for(byte b:bytes)result.append(String.format(java.util.Locale.ROOT,"%02x",b&255));
    return result.toString();
  }
  private static String hashFile(File file) throws Exception {
    MessageDigest hash=MessageDigest.getInstance("SHA-256");
    try(InputStream in=new FileInputStream(file)) {
      byte[] buffer=new byte[65536];
      int n;
      while((n=in.read(buffer))!=-1) {
        if(Thread.currentThread().isInterrupted())throw new java.io.IOException("Cancelled");
        hash.update(buffer,0,n);
      }
    }
    return hexDigest(hash.digest());
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
