/**
 * @fileType api-route
 * @domain kody
 * @pattern action-registry-api
 * @ai-summary API endpoint to list available QA actions
 */
import { NextResponse } from 'next/server'

// Action metadata for UI display
const ACTION_METADATA: Record<string, { category: string; description: string; example: string }> =
  {
    // Session
    login: {
      category: 'Session',
      description: 'Log in with user credentials',
      example: '{ userRef: "$student" }',
    },
    logout: {
      category: 'Session',
      description: 'Log out current user',
      example: '{}',
    },
    startAsGuest: {
      category: 'Session',
      description: 'Start session as guest',
      example: '{}',
    },

    // Navigation
    navigate: {
      category: 'Navigation',
      description: 'Navigate to a page',
      example: '{ type: "home" } or { path: "/courses" }',
    },
    navigateBack: {
      category: 'Navigation',
      description: 'Navigate back in browser history',
      example: '{}',
    },
    clickTab: {
      category: 'Navigation',
      description: 'Click a tab by selector',
      example: '{ selector: "#tab-id" }',
    },

    // Lesson
    startLesson: {
      category: 'Lesson',
      description: 'Start a lesson by ID',
      example: '{ lessonId: "lesson-123" }',
    },
    navigateExercise: {
      category: 'Lesson',
      description: 'Navigate to a specific exercise',
      example: '{ exerciseId: "ex-1" }',
    },
    completeLesson: {
      category: 'Lesson',
      description: 'Mark current lesson as complete',
      example: '{}',
    },

    // Exercise
    answer: {
      category: 'Exercise',
      description: 'Submit an answer to an exercise',
      example: '{ type: "mcq", selectedIds: ["opt-1"] }',
    },
    checkAnswer: {
      category: 'Exercise',
      description: 'Check if current answer is correct',
      example: '{}',
    },
    requestHelp: {
      category: 'Exercise',
      description: 'Request help for current exercise',
      example: '{ type: "hint" } or { type: "solution" }',
    },

    // Chat
    sendMessage: {
      category: 'Chat',
      description: 'Send a chat message',
      example: '{ message: "Hello" }',
    },
    waitForMessage: {
      category: 'Chat',
      description: 'Wait for a chat response',
      example: '{ timeout: 5000 }',
    },

    // Assertions
    see: {
      category: 'Assertion',
      description: 'Assert element is visible',
      example: '{ selector: "#element" }',
    },
    dontSee: {
      category: 'Assertion',
      description: 'Assert element is NOT visible',
      example: '{ selector: "#element" }',
    },
    beAt: {
      category: 'Assertion',
      description: 'Assert current URL matches pattern',
      example: '{ pattern: "/courses" }',
    },
    seeFeedback: {
      category: 'Assertion',
      description: 'Assert feedback message is visible',
      example: '{ message: "Correct!" }',
    },

    // PDF
    seePdf: {
      category: 'PDF',
      description: 'Assert PDF is visible',
      example: '{ url: "/path/to/pdf" }',
    },

    // Utility
    resizeViewport: {
      category: 'Utility',
      description: 'Resize browser viewport',
      example: '{ width: 375, height: 812 }',
    },
  }

export async function GET() {
  try {
    const actions = Object.entries(ACTION_METADATA).map(([name, meta]) => ({
      name,
      ...meta,
    }))

    // Group by category
    const grouped = actions.reduce(
      (acc, action) => {
        if (!acc[action.category]) {
          acc[action.category] = []
        }
        acc[action.category].push({
          name: action.name,
          description: action.description,
          example: action.example,
        })
        return acc
      },
      {} as Record<string, Array<{ name: string; description: string; example: string }>>,
    )

    return NextResponse.json({
      actions,
      grouped,
      total: actions.length,
    })
  } catch (error) {
    console.error('Failed to list actions:', error)
    return NextResponse.json({ error: 'Failed to list actions' }, { status: 500 })
  }
}
