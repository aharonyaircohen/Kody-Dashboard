/**
 * @fileType api-route
 * @domain kody
 * @pattern scenario-components-api
 * @ai-summary API endpoint to list design system components
 */
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    // Dynamic import to avoid build issues
    const { loadDesignSystemComponents } = await import('@dashboard/lib/scenario-stub')
    const components = await loadDesignSystemComponents()

    return NextResponse.json({ components })
  } catch (error) {
    console.error('Failed to load components:', error)
    return NextResponse.json({ error: 'Failed to load components' }, { status: 500 })
  }
}
