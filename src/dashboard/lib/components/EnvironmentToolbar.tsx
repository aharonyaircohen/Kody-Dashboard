/**
 * @fileType component
 * @domain kody
 * @pattern environment-toolbar
 * @ai-summary Toolbar with Dev/Prod site links and Publish button with confirmation dialog
 */
'use client'

import { useState } from 'react'
import { SITE_URLS } from '../constants'
import { usePublish } from '../hooks/usePublish'
import { useGitHubIdentity } from '../hooks/useGitHubIdentity'
import { Button } from '@dashboard/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@dashboard/ui/dialog'
import { ExternalLink, Rocket, Globe, Loader2 } from 'lucide-react'

export function EnvironmentToolbar() {
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const { githubUser } = useGitHubIdentity()
  const publish = usePublish(githubUser?.login)

  const handlePublish = async () => {
    setShowConfirmDialog(false)
    publish.mutate()
  }

  return (
    <div className="flex items-center gap-3 px-4 md:px-6 py-2 border-b border-white/[0.06] bg-white/[0.02]">
      {/* Left side: Site Links */}
      <div className="flex items-center gap-2">
        <a
          href={SITE_URLS.dev}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
        >
          <Globe className="w-3.5 h-3.5" />
          <span>Dev</span>
          <ExternalLink className="w-3 h-3" />
        </a>
        <a
          href={SITE_URLS.prod}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
        >
          <Globe className="w-3.5 h-3.5" />
          <span>Prod</span>
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {/* Right side: Publish Button */}
      <div className="ml-auto">
        <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
          <DialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              disabled={publish.isPending}
            >
              {publish.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Rocket className="w-3.5 h-3.5" />
              )}
              <span>Publish to Prod</span>
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Publish to Production?</DialogTitle>
              <DialogDescription>
                This will create a publish issue that triggers a PR from dev → main. Once CI passes,
                use the Merge button to finalize the deployment.
              </DialogDescription>{' '}
            </DialogHeader>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => setShowConfirmDialog(false)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handlePublish} disabled={publish.isPending}>
                {publish.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Publishing...
                  </>
                ) : (
                  'Publish'
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
