/**
 * Receives ONLY genuine locally generated audio (never microphone samples).
 * Producer must be explicitly authorized and backed by a running model.
 * AudioTrack output and WAV persistence are independent; disk failure
 * stops claiming to have stored a segment.
 */
import type { ClipMeta, Result } from "./engine";
import type { Settings } from "./settings";

export const PCM_BYTES_PER_SECOND = 48000 * 2 * 2;
export const PCM_SEGMENT_BYTES = PCM_BYTES_PER_SECOND * 120;
export const PCM_TRANSFER_BYTES = 48000; // quarter-second chunks (bridge size bound)

export type AudioSink = {
  append(chunk: Uint8Array): Promise<Result<"queued">>;
};
export type ClipStore = {
  begin(settings: Settings, genres: string[]): Promise<Result<string>>;
  append(id: string, chunk: Uint8Array): Promise<Result<number>>;
  finish(id: string): Promise<Result<ClipMeta>>;
  abort(id: string): Promise<void>;
};
type DispatchStatus = "idle" | "streaming" | "error" | "stopped";

export class GeneratedPcmSession {
  private state: DispatchStatus = "idle";
  private id: string | null = null;
  private bytes = 0;
  private chain: Promise<unknown> = Promise.resolve();
  private stopRequested = false;
  private lastFailure: string | null = null;
  private completed = 0;
  private pending = 0;
  private readonly maxPending = 8;
  private stopInFlight: Promise<Result<void>> | null = null;
  private readonly operationTimeoutMs = 12000;

  constructor(private readonly sink: AudioSink, private readonly store: ClipStore,
    private readonly settings: Settings, private readonly genres: string[]) {}

  get status() { return { state: this.state, bytesInCurrentClip: this.bytes,
    completedClips: this.completed, pendingPackets: this.pending, error: this.lastFailure }; }

  /**
   * Serialize every packet, preserving playback order and 120s WAV boundaries.
   * The returned Promise resolves only after actual queue/storage acknowledgement.
   */
  submit(pcm: Uint8Array): Promise<Result<number>> {
    if (this.stopRequested || this.state === "error") return Promise.resolve({
      ok:false, code:"UNAVAILABLE", message:"Поток остановлен",
    });
    if (!(pcm instanceof Uint8Array) || pcm.length === 0 || pcm.length % 4 !== 0 ||
      pcm.length > PCM_TRANSFER_BYTES * 16) {
      return Promise.resolve({ok:false,code:"ERROR",message:"Неверный PCM кадр"});
    }
    if (this.pending >= this.maxPending) return Promise.resolve({
      ok:false,code:"UNAVAILABLE",message:"Очередь генератора переполнена",
    });
    this.pending++;
    // Copy immediately so a model reusing its output buffer cannot corrupt queued samples.
    const owned = pcm.slice();
    const next = this.chain.then(()=>this.process(owned)).finally(()=>{this.pending--;});
    this.chain = next.then(()=>undefined,()=>undefined);
    return next;
  }

  /**
   * A hung native callback must not keep the producer queue occupied forever.
   * A timed-out write is treated as fatal; a late native completion is never
   * counted as a finished frame or used to resume playback.
   */
  private async bounded<T>(operation:Promise<Result<T>>):Promise<Result<T>> {
    let timer:ReturnType<typeof setTimeout>|undefined;
    const deadline=new Promise<Result<T>>(resolve=>{
      timer=setTimeout(()=>resolve({ok:false,code:"TIMEOUT",message:"Аудиомодуль не ответил вовремя"}),this.operationTimeoutMs);
    });
    try{return await Promise.race([operation,deadline]);}
    finally{if(timer!==undefined)clearTimeout(timer);}
  }

  private async openIfNeeded(): Promise<Result<void>> {
    if (this.id !== null) return {ok:true,value:undefined};
    const started = await this.bounded(this.store.begin(this.settings, this.genres));
    if (!started.ok) return started;
    this.id = started.value;
    this.bytes = 0;
    this.state = "streaming";
    return {ok:true,value:undefined};
  }

