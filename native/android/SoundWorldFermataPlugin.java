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
  private File preparedModelDirectory;
  private JSONObject cachedVocabulary;
  private volatile boolean destroyed=false;
  private final ThreadPoolExecutor synthWorker = new ThreadPoolExecutor(
    1,1,0L,TimeUnit.MILLISECONDS,new ArrayBlockingQueue<>(2), r -> {
      Thread t=new Thread(r,"SoundWorld-Sonivox-PCM");
      t.setDaemon(true);
      return t;
    },new ThreadPoolExecutor.AbortPolicy());
  private File renderedPcm;
  private long renderedFrames;
  private static native long renderSonivoxFile(String midiPath,String pcmPath,long targetFrames);
  private void clearRenderedFile() {
    renderedFrames=0;
    if(renderedPcm!=null){renderedPcm.delete();renderedPcm=null;}
  }
  private static native int[] generateMnnIds(String configPath, int[] inputIds, int maxTokens, int threads, int diversity);
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
    if(!android.os.Process.is64Bit())return false;
    String architecture=System.getProperty("os.arch","");
    if(!"aarch64".equalsIgnoreCase(architecture)&&!"arm64".equalsIgnoreCase(architecture))
      return false;
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
  private JSONObject loadAtomicVocabulary(Context context) throws Exception {
    if(cachedVocabulary!=null)return cachedVocabulary;
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
    cachedVocabulary=map;
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
          if(destroyed)throw new IllegalStateException("Destroyed model");
          if(!isArm64())throw new IllegalStateException("ARM64 required");
          if(preparedModelDirectory!=null&&preparedModelDirectory.isDirectory()){
            JSObject result=new JSObject();
            result.put("modelDirectory",preparedModelDirectory.getAbsolutePath());
            result.put("generationReady",false);
            call.resolve(result);return;
          }
          preparedModelDirectory=null;
          JSONObject manifest=new JSONObject(new String(
            readBounded(context,"manifest.json",256*1024),StandardCharsets.UTF_8));
          if(manifest.optInt("schemaVersion")!=1 ||
             !"haster/Fermata-0.2B-v1".equals(manifest.optString("model")) ||
             !"Alibaba/MNN".equals(manifest.optString("runtime")))
            throw new IllegalArgumentException("Wrong model manifest");
          JSONArray entries=manifest.getJSONArray("files");
          if(entries.length()>128)throw new IllegalArgumentException("Too many assets");
          File dir=new File(context.getNoBackupFilesDir(),"fermata-mnn-v1");
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
                  if(destroyed||Thread.currentThread().isInterrupted())throw new java.io.IOException("Cancelled");
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
             !names.contains("llm.mnn")||!names.contains("llm.mnn.weight")||
             !names.contains("tokenizer.txt"))
            throw new java.io.IOException("Incomplete MNN model");
          // Refuse old unlisted artifacts in this dedicated private directory.
          File[] installed=dir.listFiles();
          if(installed==null)throw new java.io.IOException("Cannot list model directory");
          for(File file:installed)if(!names.contains(file.getName())&&
             (!file.isFile()||!file.delete()))throw new java.io.IOException("Stale model asset");
          preparedModelDirectory=dir;
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

  /** Actual raw-ID MNN inference. No audio readiness claim. Only the
   * previously verified model in the private directory can be opened. */
  @PluginMethod public void generateIds(PluginCall call) {
    final JSONArray input=call.getArray("tokenIds");
    final Integer maximum=call.getInt("maxTokens");
    final Integer diversity=call.getInt("diversity",1);
    if(input==null||input.length()<1||input.length()>32||
       maximum==null||maximum<1||maximum+input.length()>4096||
       diversity==null||diversity<0||diversity>2) {
      call.reject("Некорректный запрос MNN");return;
    }
    try {
      inspector.execute(()->{
        try {
          if(destroyed)throw new IllegalStateException("Destroyed model");
          File dir=preparedModelDirectory;
          if(dir==null)throw new IllegalStateException("Model not prepared");
          final int[] ids=new int[input.length()];
          for(int i=0;i<ids.length;i++){
            Object value=input.get(i);
            if(!(value instanceof Integer)||((Integer)value)<0||((Integer)value)>=9507)
              throw new IllegalArgumentException("Invalid token ID");
            ids[i]=(Integer)value;
          }
          System.loadLibrary("soundworld_fermata_mnn");
          android.os.PowerManager power=(android.os.PowerManager)getContext().getSystemService(Context.POWER_SERVICE);
          android.app.ActivityManager memory=(android.app.ActivityManager)getContext().getSystemService(Context.ACTIVITY_SERVICE);
          if(memory!=null){
            android.app.ActivityManager.MemoryInfo info=new android.app.ActivityManager.MemoryInfo();
            memory.getMemoryInfo(info);
            if(info.lowMemory)throw new IllegalStateException("Not enough memory for MNN");
          }
          int threads=Math.max(1,Math.min(2,Runtime.getRuntime().availableProcessors()-1));
          if(power!=null&&power.getCurrentThermalStatus()>=4)
            throw new IllegalStateException("Device thermal status critical");
          if(power!=null&&(power.isPowerSaveMode()||power.getCurrentThermalStatus()>=3))threads=1;
          int[] output=generateMnnIds(new File(dir,"config.json").getAbsolutePath(),ids,maximum,threads,diversity);
          if(destroyed)throw new IllegalStateException("Destroyed model");
          if(output==null||output.length<1||output.length>maximum)
            throw new IllegalStateException("No actual model output");
          JSONArray resultIds=new JSONArray();
          for(int id:output){
            if(id<0||id>=9507)throw new IllegalStateException("Invalid model output");
            resultIds.put(id);
          }
          JSObject result=new JSObject();
          result.put("tokenIds",resultIds);
          call.resolve(result);
        }catch(Exception | LinkageError e){call.reject("MNN: локальные вычисления недоступны");}
      });
    }catch(RejectedExecutionException e){call.reject("Музыкальный движок занят");}
  }

  /** Render the authentic MIDI bytes supplied by the score adapter, only
   * through a bundled, reviewed native synthesizer. No microphone samples. */
  @PluginMethod public void renderMidi(PluginCall call) {
    final String encoded=call.getString("midi");
    final Integer frames=call.getInt("frames");
    if(encoded==null||encoded.length()>1_500_000||frames==null||
       frames<60*48000||frames>120*48000){
      call.reject("Некорректная партитура MIDI");return;
    }
    final Context context=getContext().getApplicationContext();
    try {
      synthWorker.execute(()->{
        File midi=null,output=null;
        try {
          if(destroyed)throw new IllegalStateException("Destroyed renderer");
          if(!inspectPackage(context).optBoolean("packageComplete")||
             !nativeLibraryPresent(context,"libsoundworld_sonivox.so"))
            throw new IllegalStateException("Reviewed synthesizer missing");
          clearRenderedFile();
          File dir=new File(context.getNoBackupFilesDir(),"fermata-audio");
          if(!dir.isDirectory()&&!dir.mkdirs())throw new java.io.IOException("Cannot create audio directory");
          // A process kill can leave a temporary score or PCM behind. Only
          // remove files owned by this dedicated renderer directory.
          File[] old=dir.listFiles();
          if(old!=null)for(File file:old)
            if(file.isFile()&&(file.getName().matches("score-.*\\.mid")||
               file.getName().matches("render-.*\\.pcm")))file.delete();
          if(dir.getUsableSpace()<frames*4L+8L*1024*1024)
            throw new java.io.IOException("Insufficient audio storage");
          byte[] bytes=android.util.Base64.decode(encoded,android.util.Base64.NO_WRAP);
          if(bytes.length<22||bytes.length>1_000_000||bytes[0]!=77||bytes[1]!=84||
             bytes[2]!=104||bytes[3]!=100)
            throw new IllegalArgumentException("Invalid MIDI file");
          midi=File.createTempFile("score-",".mid",dir);
          output=File.createTempFile("render-",".pcm",dir);
          try(FileOutputStream stream=new FileOutputStream(midi)){stream.write(bytes);}
          System.loadLibrary("soundworld_sonivox");
          long actual=renderSonivoxFile(midi.getAbsolutePath(),output.getAbsolutePath(),frames);
          if(actual!=frames||output.length()!=frames*4L)
            throw new java.io.IOException("Incomplete real PCM");
          renderedPcm=output;renderedFrames=actual;output=null;
          JSObject result=new JSObject();result.put("frames",actual);call.resolve(result);
        }catch(Exception | LinkageError e){call.reject("Локальный синтез MIDI недоступен");}
        finally{
          if(midi!=null)midi.delete();
          if(output!=null)output.delete();
          if(destroyed)clearRenderedFile();
        }
      });
    }catch(RejectedExecutionException e){call.reject("Музыкальный движок занят");}
  }

  @PluginMethod public void readMidiPcm(PluginCall call) {
    final Integer from=call.getInt("fromFrame"),count=call.getInt("frameCount");
    if(from==null||count==null||from<0||count<1||count>12000){
      call.reject("Некорректная порция PCM");return;
    }
    try {
      synthWorker.execute(()->{
        try {
          if(destroyed||renderedPcm==null||(long)from+count>renderedFrames)
            throw new java.io.IOException("No rendered audio");
          byte[] data=new byte[count*4];
          try(java.io.RandomAccessFile stream=new java.io.RandomAccessFile(renderedPcm,"r")){
            stream.seek(from*4L);stream.readFully(data);
          }
          JSObject result=new JSObject();
          result.put("pcm",android.util.Base64.encodeToString(data,android.util.Base64.NO_WRAP));
          java.util.Arrays.fill(data,(byte)0);
          call.resolve(result);
        }catch(Exception e){call.reject("Не удалось прочитать реальные PCM");}
        finally{if(destroyed)clearRenderedFile();}
      });
    }catch(RejectedExecutionException e){call.reject("Музыкальный движок занят");}
  }

  @PluginMethod public void releaseMidiPcm(PluginCall call) {
    try {
      synthWorker.execute(()->{clearRenderedFile();call.resolve();});
    }catch(RejectedExecutionException e){call.reject("Музыкальный движок занят");}
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
    // Let the serial worker finish its in-flight native operation and
    // remove the temporary PCM afterwards; never delete a file mid-read.
    destroyed=true;
    try{synthWorker.execute(this::clearRenderedFile);}
    catch(RejectedExecutionException ignored){}
    synthWorker.shutdown();
    inspector.shutdown();
    super.handleOnDestroy();
  }
}
