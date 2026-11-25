import {describe,it,expect} from "vitest";
import {buildSafeDiagnosticsReport,copySafeDiagnosticsReport} from "../lib/sw/safe-diagnostics-report";

describe("offline diagnostic report without sensitive data",()=>{
  it("includes measured counters but never unknown extra fields",()=>{
    const report=buildSafeDiagnosticsReport({
      android:true,musicOnly:false,active:true,stepsOnly:true,stepCount:37,
      sensors:{stepsSupported:true,stepsActive:true,activityGranted:true,captureRateHz:48000},
      performance:{battery:10,ramMb:2500,thermalStatus:4,analysisActive:true,analysisStride:3},
      wav:{state:"playing",id:"SECRET-ID",actualOutput:"PRIVATE-HEADSET"} as {state:"playing"},
    });
    expect(report).toContain("Шагов за проверку: 37");
    expect(report).toContain("Шагомер Android запущен: да");
    expect(report).toContain("Разрешение активности: да");
    expect(report).toContain("Анализ YAMNet запущен: да");
    expect(report).toContain("Частота проверки YAMNet, каждое N-е окно: 3");
    expect(report).toContain("Заряд (%): 10");
    expect(report).toContain("Тепловой статус (0–6): 4");
    expect(report).not.toContain("SECRET-ID");
    expect(report).not.toContain("PRIVATE-HEADSET");
  });
  it("does not fabricate missing or corrupted measurements",()=>{
    const report=buildSafeDiagnosticsReport({
      android:false,musicOnly:true,active:false,stepsOnly:false,stepCount:null,
      performance:{battery:150,ramMb:-1,thermalStatus:NaN},
    });
    expect(report).toContain("Шагов за проверку: нет данных");
    expect(report).toContain("Разрешение активности: нет данных");
    expect(report).toContain("Шагомер Android запущен: нет данных");
    expect(report).toContain("Анализ YAMNet запущен: нет данных");
    expect(report).toContain("Заряд (%): нет данных");
    expect(report).toContain("Fermata/MNN: не подключена");
  });
  it("copies only after actual confirmation or a successful fallback",async()=>{
    const copied:string[]=[];
    expect(await copySafeDiagnosticsReport("safe",{clipboard:{
      async writeText(s){copied.push(s);}
    }})).toBe(true);
    expect(copied).toEqual(["safe"]);
    expect(await copySafeDiagnosticsReport("safe",{clipboard:{
      async writeText(){throw new Error("permission denied");}
    },fallback:()=>true})).toBe(true);
    expect(await copySafeDiagnosticsReport("safe",{clipboard:null,fallback:()=>false})).toBe(false);
    expect(await copySafeDiagnosticsReport("",{clipboard:null,fallback:()=>true})).toBe(false);
  });
});
