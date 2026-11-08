package kz.soundworld.ar;

import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
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

  private File directory() {
    File dir = new File(getContext().getFilesDir(), "generated_music");
    if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("Не удалось создать папку музыки");
    return dir;
  }
  private boolean validId(String id) { return id != null && id.matches("[0-9a-f\\-]{36}"); }
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
      if(!clip.optBoolean("favorite") && !clip.has("exportedUri")) temporaryCount++;
    }
    for(int i=0;i<index.length() && temporaryCount>3;) {
      JSONObject clip=index.getJSONObject(i);
      if (!clip.optBoolean("favorite") && !clip.has("exportedUri")) {
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

  @PluginMethod public void list(PluginCall call) {
    String filter=call.getString("filter","recent");
    writer.execute(() -> {
      try {
        JSONArray source=loadIndex();
        JSONArray output=new JSONArray();
        int start="recent".equals(filter)?Math.max(0,source.length()-3):0;
        for(int i=start;i<source.length();i++) {
          JSONObject item=source.getJSONObject(i);
          if(!clipFile(item.getString("id")).isFile()) continue;
          if("favorites".equals(filter) && !item.optBoolean("favorite")) continue;
          if("exports".equals(filter) && !item.has("exportedUri")) continue;
          output.put(item);
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
        if(!file.isFile() || file.length()<=44)throw new IOException("Реальный WAV отсутствует");
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
            if(entry.optBoolean("favorite") || entry.has("exportedUri")) {
              call.reject("Избранные и сохранённые записи не удаляются автоматически");return;
            }
            // Persist index before deleting file to avoid creating a broken entry.
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
        for(int i=0;i<index.length();i++) {
          JSONObject item=index.getJSONObject(i);
          if(clipFile(item.getString("id")).isFile()) valid.put(item);
        }
        if(valid.length()!=index.length())saveIndex(valid);
        JSObject r=new JSObject();r.put("recovered",valid.length());call.resolve(r);
      }catch(Exception ex){call.reject("Ошибка восстановления: "+ex.getMessage());}
    });
  }

  @Override protected void handleOnDestroy() {
    writer.execute(this::abortRecording);
    writer.shutdown();
    super.handleOnDestroy();
  }
}
