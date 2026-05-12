/**
 * @fileType component
 * @domain kody
 * @pattern scenario-builder
 * @ai-summary Component for building scenario steps from selected elements and components
 */
'use client'

import { useState, useEffect } from 'react'
import { Button } from '@dashboard/ui/button'
import { Input } from '@dashboard/ui/input'
import { Label } from '@dashboard/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@dashboard/ui/select'
import type { PrototypeElement, DSComponent } from '@dashboard/lib/scenario-schema-stub'
import { Plus, Download } from 'lucide-react'
import { toast } from 'sonner'

interface ScenarioBuilderProps {
  selectedElements: PrototypeElement[]
  selectedComponents: DSComponent[]
  onAddStep: (step: { type: string; action: string; target: string; component?: string }) => void
  scenario?: {
    id?: string
    name?: string
    steps?: Array<{ type: string; action: string; target?: string }>
  }
}

const STEP_TYPES = [
  { value: 'given', label: 'Given' },
  { value: 'when', label: 'When' },
  { value: 'then', label: 'Then' },
  { value: 'and', label: 'And' },
  { value: 'but', label: 'But' },
]

interface ActionInfo {
  name: string
  description: string
  example: string
}

export function ScenarioBuilder({
  selectedElements,
  selectedComponents,
  onAddStep,
  scenario,
}: ScenarioBuilderProps) {
  const [stepType, setStepType] = useState('when')
  const [action, setAction] = useState('navigate')
  const [target, setTarget] = useState('')
  const [component, setComponent] = useState('')
  const [qaActions, setQaActions] = useState<ActionInfo[]>([])

  // Load QA actions from registry
  useEffect(() => {
    async function loadActions() {
      try {
        const response = await fetch('/api/kody/scenario/actions')
        if (response.ok) {
          const data = await response.json()
          setQaActions(data.actions || [])
        }
      } catch {
        // Use default actions on error
      }
    }
    loadActions()
  }, [])

  // Update target when element is selected
  const handleElementClick = (element: PrototypeElement) => {
    setTarget((element.selector as string) || element.idAttr || element.tag || '')
    // Auto-suggest component based on element
    if (element.tag === 'button') {
      setComponent('Button')
    } else if (element.tag === 'input') {
      setComponent('Input')
    } else if (element.tag === 'a') {
      setComponent('Button')
    }
  }

  // Update component when DS component is selected
  const handleComponentClick = (dsComponent: DSComponent) => {
    setComponent(dsComponent.name)
  }

  const handleAdd = () => {
    if (!target) return
    onAddStep({ type: stepType, action, target, component: component || undefined })
    // Reset form
    setTarget('')
    setComponent('')
  }

  const canAdd = target.length > 0

  const handleExport = async (format: 'qa' | 'playwright' | 'prd') => {
    if (!scenario?.id || !scenario?.name) {
      toast.error('Please save the scenario first')
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
        // Download as file
        const blob = new Blob([data.data], { type: 'text/plain' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${scenario.id}.spec.ts`
        a.click()
        URL.revokeObjectURL(url)
        toast.success('Playwright test downloaded')
      } else if (format === 'qa') {
        // Copy to clipboard
        await navigator.clipboard.writeText(JSON.stringify(data.data, null, 2))
        toast.success('QA format copied to clipboard')
      } else {
        // Copy markdown
        await navigator.clipboard.writeText(JSON.stringify(data.data, null, 2))
        toast.success('PRD data copied to clipboard')
      }
    } catch (error) {
      toast.error('Export failed')
      console.error(error)
    }
  }

  return (
    <div className="space-y-4">
      {/* Quick Select from Selected */}
      {(selectedElements.length > 0 || selectedComponents.length > 0) && (
        <div className="space-y-2">
          <Label>Quick Select</Label>
          <div className="flex flex-wrap gap-2">
            {selectedElements.map((el) => (
              <Button
                key={el.id}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleElementClick(el)}
              >
                {el.tag}
                {el.idAttr && <span className="ml-1 opacity-70">#{el.idAttr}</span>}
              </Button>
            ))}
            {selectedComponents.map((c) => (
              <Button
                key={c.name}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleComponentClick(c)}
              >
                {c.name}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Step Form */}
      <div className="grid grid-cols-4 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Type</Label>
          <Select value={stepType} onValueChange={setStepType}>
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STEP_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Action</Label>
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {qaActions.length > 0 ? (
                qaActions.map((a) => (
                  <SelectItem key={a.name} value={a.name}>
                    {a.name}
                  </SelectItem>
                ))
              ) : (
                <>
                  <SelectItem value="navigate">Navigate</SelectItem>
                  <SelectItem value="click">Click</SelectItem>
                  <SelectItem value="see">See</SelectItem>
                  <SelectItem value="dontSee">Don&apos;t See</SelectItem>
                  <SelectItem value="beAt">Be At</SelectItem>
                  <SelectItem value="login">Login</SelectItem>
                  <SelectItem value="logout">Logout</SelectItem>
                  <SelectItem value="answer">Answer</SelectItem>
                </>
              )}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1 col-span-2">
          <Label className="text-xs">Target</Label>
          <Input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="Selector or element"
            className="h-8"
          />
        </div>
      </div>

      {/* Component Mapping */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">DS Component (optional)</Label>
          <Input
            value={component}
            onChange={(e) => setComponent(e.target.value)}
            placeholder="e.g., Button"
            className="h-8"
          />
        </div>
        <div className="flex items-end">
          <Button onClick={handleAdd} disabled={!canAdd} className="w-full" size="sm">
            <Plus className="h-4 w-4 mr-1" />
            Add Step
          </Button>
        </div>
      </div>

      {/* Help Text */}
      <p className="text-xs text-muted-foreground">
        Select an element or component above to auto-fill, or type a selector manually. The DS
        component field helps map prototype elements to design system components.
      </p>

      {/* Export Options */}
      {scenario?.id && scenario?.steps && scenario.steps.length > 0 && (
        <div className="pt-4 border-t space-y-2">
          <Label className="text-xs">Export</Label>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => handleExport('qa')}>
              <Download className="h-3 w-3 mr-1" />
              QA Format
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleExport('playwright')}>
              <Download className="h-3 w-3 mr-1" />
              Playwright
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleExport('prd')}>
              <Download className="h-3 w-3 mr-1" />
              PRD
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
