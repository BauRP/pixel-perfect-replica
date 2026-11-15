import {describe,expect,it} from "vitest";
import {DEFAULT_SETTINGS,DIRECTOR_RULES} from "../lib/sw/settings";
import {directorLivePreview,BirdEvidenceGate,type DirectorEvidence} from "../lib/sw/director-live-preview";

const enabled=(...ids:string[])=>({...DEFAULT_SETTINGS,directorRules:DIRECTOR_RULES.map(x=>({
  id:x.id,enabled:ids.includes(x.id),
}))});
const empty:DirectorEvidence={ambient:null,step:null};
const state=(items:ReturnType<typeof directorLivePreview>,id:string)=>
  items.find(x=>x.id===id)?.state;

describe("Studio live director rule preview from real sensor events",()=>{
  it("never manufactures triggers when no native event arrives",()=>{
    const x=directorLivePreview(enabled("rain-soft","steps-drums"),empty,10000);
    expect(state(x,"rain-soft")).toBe("waiting");
    expect(state(x,"steps-drums")).toBe("waiting");
    expect(state(x,"transport-pads")).toBe("off");
  });
  it("only uses recent stable native signals and respects switches",()=>{
    const s=enabled("rain-soft","steps-drums","birds-melody");
    const evidence:DirectorEvidence={
      ambient:{at:10000,atmosphere:"rain",birdLabel:false},
      step:{at:11000,bpm:115},
    };
    expect(state(directorLivePreview(s,evidence,12000),"rain-soft")).toBe("detected");
    expect(state(directorLivePreview(s,evidence,12000),"steps-drums")).toBe("detected");
    expect(state(directorLivePreview(s,evidence,12000),"birds-melody")).toBe("waiting");
    expect(state(directorLivePreview(s,evidence,25001),"rain-soft")).toBe("waiting");
    expect(state(directorLivePreview(s,evidence,25001),"steps-drums")).toBe("waiting");
  });
  it("never treats wind or generic nature as confirmed birds",()=>{
    const s=enabled("birds-melody");
    expect(state(directorLivePreview(s,{ambient:{at:12000,atmosphere:"nature",birdLabel:false},step:null},12500),
      "birds-melody")).toBe("waiting");
    expect(state(directorLivePreview(s,{ambient:{at:12000,atmosphere:"nature",birdLabel:true},step:null},12500),
      "birds-melody")).toBe("detected");
  });
  it("privacy mode disables detection without altering user switches",()=>{
    const s={...enabled("rain-soft"),musicOnlyMode:true};
    expect(state(directorLivePreview(s,{ambient:{at:10000,atmosphere:"rain",birdLabel:false},step:null},10001),
      "rain-soft")).toBe("waiting");
    expect(s.directorRules.find(x=>x.id==="rain-soft")?.enabled).toBe(true);
  });
  it("rejects future, invalid and stale step events",()=>{
    const s=enabled("steps-drums");
    for(const step of [{at:13000,bpm:100},{at:9000,bpm:NaN},{at:9000,bpm:300},{at:3000,bpm:100}]) {
      expect(state(directorLivePreview(s,{ambient:null,step},10000),"steps-drums")).toBe("waiting");
    }
  });
});

describe("bird-only YAMNet proof",()=>{
  it("requires separate high-confidence bird windows, not wind",()=>{
    const gate=new BirdEvidenceGate();
    expect(gate.ingest("Wind",.9,1000)).toBe(false);
    expect(gate.ingest("Bird vocalization, bird call, bird song",.9,2000)).toBe(false);
    expect(gate.ingest("Birdsong",.9,2000)).toBe(false);
    expect(gate.ingest("Birdsong",.9,2200)).toBe(false);
    expect(gate.ingest("Birdsong",.9,3000)).toBe(true);
    expect(gate.isRecent(3001)).toBe(true);
    expect(gate.isRecent(14001)).toBe(false);
  });
  it("rejects noise, low confidence and long gaps",()=>{
    const gate=new BirdEvidenceGate();
    expect(gate.ingest("Window",.9,1000)).toBe(false);
    expect(gate.ingest("Birdsong",.1,2000)).toBe(false);
    expect(gate.ingest("Birdsong",.9,3000)).toBe(false);
    expect(gate.ingest("Wind",.9,4000)).toBe(false);
    // Unrelated labels can be among the top-five classes of the same
    // inference window. They must not erase the preceding bird window.
    expect(gate.ingest("Birdsong",.9,5000)).toBe(true);
    expect(gate.isRecent(5000)).toBe(true);
    gate.reset();
    expect(gate.ingest("Birdsong",.9,10000)).toBe(false);
    expect(gate.isRecent(10000)).toBe(false);
  });
});
