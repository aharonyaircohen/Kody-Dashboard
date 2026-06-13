/**
 * @fileType api-route
 * @domain kody
 * @pattern scenario-prototypes-api
 * @ai-summary API endpoint to list and upload prototypes
 */
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { requireKodyAuth } from "@dashboard/lib/auth";
import {
  parseSafeFileStem,
  resolveUnderBase,
} from "@dashboard/lib/scenario-paths";

// Base directory for prototypes
const PROTOTYPE_BASE_PATH = path.resolve(process.cwd(), "site-docs/prototypes");

export async function GET() {
  try {
    // Dynamic import to avoid build issues
    const { listPrototypes } = await import("@dashboard/lib/scenario-stub");
    const prototypes = await listPrototypes();

    return NextResponse.json({ prototypes });
  } catch (error) {
    console.error("Failed to load prototypes:", error);
    return NextResponse.json(
      { error: "Failed to load prototypes" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireKodyAuth(request);
  if (authError) return authError;

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const name = formData.get("name") as string | null;

    if (!file || !file.name.endsWith(".html")) {
      return NextResponse.json(
        { error: "Invalid file - must be HTML" },
        { status: 400 },
      );
    }

    // Ensure directory exists
    if (!fs.existsSync(PROTOTYPE_BASE_PATH)) {
      fs.mkdirSync(PROTOTYPE_BASE_PATH, { recursive: true });
    }

    // Determine filename
    const fileName = parseSafeFileStem(name || file.name);
    if (!fileName) {
      return NextResponse.json(
        { error: "Invalid prototype name" },
        { status: 400 },
      );
    }
    const filePath = resolveUnderBase(PROTOTYPE_BASE_PATH, `${fileName}.html`);
    if (!filePath) {
      return NextResponse.json(
        { error: "Invalid prototype path" },
        { status: 400 },
      );
    }

    // Write file
    const content = await file.text();
    fs.writeFileSync(filePath, content);

    return NextResponse.json({ success: true, name: fileName, path: filePath });
  } catch (error) {
    console.error("Failed to upload prototype:", error);
    return NextResponse.json(
      { error: "Failed to upload prototype" },
      { status: 500 },
    );
  }
}
