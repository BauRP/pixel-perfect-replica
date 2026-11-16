import { describe, expect, it, vi } from "vitest";
import { manageNativeListener } from "../lib/sw/native-listener";

describe("native listeners survive bridge teardown", () => {
  it("swallows native registration rejection without leaving listeners attached", async () => {
    const remove = vi.fn(async () => {});
    const unsubscribe = manageNativeListener(() => Promise.reject(new Error("Bridge destroyed")));
    unsubscribe();
    unsubscribe();
    await Promise.resolve();
    expect(remove).not.toHaveBeenCalled();
  });

  it("removes an already registered listener exactly once", async () => {
    const remove = vi.fn(async () => {});
    const unsubscribe = manageNativeListener(() => Promise.resolve({ remove }));
    await Promise.resolve();
    unsubscribe();
    unsubscribe();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("removes a listener that attaches only after unmount", async () => {
    const remove = vi.fn(async () => {});
    let resolve!: (handle: { remove(): Promise<void> }) => void;
    const pending = new Promise<{ remove(): Promise<void> }>(r => { resolve = r; });
    const unsubscribe = manageNativeListener(() => pending);
    unsubscribe();
    resolve({ remove });
    await Promise.resolve();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("does not throw when an Android plugin fails synchronously", () => {
    const unsubscribe = manageNativeListener(() => { throw new Error("Plugin unavailable"); });
    expect(() => unsubscribe()).not.toThrow();
  });

  it("does not throw if Android remove rejects or throws", async () => {
    const unsubscribe = manageNativeListener(() => Promise.resolve({
      remove: async () => { throw new Error("Already destroyed"); },
    }));
    await Promise.resolve();
    expect(() => unsubscribe()).not.toThrow();
  });
});
