/**
 * @fileType component
 * @domain kody
 * @pattern prototype-step
 * @ai-summary Step 2: Select prototype and design system components
 */
'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@dashboard/ui/card'
import { PrototypePanel } from '../../../PrototypePanel'
import { DesignSystemPanel } from '../../../DesignSystemPanel'
import { SelectedItemsBadge } from '../shared/SelectedItemsBadge'
import type { DSComponent, PrototypeElement } from '@dashboard/lib/scenario-schema-stub'

interface PrototypeStepProps {
  selectedPrototype: string | null
  selectedElements: PrototypeElement[]
  selectedComponents: DSComponent[]
  onPrototypeSelect: (name: string | null) => void
  onElementSelect: (element: PrototypeElement) => void
  onComponentSelect: (component: DSComponent) => void
}

export function PrototypeStep({
  selectedPrototype,
  selectedElements,
  selectedComponents,
  onPrototypeSelect,
  onElementSelect,
  onComponentSelect,
}: PrototypeStepProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-2">Select a Prototype</h2>
        <p className="text-muted-foreground">
          Choose an HTML prototype to extract elements from, or browse design system components.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">HTML Prototype</CardTitle>
          </CardHeader>
          <CardContent>
            <PrototypePanel
              selectedElements={selectedElements}
              onElementSelect={onElementSelect}
              selectedPrototype={selectedPrototype}
              onPrototypeSelect={onPrototypeSelect}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Design System</CardTitle>
          </CardHeader>
          <CardContent>
            <DesignSystemPanel
              selectedComponents={selectedComponents}
              onComponentSelect={onComponentSelect}
            />
          </CardContent>
        </Card>
      </div>

      <SelectedItemsBadge elements={selectedElements} components={selectedComponents} />
    </div>
  )
}
