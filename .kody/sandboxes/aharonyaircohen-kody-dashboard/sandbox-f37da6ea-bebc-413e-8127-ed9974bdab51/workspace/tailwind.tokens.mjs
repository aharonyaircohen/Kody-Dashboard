/**
 * Design Tokens for A-Guy Design System
 *
 * This file defines semantic design tokens used throughout the application.
 * Import these tokens in tailwind.config.mjs to extend the theme.
 */

/**
 * Spacing Scale
 * Semantic spacing tokens for consistent layout
 */
export const spacing = {
  // Section spacing (vertical rhythm)
  'section-xs': '2rem', // 32px - Compact sections
  'section-sm': '3rem', // 48px - Small sections
  'section-md': '4rem', // 64px - Medium sections (default)
  'section-lg': '6rem', // 96px - Large sections
  'section-xl': '8rem', // 128px - Extra large sections

  // Card/Component padding
  'card-padding-sm': '1rem', // 16px - Compact cards
  'card-padding': '1.5rem', // 24px - Default card padding
  'card-padding-lg': '2rem', // 32px - Spacious cards

  // Content spacing
  'content-gap-xs': '0.75rem', // 12px - Tight content
  'content-gap-sm': '1rem', // 16px - Small content gap
  'content-gap': '1.5rem', // 24px - Default content gap
  'content-gap-lg': '2rem', // 32px - Large content gap
  'content-gap-xl': '3rem', // 48px - Extra large content gap
}

/**
 * Shadow System
 * Elevation-based shadow tokens
 */
export const boxShadow = {
  // Elevation levels
  'elevation-1': '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  'elevation-2': '0 2px 4px 0 rgb(0 0 0 / 0.06)',
  'elevation-3': '0 4px 6px -1px rgb(0 0 0 / 0.1)',
  'elevation-4': '0 10px 15px -3px rgb(0 0 0 / 0.1)',

  // Component-specific shadows
  card: '0 2px 8px 0 rgb(0 0 0 / 0.08)',
  'card-hover': '0 4px 12px 0 rgb(0 0 0 / 0.12)',
  modal: '0 10px 25px -5px rgb(0 0 0 / 0.15)',
  dropdown: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -1px rgb(0 0 0 / 0.06)',
  'focus-ring': '0 0 0 3px hsl(var(--ring) / 0.5)',
}

/**
 * Z-Index Scale
 * Stacking order tokens
 */
export const zIndex = {
  base: '0',
  dropdown: '1000',
  sticky: '1100',
  fixed: '1200',
  'modal-backdrop': '1300',
  modal: '1400',
  popover: '1500',
  tooltip: '1600',
  toast: '1700',
}

/**
 * Typography Scale
 * Semantic font size tokens
 */
export const fontSize = {
  // Display sizes (for hero sections, landing pages)
  'display-2xl': ['4.5rem', { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '700' }], // 72px
  'display-xl': ['3.75rem', { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '700' }], // 60px
  'display-lg': ['3rem', { lineHeight: '1.2', letterSpacing: '-0.01em', fontWeight: '700' }], // 48px
  'display-md': ['2.25rem', { lineHeight: '1.2', letterSpacing: '-0.01em', fontWeight: '600' }], // 36px
  'display-sm': ['1.875rem', { lineHeight: '1.3', fontWeight: '600' }], // 30px

  // Heading sizes (for content headings)
  'heading-xl': ['1.5rem', { lineHeight: '1.3', fontWeight: '600' }], // 24px
  'heading-lg': ['1.25rem', { lineHeight: '1.4', fontWeight: '600' }], // 20px
  'heading-md': ['1.125rem', { lineHeight: '1.4', fontWeight: '600' }], // 18px
  'heading-sm': ['1rem', { lineHeight: '1.5', fontWeight: '600' }], // 16px

  // Body text sizes
  'body-xl': ['1.25rem', { lineHeight: '1.6' }], // 20px
  'body-lg': ['1.125rem', { lineHeight: '1.6' }], // 18px
  'body-md': ['1rem', { lineHeight: '1.6' }], // 16px - Default
  'body-sm': ['0.875rem', { lineHeight: '1.5' }], // 14px
  'body-xs': ['0.75rem', { lineHeight: '1.5' }], // 12px

  // Monospace sizes (for code)
  'code-lg': ['1rem', { lineHeight: '1.6', fontFamily: 'var(--font-geist-mono)' }],
  'code-md': ['0.875rem', { lineHeight: '1.6', fontFamily: 'var(--font-geist-mono)' }],
  'code-sm': ['0.75rem', { lineHeight: '1.6', fontFamily: 'var(--font-geist-mono)' }],

  // Label text (for form labels, badges, small caps)
  label: ['0.75rem', { lineHeight: '1rem', fontWeight: '500' }], // 12px semibold
}

