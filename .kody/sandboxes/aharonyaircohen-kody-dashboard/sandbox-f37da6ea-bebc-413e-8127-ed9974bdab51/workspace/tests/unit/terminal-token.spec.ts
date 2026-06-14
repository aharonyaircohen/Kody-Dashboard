import { describe, expect, it } from "vitest";

import {
  mintTerminalBridgeToken,
  verifyTerminalBridgeToken,
} from "@dashboard/lib/terminal/terminal-token";

const SECRET = "test-master-secret";

describe("terminal bridge token", () => {
  it("round-trips encrypted launch claims", () => {
    const token = mintTerminalBridgeToken({
      owner: "acme",
      repo: "widgets",
      app: "kody-runner",
      machineId: "m-123",
      chatSessionId: "chat-1",
      resetSession: true,
      flyToken: "FlyV1 secret-token",
      cols: 132,
      rows: 40,
      now: 100,
      secret: SECRET,
    });

    expect(token).not.toContain("secret-token");
    const claims = verifyTerminalBridgeToken(token, {
      now: 110,
      secret: SECRET,
    });
    expect(claims).toMatchObject({
      owner: "acme",
      repo: "widgets",
      app: "kody-runner",
      machineId: "m-123",
      chatSessionId: "chat-1",
      resetSession: true,
      flyToken: "FlyV1 secret-token",
      cols: 132,
      rows: 40,
    });
  });

  it("rejects tampered tokens", () => {
    const token = mintTerminalBridgeToken({
      owner: "acme",
      repo: "widgets",
      app: "kody-runner",
      machineId: "m-123",
      flyToken: "fly-token",
      now: 100,
      secret: SECRET,
    });

    const tampered = `${token.slice(0, -1)}x`;
    expect(() =>
      verifyTerminalBridgeToken(tampered, { now: 110, secret: SECRET }),
    ).toThrow(/signature invalid|payload invalid|malformed/);
  });

  it("rejects expired tokens", () => {
    const token = mintTerminalBridgeToken({
      owner: "acme",
      repo: "widgets",
      app: "kody-runner",
      machineId: "m-123",
      flyToken: "fly-token",
      now: 100,
      ttlSeconds: 5,
      secret: SECRET,
    });

    expect(() =>
      verifyTerminalBridgeToken(token, { now: 106, secret: SECRET }),
    ).toThrow(/expired/);
  });
});
