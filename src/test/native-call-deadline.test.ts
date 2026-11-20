import {describe,it,expect,vi} from "vitest";
import {withNativeDeadline,NativeCallDeadlineExceeded} from "../lib/sw/native-call-deadline";
describe("bounded native sensor bridge",()=>{
  it("returns an actual native result without changing it",async()=>{
    expect(await withNativeDeadline(async()=>({started:true}),100)).toEqual({started:true});
  });
  it("unblocks an indefinitely hung native callback",async()=>{
    vi.useFakeTimers();
    try{
      const pending=withNativeDeadline(()=>new Promise<boolean>(()=>{}),200);
      const assertion=expect(pending).rejects.toBeInstanceOf(NativeCallDeadlineExceeded);
      await vi.advanceTimersByTimeAsync(201);
      await assertion;
    }finally{vi.useRealTimers();}
  });
  it("preserves rejection and validates deadlines",async()=>{
    await expect(withNativeDeadline(async()=>{throw new Error("Android denied");},200))
      .rejects.toThrow("Android denied");
    await expect(withNativeDeadline(async()=>true,0)).rejects.toThrow(RangeError);
  });
});
