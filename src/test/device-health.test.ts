import {describe,it,expect} from "vitest";
import {deviceHealthAlerts,deviceHealthReadout,significantPlayerHealthAlerts,realYamnetPowerReadout} from "../lib/sw/device-health";

describe("real Android battery, memory and thermal diagnostics",()=>{
  it("shows actual YAMNet frequency only when capture AND inference are active",()=>{
    expect(realYamnetPowerReadout(null)).toContain("нет");
    expect(realYamnetPowerReadout({analysisActive:false,recording:true,analysisStride:3}))
      .toContain("не запущен");
    expect(realYamnetPowerReadout({analysisActive:true,recording:false,analysisStride:3}))
      .toContain("не запущен");
    expect(realYamnetPowerReadout({analysisActive:true,recording:true,analysisStride:1}))
      .toContain("каждое окно");
    expect(realYamnetPowerReadout({analysisActive:true,recording:true,analysisStride:3,inferenceThrottled:15}))
      .toContain("каждое 3-е окно");
    expect(realYamnetPowerReadout({analysisActive:true,recording:true,analysisStride:3,inferenceThrottled:15}))
      .toContain("15");
    expect(realYamnetPowerReadout({analysisActive:true,recording:true,analysisStride:0}))
      .toContain("не подтвердил");
  });
  it("shows only important real Android warnings directly in Player",()=>{
    expect(significantPlayerHealthAlerts(null)).toEqual([]);
    expect(significantPlayerHealthAlerts({thermalStatus:1,battery:90,lowMemory:false})).toEqual([]);
    expect(significantPlayerHealthAlerts({thermalStatus:2,battery:90})).toEqual([]);
    expect(significantPlayerHealthAlerts({thermalStatus:3,battery:90}).map(x=>x.id)).toEqual(["heat"]);
    expect(significantPlayerHealthAlerts({battery:4,lowMemory:true}).map(x=>x.id))
      .toEqual(["battery","memory"]);
    expect(significantPlayerHealthAlerts({thermalStatus:5,battery:10,lowMemory:true})
      .map(x=>x.severity)).toEqual(["critical","warning","warning"]);
  });
  it("reports real readings but never invents a temperature",()=>{
    expect(deviceHealthReadout({battery:87,ramMb:3490,thermalStatus:1}))
      .toBe("заряд 87% · свободная память 3490 МБ · тепловой статус Android 1");
    expect(deviceHealthAlerts({battery:87,ramMb:3490,thermalStatus:1})).toEqual([]);
    expect(deviceHealthReadout(null)).toBe("Android не предоставил показатели");
  });
  it("warns at Android severe and critical thermal levels independently of user battery mode",()=>{
    expect(deviceHealthAlerts({thermalStatus:2})[0]?.severity).toBe("notice");
    expect(deviceHealthAlerts({thermalStatus:3})[0]?.severity).toBe("warning");
    expect(deviceHealthAlerts({thermalStatus:4})[0]?.severity).toBe("critical");
    expect(deviceHealthAlerts({thermalStatus:6})[0]?.severity).toBe("critical");
    expect(deviceHealthAlerts({thermalStatus:7})).toEqual([]);
  });
  it("reports low charge and low memory, without treating missing data as danger",()=>{
    expect(deviceHealthAlerts({battery:15}).map(x=>x.id)).toEqual(["battery"]);
    expect(deviceHealthAlerts({battery:5})[0]?.severity).toBe("critical");
    expect(deviceHealthAlerts({battery:50,lowMemory:true})[0]?.id).toBe("memory");
    expect(deviceHealthAlerts({thermalStatus:3,battery:4,lowMemory:true}).map(x=>x.id))
      .toEqual(["heat","battery","memory"]);
    expect(deviceHealthAlerts({thermalStatus:NaN,battery:-1})).toEqual([]);
    expect(deviceHealthAlerts(null)).toEqual([]);
  });
});
