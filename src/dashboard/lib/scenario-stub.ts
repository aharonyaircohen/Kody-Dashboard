// Scenario features are deferred during Kody extraction
// These stubs prevent import errors for scenario-related routes

export function convertScenarioToIssue(_scenario: unknown): { title: string; body: string } {
  throw new Error('Scenario features not yet available in standalone Kody')
}

export function importScenarioFromGitHub(_issueNumber: number): Promise<unknown> {
  throw new Error('Scenario features not yet available in standalone Kody')
}

export function convertToQAFormat(_scenario: unknown, _options?: unknown): unknown {
  throw new Error('Scenario features not yet available in standalone Kody')
}

export function generatePlaywrightTest(_scenario: unknown, _options?: unknown): unknown {
  throw new Error('Scenario features not yet available in standalone Kody')
}

export function createScenarioIssue(
  _params: Record<string, unknown>,
): Promise<{ number: number; html_url: string }> {
  throw new Error('Scenario features not yet available in standalone Kody')
}

export function loadDesignSystemComponents(): Promise<unknown[]> {
  throw new Error('Scenario features not yet available in standalone Kody')
}

export function listPrototypes(): Promise<string[]> {
  throw new Error('Scenario features not yet available in standalone Kody')
}

export function loadPrototype(_name: string): Promise<unknown> {
  throw new Error('Scenario features not yet available in standalone Kody')
}
