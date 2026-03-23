/**
 * @fileType component
 * @domain kody
 * @pattern step-indicator
 * @ai-summary Shows wizard progress with clickable step indicators
 */
'use client'

import { Check } from 'lucide-react'
import type { WizardStepConfig, WizardStep } from '../_types/wizard'

interface StepIndicatorProps {
  steps: WizardStepConfig[]
  currentStep: WizardStep
  onStepClick: (step: WizardStep) => void
}

export function StepIndicator({ steps, currentStep, onStepClick }: StepIndicatorProps) {
  const currentIndex = steps.findIndex((s) => s.id === currentStep)

  return (
    <div className="border-b bg-muted/30">
      <div className="container py-4">
        <div className="flex items-center justify-center gap-2">
          {steps.map((step, index) => {
            const isCompleted = index < currentIndex
            const isCurrent = step.id === currentStep
            const isClickable = index <= currentIndex

            return (
              <button
                key={step.id}
                onClick={() => isClickable && onStepClick(step.id)}
                disabled={!isClickable}
                className={`
                  flex items-center gap-2 px-4 py-2 rounded-full transition-colors
                  ${
                    isCurrent
                      ? 'bg-primary text-primary-foreground'
                      : isCompleted
                        ? 'bg-muted hover:bg-muted/80 cursor-pointer'
                        : 'opacity-50 cursor-not-allowed'
                  }
                `}
              >
                {isCompleted ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <span className="h-5 w-5 rounded-full border flex items-center justify-center text-xs">
                    {index + 1}
                  </span>
                )}
                <span className="font-medium">{step.label}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
