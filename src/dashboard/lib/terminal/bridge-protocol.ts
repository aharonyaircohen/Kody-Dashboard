export type TerminalBridgeClientMessage =
  | {
      type: "input";
      id?: number;
      data: string;
    }
  | {
      type: "resize";
      cols: number;
      rows: number;
    };

export type TerminalBridgeServerMessage =
  | {
      type: "output";
      data: string;
    }
  | {
      type: "restore-start";
      replayBytes?: number;
    }
  | {
      type: "restore-complete";
    }
  | {
      type: "ready";
    }
  | {
      type: "input-accepted";
      id?: number;
      bytes?: number;
    }
  | {
      type: "input-rejected";
      id?: number;
      message?: string;
    }
  | {
      type: "error";
      message?: string;
    }
  | {
      type: "exit";
      code?: number;
    };

export function parseTerminalBridgeServerMessage(
  raw: string,
): TerminalBridgeServerMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const message = parsed as {
    type?: unknown;
    data?: unknown;
    message?: unknown;
    code?: unknown;
    id?: unknown;
    bytes?: unknown;
    replayBytes?: unknown;
  };
  switch (message.type) {
    case "output":
      return typeof message.data === "string"
        ? { type: "output", data: message.data }
        : null;
    case "restore-start":
      return {
        type: "restore-start",
        replayBytes:
          typeof message.replayBytes === "number"
            ? message.replayBytes
            : undefined,
      };
    case "restore-complete":
      return { type: "restore-complete" };
    case "ready":
      return { type: "ready" };
    case "input-accepted":
      return {
        type: "input-accepted",
        id: typeof message.id === "number" ? message.id : undefined,
        bytes: typeof message.bytes === "number" ? message.bytes : undefined,
      };
    case "input-rejected":
      return {
        type: "input-rejected",
        id: typeof message.id === "number" ? message.id : undefined,
        message:
          typeof message.message === "string" ? message.message : undefined,
      };
    case "error":
      return {
        type: "error",
        message:
          typeof message.message === "string" ? message.message : undefined,
      };
    case "exit":
      return {
        type: "exit",
        code: typeof message.code === "number" ? message.code : undefined,
      };
    default:
      return null;
  }
}
