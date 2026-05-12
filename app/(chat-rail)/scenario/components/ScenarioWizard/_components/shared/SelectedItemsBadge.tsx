/**
 * @fileType component
 * @domain kody
 * @pattern selected-items-badge
 * @ai-summary Shows selected prototype elements and design system components as badges
 */
'use client'

import { Badge } from '@dashboard/ui/badge'
import type { PrototypeElement, DSComponent } from '@dashboard/lib/scenario-schema-stub'

interface SelectedItemsBadgeProps {
  elements: PrototypeElement[]
  components: DSComponent[]
}

export function SelectedItemsBadge({ elements, components }: SelectedItemsBadgeProps) {
  if (elements.length === 0 && components.length === 0) {
    return null
  }

  return (
    <div className="p-4 bg-muted rounded-lg">
      <Badge variant="secondary" className="mb-2">
        {elements.length + components.length} selected
      </Badge>
      <div className="flex flex-wrap gap-2">
        {elements.map((el) => (
          <Badge key={el.id} variant="secondary">
            {el.tag}
            {el.idAttr && <span className="ml-1 opacity-70">#{el.idAttr}</span>}
          </Badge>
        ))}
        {components.map((c) => (
          <Badge key={c.name} variant="outline">
            {c.name}
          </Badge>
        ))}
      </div>
    </div>
  )
}
