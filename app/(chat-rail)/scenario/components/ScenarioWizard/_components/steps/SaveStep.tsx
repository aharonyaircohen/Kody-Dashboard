/**
 * @fileType component
 * @domain kody
 * @pattern save-step
 * @ai-summary Step 4: Preview, save and export scenario
 */
'use client'

import { Button } from '@dashboard/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@dashboard/ui/card'
import { Badge } from '@dashboard/ui/badge'
import { Save, Github, Download } from 'lucide-react'
import type { Scenario, DSComponent } from '@dashboard/lib/scenario-schema-stub'

interface SaveStepProps {
  scenario: Partial<Scenario>
  selectedPrototype: string | null
  selectedComponents: DSComponent[]
  onSave: () => Promise<void>
  onCreateGitHubIssue: () => void
  onExport: (format: 'playwright') => Promise<void>
}

export function SaveStep({
  scenario,
  selectedPrototype,
  selectedComponents,
  onSave,
  onCreateGitHubIssue,
  onExport,
}: SaveStepProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-2">Preview & Save</h2>
        <p className="text-muted-foreground">Review your scenario and choose how to proceed.</p>
      </div>

      {/* Summary Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{scenario.name || 'Untitled Scenario'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4 text-sm">
            <Badge variant="outline">{scenario.type || 'feature'}</Badge>
            {selectedPrototype && (
              <span className="text-muted-foreground">Prototype: {selectedPrototype}</span>
            )}
            <span className="text-muted-foreground">{scenario.steps?.length || 0} steps</span>
          </div>

          {scenario.steps && scenario.steps.length > 0 && (
            <div className="space-y-1">
              {scenario.steps.map((step, index) => (
                <div key={index} className="text-sm">
                  <Badge variant="outline" className="mr-2 text-xs">
                    {step.type}
                  </Badge>
                  {step.action} <span className="text-muted-foreground">{step.target}</span>
                </div>
              ))}
            </div>
          )}

          {selectedComponents.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selectedComponents.map((c) => (
                <Badge key={c.name} variant="secondary">
                  {c.name}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-3">
        <Button onClick={onSave} disabled={!scenario.name}>
          <Save className="h-4 w-4 mr-2" />
          Save Draft
        </Button>
        <Button variant="outline" onClick={onCreateGitHubIssue}>
          <Github className="h-4 w-4 mr-2" />
          Create GitHub Issue
        </Button>
        <Button variant="outline" onClick={() => onExport('playwright')}>
          <Download className="h-4 w-4 mr-2" />
          Export Playwright
        </Button>
      </div>
    </div>
  )
}
