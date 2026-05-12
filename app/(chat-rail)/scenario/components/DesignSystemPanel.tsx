/**
 * @fileType component
 * @domain kody
 * @pattern design-system-panel
 * @ai-summary Panel for browsing and selecting design system components
 */
'use client'

import { useState, useEffect } from 'react'
import { Input } from '@dashboard/ui/input'
import { Label } from '@dashboard/ui/label'
import { Badge } from '@dashboard/ui/badge'
import type { DSComponent } from '@dashboard/lib/scenario-schema-stub'
import { Search, Check } from 'lucide-react'

interface DesignSystemPanelProps {
  selectedComponents: DSComponent[]
  onComponentSelect: (component: DSComponent) => void
}

export function DesignSystemPanel({
  selectedComponents,
  onComponentSelect,
}: DesignSystemPanelProps) {
  const [components, setComponents] = useState<DSComponent[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(false)

  // Load components
  useEffect(() => {
    async function loadComponents() {
      setLoading(true)
      try {
        const response = await fetch('/api/kody/scenario/components')
        if (response.ok) {
          const data = await response.json()
          setComponents(data.components || [])
        }
      } catch (error) {
        console.error('Failed to load components:', error)
        // Use placeholder data for demo
        setComponents([
          {
            name: 'Button',
            path: '@/ui/web/components/button',
            variants: ['default', 'destructive', 'outline', 'ghost', 'link', 'secondary'],
            sizes: ['default', 'sm', 'lg', 'icon'],
          },
          { name: 'Input', path: '@/ui/web/components/input' },
          { name: 'Card', path: '@/ui/web/components/card' },
          { name: 'Dialog', path: '@/ui/web/components/dialog' },
          { name: 'Select', path: '@/ui/web/components/select' },
          { name: 'Textarea', path: '@/ui/web/components/textarea' },
          { name: 'Label', path: '@/ui/web/components/label' },
          { name: 'Checkbox', path: '@/ui/web/components/checkbox' },
          { name: 'Badge', path: '@/ui/web/components/badge' },
          { name: 'Progress', path: '@/ui/web/components/progress' },
          { name: 'Avatar', path: '@/ui/web/components/avatar' },
          { name: 'Accordion', path: '@/ui/web/components/accordion' },
          { name: 'Sheet', path: '@/ui/web/components/sheet' },
          { name: 'Tooltip', path: '@/ui/web/components/tooltip' },
        ])
      }
      setLoading(false)
    }
    loadComponents()
  }, [])

  // Filter components by search
  const filteredComponents = components.filter((c) => {
    if (!searchQuery) return true
    return c.name.toLowerCase().includes(searchQuery.toLowerCase())
  })

  const isSelected = (component: DSComponent) =>
    selectedComponents.some((c) => c.name === component.name)

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search components..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Selected Components */}
      {selectedComponents.length > 0 && (
        <div className="space-y-2">
          <Label>Selected ({selectedComponents.length})</Label>
          <div className="flex flex-wrap gap-1">
            {selectedComponents.map((c) => (
              <Badge key={c.name} variant="default" className="gap-1">
                {c.name}
                {c.variants && c.variants.length > 0 && (
                  <span className="text-xs opacity-70">({c.variants.length} variants)</span>
                )}
                <button
                  onClick={() => onComponentSelect(c)}
                  className="ml-1 hover:text-destructive"
                >
                  ×
                </button>
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Component Grid */}
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading components...</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 max-h-80 overflow-y-auto">
          {filteredComponents.map((component) => (
            <button
              key={component.name}
              onClick={() => onComponentSelect(component)}
              className={`p-3 rounded border text-left transition-colors ${
                isSelected(component)
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:border-primary/50'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">{component.name}</span>
                {isSelected(component) && <Check className="h-4 w-4 text-primary" />}
              </div>
              {component.variants && component.variants.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {component.variants.slice(0, 3).map((v) => (
                    <Badge key={v} variant="outline" className="text-xs">
                      {v}
                    </Badge>
                  ))}
                  {component.variants.length > 3 && (
                    <Badge variant="outline" className="text-xs">
                      +{component.variants.length - 3}
                    </Badge>
                  )}
                </div>
              )}
              {component.sizes && component.sizes.length > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  Sizes: {component.sizes.join(', ')}
                </p>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
