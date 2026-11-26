import assert from "node:assert/strict";
import { test } from "node:test";
import { themeOverviewFilters } from "../src/lib/theme-overview.ts";

const now = new Date("2026-11-24T17:00:00Z");

test("filters roll over at midnight in Vietnam and use an exclusive upper bound", () => {
  const before = themeOverviewFilters({ period: "today" }, new Date("2026-11-24T16:59:59.999Z"));
  const after = themeOverviewFilters({ period: "today" }, now);
  assert.deepEqual([before.from, before.exclusiveEnd], ["2026-11-24", "2026-11-25"]);
  assert.deepEqual([after.from, after.exclusiveEnd], ["2026-11-25", "2026-11-26"]);
  assert.equal(themeOverviewFilters({ period: "7d" }, now).from, "2026-11-19");
  assert.equal(themeOverviewFilters({}, now).from, "2026-10-27");
});

test("calendar filters handle year rollover and leap February", () => {
  assert.equal(themeOverviewFilters({ period: "year" }, now).from, "2026-01-01");
  assert.equal(themeOverviewFilters({ period: "month" }, now).from, "2026-11-01");
  const february = themeOverviewFilters({ period: "previous" }, new Date("2024-03-05"));
  assert.deepEqual([february.from, february.to, february.exclusiveEnd], ["2024-02-01", "2024-02-29", "2024-03-01"]);
  assert.equal(themeOverviewFilters({ period: "previous" }, new Date("2026-01-05")).from, "2025-12-01");
});

test("custom range rejects invalid dates, future dates, reversed ranges and more than 366 days", () => {
  const custom = (from, to) => themeOverviewFilters({ period: "custom", from, to }, now);
  assert.equal(custom("2024-01-01", "2024-12-31").valid, true);
  assert.equal(custom("2024-01-01", "2025-01-01").valid, false);
  assert.equal(custom("2026-11-31", "2026-11-25").valid, false);
  assert.equal(custom("2026-11-23", "2026-11-26").valid, false);
  assert.equal(custom("2026-11-24", "2026-11-23").valid, false);
  assert.equal(custom("", "").valid, false);
});

test("report parameters are restricted to supported sort and bucket values", () => {
  const input = themeOverviewFilters({ period: "constructor", grain: ["month"], sort: "unknown", page: "-2" }, now);
  assert.deepEqual([input.period, input.grain, input.sort, input.page], ["30d", "day", "installations", 1]);
  const valid = themeOverviewFilters({ grain: "week", sort: "revenue", page: "2" }, now);
  assert.deepEqual([valid.grain, valid.sort, valid.page], ["week", "revenue", 2]);
});
