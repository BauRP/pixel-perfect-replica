/** Safe native event registration for Capacitor plugins.
 *
 * A registration can reject if Android has destroyed the bridge, and may
 * resolve after React has unmounted. Neither outcome may leak an unhandled
 * Promise rejection or a listener attached to a dead screen.
 */
export type RemovableNativeListener = { remove(): Promise<void> };

export function manageNativeListener(register: () => Promise<RemovableNativeListener>): () => void {
  let disposed = false;
  let live: RemovableNativeListener | null = null;
  const remove = (handle: RemovableNativeListener) => {
    try { void Promise.resolve(handle.remove()).catch(() => {}); }
    catch { /* bridge may already be destroyed */ }
  };
  try {
    void register().then(
      (handle) => {
        if (disposed) remove(handle);
        else live = handle;
      },
      () => { /* native listener unavailable: no unhandled rejection */ },
    );
  } catch {
    // A synchronously unavailable bridge must also be safe.
  }
  return () => {
    if (disposed) return;
    disposed = true;
    if (live) remove(live);
    live = null;
  };
}
