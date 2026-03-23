/**
 * @fileType component
 * @domain kody
 * @pattern name-step
 * @ai-summary Step 1: Name your scenario and select type
 */
'use client'

import { Input } from '@dashboard/ui/input'
import { Label } from '@dashboard/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@dashboard/ui/select'
import type { Scenario } from '@dashboard/lib/scenario-schema-stub'
import { SCENARIO_TYPES } from '../../_constants/wizard'

interface NameStepProps {
  scenario: Partial<Scenario>
  onNameChange: (name: string) => void
  onTypeChange: (type: 'core' | 'feature' | 'edge') => void
}

export function NameStep({ scenario, onNameChange, onTypeChange }: NameStepProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-2">Name Your Scenario</h2>
        <p className="text-muted-foreground">
          Give your scenario a clear, descriptive name that explains what user flow it tests.
        </p>
      </div>

      <div className="space-y-4 max-w-md">
        <div className="space-y-2">
          <Label htmlFor="scenario-name">Scenario Name</Label>
          <Input
            id="scenario-name"
            placeholder="e.g., Student solves MCQ question correctly"
            value={scenario.name || ''}
            onChange={(e) => onNameChange(e.target.value)}
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            This will be used as the title when creating GitHub issues
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="scenario-type">Scenario Type</Label>
          <Select
            value={scenario.type}
            onValueChange={(v) => onTypeChange(v as 'core' | 'feature' | 'edge')}
          >
            <SelectTrigger id="scenario-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SCENARIO_TYPES.map((type) => (
                <SelectItem key={type.value} value={type.value}>
                  <div>
                    <div className="font-medium">{type.label}</div>
                    <div className="text-xs text-muted-foreground">{type.description}</div>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  )
}
