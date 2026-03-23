/**
 * Strip markdown formatting from text for TTS
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/^\s*[-*+]\s/gm, '')
    .replace(/^\s*\d+\.\s/gm, '')
    .replace(/>\s/g, '')
    .trim()
}

/**
 * Detect language from text content
 */
export function detectLanguage(text: string): 'he' | 'en' {
  const hebrewRegex = /[\u0590-\u05FF]/
  const hebrewCount = (text.match(hebrewRegex) || []).length
  return hebrewCount > text.length * 0.3 ? 'he' : 'en'
}
