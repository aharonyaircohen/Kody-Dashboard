/**
 * @fileType component
 * @domain kody
 * @pattern bug-report-dialog
 * @ai-summary Dialog to report bugs with structured template
 */
"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@dashboard/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@dashboard/ui/dialog";
import { Input } from "@dashboard/ui/input";
import { Label } from "@dashboard/ui/label";
import { Textarea } from "@dashboard/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@dashboard/ui/select";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { kodyApi, redirectToLogin, SessionExpiredError } from "../api";
import { useCollaborators } from "../hooks";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import { X, Upload } from "lucide-react";
import { cn } from "@dashboard/lib/utils/ui";
import {
  PRIORITY_LEVELS,
  PRIORITY_META,
  type PriorityLevel,
} from "../constants";

interface BugReportDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
}

interface AttachmentFile {
  name: string;
  content: string;
  preview: string;
  type: string;
}

export function BugReportDialog({
  open,
  onClose,
  onCreated,
}: BugReportDialogProps) {
  // Title field
  const [title, setTitle] = useState("");

  // Environment fields
  const [environment, setEnvironment] = useState("dev");
  const [browser, setBrowser] = useState("");
  const [userRole, setUserRole] = useState("");

  // Preconditions
  const [preconditions, setPreconditions] = useState("");

  // Steps to reproduce
  const [steps, setSteps] = useState("");

  // Expected result
  const [expectedResult, setExpectedResult] = useState("");

  // Actual result
  const [actualResult, setActualResult] = useState("");

  // Reproducibility
  const [reproducibility, setReproducibility] = useState("always");

  // Priority
  const [priority, setPriority] = useState<PriorityLevel>("P2");

  // Assignees
  const [assignees, setAssignees] = useState<string[]>([]);

  // Attachments
  const [attachments, setAttachments] = useState<AttachmentFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch collaborators
  const { data: collaborators = [] } = useCollaborators();

  // Toggle assignee
  const toggleAssignee = (login: string) => {
    setAssignees((prev) =>
      prev.includes(login) ? prev.filter((a) => a !== login) : [...prev, login],
    );
  };

  const { githubUser } = useGitHubIdentity();
  const queryClient = useQueryClient();

  const createBug = useMutation({
    mutationFn: (data: {
      title: string;
      body: string;
      mode: string;
      labels?: string[];
      assignees?: string[];
      attachments?: Array<{ name: string; content: string }>;
      actorLogin?: string;
    }) => kodyApi.tasks.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kody-tasks"] });
    },
    onError: (error) => {
      if (error instanceof SessionExpiredError) {
        redirectToLogin("/bug");
      }
    },
  });

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      setTitle("");
      setEnvironment("dev");
      setBrowser("");
      setUserRole("");
      setPreconditions("");
      setSteps("");
      setExpectedResult("");
      setActualResult("");
      setReproducibility("always");
      setPriority("P2");
      setAssignees([]);
      setAttachments([]);
    }
  }, [open]);

  // Convert file to base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(",")[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // Handle file selection
  const handleFiles = async (files: FileList | null) => {
    if (!files) return;

    const newAttachments: AttachmentFile[] = [];
    const imageTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];

    for (const file of Array.from(files)) {
      if (!imageTypes.includes(file.type)) continue;
      if (file.size > 10 * 1024 * 1024) continue;

      const base64 = await fileToBase64(file);
      const reader = new FileReader();
      const preview = await new Promise<string>((resolve) => {
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });

      newAttachments.push({
        name: file.name,
        content: base64,
        preview,
        type: file.type,
      });
    }

    setAttachments((prev) => [...prev, ...newAttachments].slice(0, 5));
  };

  // Handle drag and drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  // Remove attachment
  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Format body as markdown using the template
    const body = formatBugReport();

    createBug.mutate(
      {
        title,
        body,
        mode: "bug",
        labels: ["bug", `priority:${priority}`],
        assignees,
        attachments: attachments.map((a) => ({
          name: a.name,
          content: a.content,
        })),
        actorLogin: githubUser?.login,
      },
      {
        onSuccess: () => {
          onCreated?.();
          onClose();
        },
      },
    );
  };

  const formatBugReport = () => {
    let report = "# 🐞 Bug Report\n\n";

    report += "## 1. Title\n";
    report += `${title}\n\n`;

    report += "## 2. Environment\n";
    report += `- Environment: ${environment}\n`;
    if (browser) report += `- Browser / Device: ${browser}\n`;
    if (userRole) report += `- User Role / Tenant: ${userRole}\n`;
    report += "\n";

    report += "## 3. Preconditions\n";
    if (preconditions) {
      report += `${preconditions}\n`;
    } else {
      report += "_None specified_\n";
    }
    report += "\n";

    report += "## 4. Steps to Reproduce\n";
    if (steps) {
      report += `${steps}\n`;
    } else {
      report += "_None specified_\n";
    }
    report += "\n";

    report += "## 5. Expected Result\n";
    if (expectedResult) {
      report += `${expectedResult}\n`;
    } else {
      report += "_Not specified_\n";
    }
    report += "\n";

    report += "## 6. Actual Result\n";
    if (actualResult) {
      report += `${actualResult}\n`;
    } else {
      report += "_Not specified_\n";
    }
    report += "\n";

    report += "## 7. Priority\n";
    report += `${PRIORITY_META[priority].badge} ${priority} — ${PRIORITY_META[priority].label}\n\n`;

    report += "## 8. Reproducibility\n";
    report += `${reproducibility}\n`;

    return report;
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Report a Bug</DialogTitle>
          <DialogDescription>
            Create a structured bug report for the team.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid gap-4 py-4">
          {createBug.error && (
            <div className="p-2 bg-destructive/10 text-destructive text-sm rounded">
              {createBug.error.message}
            </div>
          )}

          {/* Title */}
          <div className="grid gap-2">
            <Label htmlFor="bug-title">
              Title <span className="text-destructive">*</span>
            </Label>
            <Input
              id="bug-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="[Area] Short description of failure"
              required
            />
            <p className="text-xs text-muted-foreground">
              Format: [Component] Short description
            </p>
          </div>

          {/* Attachments */}
          <div className="grid gap-2">
            <Label>Attachments (screenshots)</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />

            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {attachments.map((attachment, index) => (
                  <div key={index} className="relative group">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={attachment.preview}
                      alt={attachment.name}
                      className="w-16 h-16 object-cover rounded-md border"
                    />
                    <button
                      type="button"
                      onClick={() => removeAttachment(index)}
                      className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {attachments.length < 5 && (
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "border-2 border-dashed rounded-lg p-3 text-center cursor-pointer transition-colors",
                  isDragging
                    ? "border-primary bg-primary/5"
                    : "border-muted-foreground/25 hover:border-muted-foreground/50",
                )}
              >
                <Upload className="w-4 h-4 mx-auto mb-1 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">
                  Drop screenshots here
                </p>
              </div>
            )}
          </div>

          {/* Assignees */}
          <div className="grid gap-2">
            <Label>Assignees</Label>
            <div className="flex flex-wrap gap-2">
              {collaborators.slice(0, 10).map((user) => (
                <Button
                  key={user.login}
                  type="button"
                  variant={
                    assignees.includes(user.login) ? "default" : "outline"
                  }
                  size="sm"
                  onClick={() => toggleAssignee(user.login)}
                  className="h-8"
                >
                  {user.login}
                </Button>
              ))}
            </div>
            {assignees.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Assigned: {assignees.join(", ")}
              </p>
            )}
          </div>

          {/* environment */}
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="environment">Environment</Label>
              <Select value={environment} onValueChange={setEnvironment}>
                <SelectTrigger id="environment">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dev">Dev</SelectItem>
                  <SelectItem value="preview">Preview</SelectItem>
                  <SelectItem value="prod">Prod</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="browser">Browser / Device</Label>
              <Select value={browser} onValueChange={setBrowser}>
                <SelectTrigger id="browser">
                  <SelectValue placeholder="Select browser" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Chrome">Chrome</SelectItem>
                  <SelectItem value="Safari">Safari</SelectItem>
                  <SelectItem value="Firefox">Firefox</SelectItem>
                  <SelectItem value="Edge">Edge</SelectItem>
                  <SelectItem value="Mobile Safari (iPhone)">
                    Mobile Safari (iPhone)
                  </SelectItem>
                  <SelectItem value="Chrome (Android)">
                    Chrome (Android)
                  </SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="userRole">User Role</Label>
              <Select value={userRole} onValueChange={setUserRole}>
                <SelectTrigger id="userRole">
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Admin">Admin</SelectItem>
                  <SelectItem value="Student">Student</SelectItem>
                  <SelectItem value="Teacher">Teacher</SelectItem>
                  <SelectItem value="Guest">Guest (unauthenticated)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="bug-priority">Priority</Label>
              <Select
                value={priority}
                onValueChange={(v) => setPriority(v as PriorityLevel)}
              >
                <SelectTrigger id="bug-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_LEVELS.map((level) => (
                    <SelectItem key={level} value={level}>
                      {PRIORITY_META[level].badge} {level} —{" "}
                      {PRIORITY_META[level].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {PRIORITY_META[priority].description}
              </p>
            </div>
          </div>

          {/* Preconditions */}
          <div className="grid gap-2">
            <Label htmlFor="preconditions">Preconditions</Label>
            <Textarea
              id="preconditions"
              value={preconditions}
              onChange={(e) => setPreconditions(e.target.value)}
              placeholder="What must exist for the bug to occur?"
              rows={2}
            />
          </div>

          {/* Steps to Reproduce */}
          <div className="grid gap-2">
            <Label htmlFor="steps">
              Steps to Reproduce <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="steps"
              value={steps}
              onChange={(e) => setSteps(e.target.value)}
              placeholder="1. Go to...
2. Click...
3. See error"
              rows={4}
              required
            />
          </div>

          {/* Expected vs Actual */}
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="expected">Expected Result</Label>
              <Textarea
                id="expected"
                value={expectedResult}
                onChange={(e) => setExpectedResult(e.target.value)}
                placeholder="What should happen?"
                rows={2}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="actual">Actual Result</Label>
              <Textarea
                id="actual"
                value={actualResult}
                onChange={(e) => setActualResult(e.target.value)}
                placeholder="What actually happened?"
                rows={2}
              />
            </div>
          </div>

          {/* Reproducibility */}
          <div className="grid gap-2">
            <Label htmlFor="reproducibility">Reproducibility</Label>
            <Select value={reproducibility} onValueChange={setReproducibility}>
              <SelectTrigger id="reproducibility">
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="always">Always</SelectItem>
                <SelectItem value="sometimes">Sometimes</SelectItem>
                <SelectItem value="rare">Rare</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Submit */}
          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="flex-1"
              disabled={createBug.isPending}
            >
              {createBug.isPending ? "Creating..." : "Report Bug"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
