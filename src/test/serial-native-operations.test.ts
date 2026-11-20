import {describe,it,expect} from "vitest";
import { SerialNativeOperations } from "../lib/sw/serial-native-operations";

describe("Android sensor start/stop operation ordering",()=>{
  it("always executes stop after an in-flight start resolves",async()=>{
    const serial=new SerialNativeOperations();
    let release!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;});
    const seen:string[]=[];
    const start=serial.enqueue(async()=>{seen.push("start-enter");await gate;seen.push("start-exit");});
    const stop=serial.enqueue(async()=>{seen.push("stop");});
    expect(seen).toEqual([]);
    await Promise.resolve();
    expect(seen).toEqual(["start-enter"]);
    release();
    await Promise.all([start,stop]);
    expect(seen).toEqual(["start-enter","start-exit","stop"]);
  });
  it("keeps processing after a failed native operation",async()=>{
    const serial=new SerialNativeOperations();
    await expect(serial.enqueue(async()=>{throw Error("Android microphone error");})).rejects.toThrow();
    const finished=await serial.enqueue(async()=>42);
    expect(finished).toBe(42);
  });
});
