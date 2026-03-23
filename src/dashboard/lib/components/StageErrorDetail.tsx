/**
 * @fileType component
 * @domain kody
 * @pattern stage-error-detail
 * @ai-summary Shows detailed error information for failed pipeline stages
 */
'use client'

import { useState, useEffect } from 'react'
import type { CheckRunResult } from '../types'
import { Button } from '@dashboard/ui/button'
import { Badge } from '@dashboard/ui/badge'
import { ExternalLink, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { fetchCheckRunsForRun } from '../github-client'

interface StageErrorDetailProps {
  stageName: string
  error?: string
  runId?: number
  className?: string
}

export function StageErrorDetail({
  stageName: _stageName,
  error,
  runId,
  className,
}: StageErrorDetailProps) {
  const [expanded, setExpanded] = useState(false)
  const [checkRuns, setCheckRuns] = useState<CheckRunResult[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (expanded && runId && checkRuns.length === 0) {
      setLoading(true)
      fetchCheckRunsForRun(runId)
        .then(setCheckRuns)
        .finally(() => setLoading(false))
    }
  }, [expanded, runId, checkRuns.length])

  const failedChecks = checkRuns.filter((c) => c.conclusion === 'failure')
  const passedChecks = checkRuns.filter((c) => c.conclusion === 'success')

  return (
    <div className={className}>
      {/* Error message */}
      {error && (
        <div className="mb-3 p-3 bg-red-500/10 border border-red-500/30 rounded-md">
          <p className="text-sm text-red-400 font-medium mb-1">Failure Reason:</p>
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {/* Check runs / Job results */}
      {runId && (
        <div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            <span className="font-medium">Check Runs & Jobs</span>
            <Badge variant="outline" className="ml-2">
              {passedChecks.length} passed, {failedChecks.length} failed
            </Badge>
          </button>

          {expanded && (
            <div className="mt-2 ml-6 space-y-2">
              {loading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading...
                </div>
              ) : checkRuns.length > 0 ? (
                <>
                  {/* Failed checks first */}
                  {failedChecks.map((check, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between p-2 bg-red-500/10 rounded border border-red-500/20"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-red-500">✗</span>
                        <span className="text-sm text-red-300">{check.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="destructive" className="text-xs">
                          {check.conclusion}
                        </Badge>
                        {check.html_url && (
                          <a
                            href={check.html_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Passed checks */}
                  {passedChecks.map((check, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between p-2 bg-green-500/10 rounded border border-green-500/20"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-green-500">✓</span>
                        <span className="text-sm text-green-300">{check.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className="text-xs border-green-500/50 text-green-400"
                        >
                          passed
                        </Badge>
                        {check.html_url && (
                          <a
                            href={check.html_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No check runs found for this run.</p>
              )}

              {/* View logs link */}
              <a
                href={`https://github.com/${process.env.NEXT_PUBLIC_GITHUB_OWNER || 'A-Guy-educ'}/${process.env.NEXT_PUBLIC_GITHUB_REPO || 'A-Guy'}/actions/runs/${runId}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button variant="outline" size="sm" className="mt-2">
                  <ExternalLink className="w-3 h-3 mr-1" />
                  View Full Logs
                </Button>
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
