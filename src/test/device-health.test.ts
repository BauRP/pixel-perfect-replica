import {describe,it,expect} from "vitest";
import {deviceHealthAlerts,deviceHealthReadout} from "../lib/sw/device-health";

describe("real Android battery, memory and thermal diagnostics",()=>{
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
    expect(deviceHealthAlerts({thermalStatus:NaN,battery:-1,ramMb:undefined})).toEqual([]);
    expect(deviceHealthAlerts(null)).toEqual([]);
  });
});
