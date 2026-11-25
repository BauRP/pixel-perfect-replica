/**
 * Connects real music preferences and the live director to a FUTURE local
 * Fermata/MNN adapter. No network, microphone access, fake notes or PCM.
 * The real generator is injected explicitly; without it, nothing plays.
 */
import type { RealScoreSource } from "./continuous-midi-scores";
import type { Settings } from "./settings";
import type { ClipMeta } from "./engine";
import type { ControlPlan } from "./music-control";
import { buildMusicRequest, type MusicRequest } from "./music-preferences";
import { validateDecodedMidiScore } from "./decoded-midi-score";
import { buildFermataConditioning, type FermataHeader } from "./fermata-conditioning";

export interface LicensedLocalMidiGenerator {
  /** The original REMI+ header strings, not guessed tokenizer IDs. */
  generate(request:Readonly<MusicRequest>,signal:AbortSignal,
    conditioning:Readonly<FermataHeader>):Promise<unknown|null>;
}
export interface LiveMusicRequestInputs {
  currentSettings():Settings;
  currentPlan():ControlPlan;
  currentFavorites():ClipMeta[];
  /** Changed on any settings or confirmed sensor-plan update. */
  revision():number;
}
export class AdaptiveMidiSource implements RealScoreSource {
  constructor(private readonly generator:LicensedLocalMidiGenerator,
    private readonly inputs:LiveMusicRequestInputs,
    private readonly maxWaitMs=120_000) {}

  async next(signal?:AbortSignal):Promise<unknown|null>{
    const revision=this.inputs.revision();
    if(!Number.isSafeInteger(revision)||revision<0)
      throw new Error("Неверная версия настроек музыкального генератора");
    if(signal?.aborted)throw new Error("Музыкальная генерация остановлена");
    const request=buildMusicRequest(this.inputs.currentSettings(),
      this.inputs.currentPlan(),this.inputs.currentFavorites());
    // Parent groups are only UI categories. At least one REAL selectable
    // subgenre must survive hard exclusions; never override user blocks.
    if(!request.genreCandidates.some(id=>/^g\d{2}-s\d{2}$/.test(id)))
      throw new Error("Все выбранные музыкальные направления исключены");
    const conditioning=buildFermataConditioning(request);
    if(!conditioning.ok)
      throw new Error("Fermata: "+conditioning.reason);
    if(!Number.isSafeInteger(this.maxWaitMs)||this.maxWaitMs<1000||
       this.maxWaitMs>300_000)
      throw new Error("Некорректный предел ожидания музыкальной модели");
    const frozen:Readonly<MusicRequest>=Object.freeze({
      ...request,
      genreCandidates:Object.freeze([...request.genreCandidates]) as unknown as string[],
      emphasizedGenres:Object.freeze([...request.emphasizedGenres]) as unknown as string[],
      excludedGenres:Object.freeze([...request.excludedGenres]) as unknown as string[],
      deemphasizedGenres:Object.freeze([...request.deemphasizedGenres]) as unknown as string[],
      preferredInstruments:Object.freeze([...request.preferredInstruments]) as unknown as string[],
      excludedInstruments:Object.freeze([...request.excludedInstruments]) as unknown as string[],
      deemphasizedInstruments:Object.freeze([...request.deemphasizedInstruments]) as unknown as string[],
      directorEffects:Object.freeze([...request.directorEffects]) as unknown as string[],
    });
    const controller=new AbortController();
    let timedOut=false;
    let settingsChanged=false;
    let timeout:ReturnType<typeof setTimeout>|undefined;
    let revisionTimer:ReturnType<typeof setInterval>|undefined;
    let rejectWait:((error:Error)=>void)|undefined;
    const guard=new Promise<never>((_,reject)=>{rejectWait=reject;});
    const cancel=(message:string)=>{
      controller.abort();
      rejectWait?.(new Error(message));
    };
    const abort=()=>cancel("Музыкальная генерация остановлена");
    signal?.addEventListener("abort",abort,{once:true});
    if(signal?.aborted)abort();
    try {
      timeout=setTimeout(()=>{
        timedOut=true;
        cancel("Музыкальная модель не ответила за установленное время");
      },this.maxWaitMs);
      revisionTimer=setInterval(()=>{
        if(this.inputs.revision()!==revision){
          settingsChanged=true;
          cancel("Настройки изменились во время генерации: старый результат отклонён");
        }
      },250);
      const value=await Promise.race([
        Promise.resolve().then(()=>{
          if(controller.signal.aborted)return null;
          return this.generator.generate(frozen,controller.signal,conditioning.value);
        }),
        guard,
      ]);
      if(signal?.aborted)throw new Error("Музыкальная генерация остановлена");
      if(timedOut)throw new Error("Музыкальная модель не ответила за установленное время");
      if(settingsChanged || this.inputs.revision()!==revision)
        throw new Error("Настройки изменились во время генерации: старый результат отклонён");
      if(value===null)return null;
      const checked=validateDecodedMidiScore(value);
      if(!checked.ok)throw new Error("Генератор вернул неправильную партитуру: "+checked.reason);
      return checked.value;
    }finally {
      if(timeout!==undefined)clearTimeout(timeout);
      if(revisionTimer!==undefined)clearInterval(revisionTimer);
      signal?.removeEventListener("abort",abort);
      controller.abort();
    }
  }
}
