import {describe,it,expect} from "vitest";
import {DEFAULT_SETTINGS,migrateSettings} from "../lib/sw/settings";
import {sensorsAllowed,SENSOR_MODE_BLOCKED} from "../lib/sw/sensor-mode";
describe("music-only privacy gate",()=>{
  it("defaults to manual sensor permission, persists opt-out and restores it after reload",()=>{
    expect(sensorsAllowed(DEFAULT_SETTINGS)).toBe(true);
    expect(sensorsAllowed(migrateSettings({musicOnlyMode:true}))).toBe(false);
    expect(sensorsAllowed(migrateSettings({musicOnlyMode:false}))).toBe(true);
    expect(sensorsAllowed(migrateSettings({musicOnlyMode:"yes"}))).toBe(true);
    expect(SENSOR_MODE_BLOCKED).toContain("Без анализа окружения");
  });
});
