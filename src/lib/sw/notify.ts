import { toast } from "sonner";
import type { Result } from "./engine";

/** Distinct notification kinds required by spec. Never claim "saved" before a real file exists. */
export const notify = {
  queued: (m: string) => toast(m, { description: "Команда принята в очередь" }),
  saved: (m: string) => toast.success(m),
  notIntegrated: (m: string) => toast(m, { description: "Функция появится после подключения нативного модуля", icon: "⏳" }),
  permission: (m: string) => toast.warning(m, { description: "Нужно разрешение" }),
  audioUnavailable: (m: string) => toast.warning(m, { description: "Аудио недоступно" }),
  error: (m: string) => toast.error(m),
  result: (r: Result<unknown>, okMsg: string) => {
    if (r.ok) return notify.queued(okMsg);
    if (r.code === "UNAVAILABLE" || r.code === "NOT_IMPLEMENTED") return notify.notIntegrated(r.message);
    if (r.code === "PERMISSION_DENIED") return notify.permission(r.message);
    return notify.error(r.message);
  },
};
