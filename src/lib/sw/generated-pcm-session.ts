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

  constructor(private readonly sink: AudioSink, private readonly store: ClipStore,
    private readonly settings: Settings, private readonly genres: string[]) {}

  get status() { return { state: this.state, bytesInCurrentClip: this.bytes,
    completedClips: this.completed, error: this.lastFailure }; }

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
    // Copy immediately so a model reusing its output buffer cannot corrupt queued samples.
    const owned = pcm.slice();
    const next = this.chain.then(()=>this.process(owned));
    this.chain = next.then(()=>undefined,()=>undefined);
    return next;
  }

  private async openIfNeeded(): Promise<Result<void>> {
    if (this.id !== null) return {ok:true,value:undefined};
    const started = await this.store.begin(this.settings, this.genres);
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
    const finished = await this.store.finish(id);
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
        const pushed = await this.sink.append(part);
        if(!pushed.ok) return this.fail(pushed.message);
        const written = await this.store.append(this.id!,part);
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

  async stop():Promise<Result<void>> {
    this.stopRequested = true;
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
  }
}
