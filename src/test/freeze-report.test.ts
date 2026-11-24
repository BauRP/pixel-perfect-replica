import { describe, it, expect } from "vitest";
import { buildSupportReport } from "../lib/sw/freeze-report";

describe("locally saved Android freeze evidence",()=>{
  const snapshot="Свободная RAM (МБ): 1234";
  it("formats bounded watchdog evidence alongside safe sensor metrics",()=>{
    const report=buildSupportReport({
      report:"SoundWorld AR: webview-heartbeat-stall\\nLast screen: studio",
      recordedAt:1700000000000,jsIssue:"javascript-error",jsIssueAt:1700000001000,
    },snapshot);
    expect(report).toContain("webview-heartbeat-stall");
    expect(report).toContain("studio");
    expect(report).toContain("Ошибка JavaScript");
    expect(report).toContain(snapshot);
    expect(report).toContain("не является полным системным Logcat");
  });
  it("does not manufacture an actual freeze when none was captured",()=>{
    const report=buildSupportReport(null,snapshot);
    expect(report).toContain("Автоматически обнаруженных зависаний пока нет");
    expect(report).toContain("Дата последнего обнаруженного зависания: нет");
  });
  it("limits report size and rejects unknown JS categories",()=>{
    const report=buildSupportReport({
      report:"a".repeat(18000),recordedAt:0,
      jsIssue:"SECRET TOKEN",jsIssueAt:0,
    },snapshot);
    expect(report.length).toBeLessThanOrEqual(11000);
    expect(report).not.toContain("SECRET TOKEN");
  });
});
