/**
 * Symbolic conditioning header for the original haster/Fermata-0.2B-v1.
 * Grammar and enumerations are from the author's model card (tokenizer_v2).
 * This prepares exact TOKEN STRINGS, never invents token IDs, notes or sound.
 *
 * Only the original, hash-verified tokenizer_v2 may turn these strings into
 * numeric IDs. Until MNN inference and a licensed synth work, music is OFF.
 */
import type { MusicRequest } from "./music-preferences";

export type FermataGenre =
  "classical"|"popular"|"jazz"|"folk"|"electronic"|
  "soundtrack"|"world"|"religious"|"unknown";
export type FermataEnsemble =
  "solo"|"duo"|"band"|"chamber"|"orchestral"|"choir"|"other";
export type FermataMode =
  "major"|"minor"|"dorian"|"phrygian"|"lydian"|"mixolydian"|"none";
export type FermataHeader = Readonly<{
  tokens:readonly string[];
  text:string;
  genre:FermataGenre;
  ensemble:FermataEnsemble;
  programs:readonly number[];
  drums:boolean;
}>;
export type FermataHeaderResult =
  | {ok:true;value:FermataHeader}
  | {ok:false;reason:string};
export type HeaderInput = Readonly<{
  genre:FermataGenre;
  ensemble:FermataEnsemble;
  tempoBpm:number;
  keySignature:number;
  mode:FermataMode;
  numerator:number;
  denominator:2|4|8|16;
  programs:readonly number[];
  drums:boolean;
}>;

const VALID_GENRES:ReadonlySet<string>=new Set([
  "classical","popular","jazz","folk","electronic",
  "soundtrack","world","religious","unknown",
]);
const VALID_ENSEMBLES:ReadonlySet<string>=new Set([
  "solo","duo","band","chamber","orchestral","choir","other",
]);
const VALID_MODES:ReadonlySet<string>=new Set([
  "major","minor","dorian","phrygian","lydian","mixolydian","none",
]);
const validInt=(n:unknown,lo:number,hi:number):n is number=>
  typeof n==="number" && Number.isSafeInteger(n) && n>=lo && n<=hi;
// GM 52-55 are choir/synth voices. Instrumental-only SoundWorld must not
// quietly add a voice imitation even if the checkpoint supports it.
const VOICE_PROGRAMS=new Set([52,53,54,55]);

/** Explicit original Fermata header, with no guessed BPE IDs. */
export function createFermataHeader(input:HeaderInput):FermataHeaderResult {
  if(!VALID_GENRES.has(input.genre) || !VALID_ENSEMBLES.has(input.ensemble) ||
     input.ensemble==="choir" || !VALID_MODES.has(input.mode))
    return {ok:false,reason:"Недопустимый жанр, ансамбль или вокальная партия"};
  if(!validInt(input.tempoBpm,5,999) || !validInt(input.keySignature,-7,7) ||
     !validInt(input.numerator,1,32) || ![2,4,8,16].includes(input.denominator))
    return {ok:false,reason:"Неверный темп, тональность или размер Fermata"};
  if(!Array.isArray(input.programs) || input.programs.length>16 ||
     input.programs.some(p=>!validInt(p,0,127)||VOICE_PROGRAMS.has(p)) ||
     typeof input.drums!=="boolean")
    return {ok:false,reason:"Недопустимые инструменты или вокальная партия"};
  const programs=[...new Set(input.programs)];
  if(programs.length===0 && !input.drums)
    return {ok:false,reason:"Для инструментальной музыки нужна хотя бы одна партия"};
  const tokens=[
    "<BOS>",`<GENRE_${input.genre}>`,`<ENSEMBLE_${input.ensemble}>`,
    `<TEMPO_${input.tempoBpm}>`,`<KEY_${input.keySignature}:${input.mode}>`,
    `<METER_${input.numerator}/${input.denominator}>`,"<PLAN>",
    ...programs.map(p=>`<TRACK_${p}>`),
    ...(input.drums?["<DRUM_TRACK>"]:[]),"<PLAN_END>",
  ];
  return {ok:true,value:Object.freeze({
    tokens:Object.freeze(tokens),text:tokens.join(" "),
    genre:input.genre,ensemble:input.ensemble,
    programs:Object.freeze(programs),drums:input.drums,
  })};
}

/** Coarse genre mapping, NOT a claim that all 150 app genres are tokenized by
 * Fermata. The original checkpoint supports only the nine labels above. */
const COARSE_GENRE:Readonly<Record<string,FermataGenre>>={
  g01:"popular",g02:"electronic",g03:"popular",g04:"popular",
  g05:"popular",g06:"jazz",g07:"popular",g08:"classical",
  g09:"soundtrack",g10:"electronic",g11:"electronic",g12:"folk",
  g13:"world",g14:"world",g15:"world",
};

