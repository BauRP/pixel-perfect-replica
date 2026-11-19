import {describe,it,expect} from "vitest";
import { SoundRouteFence } from "../lib/sw/sound-route-fence";

describe("real microphone-route generations in YAMNet observations",()=>{
  it("isolates two different microphones of the same source category",()=>{
    const gate=new SoundRouteFence();
    expect(gate.observe({source:"headsetMic",routeGeneration:2})).toBe("first");
    expect(gate.observe({source:"headsetMic",routeGeneration:2})).toBe("same");
    expect(gate.observe({source:"headsetMic",routeGeneration:3})).toBe("changed");
    expect(gate.observe({source:"headsetMic",routeGeneration:2})).toBe("stale");
    expect(gate.observe({source:"headsetMic",routeGeneration:3})).toBe("same");
  });
  it("handles phone-to-Bluetooth transitions and ignores late callbacks",()=>{
    const gate=new SoundRouteFence();
    expect(gate.observe({source:"phoneMic",routeGeneration:10})).toBe("first");
    expect(gate.observe({source:"bluetoothMic",routeGeneration:11})).toBe("changed");
    expect(gate.observe({source:"phoneMic",routeGeneration:10})).toBe("stale");
    gate.reset();
    expect(gate.observe({source:"phoneMic",routeGeneration:14})).toBe("first");
  });
  it("rejects impossible generations and supports earlier Android metadata",()=>{
    const gate=new SoundRouteFence();
    expect(gate.observe({source:"phoneMic",routeGeneration:NaN})).toBe("stale");
    expect(gate.observe({source:"phoneMic",routeGeneration:-1})).toBe("stale");
    expect(gate.observe({source:"phoneMic"})).toBe("first");
    expect(gate.observe({source:"headsetMic"})).toBe("changed");
    expect(gate.observe({source:"headsetMic"})).toBe("same");
  });
});
