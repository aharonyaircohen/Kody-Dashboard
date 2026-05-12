/**
 * @fileType component
 * @domain kody
 * @pattern scenario-wizard-orchestrator
 * @ai-summary Main orchestrator for ScenarioWizard - renders steps and manages navigation
 */
'use client'

import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { useScenarioWizard } from './_hooks/useScenarioWizard'
import { StepIndicator } from './_components/StepIndicator'
import { WizardNavigation } from './_components/WizardNavigation'
import { WizardDialog } from './_components/WizardDialog'
import { NameStep } from './_components/steps/NameStep'
import { PrototypeStep } from './_components/steps/PrototypeStep'
import { StepsStep } from './_components/steps/StepsStep'
import { SaveStep } from './_components/steps/SaveStep'
import { STEPS } from './_constants/wizard'
import type { ScenarioWizardProps, WizardStep } from './_types/wizard'

export function ScenarioWizard({ initialScenario }: ScenarioWizardProps) {
  // Wizard state and actions
  const wizard = useScenarioWizard({ initialScenario })

  // Local navigation state
  const [currentStep, setCurrentStep] = useState<WizardStep>('name')

  // Navigation helpers
  const stepIndex = STEPS.findIndex((s) => s.id === currentStep)
  const canGoBack = stepIndex > 0
  const canGoForward = stepIndex < STEPS.length - 1

  const goNext = useCallback(() => {
    if (currentStep === 'name' && !wizard.scenario.name) {
      toast.error('Please enter a scenario name')
      return
    }
    if (canGoForward) {
      setCurrentStep(STEPS[stepIndex + 1].id)
    }
  }, [currentStep, wizard.scenario.name, canGoForward, stepIndex])

  const goBack = useCallback(() => {
    if (canGoBack) {
      setCurrentStep(STEPS[stepIndex - 1].id)
    }
  }, [canGoBack, stepIndex])

  const goToStep = useCallback(
    (step: WizardStep) => {
      const targetIndex = STEPS.findIndex((s) => s.id === step)
      if (targetIndex <= stepIndex) {
        setCurrentStep(step)
      } else if (wizard.scenario.name) {
        setCurrentStep(step)
      }
    },
    [stepIndex, wizard.scenario.name],
  )

  // Render step content
  const renderStepContent = () => {
    switch (currentStep) {
      case 'name':
        return (
          <NameStep
            scenario={wizard.scenario}
            onNameChange={wizard.handleNameChange}
            onTypeChange={wizard.handleTypeChange}
          />
        )

      case 'prototype':
        return (
          <PrototypeStep
            selectedPrototype={wizard.selectedPrototype}
            selectedElements={wizard.selectedElements}
            selectedComponents={wizard.selectedComponents}
            onPrototypeSelect={wizard.setSelectedPrototype}
            onElementSelect={wizard.handleElementSelect}
            onComponentSelect={wizard.handleComponentSelect}
          />
        )

      case 'steps':
        return (
          <StepsStep
            scenario={wizard.scenario}
            selectedElements={wizard.selectedElements}
            selectedComponents={wizard.selectedComponents}
            onAddStep={wizard.handleAddStep}
            onRemoveStep={wizard.handleRemoveStep}
          />
        )

      case 'save':
        return (
          <SaveStep
            scenario={wizard.scenario}
            selectedPrototype={wizard.selectedPrototype}
            selectedComponents={wizard.selectedComponents}
            onSave={wizard.handleSaveScenario}
            onCreateGitHubIssue={() => wizard.setShowPRDDialog(true)}
            onExport={wizard.handleExport}
          />
        )

      default:
        return null
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container py-4">
          <h1 className="text-2xl font-bold">Create Scenario</h1>
        </div>
      </header>

      {/* Step Indicator */}
      <StepIndicator steps={STEPS} currentStep={currentStep} onStepClick={goToStep} />

      {/* Content */}
      <div className="container py-8">
        <div className="max-w-4xl mx-auto">{renderStepContent()}</div>
      </div>

      {/* Navigation */}
      <WizardNavigation
        currentStep={currentStep}
        canGoBack={canGoBack}
        onBack={goBack}
        onNext={goNext}
      />

      {/* PRD Dialog */}
      <WizardDialog
        open={wizard.showPRDDialog}
        onOpenChange={wizard.setShowPRDDialog}
        scenario={wizard.scenario}
        selectedComponents={wizard.selectedComponents}
        onCreateGitHubIssue={wizard.handleCreateGitHubIssue}
      />
    </div>
  )
}

export type { ScenarioWizardProps }
