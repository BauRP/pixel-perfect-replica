import {describe,it,expect} from "vitest";
import {YamnetObservationLog} from "../lib/sw/yamnet-observation-log";

const event=(label:string,timestamp:number,confidence=.87)=>({
  label,timestamp,confidence,source:"phoneMic",
});
describe("actual YAMNet in-memory observations",()=>{
  it("shows only real callbacks during an explicit capture and never persists old events",()=>{
    const log=new YamnetObservationLog(3);
    expect(log.ingest(event("Rain",1001),1100)).toBeNull();
    log.start(1000);
    expect(log.ingest(event("Rain",1001),1100)?.[0]?.label).toBe("Rain");
    expect(log.ingest(event("Rain",1001),1120)).toBeNull();
    expect(log.ingest(event("Train",1002),1120)?.length).toBe(2);
    expect(log.ingest(event("Bird",1002),1130)?.length).toBe(3);
    expect(log.ingest(event("Thunder",1003),1140)?.map(x=>x.label)).toEqual(["Thunder","Bird","Train"]);
    log.stop();
    expect(log.snapshot()).toEqual([]);
    expect(log.ingest(event("Rain",1004),1200)).toBeNull();
    log.start(2000);
    expect(log.snapshot()).toEqual([]);
  });
  it("rejects impossible, delayed, invalid and invented scores",()=>{
    const log=new YamnetObservationLog();log.start(10000);
    expect(log.ingest(event("Rain",9000),10500)).toBeNull();
    expect(log.ingest(event("Rain",20000),10500)).toBeNull();
    expect(log.ingest({...event("Rain",10001),confidence:1.4},10500)).toBeNull();
    expect(log.ingest({...event("Rain",10001),confidence:NaN},10500)).toBeNull();
    expect(log.ingest({...event("Rain",10001),label:""},10500)).toBeNull();
    expect(log.ingest(event("Rain",10001),10500)).not.toBeNull();
    expect(log.ingest(event("Train",10000),10500)).toBeNull();
    expect(log.snapshot()).toHaveLength(1);
  });
});
