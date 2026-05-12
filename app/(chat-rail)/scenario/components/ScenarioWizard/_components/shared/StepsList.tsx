/**
 * @fileType component
 * @domain kody
 * @pattern steps-list
 * @ai-summary Renders a list of scenario steps with remove functionality
 */
'use client'

import { Button } from '@dashboard/ui/button'
import { Badge } from '@dashboard/ui/badge'
import type { Scenario } from '@dashboard/lib/scenario-schema-stub'

interface StepsListProps {
  steps?: Scenario['steps']
  onRemove: (index: number) => void
}

export function StepsList({ steps, onRemove }: StepsListProps) {
  if (!steps || steps.length === 0) {
    return (
      <p className="text-sm text-muted-foreground p-4 bg-muted rounded-lg">
        No steps yet. Use the builder above to add steps.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {steps.map((step, index) => (
        <div key={index} className="flex items-center justify-between p-3 rounded-lg bg-muted">
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono opacity-60">{index + 1}.</span>
            <Badge variant="outline" className="font-normal">
              {step.type}
            </Badge>
            <span className="font-medium">{step.action}</span>
            <span className="text-muted-foreground">{step.target}</span>
            {step.component && (
              <Badge variant="secondary" className="text-xs">
                → {step.component}
              </Badge>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={() => onRemove(index)}>
            ×
          </Button>
        </div>
      ))}
    </div>
  )
}
