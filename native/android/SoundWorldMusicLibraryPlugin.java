package kz.soundworld.ar;

import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.media.AudioManager;
import android.media.AudioFocusRequest;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.content.BroadcastReceiver;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.util.UUID;
import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Real 48kHz stereo 16-bit generated-PCM file store.
 * Does not record surrounding microphone audio and never invents saved music.
 * All disk operations are serialized off Android main thread.
 */
@CapacitorPlugin(name = "SoundWorldMusicLibrary")
public class SoundWorldMusicLibraryPlugin extends Plugin {
  private static final int SAMPLE_RATE = 48000;
  private static final int FRAME_BYTES = 4;
  private static final long MAX_PCM = 120L * SAMPLE_RATE * FRAME_BYTES;
  private static final String PREFS = "soundworld_real_clips";
  private final ExecutorService writer = Executors.newSingleThreadExecutor(r -> {
    Thread t = new Thread(r, "SoundWorld-Music-Library");
    t.setDaemon(true);
    return t;
  });
  private RandomAccessFile recording;
  private File partial;
  private String recordingId;
  private JSONObject recordingMetadata;
  private long written;
  private MediaPlayer player;
  private AudioManager playbackAudioManager;
  private AudioFocusRequest playbackFocus;
  private String playingId;
  private String playbackState = "stopped";
  private BroadcastReceiver noisyReceiver;