  private async finishIfOpen(): Promise<Result<void>> {
    if (this.id === null) return {ok:true,value:undefined};
    const id = this.id;
    if (this.bytes === 0) {
      await this.store.abort(id);
      this.id = null;
      return {ok:true,value:undefined};
    }
    const finished = await this.bounded(this.store.finish(id));
    if (!finished.ok) return finished;
    this.completed++;
    this.id = null;
    this.bytes = 0;
    return {ok:true,value:undefined};
  }

  private async process(pcm:Uint8Array):Promise<Result<number>> {
    if (this.state === "error") return {ok:false,code:"ERROR",message:this.lastFailure ?? "Ошибка потока"};
    let processed = 0;
    try {
      while(processed < pcm.length) {
        const opened = await this.openIfNeeded();
        if(!opened.ok) return this.fail(opened.message);
        const length = Math.min(PCM_TRANSFER_BYTES, pcm.length-processed, PCM_SEGMENT_BYTES-this.bytes);
        const part = pcm.subarray(processed,processed+length);
        // Output is queued before the persisted WAV bytes. Never claim audible here.
        const pushed = await this.bounded(this.sink.append(part));
        if(!pushed.ok) return this.fail(pushed.message);
        const written = await this.bounded(this.store.append(this.id!,part));
        if(!written.ok) return this.fail(written.message);
        this.bytes += length;
        processed += length;
        if(this.bytes === PCM_SEGMENT_BYTES) {
          const ended = await this.finishIfOpen();
          if(!ended.ok) return this.fail(ended.message);
        }
      }
      return {ok:true,value:processed};
    } catch(e) {
      return this.fail(e instanceof Error?e.message:"Ошибка передачи аудио");
    }
  }

  private async fail(message:string):Promise<Result<number>> {
    this.state = "error";
    this.lastFailure = message;
    const current = this.id;
    this.id = null;
    this.bytes = 0;
    if(current !== null) await this.store.abort(current).catch(()=>{});
    return {ok:false,code:"ERROR",message};
  }

  stop():Promise<Result<void>> {
    if(this.stopInFlight) return this.stopInFlight;
    this.stopRequested = true;
    this.stopInFlight=(async()=>{
      await this.chain;
      if(this.state === "error") return {ok:false,code:"ERROR",message:this.lastFailure??"Ошибка"};
      try {
        const result = await this.finishIfOpen();
        if(!result.ok) {this.state="error";this.lastFailure=result.message;return result;}
        this.state = "stopped";
        return {ok:true,value:undefined};
      }catch(e){
        this.state = "error";
        return {ok:false,code:"ERROR",message:e instanceof Error?e.message:"Ошибка завершения"};
      }
    })();
    return this.stopInFlight;
  }
}

/** Real-PCM-only handoff to Android native AudioTrack and 120-second WAV storage.
 * The caller must explicitly start an actual model and request the audio sink.
 * Creating this object does not open a microphone, play tones or create files.
 */
export function createNativeGeneratedPcmSession(settings:Settings,genres:string[]) {
  const outputPromise=import("./native-pcm");
  const libraryPromise=import("./native-music-library");
  const sink:AudioSink={
    append:async(bytes)=>{
      const x=await outputPromise;
      return x.appendRealPcm(bytes);
    },
  };
  const store:ClipStore={
    begin:async(s,g)=> (await libraryPromise).beginGenuineClip(s,g),
    append:async(id,bytes)=> (await libraryPromise).appendGenuineClipPcm(id,bytes),
    finish:async(id)=> (await libraryPromise).finishGenuineClip(id),
    abort:async(id)=> (await libraryPromise).abortGenuineClip(id),
  };
  return new GeneratedPcmSession(sink,store,settings,genres);
}
