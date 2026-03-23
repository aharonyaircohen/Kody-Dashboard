/**
 * @fileType api-route
 * @domain kody
 * @pattern scenario-prototypes-api
 * @ai-summary API endpoint to list and upload prototypes
 */
import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

// Base directory for prototypes
const PROTOTYPE_BASE_PATH = path.resolve(process.cwd(), 'site-docs/prototypes')

export async function GET() {
  try {
    // Dynamic import to avoid build issues
    const { listPrototypes } = await import('@dashboard/lib/scenario-stub')
    const prototypes = await listPrototypes()

    return NextResponse.json({ prototypes })
  } catch (error) {
    console.error('Failed to load prototypes:', error)
    return NextResponse.json({ error: 'Failed to load prototypes' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const name = formData.get('name') as string | null

    if (!file || !file.name.endsWith('.html')) {
      return NextResponse.json({ error: 'Invalid file - must be HTML' }, { status: 400 })
    }

    // Ensure directory exists
    if (!fs.existsSync(PROTOTYPE_BASE_PATH)) {
      fs.mkdirSync(PROTOTYPE_BASE_PATH, { recursive: true })
    }

    // Determine filename
    const fileName = name || file.name.replace(/\.html$/, '')
    const filePath = path.join(PROTOTYPE_BASE_PATH, `${fileName}.html`)

    // Write file
    const content = await file.text()
    fs.writeFileSync(filePath, content)

    return NextResponse.json({ success: true, name: fileName, path: filePath })
  } catch (error) {
    console.error('Failed to upload prototype:', error)
    return NextResponse.json({ error: 'Failed to upload prototype' }, { status: 500 })
  }
}
