/**
 * @fileType layout
 * @domain kody
 * @pattern route-group
 * @ai-summary Root layout for Kody dashboard — reuses frontend fonts, theme, and CSS without Header/Footer/i18n
 */
import React from 'react'
import type { Metadata } from 'next'
import { cn } from '@dashboard/lib/utils/ui'
import { GeistMono } from 'geist/font/mono'
import { GeistSans } from 'geist/font/sans'
import { Assistant } from 'next/font/google'

import { KodyProviders } from './KodyProviders'
import { Toaster } from '@dashboard/ui/toaster'
import { defaultTheme, themeLocalStorageKey } from '@dashboard/providers/Theme/shared'
import '@dashboard/globals.css'

const assistant = Assistant({
  subsets: ['latin', 'hebrew'],
  weight: ['300', '400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-assistant',
})

export const metadata: Metadata = {
  metadataBase: new URL(process.env.KODY_PUBLIC_SERVER_URL || 'https://www.dev.aguy.co.il'),
  title: {
    default: 'Kody Operations Dashboard',
    template: '%s | Kody Operations',
  },
}

export default function KodyLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      className={cn(GeistSans.variable, GeistMono.variable, assistant.variable)}
      lang="en"
      suppressHydrationWarning
    >
      <head>
        {/* Reuse the same theme init logic as the frontend layout */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                function getImplicitPreference() {
                  var mql = window.matchMedia('(prefers-color-scheme: dark)');
                  if (typeof mql.matches === 'boolean') {
                    return mql.matches ? 'dark' : 'light';
                  }
                  return null;
                }
                var themeToSet = '${defaultTheme}';
                var preference = window.localStorage.getItem('${themeLocalStorageKey}');
                if (preference === 'light' || preference === 'dark') {
                  themeToSet = preference;
                } else {
                  var implicit = getImplicitPreference();
                  if (implicit) themeToSet = implicit;
                }
                document.documentElement.setAttribute('data-theme', themeToSet);
              })();
            `,
          }}
        />
        <link href="/favicon.ico" rel="icon" sizes="32x32" />
        <link href="/favicon.svg" rel="icon" type="image/svg+xml" />
      </head>
      <body>
        <KodyProviders>
          <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
            {children}
          </div>
          <Toaster />
        </KodyProviders>
      </body>
    </html>
  )
}
