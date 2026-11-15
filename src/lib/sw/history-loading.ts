/**
 * WAV verification is real disk I/O. The Android plugin validates every
 * saved MediaStore copy using SHA-256, on a serial worker. 5 seconds is not
 * enough for 120s recordings, especially when many are stored.
 *
 * Do not claim history is empty while an initial scan is pending/failed.
 */
export type HistoryLoadPhase="loading"|"ready"|"error";
export const HISTORY_DISK_SCAN_TIMEOUT_MS=120_000;
export function historyIsEmpty(phase:HistoryLoadPhase,count:number):boolean {
  return phase==="ready" && Number.isSafeInteger(count) && count===0;
}