  private File directory() {
    File dir = new File(getContext().getFilesDir(), "generated_music");
    if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("Не удалось создать папку музыки");
    return dir;
  }
  private boolean validId(String id) { return id != null && id.matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"); }
  private File clipFile(String id) {
    if (!validId(id)) throw new IllegalArgumentException("Недопустимый идентификатор аудио");
    return new File(directory(), id + ".wav");
  }
  private JSONArray loadIndex() throws Exception {
    SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    return new JSONArray(prefs.getString("clips", "[]"));
  }
  private void saveIndex(JSONArray entries) throws Exception {
    boolean ok = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putString("clips", entries.toString()).commit();
    if (!ok) throw new IOException("Не удалось записать каталог музыки");
  }
  private JSObject errorMessage(Exception ex) {
    JSObject obj = new JSObject();obj.put("message", ex.getMessage());return obj;
  }

  @PluginMethod public void beginClip(PluginCall call) {
    writer.execute(() -> {
      if (recording != null) {call.reject("Другой музыкальный фрагмент ещё записывается");return;}
      try {
        String id = UUID.randomUUID().toString();
        String genreJson = call.getString("genreIdsJson", "[]");
        JSONArray genres = new JSONArray(genreJson);
        if (genres.length() > 150) throw new IllegalArgumentException("Слишком много жанров");
        int mood = call.getInt("mood", 0);
        int speed = call.getInt("speed", 0);
        if (mood < -5 || mood > 5 || speed < -3 || speed > 3) throw new IllegalArgumentException("Некорректные настройки");
        File file = new File(directory(), id + ".partial");
        recording = new RandomAccessFile(file, "rw");
        recording.setLength(0);
        recording.write(new byte[44]); // WAV header written when actual PCM arrives
        partial = file;
        recordingId = id;
        written = 0;
        recordingMetadata = new JSONObject();
        recordingMetadata.put("id", id);
        recordingMetadata.put("createdAt", System.currentTimeMillis());
        recordingMetadata.put("genreIds", genres);
        JSONArray instruments = new JSONArray(call.getString("instrumentIdsJson", "[]"));
        if (instruments.length() > 100) throw new IllegalArgumentException("Слишком много инструментов");
        recordingMetadata.put("instrumentIds", instruments);
        recordingMetadata.put("mood", mood);
        recordingMetadata.put("speed", speed);
        recordingMetadata.put("favorite", false);
        JSObject r = new JSObject();r.put("id", id);call.resolve(r);
      } catch (Exception ex) { abortRecording();call.reject("Ошибка начала файла: " + ex.getMessage()); }
    });
  }

  @PluginMethod public void appendPcm(PluginCall call) {
    String id = call.getString("id");
    String encoded = call.getString("base64");
    if (!validId(id) || encoded == null || encoded.length() > 275000) {
      call.reject("Недопустимый PCM фрагмент");return;
    }
    writer.execute(() -> {
      try {
        byte[] pcm = Base64.decode(encoded, Base64.DEFAULT);
        if (!id.equals(recordingId) || recording == null) throw new IllegalStateException("Нет записи с таким ID");
        if (pcm.length == 0 || pcm.length % FRAME_BYTES != 0 || pcm.length > 192000 ||
          written + pcm.length > MAX_PCM) throw new IllegalArgumentException("PCM выходит за допустимый объём");
        recording.write(pcm);
        written += pcm.length;
        JSObject r = new JSObject();r.put("bytesWritten", written);call.resolve(r);
      } catch(Exception ex) {call.reject("Ошибка сохранения PCM: " + ex.getMessage());}
    });
  }

  private void leShort(RandomAccessFile file, int value) throws IOException {
    file.write(value & 0xff);file.write((value >>> 8) & 0xff);
  }
  private void leInt(RandomAccessFile file, long value) throws IOException {
    for (int i=0;i<4;i++) file.write((int)((value >>> (i*8)) & 0xff));
  }
  private void wavHeader(RandomAccessFile file, long dataBytes) throws IOException {
    file.seek(0);
    file.writeBytes("RIFF");leInt(file,36L+dataBytes);file.writeBytes("WAVE");
    file.writeBytes("fmt ");leInt(file,16);leShort(file,1);
    leShort(file,2);leInt(file,SAMPLE_RATE);
    leInt(file,SAMPLE_RATE*FRAME_BYTES);leShort(file,FRAME_BYTES);leShort(file,16);
    file.writeBytes("data");leInt(file,dataBytes);
  }

  @PluginMethod public void finishClip(PluginCall call) {
    String id = call.getString("id");
    writer.execute(() -> {
      if (recording == null || !validId(id) || !id.equals(recordingId)) {
        call.reject("Нечего завершать");return;
      }
      try {
        if (written == 0) throw new IllegalStateException("Отсутствует настоящее аудио");
        wavHeader(recording, written);
        recording.getFD().sync();
        recording.close(); recording = null;
        File completed = clipFile(id);
        if (!partial.renameTo(completed)) throw new IOException("Не удалось завершить WAV");
        recordingMetadata.put("durationSec", written / (double)(SAMPLE_RATE*FRAME_BYTES));
        recordingMetadata.put("uri", Uri.fromFile(completed).toString());
        JSONArray index=loadIndex();
        index.put(recordingMetadata);
        ArrayList<String> evicted = prune(index);
        saveIndex(index);
        for (String previous : evicted) clipFile(previous).delete();
        JSObject r = new JSObject();r.put("clip", recordingMetadata);call.resolve(r);
        partial=null;recordingId=null;recordingMetadata=null;written=0;
      } catch(Exception ex) {
        abortRecording();call.reject("Файл не завершён: " + ex.getMessage());
      }
    });
  }

  private ArrayList<String> prune(JSONArray index) throws Exception {
    ArrayList<String> evicted = new ArrayList<>();
    int temporaryCount=0;
    for(int i=0;i<index.length();i++) {
      JSONObject clip=index.getJSONObject(i);
      if(!clip.optBoolean("favorite") && !clip.has("exportedUri") && !clip.optBoolean("recoveredProtected")) temporaryCount++;
    }
    for(int i=0;i<index.length() && temporaryCount>3;) {
      JSONObject clip=index.getJSONObject(i);
      if (!clip.optBoolean("favorite") && !clip.has("exportedUri") && !clip.optBoolean("recoveredProtected")) {
        String id=clip.getString("id");
        // Persist catalog before deleting older data to avoid loss on a write failure.
        evicted.add(id);
        index.remove(i);temporaryCount--;
      } else i++;
    }
    return evicted;
  }

  private void abortRecording() {
    try {if (recording != null) recording.close();}catch(Exception ignored){}
    recording=null;
    if (partial != null) partial.delete();
    partial=null;recordingId=null;recordingMetadata=null;written=0;
  }

  /** Abort the active incomplete temporary file, never a finished favorite/export. */
  @PluginMethod public void abortClip(PluginCall call) {
    String id = call.getString("id");
    writer.execute(() -> {
      if (id == null || !id.equals(recordingId)) {
        call.reject("Запись не найдена или уже завершена"); return;
      }
      abortRecording();
      JSObject result = new JSObject(); result.put("aborted", true); call.resolve(result);
    });
  }

  @PluginMethod public void list(PluginCall call) {
    String filter=call.getString("filter","recent");
    writer.execute(() -> {
      try {
        JSONArray source=loadIndex();
        JSONArray output=new JSONArray();
        if (!"recent".equals(filter) && !"favorites".equals(filter) && !"exports".equals(filter))
          throw new IllegalArgumentException("Неизвестный список файлов");
        for(int i=source.length()-1;i>=0;i--) {
          JSONObject item=source.getJSONObject(i);
          // A file with a matching name may be truncated/corrupt after a crash.
          try { verifyWavFile(clipFile(item.getString("id"))); }
          catch (Exception invalidFile) { continue; }
          if("favorites".equals(filter) && !item.optBoolean("favorite")) continue;
          if("exports".equals(filter) && !item.has("exportedUri")) continue;
          output.put(item);
          if ("recent".equals(filter) && output.length() >= 3) break;
        }
        JSObject r=new JSObject();r.put("items",output);call.resolve(r);
      } catch(Exception ex){call.reject("Ошибка чтения файлов: "+ex.getMessage());}
    });
  }

  @PluginMethod public void favorite(PluginCall call) {
    String id=call.getString("id");boolean value=Boolean.TRUE.equals(call.getBoolean("value"));
    writer.execute(() -> {
      try {
        JSONArray index=loadIndex();boolean found=false;
        for(int i=0;i<index.length();i++) {
          JSONObject item=index.getJSONObject(i);
          if(item.getString("id").equals(id) && clipFile(id).isFile()) {
            item.put("favorite",value);found=true;break;
          }
        }
        if(!found){call.reject("Настоящий аудиофайл не найден");return;}
        saveIndex(index);JSObject r=new JSObject();r.put("updated",true);call.resolve(r);
      }catch(Exception ex){call.reject("Не удалось изменить избранное: "+ex.getMessage());}
    });
  }

  @PluginMethod public void export(PluginCall call) {
    String id=call.getString("id");
    writer.execute(() -> {
      Uri outputUri=null;
      try {
        File file=clipFile(id);
        verifyPlayableClip(id);
        JSONArray index=loadIndex();
        JSONObject record=null;
        for(int i=0;i<index.length();i++) {
          if(index.getJSONObject(i).getString("id").equals(id)){record=index.getJSONObject(i);break;}
        }
        if(record==null)throw new IOException("Фрагмент не зарегистрирован");
        ContentValues values=new ContentValues();
        values.put(MediaStore.Audio.Media.DISPLAY_NAME,"SoundWorld-"+id+".wav");
        values.put(MediaStore.Audio.Media.MIME_TYPE,"audio/wav");
        values.put(MediaStore.Audio.Media.RELATIVE_PATH,"Music/SoundWorld AR");
        values.put(MediaStore.Audio.Media.IS_PENDING,1);
        outputUri=getContext().getContentResolver().insert(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,values);
        if(outputUri==null)throw new IOException("Android не разрешил экспорт");
        try(InputStream input=new FileInputStream(file);
            OutputStream output=getContext().getContentResolver().openOutputStream(outputUri)) {
          if(output==null)throw new IOException("Не открыть выходной файл");
          byte[] buffer=new byte[65536];int n;
          while((n=input.read(buffer))!=-1)output.write(buffer,0,n);
          output.flush();
        }
        ContentValues done=new ContentValues();done.put(MediaStore.Audio.Media.IS_PENDING,0);
        if(getContext().getContentResolver().update(outputUri,done,null,null)<1)
          throw new IOException("Не удалось подтвердить сохранение файла");
        record.put("exportedUri",outputUri.toString());
        saveIndex(index);
        JSObject r=new JSObject();r.put("uri",outputUri.toString());call.resolve(r);
      }catch(Exception ex){
        if(outputUri!=null)try{getContext().getContentResolver().delete(outputUri,null,null);}catch(Exception ignored){}
        call.reject("Не удалось сохранить на телефон: "+ex.getMessage());
      }
    });
  }

  @PluginMethod public void deleteTemporary(PluginCall call) {
    String id=call.getString("id");
    writer.execute(() -> {
      try {
        JSONArray index=loadIndex();boolean removed=false;
        for(int i=0;i<index.length();i++) {
          JSONObject entry=index.getJSONObject(i);
          if(entry.getString("id").equals(id)) {
            if(entry.optBoolean("favorite") || entry.has("exportedUri") || entry.optBoolean("recoveredProtected")) {
              call.reject("Избранные и сохранённые записи не удаляются автоматически");return;
            }
            // Persist index before deleting file to avoid creating a broken entry.
            if(id.equals(playingId)) releasePlayer();
            index.remove(i);saveIndex(index);clipFile(id).delete();removed=true;break;
          }
        }
        if(!removed){call.reject("Запись не найдена");return;}
        JSObject r=new JSObject();r.put("deleted",true);call.resolve(r);
      } catch(Exception ex){call.reject("Ошибка удаления: "+ex.getMessage());}
    });
  }

  @PluginMethod public void recover(PluginCall call) {
    writer.execute(() -> {
      try {
        JSONArray index=loadIndex();JSONArray valid=new JSONArray();
        // Incomplete recordings after process death are not playable WAV files.
        File[] partials=directory().listFiles((dir,name)->name.endsWith(".partial"));
        if(partials!=null)for(File file:partials)if(!file.equals(partial))file.delete();
        for(int i=0;i<index.length();i++) {
          JSONObject item=index.getJSONObject(i);
          String id=item.optString("id","");
          if(!validId(id)) continue;
          File file=clipFile(id);
          try {
            verifyWavFile(file);
            valid.put(item);
          } catch(Exception invalidFile) {
            // Never silently erase user's favorite/export metadata.
            // The UI suppresses inaccessible audio, but a recovered file can
            // still regain its existing metadata on a future repair.
            if(item.optBoolean("favorite") || item.has("exportedUri") || item.optBoolean("recoveredProtected"))
              valid.put(item);
          }
        }
        // Recover genuine WAVs that were fully committed to disk, but whose
        // metadata write failed. Never invent audio: check RIFF/WAVE and PCM length.
        java.util.HashSet<String> known = new java.util.HashSet<>();
        for(int i=0;i<valid.length();i++) known.add(valid.getJSONObject(i).getString("id"));
        File[] files=directory().listFiles((dir,name)->name.endsWith(".wav"));
        if(files!=null)for(File file:files) {
          String name=file.getName();
          String id=name.substring(0,name.length()-4);
          if(!validId(id)||known.contains(id)||file.length()<=44||file.length()>MAX_PCM+44)continue;
          try {
            verifyWavFile(file);
            long size=file.length()-44;
            JSONObject item=new JSONObject();
            item.put("id",id);item.put("createdAt",file.lastModified());
            item.put("durationSec",size/(double)(SAMPLE_RATE*FRAME_BYTES));
            item.put("genreIds",new JSONArray());item.put("instrumentIds",new JSONArray());
            item.put("mood",0);item.put("speed",0);
            item.put("favorite",false); // recovery must never forge a user heart.
            item.put("recoveredProtected",true); // preserve orphaned audio until the user acts.
            item.put("recoveredWithoutSettings",true);
            item.put("uri",Uri.fromFile(file).toString());
            valid.put(item);
          } catch(Exception ignored) { /* invalid WAV is not registered */ }
        }
        if(!valid.toString().equals(index.toString()))saveIndex(valid);
        JSObject r=new JSObject();r.put("recovered",valid.length());call.resolve(r);
      }catch(Exception ex){call.reject("Ошибка восстановления: "+ex.getMessage());}
    });
  }

  /** Reads only a validated locally generated file, never an arbitrary device path. */
  private void verifyWavFile(File file) throws Exception {
    if (!file.isFile() || file.length()<=44 || file.length()>MAX_PCM+44)
      throw new IOException("Файл WAV отсутствует или повреждён");
    try(RandomAccessFile wav=new RandomAccessFile(file,"r")) {
      byte[] header=new byte[44]; wav.readFully(header);
      if(!"RIFF".equals(new String(header,0,4,java.nio.charset.StandardCharsets.US_ASCII)) ||
         !"WAVE".equals(new String(header,8,4,java.nio.charset.StandardCharsets.US_ASCII)) ||
         !"fmt ".equals(new String(header,12,4,java.nio.charset.StandardCharsets.US_ASCII)) ||
         !"data".equals(new String(header,36,4,java.nio.charset.StandardCharsets.US_ASCII)))
        throw new IOException("Некорректный WAV");
      long riffSize=(header[4]&255L)|((header[5]&255L)<<8)|((header[6]&255L)<<16)|((header[7]&255L)<<24);
      long fmtSize=(header[16]&255L)|((header[17]&255L)<<8)|((header[18]&255L)<<16)|((header[19]&255L)<<24);
      int format=(header[20]&255)|((header[21]&255)<<8);
      int channels=(header[22]&255)|((header[23]&255)<<8);
      long rate=(header[24]&255L)|((header[25]&255L)<<8)|((header[26]&255L)<<16)|((header[27]&255L)<<24);
      long byteRate=(header[28]&255L)|((header[29]&255L)<<8)|((header[30]&255L)<<16)|((header[31]&255L)<<24);
      int blockAlign=(header[32]&255)|((header[33]&255)<<8);
      int bits=(header[34]&255)|((header[35]&255)<<8);
      if(riffSize!=file.length()-8 || fmtSize!=16 || format!=1 || channels!=2 ||
         rate!=SAMPLE_RATE || byteRate!=SAMPLE_RATE*FRAME_BYTES || blockAlign!=FRAME_BYTES || bits!=16)
        throw new IOException("Неподдерживаемый или повреждённый формат WAV");
      long size=(header[40]&255L)|((header[41]&255L)<<8)|((header[42]&255L)<<16)|((header[43]&255L)<<24);
      if(size!=file.length()-44 || size%FRAME_BYTES!=0)
        throw new IOException("Повреждён размер WAV");
    }
  }

  /** Do not trust a user-supplied URI or a guessed filename. */
  private void verifyPlayableClip(String id) throws Exception {
    File file=clipFile(id);
    boolean listed=false;
    JSONArray catalog=loadIndex();
    for(int i=0;i<catalog.length();i++) {
      if(id.equals(catalog.getJSONObject(i).optString("id"))) {listed=true;break;}
    }
    if(!listed) throw new IOException("Запись отсутствует в каталоге");
    verifyWavFile(file);
  }

  @Override public void load() {
    super.load();
    // When wired/Bluetooth headphones vanish, do not surprise the listener with speaker audio.
    noisyReceiver=new BroadcastReceiver() {
      @Override public void onReceive(Context context,Intent intent) {
        if(AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) {
          writer.execute(()->pausePlayer());
        }
      }
    };
    IntentFilter filter=new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
    // ACTION_AUDIO_BECOMING_NOISY is exclusively a system broadcast.
    // Android 14+ explicitly permits registration without export flags for
    // system-only actions; this also avoids OEM-specific receiver flag errors
    // during Capacitor plugin initialization.
    try {
      getContext().registerReceiver(noisyReceiver, filter);
    } catch (SecurityException ex) {
      // Some OEM Android builds demand explicit flags even for this system
      // broadcast. Retry without sacrificing headphone-disconnect protection.
      if (Build.VERSION.SDK_INT >= 33)
        getContext().registerReceiver(noisyReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
      else throw ex;
    }
  }

  private void publishPlayback(String state) {
    playbackState=state;
    JSObject data=new JSObject();
    data.put("state",state);
    data.put("clipId",playingId == null ? "" : playingId);
    notifyListeners("clipPlayback",data);
  }

  private void releasePlayer() {
    MediaPlayer old=player;
    player=null;
    if(old!=null) {
      try {old.setOnCompletionListener(null);}catch(Exception ignored){}
      try {old.stop();}catch(Exception ignored){}
      try {old.release();}catch(Exception ignored){}
    }
    if(playbackAudioManager!=null && playbackFocus!=null) {
      try {playbackAudioManager.abandonAudioFocusRequest(playbackFocus);}catch(Exception ignored){}
    }
    playbackFocus=null;
    playingId=null;
    publishPlayback("stopped");
  }

  private void pausePlayer() {
    if(player!=null && "playing".equals(playbackState)) {
      try {player.pause();publishPlayback("paused");}
      catch(Exception ignored) {releasePlayer();}
    }
  }

  @PluginMethod public void playClip(PluginCall call) {
    String id=call.getString("id");
    writer.execute(()->{
      try {
        verifyPlayableClip(id);
        if(id.equals(playingId) && player!=null) {
          player.start();publishPlayback("playing");
        } else {
          releasePlayer();
          playbackAudioManager=(AudioManager)getContext().getSystemService(Context.AUDIO_SERVICE);
          if(playbackAudioManager==null)throw new IOException("Звуковая система недоступна");
          AudioAttributes attrs=new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build();
          playbackFocus=new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(attrs).setOnAudioFocusChangeListener(change->{
              if(change<=0) writer.execute(this::pausePlayer);
            },new Handler(Looper.getMainLooper())).build();
          if(playbackAudioManager.requestAudioFocus(playbackFocus)!=AudioManager.AUDIOFOCUS_REQUEST_GRANTED)
            throw new IOException("Нет разрешения на воспроизведение звука");
          MediaPlayer created=new MediaPlayer();
          player=created;
          created.setAudioAttributes(attrs);
          created.setDataSource(clipFile(id).getAbsolutePath());
          created.setOnCompletionListener(p->writer.execute(this::releasePlayer));
          created.prepare();
          created.start();
          playingId=id;
          publishPlayback("playing");
        }
        JSObject result=new JSObject();result.put("playing",true);result.put("id",id);call.resolve(result);
      }catch(Exception ex) {
        releasePlayer();call.reject("Не удалось воспроизвести WAV: "+ex.getMessage());
      }
    });
  }

  @PluginMethod public void pauseClip(PluginCall call) {
    writer.execute(()->{
      pausePlayer();
      JSObject result=new JSObject();result.put("state",playbackState);call.resolve(result);
    });
  }

  @PluginMethod public void stopClip(PluginCall call) {
    writer.execute(()->{
      releasePlayer();
      JSObject result=new JSObject();result.put("state","stopped");call.resolve(result);
    });
  }

  @PluginMethod public void playbackStatus(PluginCall call) {
    writer.execute(()->{
      JSObject result=new JSObject();
      result.put("state",playbackState);
      result.put("clipId",playingId == null ? "" : playingId);
      call.resolve(result);
    });
  }

  @Override protected void handleOnDestroy() {
    if(noisyReceiver!=null) {
      try {getContext().unregisterReceiver(noisyReceiver);}catch(Exception ignored){}
      noisyReceiver=null;
    }
    writer.execute(()->{releasePlayer();abortRecording();});
    writer.shutdown();
    super.handleOnDestroy();
  }
}
