/**
 * @fileType component
 * @domain kody
 * @pattern wizard-navigation
 * @ai-summary Bottom navigation for wizard - back/next buttons with step counter
 */
'use client'

import { Button } from '@dashboard/ui/button'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { WizardStep } from '../_types/wizard'
import { STEPS } from '../_constants/wizard'

interface WizardNavigationProps {
  currentStep: WizardStep
  canGoBack: boolean
  onBack: () => void
  onNext: () => void
}

export function WizardNavigation({
  currentStep,
  canGoBack,
  onBack,
  onNext,
}: WizardNavigationProps) {
  const stepIndex = STEPS.findIndex((s) => s.id === currentStep)
  const isLastStep = stepIndex === STEPS.length - 1

  return (
    <div className="fixed bottom-0 left-0 right-0 border-t bg-background">
      <div className="container py-4">
        <div className="flex justify-between items-center max-w-4xl mx-auto">
          <Button variant="outline" onClick={onBack} disabled={!canGoBack}>
            <ChevronLeft className="h-4 w-4 mr-2" />
            Back
          </Button>

          <span className="text-sm text-muted-foreground">
            Step {stepIndex + 1} of {STEPS.length}
          </span>

          {isLastStep ? (
            <div /> // Spacer to balance layout
          ) : (
            <Button onClick={onNext}>
              {stepIndex === 0 ? 'Review' : 'Next'}
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
