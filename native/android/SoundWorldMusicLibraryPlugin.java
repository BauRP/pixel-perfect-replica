package kz.soundworld.ar;

import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.os.Build;
import android.provider.MediaStore;
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
import android.database.Cursor;
import java.util.HashMap;
import java.util.Map;
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
  private static final long MIN_SAVE_PCM = SoundWorldClipLengthPolicy.MIN_SAVE_PCM;
  private static final String PREFS = "soundworld_real_clips";
  private SoundWorldClipPlaybackService.PlaybackListener playbackObserver;
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
  // Reuse a verified SHA-256 check only while both the source and the
  // MediaStore item have unchanged metadata. A size match alone is not proof.
  private static final class VerifiedExport {
    final String uri; final long bytes; final long sourceModified; final long mediaModified;
    VerifiedExport(String u,long b,long sourceTime,long externalTime) {
      uri=u;bytes=b;sourceModified=sourceTime;mediaModified=externalTime;
    }
  }
  private final Map<String,VerifiedExport> verifiedExportCache = new HashMap<>();

  private long exportedModifiedAt(String uriText) {
    try (Cursor c=getContext().getContentResolver().query(
        Uri.parse(uriText),new String[]{MediaStore.MediaColumns.DATE_MODIFIED},
        null,null,null)) {
      if(c!=null && c.moveToFirst() && !c.isNull(0))return c.getLong(0);
    } catch(Exception ignored){}
    return -1;
  }

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
    // A single malformed legacy row must not break History, Favorites,
    // Export or recovery for every genuinely completed WAV. Never overwrite
    // the persisted index during a read: keeping the original allows manual
    // recovery if some metadata is damaged. Only valid native recording IDs
    // can refer to files that this plugin is allowed to access.
    JSONArray stored = new JSONArray(prefs.getString("clips", "[]"));
    JSONArray usable = new JSONArray();
    for (int i = 0; i < stored.length(); i++) {
      JSONObject item = stored.optJSONObject(i);
      if (item != null && validId(item.optString("id", ""))) usable.put(item);
    }
    return usable;
  }
  private void saveIndex(JSONArray entries) throws Exception {
    boolean ok = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putString("clips", entries.toString()).commit();
    if (!ok) throw new IOException("Не удалось записать каталог музыки");
  }
  private JSObject errorMessage(Exception ex) {
    JSObject obj = new JSObject();obj.put("message", ex.getMessage());return obj;
  }

  /** MediaStore copy can be deleted by the user independently of our WAV.
   * Never show stale entries in Saved, but preserve their index metadata.
   * File descriptors are checked only on the serial disk worker thread. */
  private boolean exportedCopyExists(String uriText, long expectedBytes) {
    if (uriText == null || uriText.isEmpty() || expectedBytes <= 44) return false;
    try {
      Uri uri = Uri.parse(uriText);
      if (!"content".equals(uri.getScheme()) || !"media".equals(uri.getAuthority()))
        return false;
      try (ParcelFileDescriptor descriptor =
          getContext().getContentResolver().openFileDescriptor(uri, "r")) {
        return descriptor != null && descriptor.getStatSize() == expectedBytes;
      }
    } catch (Exception missing) {
      return false;
    }
  }

  /** An interrupted WebView request may have successfully exported already.
   * Reuse only the same verified MediaStore copy, never duplicate it because
   * the UI waited five seconds and then retried. A size match ALONE is unsafe.
   * All digest work runs on the existing serial file executor. */
  private boolean exportedCopyMatches(File source, String uriText) {
    if (!exportedCopyExists(uriText, source.length())) {
      verifiedExportCache.remove(source.getName());
      return false;
    }
    long changedAt=exportedModifiedAt(uriText);
    VerifiedExport cached=verifiedExportCache.get(source.getName());
    if(changedAt>=0 && cached!=null && cached.uri.equals(uriText) &&
        cached.bytes==source.length() && cached.sourceModified==source.lastModified() &&
        cached.mediaModified==changedAt) return true;
    try (InputStream original=new FileInputStream(source);
         InputStream saved=getContext().getContentResolver().openInputStream(Uri.parse(uriText))) {
      SoundWorldWavExportPolicy.verifyExactCopy(original,saved,source.length());
      if(changedAt>=0)
        verifiedExportCache.put(source.getName(),
          new VerifiedExport(uriText,source.length(),source.lastModified(),changedAt));
      return true;
    } catch (Exception ignored) {
      verifiedExportCache.remove(source.getName());
      return false;
    }
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
        if (!SoundWorldClipLengthPolicy.canFinish(written)) throw new IllegalStateException("Готовая музыка должна звучать от 60 до 120 секунд");
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
    // Never delete the WAV being prepared, played, or paused in the foreground
    // music service. The temporary-history cap still applies to other files.
    SoundWorldClipPlaybackService playback = SoundWorldClipPlaybackService.current();
    final String protectedId = playback == null ? "" : playback.playbackClipId();
    int temporaryCount=0;
    for(int i=0;i<index.length();i++) {
      JSONObject clip=index.getJSONObject(i);
      if(!clip.optBoolean("favorite") && !clip.has("exportedUri") && !clip.optBoolean("recoveredProtected")) temporaryCount++;
    }
    while (temporaryCount > 3) {
      // The index can contain an orphan WAV recovered after a newer one,
      // so insertion order is unsafe for deciding which file to erase.
      long[] times=new long[index.length()];
      boolean[] blocked=new boolean[index.length()];
      for (int i=0;i<index.length();i++) {
        JSONObject item=index.getJSONObject(i);
        String id=item.optString("id","");
        times[i]=item.optLong("createdAt",0);
        blocked[i]=!validId(id) || id.equals(protectedId) ||
          item.optBoolean("favorite") || item.has("exportedUri") ||
          item.optBoolean("recoveredProtected");
      }
      int oldest=SoundWorldClipRetentionPolicy.oldestEvictable(times,blocked);
      // If the only excess temporary file is being played, preserve it.
      // The storage limit can be enforced after playback has stopped.
      if (oldest < 0) break;
      evicted.add(index.getJSONObject(oldest).getString("id"));
      index.remove(oldest);
      temporaryCount--;
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
        if (!"recent".equals(filter) && !"favorites".equals(filter) &&
            !"exports".equals(filter) && !"journey".equals(filter))
          throw new IllegalArgumentException("Неизвестный список файлов");
        // Recovery may append a valid older WAV after newer entries. Sort by
        // real creation date, not SharedPreferences insertion order. Preserve
        // favorites/export metadata and never invent missing WAVs.
        ArrayList<JSONObject> sorted=new ArrayList<>();
        for (int i=0;i<source.length();i++) sorted.add(source.getJSONObject(i));
        sorted.sort((a,b) -> Long.compare(b.optLong("createdAt",0),
                                               a.optLong("createdAt",0)));
        java.util.HashSet<String> seen=new java.util.HashSet<>();
        for (JSONObject item:sorted) {
          String id=item.optString("id","");
          if (!validId(id) || !seen.add(id)) continue;
          // A file with a matching name may be truncated/corrupt after a crash.
          try { verifyWavFile(clipFile(id)); }
          catch (Exception invalidFile) { continue; }
          if("favorites".equals(filter) && !item.optBoolean("favorite")) continue;
          if("exports".equals(filter) && (
               !item.has("exportedUri") ||
               !exportedCopyMatches(clipFile(id),
                                    item.optString("exportedUri", "")))) continue;
          output.put(item);
          if ("recent".equals(filter) && output.length() >= 3) break;
          if ("journey".equals(filter) && output.length() >= 100) break;
        }
        JSObject r=new JSObject();r.put("items",output);call.resolve(r);
      } catch(Exception ex){call.reject("Ошибка чтения файлов: "+ex.getMessage());}
    });
  }

  @PluginMethod public void favorite(PluginCall call) {
    String id=call.getString("id");boolean value=Boolean.TRUE.equals(call.getBoolean("value"));
    writer.execute(() -> {
      try {
        if (!validId(id)) throw new IllegalArgumentException("Недопустимый ID WAV");
        // Adding a heart is allowed ONLY for a fully verified 60-120 second WAV.
        // File.isFile() alone used to accept corrupt/truncated recordings.
        // Removing a heart must remain possible if a previously saved file
        // is missing, so the user can clear obsolete protected metadata.
        if (value) verifyPlayableClip(id);
        JSONArray index=loadIndex();boolean found=false;
        for(int i=0;i<index.length();i++) {
          JSONObject item=index.getJSONObject(i);
          if(item.getString("id").equals(id)) {
            item.put("favorite",value);found=true;break;
          }
        }
        if(!found){call.reject("Запись не найдена в каталоге");return;}
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
        // A retry after a UI timeout must NOT produce two copies in MediaStore.
        // Reuse only when the existing export is still present and byte-identical.
        String previousUri=record.optString("exportedUri","");
        if (exportedCopyMatches(file,previousUri)) {
          JSObject existing=new JSObject();
          existing.put("uri",previousUri);
          call.resolve(existing);
          return;
        }
        ContentValues values=new ContentValues();
        values.put(MediaStore.Audio.Media.DISPLAY_NAME,"SoundWorld-"+id+".wav");
        values.put(MediaStore.Audio.Media.MIME_TYPE,"audio/wav");
        values.put(MediaStore.Audio.Media.RELATIVE_PATH,"Music/SoundWorld AR");
        values.put(MediaStore.Audio.Media.IS_PENDING,1);
        outputUri=getContext().getContentResolver().insert(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,values);
        if(outputUri==null)throw new IOException("Android не разрешил экспорт");
        try(InputStream input=new FileInputStream(file);
            OutputStream output=getContext().getContentResolver().openOutputStream(outputUri)) {
          // MediaStore must receive the ENTIRE previously verified WAV. If
          // the file shrinks/grows or the target write fails, the pending
          // MediaStore item is deleted instead of appearing in Exports.
          SoundWorldWavExportPolicy.copyExactly(input,output,file.length());
        }
        // Keep IS_PENDING=1 until the entire read-back verification passes:
        // Android must never publish an incomplete WAV into the user's Music.
        // The inserting app may open its own pending MediaStore item for
        // verification before making it visible.
        if (!exportedCopyExists(outputUri.toString(), file.length()))
          throw new IOException("Android не подтвердил полный размер экспортированного WAV");
        try (InputStream source=new FileInputStream(file);
             InputStream saved=getContext().getContentResolver().openInputStream(outputUri)) {
          SoundWorldWavExportPolicy.verifyExactCopy(source,saved,file.length());
        }
        ContentValues done=new ContentValues();done.put(MediaStore.Audio.Media.IS_PENDING,0);
        if(getContext().getContentResolver().update(outputUri,done,null,null)<1)
          throw new IOException("Не удалось подтвердить сохранение файла");
        // This copy was just fully hash-verified before publication.
        long modified=exportedModifiedAt(outputUri.toString());
        if(modified>=0) verifiedExportCache.put(file.getName(),
          new VerifiedExport(outputUri.toString(),file.length(),file.lastModified(),modified));
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
            // Do not race asynchronous MediaPlayer.stop with unlinking a file.
            // The caller may retry once playback is explicitly stopped.
            SoundWorldClipPlaybackService active = SoundWorldClipPlaybackService.current();
            if (active != null && id.equals(active.playbackClipId())) {
              call.reject("Сначала остановите воспроизведение этого файла");return;
            }
            // Never announce deletion if Android could not unlink the WAV.
            // Removing metadata first would hide the file and then recovery
            // could rediscover it as a protected orphan, confusing the user.
            File target=clipFile(id);
            if(target.isFile() && !target.delete()) {
              call.reject("Android не смог удалить временный WAV");return;
            }
            index.remove(i);
            saveIndex(index);
            removed=true;break;
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
      if(size!=file.length()-44 || !SoundWorldClipLengthPolicy.canFinish(size))
        throw new IOException("Готовый WAV должен быть 60–120 секунд PCM без повреждений");
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

  /** Listen to the actual persistent playback service, not a WebView-owned player. */
  @Override public void load() {
    super.load();
    playbackObserver = (state, id, error) -> {
      JSObject result = new JSObject();
      result.put("state", state);
      result.put("clipId", id);
      if (error != null && !error.isEmpty()) result.put("error", error);
      notifyListeners("clipPlayback", result);
    };
    SoundWorldClipPlaybackService.setListener(playbackObserver);
  }

  private void respondPlayback(PluginCall call, String state, String id) {
    JSObject result = new JSObject();
    result.put("state", state);
    result.put("clipId", id);
    call.resolve(result);
  }

  /**
   * Verify the WAV is in the app's real protected catalog BEFORE starting the
   * foreground service. Android performs async MediaPlayer.prepare, never
   * blocks the calling UI thread waiting for a complete WAV decode.
   */
  @PluginMethod public void playClip(PluginCall call) {
    String id = call.getString("id");
    writer.execute(() -> {
      try {
        verifyPlayableClip(id);
        android.content.Intent intent = new android.content.Intent(
          getContext(), SoundWorldClipPlaybackService.class)
          .setAction(SoundWorldClipPlaybackService.ACTION_PLAY)
          .putExtra(SoundWorldClipPlaybackService.EXTRA_CLIP_ID, id);
        boolean allowed = Boolean.TRUE.equals(call.getBoolean("resumeAfterCall", true));
        intent.putExtra(SoundWorldClipPlaybackService.EXTRA_AUTO_RESUME, allowed);
        androidx.core.content.ContextCompat.startForegroundService(getContext(), intent);
        // This only acknowledges the request. Actual "playing" comes from
        // MediaPlayer.onPrepared via clipPlayback, never from an invented state.
        JSObject result = new JSObject();
        result.put("requested", true);
        result.put("id", id);
        call.resolve(result);
      } catch (Exception ex) {
        call.reject("Не удалось включить WAV: " + ex.getMessage());
      }
    });
  }

  @PluginMethod public void seekClip(PluginCall call) {
    SoundWorldClipPlaybackService service = SoundWorldClipPlaybackService.current();
    Long position=call.getLong("positionMs");
    String id=call.getString("id");
    if (service == null || id == null || position == null ||
        position < 0 || position > 120500) {
      call.reject("Настоящая WAV-запись недоступна для перемотки");return;
    }
    service.requestSeek(id, position, requested -> {
      if (requested) {
        JSObject result=new JSObject();
        result.put("requested", true);
        call.resolve(result);
      } else call.reject("WAV не воспроизводится или сменился фрагмент");
    });
  }

  @PluginMethod public void pauseClip(PluginCall call) {
    SoundWorldClipPlaybackService service = SoundWorldClipPlaybackService.current();
    if (service == null) {
      respondPlayback(call, "stopped", "");
      return;
    }
    service.requestPause();
    // Acknowledgment is a request; listener/status report the actual state.
    respondPlayback(call, "requested", service.playbackClipId());
  }

  @PluginMethod public void stopClip(PluginCall call) {
    SoundWorldClipPlaybackService service = SoundWorldClipPlaybackService.current();
    if (service != null) service.requestStop();
    respondPlayback(call, "requested", "");
  }

  @PluginMethod public void playbackStatus(PluginCall call) {
    SoundWorldClipPlaybackService service = SoundWorldClipPlaybackService.current();
    JSObject result = new JSObject();
    result.put("state", service == null ? "stopped" : service.playbackState());
    result.put("clipId", service == null ? "" : service.playbackClipId());
    result.put("lastError", service == null ? "" : service.playbackError());
    result.put("positionMs", service == null ? 0 : service.playbackPositionMs());
    result.put("durationMs", service == null ? 0 : service.playbackDurationMs());
    result.put("actualOutput", service == null ? "" : service.routedOutput());
    result.put("actualOutputType", service == null ? "" : service.routedOutputType());
    call.resolve(result);
  }

  @Override protected void handleOnDestroy() {
    // The saved music belongs to a foreground SERVICE, not this WebView.
    // Do not stop it when Android destroys/recreates the Activity.
    SoundWorldClipPlaybackService.clearListener(playbackObserver);
    playbackObserver = null;
    writer.execute(this::abortRecording);
    writer.shutdown();
    super.handleOnDestroy();
  }
}
