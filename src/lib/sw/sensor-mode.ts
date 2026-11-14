/**
 * Privacy gate for "Без анализа окружения".
 * OFF means no automatic YAMNet microphone capture or step monitoring.
 * Explicit permission requests and diagnostics must also respect this gate.
 * This does not pretend that an offline music engine is installed.
 */
import type {Settings} from "./settings";
export const sensorsAllowed = (settings:Pick<Settings,"musicOnlyMode">):boolean =>
  settings.musicOnlyMode !== true;

export const SENSOR_MODE_BLOCKED =
  "Включён режим «Без анализа окружения». Отключите его в Настройках для проверки микрофона и шагов.";
