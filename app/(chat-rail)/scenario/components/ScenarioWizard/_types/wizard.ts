/**
 * @fileType types
 * @domain kody
 * @pattern scenario-wizard-types
 */
import type { Scenario, DSComponent, PrototypeElement } from '@dashboard/lib/scenario-schema-stub'

export type WizardStep = 'name' | 'prototype' | 'steps' | 'save'

export interface WizardStepConfig {
  id: WizardStep
  label: string
  description: string
}

export interface ScenarioWizardState {
  scenario: Partial<Scenario>
  selectedPrototype: string | null
  selectedElements: PrototypeElement[]
  selectedComponents: DSComponent[]
  showPRDDialog: boolean
}

export interface ScenarioWizardActions {
  // Scenario
  setScenario: (scenario: Partial<Scenario>) => void
  updateScenario: (updates: Partial<Scenario>) => void

  // Name & Type
  handleNameChange: (name: string) => void
  handleTypeChange: (type: 'core' | 'feature' | 'edge') => void

  // Selection
  handleElementSelect: (element: PrototypeElement) => void
  handleComponentSelect: (component: DSComponent) => void
  setSelectedPrototype: (name: string | null) => void

  // Steps
  handleAddStep: (step: StepInput) => void
  handleRemoveStep: (index: number) => void

  // Dialog
  setShowPRDDialog: (show: boolean) => void

  // API Actions
  handleSaveScenario: () => Promise<void>
  handleCreateGitHubIssue: () => Promise<void>
  handleExport: (format: 'qa' | 'playwright' | 'prd') => Promise<void>
}

export interface StepInput {
  type: string
  action: string
  target: string
  component?: string
}

export interface ScenarioWizardProps {
  initialScenario?: Partial<Scenario>
}

export type UseScenarioWizardReturn = ScenarioWizardState & ScenarioWizardActions
