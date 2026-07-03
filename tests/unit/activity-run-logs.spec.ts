import { describe, expect, it } from "vitest";

import {
  buildRunTimeline,
  extractZipEntryText,
  parseKodyRunEventsJsonl,
  parseKodyRunLogZip,
} from "@dashboard/lib/activity/run-logs";

function makeStoredZipEntries(
  entries: Array<{ path: string; content: string }>,
): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.path);
    const data = Buffer.from(entry.content);
    const localOffset = offset;
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

    locals.push(local, name, data);
    offset += local.length + name.length + data.length;

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
    central.writeUInt32LE(localOffset, 42);
    centrals.push(central, name);
  }

  const centralOffset = offset;
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, ...centrals, eocd]);
}

function makeStoredZip(path: string, content: string): Buffer {
  return makeStoredZipEntries([{ path, content }]);
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

    expect(extractZipEntryText(zip, ".kody/agent-runs/123/events.jsonl")).toBe(
      jsonl,
    );
    const parsed = parseKodyRunLogZip(zip, 123);

    expect(parsed?.events).toHaveLength(1);
    expect(parsed?.timeline[0]).toMatchObject({
      category: "stage",
      kind: "stage_end",
      summary: "Stage ended: execute",
    });
  });

  it("extracts agency boundary evals from the existing artifact zip", () => {
    const jsonl = `${JSON.stringify({
      ts: "2026-07-03T17:58:00Z",
      runId: "123",
      kind: "stage_end",
      name: "execute",
    })}\n`;
    const marker =
      'KODY_AGENCY_BOUNDARY_EVAL={"version":1,"status":"pass","capability":"ai-agency-health-matrix","capabilityKind":"observe","findings":[{"rule":"observe-does-not-act","status":"pass","message":"observe capability reported facts without action output","evidence":{"resultCount":0}}]}';
    const zip = makeStoredZipEntries([
      { path: ".kody/agent-runs/123/events.jsonl", content: jsonl },
      { path: "run.log", content: marker },
    ]);

    expect(parseKodyRunLogZip(zip, 123)?.agencyBoundaryEvals).toEqual([
      {
        version: 1,
        status: "pass",
        capability: "ai-agency-health-matrix",
        capabilityKind: "observe",
        findings: [
          {
            rule: "observe-does-not-act",
            status: "pass",
            message: "observe capability reported facts without action output",
            evidence: { resultCount: 0 },
          },
        ],
      },
    ]);
  });
});
