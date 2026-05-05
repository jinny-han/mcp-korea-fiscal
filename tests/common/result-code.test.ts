import { describe, it, expect } from "vitest";
import { classifyResultCode } from "../../src/common/result-code.js";

describe("classifyResultCode", () => {
  it("INFO-000 is ok, not empty, not retryable", () => {
    expect(classifyResultCode("INFO-000")).toEqual({
      ok: true,
      empty: false,
      retryable: false,
    });
  });

  it("INFO-200 is ok and marked empty (no data, not error)", () => {
    expect(classifyResultCode("INFO-200")).toEqual({
      ok: true,
      empty: true,
      retryable: false,
    });
  });

  it("INFO-300 (admin-restricted key) is non-ok, non-retryable", () => {
    const r = classifyResultCode("INFO-300");
    expect(r.ok).toBe(false);
    expect(r.retryable).toBe(false);
  });

  it.each([
    ["ERROR-290", "auth"],
    ["ERROR-300", "missing required"],
    ["ERROR-310", "unknown service"],
    ["ERROR-333", "bad position type"],
    ["ERROR-336", "over 1000 limit"],
    ["ERROR-337", "daily traffic"],
  ])("%s (%s) is non-ok and non-retryable", (code) => {
    const r = classifyResultCode(code);
    expect(r.ok).toBe(false);
    expect(r.retryable).toBe(false);
  });

  it.each([["ERROR-500"], ["ERROR-600"], ["ERROR-601"]])(
    "%s (server/db) is retryable",
    (code) => {
      const r = classifyResultCode(code);
      expect(r.ok).toBe(false);
      expect(r.retryable).toBe(true);
    },
  );

  it("unknown code defaults to non-ok, non-retryable", () => {
    const r = classifyResultCode("ERROR-999");
    expect(r.ok).toBe(false);
    expect(r.retryable).toBe(false);
  });
});
