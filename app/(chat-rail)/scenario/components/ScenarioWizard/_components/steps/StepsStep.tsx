/**
 * @fileType component
 * @domain kody
 * @pattern steps-step
 * @ai-summary Step 3: Add and manage test steps
 */
'use client'

import { useState } from 'react'
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
import { StepsList } from '../shared/StepsList'
import { STEP_TYPES, ACTIONS } from '../../_constants/wizard'
import type { Scenario, DSComponent, PrototypeElement } from '@dashboard/lib/scenario-schema-stub'

interface StepsStepProps {
  scenario: Partial<Scenario>
  selectedElements: PrototypeElement[]
  selectedComponents: DSComponent[]
  onAddStep: (step: { type: string; action: string; target: string; component?: string }) => void
  onRemoveStep: (index: number) => void
}

export function StepsStep({
  scenario,
  selectedElements,
  selectedComponents,
  onAddStep,
  onRemoveStep,
}: StepsStepProps) {
  const [stepType, setStepType] = useState('when')
  const [action, setAction] = useState('navigate')
  const [target, setTarget] = useState('')
  const [component, setComponent] = useState('')

  const handleElementClick = (element: PrototypeElement) => {
    setTarget((element.selector as string) || element.idAttr || element.tag || '')
    if (element.tag === 'button') setComponent('Button')
    else if (element.tag === 'input') setComponent('Input')
    else if (element.tag === 'a') setComponent('Button')
  }

  const handleComponentClick = (c: DSComponent) => {
    setComponent(c.name)
  }

  const handleAdd = () => {
    if (!target) return
    onAddStep({ type: stepType, action, target, component: component || undefined })
    setTarget('')
    setComponent('')
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-2">Add Test Steps</h2>
        <p className="text-muted-foreground">
          Build your scenario using Gherkin-style steps (Given/When/Then).
        </p>
      </div>

      {/* Steps Builder Form */}
      <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
        {/* Quick Select */}
        {(selectedElements.length > 0 || selectedComponents.length > 0) && (
          <div className="space-y-2">
            <Label className="text-xs">Quick Select</Label>
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
        <div className="grid grid-cols-12 gap-2 items-end">
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">Type</Label>
            <Select value={stepType} onValueChange={setStepType}>
              <SelectTrigger className="h-9">
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

          <div className="col-span-3 space-y-1">
            <Label className="text-xs">Action</Label>
            <Select value={action} onValueChange={setAction}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACTIONS.map((a) => (
                  <SelectItem key={a.value} value={a.value}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="col-span-4 space-y-1">
            <Label className="text-xs">Target</Label>
            <Input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="Selector or element"
              className="h-9"
            />
          </div>

          <div className="col-span-2 space-y-1">
            <Label className="text-xs">Component</Label>
            <Input
              value={component}
              onChange={(e) => setComponent(e.target.value)}
              placeholder="Optional"
              className="h-9"
            />
          </div>

          <div className="col-span-1">
            <Button onClick={handleAdd} disabled={!target} className="w-full h-9">
              +
            </Button>
          </div>
        </div>
      </div>

      {/* Steps List */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">
          Scenario Steps ({scenario.steps?.length || 0})
        </Label>
        <StepsList steps={scenario.steps} onRemove={onRemoveStep} />
      </div>
    </div>
  )
}
