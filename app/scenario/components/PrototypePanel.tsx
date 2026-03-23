/**
 * @fileType component
 * @domain kody
 * @pattern prototype-panel
 * @ai-summary Panel for loading and selecting prototype elements
 */
'use client'

import { useState, useEffect } from 'react'
import { Button } from '@dashboard/ui/button'
import { Input } from '@dashboard/ui/input'
import { Label } from '@dashboard/ui/label'
import { Badge } from '@dashboard/ui/badge'
import type { PrototypeElement } from '@dashboard/lib/scenario-schema-stub'
import { Search, Upload, X } from 'lucide-react'

interface PrototypePanelProps {
  selectedElements: PrototypeElement[]
  onElementSelect: (element: PrototypeElement) => void
  selectedPrototype: string | null
  onPrototypeSelect: (name: string | null) => void
}

export function PrototypePanel({
  selectedElements,
  onElementSelect,
  selectedPrototype,
  onPrototypeSelect,
}: PrototypePanelProps) {
  const [prototypes, setPrototypes] = useState<string[]>([])
  const [elements, setElements] = useState<PrototypeElement[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)

  // Load prototype list
  useEffect(() => {
    async function loadPrototypes() {
      try {
        const response = await fetch('/api/kody/scenario/prototypes')
        if (response.ok) {
          const data = await response.json()
          setPrototypes(data.prototypes || [])
        }
      } catch (error) {
        console.error('Failed to load prototypes:', error)
        // Use placeholder data for demo
        setPrototypes(['exercise-page', 'course-page', 'lesson-page'])
      }
    }
    loadPrototypes()
  }, [])

  // Load elements when prototype selected
  useEffect(() => {
    async function loadElements() {
      if (!selectedPrototype) {
        setElements([])
        return
      }

      setLoading(true)
      try {
        const response = await fetch(`/api/kody/scenario/prototypes/${selectedPrototype}`)
        if (response.ok) {
          const data = await response.json()
          setElements(data.elements || [])
        }
      } catch (error) {
        console.error('Failed to load elements:', error)
        // Use placeholder data for demo
        setElements([
          {
            id: 'btn-submit',
            tag: 'button',
            idAttr: 'submit-btn',
            classes: ['btn', 'btn-primary'],
            text: 'Submit',
            selector: '#submit-btn',
          },
          {
            id: 'hint-link',
            tag: 'a',
            idAttr: 'hint-link',
            classes: ['hint-trigger'],
            text: 'Need a hint?',
            selector: '#hint-link',
          },
          {
            id: 'feedback-div',
            tag: 'div',
            idAttr: 'feedback',
            classes: ['feedback', 'success'],
            text: 'Correct!',
            selector: '#feedback',
          },
        ])
      }
      setLoading(false)
    }
    loadElements()
  }, [selectedPrototype])

  // Filter elements by search
  const filteredElements = elements.filter((el) => {
    if (!searchQuery) return true
    const query = searchQuery.toLowerCase()
    return (
      el.idAttr?.toLowerCase().includes(query) ||
      el.classes?.some((c) => c.toLowerCase().includes(query)) ||
      el.text?.toLowerCase().includes(query) ||
      el.tag?.toLowerCase().includes(query)
    )
  })

  const isSelected = (element: PrototypeElement) =>
    selectedElements.some((e) => e.id === element.id)

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('name', file.name.replace(/\.html$/, ''))

      const response = await fetch('/api/kody/scenario/prototypes', {
        method: 'POST',
        body: formData,
      })

      if (response.ok) {
        const data = await response.json()
        // Refresh prototypes list
        const listResponse = await fetch('/api/kody/scenario/prototypes')
        if (listResponse.ok) {
          const listData = await listResponse.json()
          setPrototypes(listData.prototypes || [])
        }
        // Select the newly uploaded prototype
        onPrototypeSelect(data.name)
      }
    } catch (error) {
      console.error('Failed to upload prototype:', error)
    }
    setUploading(false)
  }

  return (
    <div className="space-y-4">
      {/* Prototype Selector */}
      <div className="space-y-2">
        <Label>Select Prototype</Label>
        <div className="flex gap-2">
          <select
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={selectedPrototype || ''}
            onChange={(e) => onPrototypeSelect(e.target.value || null)}
          >
            <option value="">Choose a prototype...</option>
            {prototypes.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <div className="relative">
            <input
              type="file"
              accept=".html"
              onChange={handleUpload}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              disabled={uploading}
            />
            <Button variant="outline" size="icon" className="pointer-events-none">
              {uploading ? '...' : <Upload className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>

      {/* Search */}
      {selectedPrototype && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search elements..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      )}

      {/* Selected Elements */}
      {selectedElements.length > 0 && (
        <div className="space-y-2">
          <Label>Selected ({selectedElements.length})</Label>
          <div className="flex flex-wrap gap-1">
            {selectedElements.map((el) => (
              <Badge key={el.id} variant="secondary" className="gap-1">
                {el.tag}
                {el.idAttr && <span className="text-xs opacity-70">#{el.idAttr}</span>}
                <button onClick={() => onElementSelect(el)} className="ml-1 hover:text-destructive">
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Element List */}
      {selectedPrototype && (
        <div className="space-y-2">
          <Label>Elements ({filteredElements.length})</Label>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading elements...</p>
          ) : (
            <div className="max-h-60 overflow-y-auto space-y-1">
              {filteredElements.map((el) => (
                <button
                  key={el.id}
                  onClick={() => onElementSelect(el)}
                  className={`w-full text-left p-2 rounded text-sm transition-colors ${
                    isSelected(el)
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted hover:bg-muted/80'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs opacity-70">&lt;{el.tag}&gt;</span>
                    {el.idAttr && <span className="font-mono text-xs">#{el.idAttr}</span>}
                    {el.classes && el.classes.length > 0 && (
                      <span className="font-mono text-xs opacity-70">.{el.classes[0]}</span>
                    )}
                  </div>
                  {el.text && <p className="truncate text-xs opacity-70 mt-1">{el.text}</p>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
