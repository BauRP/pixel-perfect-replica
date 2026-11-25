import {describe,it,expect} from "vitest";
import {explainFermataAvailability,parseFermataPackageStatus} from "../lib/sw/fermata-native";

const status={
  model:"haster/Fermata-0.2B-v1",runtime:"Alibaba/MNN",
  manifestPresent:true,modelPackaged:true,tokenizerPackaged:true,
  mnnPackaged:true,synthPackaged:true,soundbankPackaged:true,
  licenseEvidencePackaged:true,packageComplete:true,arm64Supported:true,
  generationReady:true,
};

describe("real Fermata package gate (no invented music)",()=>{
  it("rejects missing or mismatched model metadata",()=>{
    expect(parseFermataPackageStatus(null)).toBeNull();
    expect(parseFermataPackageStatus({...status,model:"fake-model"})).toBeNull();
    expect(parseFermataPackageStatus({...status,tokenizerPackaged:"yes"})).toBeNull();
  });
  it("never reports generation ready just because the APK has model files",()=>{
    const parsed=parseFermataPackageStatus(status);
    expect(parsed).not.toBeNull();
    expect(parsed?.packageComplete).toBe(true);
    expect(parsed?.generationReady).toBe(false);
    expect(explainFermataAvailability(parsed)).toContain("ещё не подключены");
  });
  it("distinguishes absent and incomplete packages without asking for network",()=>{
    const base=parseFermataPackageStatus(status)!;
    expect(explainFermataAvailability(null)).toContain("не подключены");
    expect(explainFermataAvailability({...base,manifestPresent:false})).toContain("не входят в APK");
    expect(explainFermataAvailability({...base,packageComplete:false})).toContain("неполный");
    expect(explainFermataAvailability({...base,arm64Supported:false})).toContain("ARM64");
  });
});
