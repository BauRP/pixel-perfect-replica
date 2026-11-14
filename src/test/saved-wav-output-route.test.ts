import {describe,expect,it} from "vitest";
import {androidOutputKind,describeSavedWavRoute} from "../lib/sw/saved-wav-output-route";

describe("real Android saved WAV output route",()=>{
  it("maps actual AudioDeviceInfo types, never the requested microphone",()=>{
    expect(androidOutputKind("2")).toBe("Динамик телефона");
    expect(androidOutputKind("3")).toBe("Проводные наушники");
    expect(androidOutputKind("8")).toBe("Bluetooth");
    expect(androidOutputKind("26")).toBe("Bluetooth");
    expect(androidOutputKind("22")).toBe("USB-аудиоустройство");
    expect(androidOutputKind("29")).toBe("HDMI-аудиоустройство");
    expect(androidOutputKind("20")).toBe("Другое аудиоустройство Android");
    expect(androidOutputKind("")).toBeNull();
    expect(androidOutputKind("0")).toBeNull();
    expect(androidOutputKind("8; Bluetooth MyName")).toBeNull();
    expect(androidOutputKind("1000")).toBeNull();
    expect(androidOutputKind(NaN)).toBeNull();
  });
  it("does not invent a route when service stopped, unprepared or offline",()=>{
    expect(describeSavedWavRoute(null)).toContain("Нет данных");
    expect(describeSavedWavRoute({state:"stopped",actualOutputType:"8"}))
      .toBe("Сохранённый WAV не воспроизводится");
    expect(describeSavedWavRoute({state:"preparing",actualOutputType:"8"}))
      .toContain("подготавливает");
    expect(describeSavedWavRoute({state:"playing"}))
      .toContain("не подтверждён");
    expect(describeSavedWavRoute({state:"UNKNOWN",actualOutputType:"2"}))
      .toContain("не подтвердил состояние");
  });
  it("distinguishes paused and playing without exposing Bluetooth device names",()=>{
    const playing=describeSavedWavRoute({
      state:"playing",actualOutputType:"8",
      actualOutput:"SENSITIVE-HEADSET" 
    } as {state:"playing";actualOutputType:string});
    expect(playing).toBe("WAV воспроизводится через: Bluetooth");
    expect(playing).not.toContain("SENSITIVE-HEADSET");
    expect(describeSavedWavRoute({state:"paused",actualOutputType:"3"}))
      .toBe("WAV на паузе · последний подтверждённый выход: Проводные наушники");
  });
});
