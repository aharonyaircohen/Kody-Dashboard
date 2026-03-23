/**
 * @fileType api-route
 * @domain kody
 * @pattern scenario-prototype-detail-api
 * @ai-summary API endpoint to get a specific prototype by name
 */
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  try {
    const { name } = await params

    // Dynamic import to avoid build issues
    const { loadPrototype } = await import('@dashboard/lib/scenario-stub')
    const prototype = await loadPrototype(name)

    if (!prototype) {
      return NextResponse.json({ error: 'Prototype not found' }, { status: 404 })
    }

    return NextResponse.json(prototype)
  } catch (error) {
    console.error('Failed to load prototype:', error)
    return NextResponse.json({ error: 'Failed to load prototype' }, { status: 500 })
  }
}
