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

export interface LicensedLocalMidiGenerator {
  generate(request:Readonly<MusicRequest>,signal:AbortSignal):Promise<unknown|null>;
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
    private readonly inputs:LiveMusicRequestInputs) {}

  async next(signal?:AbortSignal):Promise<unknown|null>{
    const revision=this.inputs.revision();
    if(!Number.isSafeInteger(revision)||revision<0)
      throw new Error("Неверная версия настроек музыкального генератора");
    if(signal?.aborted)throw new Error("Музыкальная генерация остановлена");
    const request=buildMusicRequest(this.inputs.currentSettings(),
      this.inputs.currentPlan(),this.inputs.currentFavorites());
    // Parent groups are only UI categories. At least one REAL selectable
    // subgenre must survive hard exclusions; never override user blocks.
    if(!request.genreCandidates.some(id=>/^g\\d{2}-s\\d{2}$/.test(id)))
      throw new Error("Все выбранные музыкальные направления исключены");
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
    let cancel:()=>void=()=>undefined;
    const aborted=new Promise<never>((_,reject)=>{
      cancel=()=>{controller.abort();reject(new Error("Музыкальная генерация остановлена"));};
      signal?.addEventListener("abort",cancel,{once:true});
      if(signal?.aborted)cancel();
    });
    try {
      const value=await Promise.race([this.generator.generate(frozen,controller.signal),aborted]);
      if(signal?.aborted)throw new Error("Музыкальная генерация остановлена");
      if(this.inputs.revision()!==revision)
        throw new Error("Настройки изменились во время генерации: старый результат отклонён");
      if(value===null)return null;
      const checked=validateDecodedMidiScore(value);
      if(!checked.ok)throw new Error("Генератор вернул неправильную партитуру: "+checked.reason);
      return checked.value;
    } finally {
      signal?.removeEventListener("abort",cancel);
    }
  }
}