/** Explicit GM mappings only. An unmatched instrument (e.g. dombyra,
 * kobyz) must never be silently replaced with piano or violin. */
const GM_BY_ID:Readonly<Record<string,number|"drums">>={
  "i1-01":0,   // concert grand piano
  "i1-02":0,   // acoustic piano
  "i1-03":4,   // electric piano
  "i1-04":19,  // church organ
  "i1-05":6,   // harpsichord
  "i1-06":4,   // Rhodes / electric piano 1
  "i1-07":5,   // electric piano 2
  "i2-03":38,  // synth bass 1
  "i2-04":89,  // warm pad
  "i3-01":25,  // acoustic steel guitar
  "i3-02":27,  // clean electric guitar
  "i3-03":24,  // classical nylon guitar
  "i3-04":33,  // fingered electric bass
  "i4-01":40,  // violin
  "i4-02":41,  // viola
  "i4-03":42,  // cello
  "i4-04":43,  // double bass
  "i4-05":46,  // orchestral harp
  "i4-07":105, // banjo
  "i5-01":"drums",
  "i6-01":65,  // alto saxophone
  "i6-02":56,  // trumpet
  "i6-03":57,  // trombone
  "i6-04":60,  // French horn
  "i6-05":58,  // tuba
  "i6-06":73,  // flute
  "i6-07":71,  // clarinet
  "i6-08":68,  // oboe
  "i6-09":70,  // bassoon
  "i6-10":22,  // harmonica
  "i7-01":48,  // string ensemble
  "i7-03":47,  // timpani
  "i7-05":9,   // glockenspiel
  "i7-06":13,  // xylophone
  "i8-03":104, // sitar
  "i8-05":107, // koto
  "i8-07":106, // shamisen
  "i8-08":21,  // accordion
  "i8-09":109, // bagpipe
};
const DEFAULT_INSTRUMENTS:Readonly<Record<FermataGenre,readonly string[]>>={
  popular:["i1-01","i3-04","i5-01"],
  electronic:["i1-03","i3-04","i5-01"],
  jazz:["i1-01","i3-04","i5-01"],
  classical:["i1-01","i4-01","i4-03"],
  soundtrack:["i7-01","i4-03","i1-01"],
  // No authentic GM map for folk/ethnic instruments such as dombyra/kobyz.
  // Never substitute a piano/violin behind the user’s back.
  folk:[],
  world:[],
  religious:[],
  unknown:[],
};

/** Compiles actual app preferences into a VALID Fermata conditioning header.
 * Hard dislikes always win, including aliases sharing a GM program and
 * percussion sub-instruments. Soft dislikes remain last-resort options.
 * A favorite with no faithful GM mapping fails instead of faking its sound. */
