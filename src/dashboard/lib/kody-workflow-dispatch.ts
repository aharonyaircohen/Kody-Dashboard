type WorkflowInputNames = Set<string> | null;

interface OctokitContentReader {
  rest?: {
    repos?: {
      getContent?: (params: {
        owner: string;
        repo: string;
        path: string;
        ref?: string;
      }) => Promise<{ data: unknown }>;
    };
  };
}

interface GitHubFileContent {
  type?: string;
  content?: string;
  encoding?: string;
}

export interface KodyWorkflowDispatchInputRequest {
  owner: string;
  repo: string;
  ref: string;
  action?: string;
  issueNumber?: string | number;
  sessionId?: string;
  message?: string;
  model?: string;
  reasoningEffort?: string;
  dashboardUrl?: string;
}

const KODY_WORKFLOW_PATH = ".github/workflows/kody.yml";
const ACTION_INPUT_KEYS = [
  "capability",
  "executable",
  "capability",
  "executable",
] as const;

function indentation(line: string): number {
  return line.match(/^\s*/)?.[0].length ?? 0;
}

function parseYamlKey(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const match = /^["']?([A-Za-z0-9_-]+)["']?\s*:/.exec(trimmed);
  return match?.[1] ?? null;
}

function lineHasEmptyMapping(line: string): boolean {
  return /:\s*\{\s*\}\s*(?:#.*)?$/.test(line);
}

export function parseWorkflowDispatchInputNames(
  workflow: string,
): Set<string> | null {
  const lines = workflow.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (parseYamlKey(line) !== "workflow_dispatch") continue;

    if (lineHasEmptyMapping(line)) return new Set();

    const dispatchIndent = indentation(line);
    for (let j = i + 1; j < lines.length; j += 1) {
      const inputLine = lines[j] ?? "";
      const key = parseYamlKey(inputLine);
      if (!key) continue;

      const inputIndent = indentation(inputLine);
      if (inputIndent <= dispatchIndent) break;
      if (key !== "inputs") continue;
      if (lineHasEmptyMapping(inputLine)) return new Set();

      const inputNames = new Set<string>();
      let childIndent: number | null = null;
      for (let k = j + 1; k < lines.length; k += 1) {
        const candidateLine = lines[k] ?? "";
        const candidateKey = parseYamlKey(candidateLine);
        if (!candidateKey) continue;

        const candidateIndent = indentation(candidateLine);
        if (candidateIndent <= inputIndent) break;
        childIndent ??= candidateIndent;
        if (candidateIndent === childIndent) inputNames.add(candidateKey);
      }

      return inputNames;
    }

    return null;
  }

  return null;
}

function isGitHubFileContent(data: unknown): data is GitHubFileContent {
  return (
    !Array.isArray(data) &&
    typeof data === "object" &&
    data !== null &&
    "content" in data
  );
}

async function readWorkflowInputNames(
  octokit: OctokitContentReader,
  request: Pick<KodyWorkflowDispatchInputRequest, "owner" | "repo" | "ref">,
): Promise<WorkflowInputNames> {
  try {
    const getContent = octokit.rest?.repos?.getContent;
    if (!getContent) return null;

    const response = await getContent({
      owner: request.owner,
      repo: request.repo,
      path: KODY_WORKFLOW_PATH,
      ref: request.ref,
    });
    if (!isGitHubFileContent(response.data)) return null;

    const raw =
      response.data.encoding === "base64"
        ? Buffer.from(response.data.content ?? "", "base64").toString("utf8")
        : (response.data.content ?? "");

    return parseWorkflowDispatchInputNames(raw);
  } catch {
    return null;
  }
}

function supportsInput(inputNames: WorkflowInputNames, key: string): boolean {
  return inputNames === null || inputNames.has(key);
}

function addOptionalInput(
  inputs: Record<string, string>,
  inputNames: WorkflowInputNames,
  key: string,
  value: string | number | undefined,
) {
  if (value === undefined) return;
  const stringValue = String(value);
  if (!stringValue) return;
  if (supportsInput(inputNames, key)) inputs[key] = stringValue;
}

function buildInputsForNames(
  inputNames: WorkflowInputNames,
  request: KodyWorkflowDispatchInputRequest,
): Record<string, string> {
  const inputs: Record<string, string> = {};

  if (request.action) {
    const actionInput =
      inputNames === null
        ? "executable"
        : ACTION_INPUT_KEYS.find((key) => inputNames.has(key));
    if (!actionInput) {
      throw new Error(
        "kody.yml workflow_dispatch must declare capability, executable, capability, or executable input.",
      );
    }
    inputs[actionInput] = request.action;
  }

  addOptionalInput(inputs, inputNames, "issue_number", request.issueNumber);
  addOptionalInput(inputs, inputNames, "sessionId", request.sessionId);
  addOptionalInput(inputs, inputNames, "message", request.message);
  addOptionalInput(inputs, inputNames, "model", request.model);
  addOptionalInput(inputs, inputNames, "reasoningEffort", request.reasoningEffort);
  addOptionalInput(inputs, inputNames, "dashboardUrl", request.dashboardUrl);

  return inputs;
}

export async function buildKodyWorkflowDispatchInputs(
  octokit: OctokitContentReader,
  request: KodyWorkflowDispatchInputRequest,
): Promise<Record<string, string>> {
  const inputNames = await readWorkflowInputNames(octokit, request);
  return buildInputsForNames(inputNames, request);
}
