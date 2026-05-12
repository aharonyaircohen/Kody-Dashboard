/**
 * @fileType component
 * @domain kody
 * @pattern prd-card-content
 * @ai-summary PRD card content for preview dialog
 */
'use client'

import { Card, CardContent } from '@dashboard/ui/card'
import { Badge } from '@dashboard/ui/badge'
import type { Scenario, DSComponent } from '@dashboard/lib/scenario-schema-stub'

interface PRDCardContentProps {
  scenario: Partial<Scenario>
  selectedComponents: DSComponent[]
}

export function PRDCardContent({ scenario, selectedComponents }: PRDCardContentProps) {
  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div>
          <h3 className="font-semibold">{scenario.name || 'Untitled'}</h3>
          <Badge variant="outline" className="mt-1">
            {scenario.type || 'feature'}
          </Badge>
        </div>

        <div>
          <h4 className="text-sm font-medium mb-2">Scenario</h4>
          <pre className="text-xs bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap">
            {scenario.steps?.map((s) => `${s.type}: ${s.action} ${s.target}`).join('\n') ||
              'No steps defined'}
          </pre>
        </div>

        {selectedComponents.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-2">Design System Components</h4>
            <div className="flex flex-wrap gap-2">
              {selectedComponents.map((c) => (
                <Badge key={c.name} variant="secondary">
                  {c.name}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
