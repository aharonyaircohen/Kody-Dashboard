/**
 * @fileType tool
 * @domain kody
 * @pattern browse-url
 * @ai-summary Web browsing tool using headless Playwright - fetches and renders JavaScript-heavy pages
 */
import { tool } from 'ai'
import { z } from 'zod'
import { chromium, type Browser, type Page } from 'playwright-core'
import { logger } from '@dashboard/lib/logger'

// ===========================================
// CONSTANTS
// ===========================================

const MAX_CONTENT_SIZE = 50 * 1024 // 50KB max content to return
const NAVIGATION_TIMEOUT = 15_000 // 15s max page load
const PRIVATE_IP_PATTERNS = [
  /^localhost$/i,
  /^127\.0\.0\.1$/,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^169\.254\./, // Link-local
  /^10\./, // Private Class A
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // Private Class B
  /^192\.168\./, // Private Class C
  /^fc00:/i, // IPv6 private
  /^fe80:/i, // IPv6 link-local
]

// ===========================================
// SSRF PROTECTION
// ===========================================

/**
 * Check if a URL points to a private/internal network (SSRF protection)
 */
function isPrivateURL(urlString: string): boolean {
  try {
    const url = new URL(urlString)
    const hostname = url.hostname.toLowerCase()

    // Check localhost variants
    if (PRIVATE_IP_PATTERNS.some((pattern) => pattern.test(hostname))) {
      return true
    }

    // Try to resolve hostname and check if it's a private IP
    // Note: In production, you'd want to do DNS resolution, but for simplicity
    // we'll rely on the hostname patterns above
    return false
  } catch {
    return true // Invalid URL = blocked
  }
}

// ===========================================
// BROWSER MANAGEMENT
// ===========================================

let browser: Browser | null = null

/**
 * Get or create a headless browser instance
 */
async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })
  }
  return browser
}

/**
 * Close the browser (for cleanup)
 */
async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close()
    browser = null
  }
}

// ===========================================
// CONTENT EXTRACTION
// ===========================================

/**
 * Extract readable text content from a page
 */
async function extractPageContent(
  page: Page,
  selector?: string,
): Promise<{ content: string; truncated: boolean }> {
  let textContent: string

  if (selector) {
    // Extract content from a specific element
    const element = page.locator(selector)
    const count = await element.count()
    if (count > 0) {
      textContent = await element.first().innerText()
    } else {
      textContent = ''
    }
  } else {
    // Extract all text content from body
    textContent = await page.evaluate(() => {
      // Remove script and style elements
      const scripts = document.querySelectorAll('script, style, noscript, iframe')
      scripts.forEach((el) => el.remove())

      // Get text content
      const body = document.body
      return body?.innerText?.trim() || ''
    })
  }

  // Truncate if necessary
  const truncated = textContent.length > MAX_CONTENT_SIZE
  if (truncated) {
    textContent = textContent.slice(0, MAX_CONTENT_SIZE) + '\n\n[... content truncated ...]'
  }

  return { content: textContent, truncated }
}

/**
 * Get page metadata
 */
async function getPageMetadata(page: Page): Promise<{ title: string; url: string }> {
  const title = await page.title()
  const url = page.url()

  return { title, url }
}

// ===========================================
// TOOL DEFINITION
// ===========================================

export const browseUrlTool = tool({
  description:
    'Fetch and read any public web page. Handles JavaScript-rendered content (like Figma sites, SPAs). Use this when a user shares a URL and wants you to read or analyze its content.',
  inputSchema: z.object({
    url: z.string().url().describe('The URL of the page to browse'),
    selector: z
      .string()
      .optional()
      .describe(
        'Optional CSS selector to extract specific content (e.g., ".main-content", "article")',
      ),
  }),
  execute: async ({ url, selector }) => {
    // SSRF protection
    if (isPrivateURL(url)) {
      logger.warn({ url }, 'Blocked request to private/internal URL')
      return {
        error: 'Cannot access private or internal URLs. This URL is blocked for security reasons.',
      }
    }

    let page: Page | null = null

    try {
      const browserInstance = await getBrowser()
      page = await browserInstance.newPage()

      // Set a custom user agent
      await page.setExtraHTTPHeaders({
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      })

      // Navigate to the URL with timeout
      await page.goto(url, {
        waitUntil: 'networkidle', // Wait for network to be idle (handles JS-rendered content)
        timeout: NAVIGATION_TIMEOUT,
      })

      // Get metadata
      const { title, url: finalUrl } = await getPageMetadata(page)

      // Extract content
      const { content, truncated } = await extractPageContent(page, selector)

      // Check if we got meaningful content
      if (!content || content.trim().length < 10) {
        return {
          error:
            'The page appears to be empty or could not be rendered. It may require authentication or be a binary file.',
        }
      }

      return {
        title,
        url: finalUrl,
        content,
        truncated,
        selectorUsed: selector || null,
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      // Handle specific error types
      if (errorMessage.includes('net::ERR_NAME_NOT_RESOLVED')) {
        return { error: 'Could not resolve the domain name. Please check the URL.' }
      }

      if (errorMessage.includes('net::ERR_CONNECTION_REFUSED')) {
        return { error: 'Connection refused. The server may be down or blocking requests.' }
      }

      if (errorMessage.includes('Timeout')) {
        return {
          error: 'Page load timed out. The page may be taking too long to load or be unavailable.',
        }
      }

      logger.error({ err: error, url }, 'Browser tool error')
      return { error: `Failed to load page: ${errorMessage}` }
    } finally {
      // Clean up the page
      if (page) {
        await page.close()
      }
    }
  },
})

// ===========================================
// CLEANUP
// ===========================================

/**
 * Cleanup function to be called on server shutdown
 */
export function cleanupBrowserTool(): void {
  closeBrowser()
}

// Register cleanup handlers
if (typeof process !== 'undefined') {
  process.on('beforeExit', cleanupBrowserTool)
  process.on('SIGTERM', cleanupBrowserTool)
  process.on('SIGINT', cleanupBrowserTool)
}
