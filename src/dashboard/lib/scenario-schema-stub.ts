// Scenario schema types — stubbed during Kody extraction
// These types are used by the scenario builder UI which is deferred

export interface Scenario {
  id: string
  name: string
  description: string
  type?: string
  status?: ScenarioStatus
  prototype?: string
  steps: ScenarioStep[]
  metadata?: Record<string, unknown>
  [key: string]: unknown
}

export interface ScenarioStep {
  id?: string
  type: string
  description?: string
  action?: string
  target?: string
  component?: string
  expected?: string
  [key: string]: unknown
}

export interface PRD {
  id: string
  title: string
  content: string
}

export interface Prototype {
  name: string
  description: string
  components: string[]
}

export interface DesignSystemComponent {
  name: string
  category: string
  description: string
}

export interface DSComponent {
  name: string
  category?: string
  description?: string
  path?: string
  variants?: string[]
  sizes?: string[]
  props?: Record<string, unknown>
  [key: string]: unknown
}

export interface PrototypeElement {
  id: string
  type?: string
  name?: string
  tag?: string
  idAttr?: string
  classes?: string[]
  text?: string
  props?: Record<string, unknown>
  children?: PrototypeElement[]
  [key: string]: unknown
}

// Re-export common types that scenario components expect
export type ScenarioStatus = 'draft' | 'active' | 'archived'
export type StepType = 'action' | 'assertion' | 'navigation' | 'input'
