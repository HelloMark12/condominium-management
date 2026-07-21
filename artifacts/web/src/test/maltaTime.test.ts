/**
 * Suite 37 — Malta timezone utility (Correction 5)
 *
 * Verifies that maltaLocalToUtc() correctly converts Europe/Malta local times
 * to UTC regardless of the test environment's system timezone, and correctly
 * handles DST transitions.
 */

import { describe, it, expect } from "vitest";
import { maltaLocalToUtc, formatMaltaTime } from "@/lib/maltaTime";

describe("Suite 37 — Malta timezone conversion", () => {
  // ── Winter (CET = UTC+1) ────────────────────────────────────────────────────

  it("Winter: 10:00 Malta (CET, UTC+1) → 09:00 UTC", () => {
    const utc = maltaLocalToUtc("2024-01-15T10:00");
    expect(utc).not.toBeNull();
    expect(utc!.toISOString()).toBe("2024-01-15T09:00:00.000Z");
  });

  it("Winter: midnight Malta → 23:00 UTC previous day", () => {
    const utc = maltaLocalToUtc("2024-02-01T00:00");
    expect(utc).not.toBeNull();
    expect(utc!.toISOString()).toBe("2024-01-31T23:00:00.000Z");
  });

  it("Winter: 23:59 Malta → 22:59 UTC same day", () => {
    const utc = maltaLocalToUtc("2024-12-25T23:59");
    expect(utc).not.toBeNull();
    expect(utc!.toISOString()).toBe("2024-12-25T22:59:00.000Z");
  });

  // ── Summer (CEST = UTC+2) ───────────────────────────────────────────────────

  it("Summer: 10:00 Malta (CEST, UTC+2) → 08:00 UTC", () => {
    const utc = maltaLocalToUtc("2024-07-15T10:00");
    expect(utc).not.toBeNull();
    expect(utc!.toISOString()).toBe("2024-07-15T08:00:00.000Z");
  });

  it("Summer: midnight Malta → 22:00 UTC previous day", () => {
    const utc = maltaLocalToUtc("2024-08-01T00:00");
    expect(utc).not.toBeNull();
    expect(utc!.toISOString()).toBe("2024-07-31T22:00:00.000Z");
  });

  // ── DST spring-forward (last Sunday in March) ───────────────────────────────
  // Malta 2024: clocks skip from 02:00 CET → 03:00 CEST on 31 March.
  // Any time in the 02:00–03:00 window does not exist.

  it("Spring-forward gap: 02:30 Malta on 2024-03-31 → null (nonexistent time)", () => {
    const utc = maltaLocalToUtc("2024-03-31T02:30");
    expect(utc).toBeNull();
  });

  it("Spring-forward gap: 02:00 Malta on 2024-03-31 → null", () => {
    const utc = maltaLocalToUtc("2024-03-31T02:00");
    expect(utc).toBeNull();
  });

  it("Just before spring-forward: 01:59 Malta → valid CET (UTC+1)", () => {
    const utc = maltaLocalToUtc("2024-03-31T01:59");
    expect(utc).not.toBeNull();
    expect(utc!.toISOString()).toBe("2024-03-31T00:59:00.000Z");
  });

  it("Just after spring-forward: 03:01 Malta → valid CEST (UTC+2)", () => {
    const utc = maltaLocalToUtc("2024-03-31T03:01");
    expect(utc).not.toBeNull();
    expect(utc!.toISOString()).toBe("2024-03-31T01:01:00.000Z");
  });

  // ── DST fall-back (last Sunday in October) ──────────────────────────────────
  // Malta 2024: clocks go from 03:00 CEST → 02:00 CET on 27 October.
  // 02:30 exists in both CEST and CET; algorithm returns the CEST interpretation.

  it("Fall-back overlap: 02:30 Malta on 2024-10-27 → a valid UTC time", () => {
    const utc = maltaLocalToUtc("2024-10-27T02:30");
    expect(utc).not.toBeNull();
    // The result must convert back to 02:30 Malta time (either CEST or CET)
    const formatted = new Intl.DateTimeFormat("en", {
      timeZone: "Europe/Malta",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(utc!);
    expect(formatted).toMatch(/02:30/);
  });

  // ── Input validation ────────────────────────────────────────────────────────

  it("Invalid format → null", () => {
    expect(maltaLocalToUtc("2024-01-15")).toBeNull();
    expect(maltaLocalToUtc("not-a-date")).toBeNull();
    expect(maltaLocalToUtc("")).toBeNull();
  });

  // ── formatMaltaTime ─────────────────────────────────────────────────────────

  it("formatMaltaTime produces a human-readable string containing Malta time", () => {
    const utc = new Date("2024-07-15T08:00:00.000Z"); // 10:00 CEST
    const label = formatMaltaTime(utc);
    expect(label).toContain("10:00");
    expect(label.toLowerCase()).toContain("malta");
  });

  it("formatMaltaTime reflects correct winter offset (+01:00 or GMT+1)", () => {
    const utc = new Date("2024-01-15T09:00:00.000Z"); // 10:00 CET
    const label = formatMaltaTime(utc);
    expect(label).toMatch(/\+01:00|GMT\+1/i);
  });

  it("formatMaltaTime reflects correct summer offset (+02:00 or GMT+2)", () => {
    const utc = new Date("2024-07-15T08:00:00.000Z"); // 10:00 CEST
    const label = formatMaltaTime(utc);
    expect(label).toMatch(/\+02:00|GMT\+2/i);
  });
});
