/**
 * One-at-a-time lifecycle commands for Android sensors.
 * Cancellation is tracked separately by diagnosticEpoch; serial ordering
 * prevents a delayed native START from reopening a microphone after STOP.
 * Errors cannot permanently poison the chain. No timers or device access.
 */
export class SerialNativeOperations {
  private tail:Promise<void>=Promise.resolve();
  enqueue<T>(work:()=>Promise<T>):Promise<T> {
    const operation=this.tail.then(work,work);
    this.tail=operation.then(()=>undefined,()=>undefined);
    return operation;
  }
}
