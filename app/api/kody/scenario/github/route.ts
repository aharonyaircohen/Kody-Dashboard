/**
 * @fileType api-route
 * @domain kody
 * @pattern scenario-github-api
 * @ai-summary API endpoint to create GitHub issues from scenarios
 */
import { NextRequest, NextResponse } from 'next/server'
import { createScenarioIssue } from '@dashboard/lib/scenario-stub'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { title, category, area, scenario, prototype, fixture, behaviors, dsComponents } = body

    if (!title || !category || !scenario) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const issue = await createScenarioIssue({
      title,
      category,
      area,
      scenario,
      prototype,
      fixture,
      behaviors,
      dsComponents,
    })

    return NextResponse.json({
      success: true,
      number: issue.number,
      url: issue.html_url,
    })
  } catch (error) {
    console.error('Failed to create GitHub issue:', error)
    return NextResponse.json({ error: 'Failed to create GitHub issue' }, { status: 500 })
  }
}
