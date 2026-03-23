/**
 * @fileType api-route
 * @domain kody
 * @pattern scenario-save-api
 * @ai-summary API endpoint to save scenarios to filesystem
 */
import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

// Base directory for scenarios
const SCENARIOS_BASE_PATH = path.resolve(process.cwd(), 'tests/qa/student/scenarios')

export async function GET() {
  try {
    const scenarios: Array<{ id: string; name: string; type: string; path: string }> = []

    // Walk through all category directories
    const categories = ['core', 'feature', 'edge']
    for (const category of categories) {
      const categoryPath = path.join(SCENARIOS_BASE_PATH, category)
      if (!fs.existsSync(categoryPath)) continue

      const files = fs.readdirSync(categoryPath)
      for (const file of files) {
        if (!file.endsWith('.json')) continue
        const filePath = path.join(categoryPath, file)
        const content = fs.readFileSync(filePath, 'utf-8')
        try {
          const data = JSON.parse(content)
          scenarios.push({
            id: data.id || file.replace('.json', ''),
            name: data.name || file.replace('.json', ''),
            type: data.type || category,
            path: filePath,
          })
        } catch {
          // Skip invalid JSON files
        }
      }
    }

    return NextResponse.json({ scenarios })
  } catch (error) {
    console.error('Failed to list scenarios:', error)
    return NextResponse.json({ error: 'Failed to list scenarios' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { scenario, category = 'feature' } = body

    if (!scenario || !scenario.id) {
      return NextResponse.json({ error: 'Invalid scenario' }, { status: 400 })
    }

    // Ensure directory exists
    const categoryPath = path.join(SCENARIOS_BASE_PATH, category)
    if (!fs.existsSync(categoryPath)) {
      fs.mkdirSync(categoryPath, { recursive: true })
    }

    // Write scenario file
    const filePath = path.join(categoryPath, `${scenario.id}.json`)
    fs.writeFileSync(filePath, JSON.stringify(scenario, null, 2))

    return NextResponse.json({ success: true, path: filePath })
  } catch (error) {
    console.error('Failed to save scenario:', error)
    return NextResponse.json({ error: 'Failed to save scenario' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    const category = searchParams.get('category') || 'feature'

    if (!id) {
      return NextResponse.json({ error: 'Missing scenario id' }, { status: 400 })
    }

    const filePath = path.join(SCENARIOS_BASE_PATH, category, `${id}.json`)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete scenario:', error)
    return NextResponse.json({ error: 'Failed to delete scenario' }, { status: 500 })
  }
}
