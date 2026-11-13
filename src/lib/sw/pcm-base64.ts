/**
 * Convert genuine 16-bit PCM bytes to the Android Capacitor bridge format.
 * Chunked String.fromCharCode avoids constructing a new JavaScript string by
 * appending one character at a time for every 48 kHz stereo audio packet.
 * Never modify, resample or synthesize any audio data here.
 */
export function pcmToBase64(bytes: Uint8Array): string {
  const strings: string[] = [];
  // Keep call argument counts comfortably below older Android WebView limits.
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    strings.push(String.fromCharCode(...bytes.subarray(i, i + chunkSize)));
  }
  return btoa(strings.join(""));
}
