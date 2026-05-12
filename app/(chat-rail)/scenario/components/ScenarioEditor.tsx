/**
 * @fileType component
 * @domain kody
 * @pattern scenario-editor
 * @ai-summary Main scenario editor component with prototype, design system, and scenario builder panels
 */
'use client'

import { useState, useCallback } from 'react'
import { Button } from '@dashboard/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@dashboard/ui/card'
import { Input } from '@dashboard/ui/input'
import { Label } from '@dashboard/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@dashboard/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@dashboard/ui/tabs'
import { Badge } from '@dashboard/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@dashboard/ui/dialog'
import { PrototypePanel } from './PrototypePanel'
import { DesignSystemPanel } from './DesignSystemPanel'
import { ScenarioBuilder } from './ScenarioBuilder'
import { PRDCard } from './PRDCard'
import { Scenario, DSComponent, PrototypeElement } from '@dashboard/lib/scenario-schema-stub'
import { toast } from 'sonner'

type ScenarioEditorProps = object

export function ScenarioEditor({}: ScenarioEditorProps) {
  // State
  const [scenario, setScenario] = useState<Partial<Scenario>>({
    id: '',
    name: '',
    type: 'feature',
    steps: [],
    status: 'draft',
  })
  const [selectedPrototype, setSelectedPrototype] = useState<string | null>(null)
  const [selectedElements, setSelectedElements] = useState<PrototypeElement[]>([])
  const [selectedComponents, setSelectedComponents] = useState<DSComponent[]>([])
  const [showPRDDialog, setShowPRDDialog] = useState(false)

  // Handlers
  const handleScenarioNameChange = useCallback((name: string) => {
    setScenario((prev) => ({
      ...prev,
      id: name.toLowerCase().replace(/\s+/g, '-'),
      name,
    }))
  }, [])

  const handleScenarioTypeChange = useCallback((type: 'core' | 'feature' | 'edge') => {
    setScenario((prev) => ({ ...prev, type }))
  }, [])

  const handleElementSelect = useCallback((element: PrototypeElement) => {
    setSelectedElements((prev) => {
      const exists = prev.some((e) => e.id === element.id)
      if (exists) {
        return prev.filter((e) => e.id !== element.id)
      }
      return [...prev, element]
    })
  }, [])

  const handleComponentSelect = useCallback((component: DSComponent) => {
    setSelectedComponents((prev) => {
      const exists = prev.some((c) => c.name === component.name)
      if (exists) {
        return prev.filter((c) => c.name !== component.name)
      }
      return [...prev, component]
    })
  }, [])

  const handleAddStep = useCallback(
    (step: { type: string; action: string; target: string; component?: string }) => {
      setScenario((prev) => ({
        ...prev,
        steps: [
          ...(prev.steps || []),
          {
            type: step.type as 'given' | 'when' | 'then' | 'and' | 'but',
            action: step.action,
            target: step.target,
            component: step.component,
          },
        ],
      }))
    },
    [],
  )

  const handleRemoveStep = useCallback((index: number) => {
    setScenario((prev) => ({
      ...prev,
      steps: prev.steps?.filter((_, i) => i !== index),
    }))
  }, [])

  const handleGeneratePRD = useCallback(() => {
    if (!scenario.name || !scenario.steps?.length) {
      toast.error('Please fill in scenario name and add at least one step')
      return
    }
    setShowPRDDialog(true)
  }, [scenario])

  const handleSaveScenario = useCallback(async () => {
    if (!scenario.id || !scenario.name) {
      toast.error('Please enter a scenario name')
      return
    }

    try {
      // Save to file system
      const response = await fetch('/api/kody/scenario/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenario: {
            ...scenario,
            status: 'draft',
            createdAt: new Date().toISOString(),
          },
          category: scenario.type || 'feature',
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to save')
      }

      toast.success(`Scenario "${scenario.name}" saved`)
    } catch (error) {
      toast.error('Failed to save scenario')
      console.error(error)
    }
  }, [scenario])

  const handleCreateGitHubIssue = useCallback(async () => {
    if (!scenario.name || !scenario.steps?.length) {
      toast.error('Please add name and steps first')
      return
    }

    try {
      const response = await fetch('/api/kody/scenario/github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: scenario.name,
          category: scenario.type || 'feature',
          area: scenario.area,
          scenario: scenario.steps.map((s) => `${s.type}: ${s.action} ${s.target}`).join('\n'),
          prototype: selectedPrototype,
          fixture: scenario.fixture,
          behaviors: scenario.siteBehaviors,
          dsComponents: selectedComponents.map((c) => c.name),
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to create issue')
      }

      const data = await response.json()
      toast.success(`GitHub issue #${data.number} created`)
      setShowPRDDialog(false)
    } catch (error) {
      toast.error('Failed to create GitHub issue')
      console.error(error)
    }
  }, [scenario, selectedPrototype, selectedComponents])

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container flex items-center justify-between py-4">
          <div>
            <h1 className="text-2xl font-bold">Scenario Editor</h1>
            <p className="text-sm text-muted-foreground">
              Create scenarios using prototypes and design system components
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleSaveScenario}>
              Save Draft
            </Button>
            <Button onClick={handleGeneratePRD}>Generate PRD</Button>
          </div>
        </div>
      </header>

      {/* Main Content - 3 column layout */}
      <div className="container py-6">
        <div className="grid grid-cols-12 gap-6">
          {/* Left Column - Scenario Config + Steps */}
          <div className="col-span-3 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Scenario</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    placeholder="e.g., Student solves MCQ"
                    value={scenario.name || ''}
                    onChange={(e) => handleScenarioNameChange(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="type">Type</Label>
                  <Select
                    value={scenario.type}
                    onValueChange={(v) =>
                      handleScenarioTypeChange(v as 'core' | 'feature' | 'edge')
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="core">Core</SelectItem>
                      <SelectItem value="feature">Feature</SelectItem>
                      <SelectItem value="edge">Edge Case</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Status</Label>
                  <Badge variant={scenario.status === 'draft' ? 'secondary' : 'default'}>
                    {scenario.status || 'draft'}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            {/* Steps List */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Steps ({scenario.steps?.length || 0})</CardTitle>
              </CardHeader>
              <CardContent>
                {scenario.steps && scenario.steps.length > 0 ? (
                  <div className="space-y-2">
                    {scenario.steps.map((step, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between p-2 rounded bg-muted text-sm"
                      >
                        <div className="flex-1 min-w-0">
                          <Badge variant="outline" className="mr-2 mb-1">
                            {step.type}
                          </Badge>
                          <span className="font-medium truncate block">{step.action}</span>
                          <span className="text-xs text-muted-foreground truncate block">
                            {step.target}
                          </span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="ml-2"
                          onClick={() => handleRemoveStep(index)}
                        >
                          ×
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No steps added yet</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Middle Column - Input Panels */}
          <div className="col-span-6">
            <Tabs defaultValue="prototype" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="prototype">Prototype</TabsTrigger>
                <TabsTrigger value="design-system">Design System</TabsTrigger>
                <TabsTrigger value="builder">Builder</TabsTrigger>
              </TabsList>
              <TabsContent value="prototype">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Prototype</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <PrototypePanel
                      selectedElements={selectedElements}
                      onElementSelect={handleElementSelect}
                      selectedPrototype={selectedPrototype}
                      onPrototypeSelect={setSelectedPrototype}
                    />
                  </CardContent>
                </Card>
              </TabsContent>
              <TabsContent value="design-system">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Design System</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <DesignSystemPanel
                      selectedComponents={selectedComponents}
                      onComponentSelect={handleComponentSelect}
                    />
                  </CardContent>
                </Card>
              </TabsContent>
              <TabsContent value="builder">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Build Scenario</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ScenarioBuilder
                      selectedElements={selectedElements}
                      selectedComponents={selectedComponents}
                      onAddStep={handleAddStep}
                      scenario={scenario as never}
                    />
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>

          {/* Right Column - Preview */}
          <div className="col-span-3">
            <Card className="sticky top-6">
              <CardHeader>
                <CardTitle className="text-lg">Preview</CardTitle>
              </CardHeader>
              <CardContent>
                <PRDCard scenario={scenario} />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* PRD Dialog */}
      <Dialog open={showPRDDialog} onOpenChange={setShowPRDDialog}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Generated PRD</DialogTitle>
            <DialogDescription>
              Review and create a GitHub issue for this scenario
            </DialogDescription>
          </DialogHeader>
          <PRDCard scenario={scenario} expanded />
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowPRDDialog(false)}>
              Close
            </Button>
            <Button onClick={handleCreateGitHubIssue}>Create GitHub Issue</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
