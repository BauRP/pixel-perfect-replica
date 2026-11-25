import {describe,it,expect} from "vitest";
import {originalFermataPitch} from "../lib/sw/fermata-pitch";
describe("Fermata v1 percussion correction",()=>{
  it("corrects only the original percussion pitch, not melodic notes",()=>{
    expect(originalFermataPitch(9,37)).toBe(36);
    expect(originalFermataPitch(9,39)).toBe(38);
    expect(originalFermataPitch(0,60)).toBe(60);
    expect(()=>originalFermataPitch(9,0)).toThrow();
  });
});
