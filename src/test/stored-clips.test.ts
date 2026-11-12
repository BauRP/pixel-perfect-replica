import {describe,it,expect} from "vitest";
import {latestRealClip,previousRealClip,nextRealClip,mayEvictClip} from "../lib/sw/stored-clips";
import type {ClipMeta} from "../lib/sw/engine";
const mk=(id:string,createdAt:number,more:Partial<ClipMeta>={}):ClipMeta=>({
  id,createdAt,durationSec:120,genreIds:[],favorite:false,mood:0,speed:0,uri:"file:///data/user/0/kz.soundworld.ar/files/generated_music/"+id+".wav",...more,
});
const a="11111111-1111-4111-8111-111111111111";
const b="22222222-2222-4222-8222-222222222222";
describe("real saved recording selection",()=>{
  it("chooses newest genuinely completed recording",()=>{
    expect(latestRealClip([mk(a,100),mk(b,200)])?.id).toBe(b);
  });
  it("never selects a fabricated current ID or an incomplete recording",()=>{
    expect(latestRealClip([mk("current",300),{...mk(a,400),uri:""},mk(b,200)])?.id).toBe(b);
    expect(latestRealClip([mk(a,100,{durationSec:0})])).toBeNull();
  });
  it("previous selects the older recording, not the latest one",()=>{
    const c="33333333-3333-4333-8333-333333333333";
    const clips=[mk(b,200),mk(a,100),mk(c,300)];
    expect(previousRealClip(clips,c)?.id).toBe(b);
    expect(previousRealClip(clips,b)?.id).toBe(a);
    expect(previousRealClip(clips,a)).toBeNull();
    expect(previousRealClip(clips)?.id).toBe(b);
    expect(previousRealClip([mk(a,100)])).toBeNull();
  });
  it("next returns a newer real WAV, not an imaginary generated clip",()=>{
    const c="33333333-3333-4333-8333-333333333333";
    const clips=[mk(a,100),mk(c,300),mk(b,200)];
    expect(nextRealClip(clips,a)?.id).toBe(b);
    expect(nextRealClip(clips,b)?.id).toBe(c);
    expect(nextRealClip(clips,c)).toBeNull();
    expect(nextRealClip(clips)?.id).toBe(c);
    expect(nextRealClip([])).toBeNull();
    expect(nextRealClip([mk("----".padEnd(36,"-"),500),mk(b,200)])?.id).toBe(b);
  });
  it("does not evict exported, liked or recovered protected audio",()=>{
    expect(mayEvictClip(mk(a,100,{favorite:true}))).toBe(false);
    expect(mayEvictClip(mk(a,100,{exportedUri:"content://media/audio/1"}))).toBe(false);
    expect(mayEvictClip(mk(a,100,{recoveredProtected:true}))).toBe(false);
    expect(mayEvictClip(mk(a,100))).toBe(true);
    expect(mayEvictClip(mk(a,100),a)).toBe(false);
    expect(mayEvictClip(mk(b,200),a)).toBe(true);
  });
});
