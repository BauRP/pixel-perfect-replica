/**
 * Actual Android MediaPlayer route for a genuinely saved WAV.
 * Android AudioDeviceInfo.getType() is returned as a numeric string.
 * Never infer output from user preferences, the selected input microphone,
 * or a connected but currently unused Bluetooth device.
 * Product names, addresses, MACs and IDs are deliberately not exposed.
 */
export type WavRouteSnapshot = Readonly<{
  state?: "playing"|"paused"|"preparing"|"stopped" | string;
  actualOutputType?: string | number;
}>;

export function androidOutputKind(type: unknown): string | null {
  if (typeof type !== "string" && typeof type !== "number") return null;
  const value = String(type);
  if (!/^(?:[1-9]|[12]\d|30)$/.test(value)) return null;
  switch (Number(value)) {
    case 1: return "Разговорный динамик телефона";
    case 2:
    case 24: return "Динамик телефона";
    case 3:
    case 4: return "Проводные наушники";
    case 7:
    case 8:
    case 26:
    case 27:
    case 30: return "Bluetooth";
    case 11:
    case 12:
    case 22: return "USB-аудиоустройство";
    case 9:
    case 10:
    case 29: return "HDMI-аудиоустройство";
    default: return "Другое аудиоустройство Android";
  }
}

export function describeSavedWavRoute(
  snapshot: WavRouteSnapshot | null | undefined,
): string {
  if (!snapshot) return "Нет данных о воспроизведении Android";
  if (snapshot.state === "stopped") return "Сохранённый WAV не воспроизводится";
  if (snapshot.state === "preparing") return "Android подготавливает воспроизведение WAV";
  if (snapshot.state !== "playing" && snapshot.state !== "paused")
    return "Android не подтвердил состояние воспроизведения";
  const route = androidOutputKind(snapshot.actualOutputType);
  if (!route) return snapshot.state === "paused"
    ? "WAV на паузе · маршрут Android не подтверждён"
    : "WAV воспроизводится · маршрут Android не подтверждён";
  return snapshot.state === "paused"
    ? "WAV на паузе · последний подтверждённый выход: " + route
    : "WAV воспроизводится через: " + route;
}
