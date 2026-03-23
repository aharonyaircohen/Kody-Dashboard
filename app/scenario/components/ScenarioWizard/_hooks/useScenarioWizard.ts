/**
 * @fileType hook
 * @domain kody
 * @pattern use-scenario-wizard
 * @ai-summary Main state hook for ScenarioWizard - manages all scenario state and actions
 */
'use client'

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import type {
  ScenarioWizardState,
  UseScenarioWizardReturn,
  ScenarioWizardProps,
  StepInput,
} from '../_types/wizard'
import type { Scenario, DSComponent, PrototypeElement } from '@dashboard/lib/scenario-schema-stub'

const INITIAL_STATE: ScenarioWizardState = {
  scenario: {
    id: '',
    name: '',
    type: 'feature',
    steps: [],
    status: 'draft',
  },
  selectedPrototype: null,
  selectedElements: [],
  selectedComponents: [],
  showPRDDialog: false,
}

export function useScenarioWizard({
  initialScenario,
}: ScenarioWizardProps): UseScenarioWizardReturn {
  // Scenario state
  const [scenario, setScenario] = useState<Partial<Scenario>>({
    ...INITIAL_STATE.scenario,
    ...initialScenario,
  })

  // Selection state
  const [selectedPrototype, setSelectedPrototype] = useState<string | null>(null)
  const [selectedElements, setSelectedElements] = useState<PrototypeElement[]>([])
  const [selectedComponents, setSelectedComponents] = useState<DSComponent[]>([])

  // UI state
  const [showPRDDialog, setShowPRDDialog] = useState(false)

  // Name & Type handlers
  const handleNameChange = useCallback((name: string) => {
    setScenario((prev) => ({
      ...prev,
      id: name.toLowerCase().replace(/\s+/g, '-'),
      name,
    }))
  }, [])

  const handleTypeChange = useCallback((type: 'core' | 'feature' | 'edge') => {
    setScenario((prev) => ({ ...prev, type }))
  }, [])

  // Selection handlers
  const handleElementSelect = useCallback((element: PrototypeElement) => {
    setSelectedElements((prev) => {
      const exists = prev.some((e) => e.id === element.id)
      if (exists) {
        return prev.filter((e) => e.id !== element.id)
      }
      return [...prev, element]
    })
  }, [])

  const handleComponentSelect = useCallback((component: DSComponent) => {
    setSelectedComponents((prev) => {
      const exists = prev.some((c) => c.name === component.name)
      if (exists) {
        return prev.filter((c) => c.name !== component.name)
      }
      return [...prev, component]
    })
  }, [])

  // Steps handlers
  const handleAddStep = useCallback((step: StepInput) => {
    setScenario((prev) => ({
      ...prev,
      steps: [
        ...(prev.steps || []),
        {
          type: step.type as 'given' | 'when' | 'then' | 'and' | 'but',
          action: step.action,
          target: step.target,
          component: step.component,
        },
      ],
    }))
  }, [])

  const handleRemoveStep = useCallback((index: number) => {
    setScenario((prev) => ({
      ...prev,
      steps: prev.steps?.filter((_, i) => i !== index),
    }))
  }, [])

  // API Actions
  const handleSaveScenario = useCallback(async () => {
    if (!scenario.id || !scenario.name) {
      toast.error('Please enter a scenario name')
      return
    }

    try {
      const response = await fetch('/api/kody/scenario/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenario: {
            ...scenario,
            status: 'draft',
            createdAt: new Date().toISOString(),
          },
          category: scenario.type || 'feature',
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to save')
      }

      toast.success(`Scenario "${scenario.name}" saved`)
    } catch (error) {
      toast.error('Failed to save scenario')
      console.error(error)
    }
  }, [scenario])

  const handleCreateGitHubIssue = useCallback(async () => {
    if (!scenario.name || !scenario.steps?.length) {
      toast.error('Please add name and steps first')
      return
    }

    try {
      const response = await fetch('/api/kody/scenario/github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: scenario.name,
          category: scenario.type || 'feature',
          area: scenario.area,
          scenario: scenario.steps.map((s) => `${s.type}: ${s.action} ${s.target}`).join('\n'),
          prototype: selectedPrototype,
          fixture: scenario.fixture,
          behaviors: scenario.siteBehaviors,
          dsComponents: selectedComponents.map((c) => c.name),
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to create issue')
      }

      const data = await response.json()
      toast.success(`GitHub issue #${data.number} created`)
      setShowPRDDialog(false)
    } catch (error) {
      toast.error('Failed to create GitHub issue')
      console.error(error)
    }
  }, [scenario, selectedPrototype, selectedComponents])

  const handleExport = useCallback(
    async (format: 'qa' | 'playwright' | 'prd') => {
      if (!scenario.id || !scenario.name) {
        toast.error('Please name your scenario first')
        return
      }

      try {
        const response = await fetch('/api/kody/scenario/export', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scenario: {
              ...scenario,
              steps: scenario.steps?.map((s) => ({
                type: s.type,
                action: s.action,
                target: s.target,
              })),
            },
            format,
          }),
        })

        if (!response.ok) throw new Error('Export failed')

        const data = await response.json()

        if (format === 'playwright') {
          const blob = new Blob([data.data], { type: 'text/plain' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `${scenario.id}.spec.ts`
          a.click()
          URL.revokeObjectURL(url)
          toast.success('Playwright test downloaded')
        } else if (format === 'qa') {
          await navigator.clipboard.writeText(JSON.stringify(data.data, null, 2))
          toast.success('QA format copied to clipboard')
        } else {
          await navigator.clipboard.writeText(JSON.stringify(data.data, null, 2))
          toast.success('PRD data copied to clipboard')
        }
      } catch (error) {
        toast.error('Export failed')
        console.error(error)
      }
    },
    [scenario],
  )

  const updateScenario = useCallback((updates: Partial<Scenario>) => {
    setScenario((prev) => ({ ...prev, ...updates }))
  }, [])

  return {
    // State
    scenario,
    selectedPrototype,
    selectedElements,
    selectedComponents,
    showPRDDialog,
    // Setters
    setScenario,
    updateScenario,
    // Handlers
    handleNameChange,
    handleTypeChange,
    handleElementSelect,
    handleComponentSelect,
    setSelectedPrototype,
    handleAddStep,
    handleRemoveStep,
    setShowPRDDialog,
    // API Actions
    handleSaveScenario,
    handleCreateGitHubIssue,
    handleExport,
  }
}