export function buildFermataConditioning(request:Readonly<MusicRequest>,sequenceIndex=0):FermataHeaderResult {
  if(!Number.isSafeInteger(sequenceIndex)||sequenceIndex<0)
    return {ok:false,reason:"Некорректный номер композиции"};
  if(request.instrumental!==true)
    return {ok:false,reason:"SoundWorld AR запрещает вокальную генерацию"};
  if(!validInt(request.compositionBpm,5,999))
    return {ok:false,reason:"Темп не поддерживается Fermata"};
  const allowed=request.genreCandidates.filter(id=>/^g(0[1-9]|1[0-5])-s0[1-9]$/.test(id));
  const excluded=new Set(request.excludedGenres);
  const permitted=allowed.filter(id=>!excluded.has(id) && !excluded.has(id.slice(0,3)));
  if(permitted.length===0)return {ok:false,reason:"Все разрешённые направления исключены"};
  const weak=new Set(request.deemphasizedGenres);
  const emph=new Set(request.emphasizedGenres);
  const notWeak=permitted.filter(id=>!weak.has(id) && !weak.has(id.slice(0,3)));
  // Rotate distinct model-supported genre families, not every UI subgenre
  // with the same coarse token. Familiar keeps favorite/history priority.
  const pool=notWeak.length?notWeak:permitted;
  const ranked=[...pool.filter(id=>emph.has(id)),...pool.filter(id=>!emph.has(id))];
  const defaultsFor=(id:string):readonly string[]=>{
    if(id.startsWith("g12-"))return ["i3-01","i3-03","i4-07"];
    if(id==="g13-s04")return ["i8-05"]; // Japanese koto
    if(id==="g13-s08")return ["i8-03"]; // Indian sitar
    if(id==="g08-s06")return ["i1-01"]; // solo piano
    if(id.startsWith("g05-"))return ["i3-02","i3-04","i5-01"]; // rock
    if(id.startsWith("g10-"))return ["i2-04","i1-03"]; // ambient
    if(id==="g15-s02")return ["i3-03","i3-04","i5-01"]; // bossa nova
    if(id==="g15-s04")return ["i8-08"]; // tango accordion
    if(id==="g15-s05")return ["i3-03"]; // flamenco guitar
    return DEFAULT_INSTRUMENTS[COARSE_GENRE[id.slice(0,3)]!]??[];
  };
  const playable=request.preferredInstruments.length>0?ranked:
    ranked.filter(id=>defaultsFor(id).length>0);
  const distinct=playable.filter((id,i)=>playable.findIndex(other=>
    COARSE_GENRE[other.slice(0,3)]===COARSE_GENRE[id.slice(0,3)])===i);
  const preferred=request.diversity==="familiar"?playable[0]:
    distinct[sequenceIndex%Math.max(1,distinct.length)];
  if(!preferred)return {ok:false,reason:"Нет разрешённого жанра Fermata"};
  const genre=COARSE_GENRE[preferred.slice(0,3)];
  if(!genre)return {ok:false,reason:"Жанр не поддерживается оригинальной моделью"};

  const banned=new Set(request.excludedInstruments);
  const weakInstruments=new Set(request.deemphasizedInstruments);
  // A drum kit contains all percussion voices; excluding a single piece
  // makes the entire kit unavailable without a verified per-note filter.
  const drumsBanned=[...banned].some(id=>id==="i2-07"||id==="i7-04"||/^i5-(0[1-9]|1[01])$/.test(id));
  const bannedPrograms=new Set(
    [...banned].map(id=>GM_BY_ID[id]).filter((p):p is number=>typeof p==="number"),
  );
  if(banned.has("i2-01")||banned.has("i2-02")){
    bannedPrograms.add(38);bannedPrograms.add(89);
  }
  const explicit=request.preferredInstruments.length>0;
  const effects=new Set(request.directorEffects);
  let automatic=[...defaultsFor(preferred)];
  if(automatic.length>0) {
    if(effects.has("accent-step-percussion")&&!automatic.includes("i5-01"))
      automatic.push("i5-01");
    if(effects.has("soften-arrangement")||effects.has("sparser-arrangement"))
      automatic=automatic.filter(id=>id!=="i5-01"||effects.has("accent-step-percussion"));
    if(effects.has("brighter-melody")&&!automatic.includes("i6-06"))
      automatic.push("i6-06");
    if(effects.has("deeper-pads")&&!automatic.includes("i2-04"))
      automatic.push("i2-04"); // General MIDI warm pad
  }
  const ids=explicit?request.preferredInstruments:automatic;
  if(explicit && ids.some(id=>GM_BY_ID[id]===undefined))
    return {ok:false,reason:"Любимый инструмент не имеет подтверждённого соответствия General MIDI"};
  const permittedInstruments=ids.filter(id=>{
    const program=GM_BY_ID[id];
    if(program===undefined || banned.has(id))return false;
    if(program==="drums")return !drumsBanned;
    return !bannedPrograms.has(program);
  });
  // For automatic arrangements, avoid soft dislikes when possible, but
  // never treat them as hard bans.
  // For large favorite sets, use successive windows so no favorite is
  // permanently hidden behind the first six. Preserve hard exclusions.
  const offset=permittedInstruments.length>6?(sequenceIndex*6)%permittedInstruments.length:0;
  const rotated=[...permittedInstruments.slice(offset),...permittedInstruments.slice(0,offset)];
  const prioritized=explicit?rotated.slice(0,6):
    [...permittedInstruments.filter(id=>!weakInstruments.has(id)),
     ...permittedInstruments.filter(id=>weakInstruments.has(id))];
  const programs=[...new Set(prioritized
    .map(id=>GM_BY_ID[id]).filter((p):p is number=>typeof p==="number"))];
  const drums=prioritized.some(id=>GM_BY_ID[id]==="drums");
  if(programs.length===0 && !drums)
    return {ok:false,reason:"После исключений не осталось подтверждённых GM-инструментов"};
  const ensemble:FermataEnsemble=programs.length+(drums?1:0)===1?"solo":
    programs.length+(drums?1:0)===2?"duo":
    genre==="classical"?"chamber":genre==="soundtrack"?"orchestral":"band";
  // Mood shifts modal bias; no claim to choose the user's exact musical key.
  const mode:FermataMode=request.mood<0?"minor":request.mood>0?"major":"none";
  return createFermataHeader({
    genre,ensemble,tempoBpm:request.compositionBpm,keySignature:0,
    mode,numerator:4,denominator:4,programs,drums,
  });
}