/**
 * Animation Durations
 * Consistent timing tokens
 */
export const transitionDuration = {
  fast: '100ms',
  normal: '200ms',
  slow: '300ms',
  slower: '500ms',
}

/**
 * Letter Spacing Scale
 * Consistent tracking tokens
 */
export const letterSpacing = {
  'tracking-xs': '0.05em', // Very tight
  'tracking-sm': '0.1em', // Small caps
  'tracking-md': '0.15em', // Footer copyright style
  'tracking-lg': '0.2em', // All caps
}

/**
 * Border Widths
 * Semantic border tokens
 */
export const borderWidth = {
  thin: '1px',
  medium: '2px',
  thick: '3px',
  heavy: '4px',
}

/**
 * Opacity Scale
 * Semantic opacity tokens
 */
export const opacity = {
  disabled: '0.5',
  hover: '0.8',
  muted: '0.6',
  subtle: '0.4',
}

/**
 * Border Radius Scale
 * Semantic radius tokens for consistent rounding
 */
export const borderRadius = {
  // Chat bubble radii (commonly used in ChatInterface)
  'chat-xs': '8px', // 8px - small chat bubbles
  'chat-sm': '12px', // 12px - compact chat
  'chat-md': '16px', // 16px - medium chat
  'chat-lg': '20px', // 20px - standard chat bubble
  'chat-xl': '24px', // 24px - large chat bubble
  'chat-2xl': '30px', // 30px - extra large chat bubble
}

/**
 * Icon Size Scale
 * Semantic icon size tokens for consistent iconography
 */
export const iconSize = {
  'icon-xs': '0.75rem', // 12px - extra small icons
  'icon-sm': '1rem', // 16px - small icons
  'icon-md': '1.25rem', // 20px - medium icons (default)
  'icon-lg': '1.5rem', // 24px - large icons
  'icon-xl': '2rem', // 32px - extra large icons
  'icon-2xl': '2.5rem', // 40px - 2xl icons
}

/**
 * Input Height Scale
 * Semantic input height tokens for consistent form elements
 */
export const inputHeight = {
  'input-h-sm': '2rem', // 32px - compact inputs
  'input-h-md': '2.5rem', // 40px - default inputs
  'input-h-lg': '3rem', // 48px - large inputs
}

/**
 * Chat Input Text Size
 * Specific text size for chat input (17px observed in ChatInterface)
 */
export const chatText = {
  'chat-input': ['17px', { lineHeight: '1.5' }],
}

/**
 * Max Width Scale
 * Semantic max-width tokens for containers
 */
export const maxWidth = {
  'max-w-chat': '850px', // Chat input container
  'max-w-prose': '65ch', // Prose content
  'max-w-content': '1280px', // General content
}

export default {
  spacing,
  boxShadow,
  zIndex,
  fontSize,
  transitionDuration,
  borderWidth,
  opacity,
  borderRadius,
  iconSize,
  inputHeight,
  chatText,
  letterSpacing,
  maxWidth,
}
