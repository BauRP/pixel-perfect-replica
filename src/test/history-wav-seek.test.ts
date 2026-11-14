import {describe,expect,it} from "vitest";
import {verifiedHistoryProgress,verifiedHistorySeek} from "../lib/sw/history-wav-seek";

describe("real Android WAV history slider",()=>{
  const reading={clipId:"first-real-wav",state:"playing",positionMs:28000,durationMs:120000};
  it("renders only measured position of the actively playing or paused clip",()=>{
    expect(verifiedHistoryProgress("first-real-wav",reading)?.percent).toBe(23);
    expect(verifiedHistoryProgress("other",reading)).toBeNull();
    expect(verifiedHistoryProgress("first-real-wav",{...reading,state:"stopped"})).toBeNull();
    expect(verifiedHistoryProgress("first-real-wav",{...reading,state:"preparing"})).toBeNull();
    expect(verifiedHistoryProgress("first-real-wav",{...reading,positionMs:NaN})).toBeNull();
    expect(verifiedHistoryProgress("first-real-wav",null)).toBeNull();
    expect(verifiedHistoryProgress("first-real-wav",{...reading,state:"paused"})?.positionMs).toBe(28000);
  });
  it("cannot seek another WAV or outside confirmed native duration",()=>{
    const p=verifiedHistoryProgress("first-real-wav",reading);
    expect(verifiedHistorySeek("first-real-wav","first-real-wav",40000,p)).toBe(40000);
    expect(verifiedHistorySeek("other","first-real-wav",40000,p)).toBeNull();
    expect(verifiedHistorySeek("first-real-wav","first-real-wav",120001,p)).toBeNull();
    expect(verifiedHistorySeek("first-real-wav","first-real-wav",-1,p)).toBeNull();
    expect(verifiedHistorySeek("first-real-wav","first-real-wav",Infinity,p)).toBeNull();
    expect(verifiedHistorySeek("first-real-wav","first-real-wav",100.5,p)).toBeNull();
    expect(verifiedHistorySeek("first-real-wav","first-real-wav",0,null)).toBeNull();
  });
});
