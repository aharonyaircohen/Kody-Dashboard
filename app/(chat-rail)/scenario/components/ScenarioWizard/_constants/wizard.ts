/**
 * @fileType constants
 * @domain kody
 * @pattern scenario-wizard-constants
 */
import type { WizardStepConfig } from '../_types/wizard'

export const STEPS: WizardStepConfig[] = [
  { id: 'name', label: 'Name', description: 'Name your scenario' },
  { id: 'prototype', label: 'Prototype', description: 'Select a prototype' },
  { id: 'steps', label: 'Steps', description: 'Add test steps' },
  { id: 'save', label: 'Save', description: 'Preview and export' },
]

export const STEP_TYPES = [
  { value: 'given', label: 'Given' },
  { value: 'when', label: 'When' },
  { value: 'then', label: 'Then' },
  { value: 'and', label: 'And' },
  { value: 'but', label: 'But' },
] as const

export const ACTIONS = [
  { value: 'navigate', label: 'Navigate' },
  { value: 'click', label: 'Click' },
  { value: 'see', label: 'See' },
  { value: 'dontSee', label: "Don't See" },
  { value: 'beAt', label: 'Be At' },
  { value: 'login', label: 'Login' },
  { value: 'logout', label: 'Logout' },
  { value: 'answer', label: 'Answer' },
] as const

export const SCENARIO_TYPES = [
  { value: 'core', label: 'Core', description: 'Critical user flows' },
  { value: 'feature', label: 'Feature', description: 'Specific functionality' },
  { value: 'edge', label: 'Edge Case', description: 'Boundary conditions' },
] as const
