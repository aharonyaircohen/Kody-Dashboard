import { describe, expect, it } from "vitest";

import {
  buildRunTimeline,
  extractZipEntryText,
  parseKodyRunEventsJsonl,
  parseKodyRunLogZip,
} from "@dashboard/lib/activity/run-logs";

function makeStoredZip(path: string, content: string): Buffer {
  const name = Buffer.from(path);
  const data = Buffer.from(content);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(0, 10);
  local.writeUInt32LE(0, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt32LE(0, 12);
  central.writeUInt32LE(0, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(0, 42);

  const centralOffset = local.length + name.length + data.length;
  const centralSize = central.length + name.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([local, name, data, central, name, eocd]);
}

describe("activity run logs", () => {
  it("parses NDJSON events and builds a focused timeline", () => {
    const events = parseKodyRunEventsJsonl(
      [
        JSON.stringify({
          ts: "2026-06-16T10:00:00Z",
          runId: "123",
          capability: "build",
          kind: "stage_start",
          name: "execute",
        }),
        JSON.stringify({
          ts: "2026-06-16T10:00:02Z",
          runId: "123",
          capability: "preflight",
          kind: "step",
          name: "checkout",
          durationMs: 1250,
          outcome: "success",
        }),
        JSON.stringify({
          ts: "2026-06-16T10:00:05Z",
          runId: "123",
          capability: "agent",
          kind: "container",
          name: "codex",
          meta: { exitCode: 2, reason: "tests failed" },
          outcome: "failure",
        }),
        "",
      ].join("\n"),
    );

    const timeline = buildRunTimeline(events);

    expect(timeline).toHaveLength(3);
    expect(timeline.map((item) => item.category)).toEqual([
      "stage",
      "preflight",
      "failure",
    ]);
    expect(timeline[2]).toMatchObject({
      capability: "agent",
      failureReason: "tests failed",
      exitCode: 2,
      summary: "Failure: codex",
    });
  });

  it("extracts the run events file from a GitHub artifact zip", () => {
    const jsonl = `${JSON.stringify({
      ts: "2026-06-16T10:00:00Z",
      runId: "123",
      kind: "stage_end",
      name: "execute",
      durationMs: 3000,
    })}\n`;
    const zip = makeStoredZip(".kody/agent-runs/123/events.jsonl", jsonl);

    expect(extractZipEntryText(zip, ".kody/agent-runs/123/events.jsonl")).toBe(jsonl);
    const parsed = parseKodyRunLogZip(zip, 123);

    expect(parsed?.events).toHaveLength(1);
    expect(parsed?.timeline[0]).toMatchObject({
      category: "stage",
      kind: "stage_end",
      summary: "Stage ended: execute",
    });
  });
});
