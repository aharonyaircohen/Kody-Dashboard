/**
 * @fileType component
 * @domain kody
 * @pattern edit-task-dialog
 * @ai-summary Dialog to edit existing tasks with title, description, labels, and assignees
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@dashboard/ui/select";
import { Textarea } from "@dashboard/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@dashboard/ui/avatar";
import { useUpdateTask, useKodyBoards, useCollaborators } from "../hooks";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import ReactMarkdown from "react-markdown";
import {
  Bold,
  Italic,
  Code,
  Link2,
  List,
  ListOrdered,
  Heading2,
  Quote,
  Eye,
  Edit3,
  Loader2,
} from "lucide-react";
import { cn } from "../utils";
import type { KodyTask } from "../types";

interface EditTaskDialogProps {
  open: boolean;
  onClose: () => void;
  task: KodyTask | null;
  onSaved?: () => void;
}

const PRIORITY_OPTIONS = [
  { label: "No Priority", value: "" },
  { label: "P0 - Critical", value: "priority:P0" },
  { label: "P1 - High", value: "priority:P1" },
  { label: "P2 - Medium", value: "priority:P2" },
  { label: "P3 - Low", value: "priority:P3" },
];

export function EditTaskDialog({
  open,
  onClose,
  task,
  onSaved,
}: EditTaskDialogProps) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [labels, setLabels] = useState<string[]>([]);
  const [assignees, setAssignees] = useState<string[]>([]);
  const [priority, setPriority] = useState("");

  // Use hooks for data fetching
  const { data: collaborators = [] } = useCollaborators();
  const { data: boards = [] } = useKodyBoards();

  // Extract labels from boards - get just the label names
  const availableLabels: string[] = boards
    .filter((b) => b.type === "label")
    .flatMap((b) => {
      const board = b as { labels?: Array<{ name: string; color: string }> };
      return board.labels?.map((l) => l.name) ?? [];
    })
    .slice(0, 20);

  const { githubUser } = useGitHubIdentity();
  const updateTask = useUpdateTask(task?.issueNumber ?? 0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Populate form when task changes
  useEffect(() => {
    if (task && open) {
      setTitle(task.title);
      setBody(task.body || "");
      setLabels(task.labels || []);
      setAssignees(task.assignees?.map((a) => a.login) || []);
      // Extract priority from labels
      const priorityLabel = task.labels?.find((l) => l.startsWith("priority:"));
      setPriority(priorityLabel || "");
    }
  }, [task, open]);

  // Handle submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    // Process labels: remove existing priority labels and add new one
    const labelsWithoutPriority = labels.filter(
      (l) => !l.startsWith("priority:"),
    );
    const finalLabels = priority
      ? [...labelsWithoutPriority, priority]
      : labelsWithoutPriority;

    try {
      await updateTask.mutateAsync({
        title,
        body,
        labels: finalLabels,
        assignees,
        actorLogin: githubUser?.login,
      });
      onSaved?.();
      onClose();
    } catch {
      // Error is handled by the mutation
    }
  };

  const toggleLabel = (label: string) => {
    setLabels((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label],
    );
  };

  const toggleAssignee = (login: string) => {
    setAssignees((prev) =>
      prev.includes(login) ? prev.filter((a) => a !== login) : [...prev, login],
    );
  };

  // Markdown helper functions
  const insertMarkdown = (before: string, after: string = "") => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = body.slice(start, end);
    const newBody =
      body.slice(0, start) + before + selectedText + after + body.slice(end);
    setBody(newBody);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(
        start + before.length,
        start + before.length + selectedText.length,
      );
    }, 0);
  };

  if (!task) return null;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-[800px] max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Task</DialogTitle>
          <DialogDescription>
            Update task #{task.issueNumber} on GitHub.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid gap-5 py-2">
          {updateTask.error && (
            <div className="p-2 bg-destructive/10 text-destructive text-sm rounded">
              {updateTask.error.message}
            </div>
          )}

          {/* Title */}
          <div className="grid gap-2">
            <Label htmlFor="edit-title">Title</Label>
            <Input
              id="edit-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Task title"
              required
            />
          </div>

          {/* Description with Markdown Editor */}
          <div className="grid gap-2">
            <Label htmlFor="edit-body">Description</Label>

            {/* Toolbar */}
            <div className="flex items-center gap-0.5 border border-border rounded-md p-1 bg-muted/30">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => insertMarkdown("**", "**")}
                className="h-7 w-7 p-0"
                title="Bold"
              >
                <Bold className="w-3.5 h-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => insertMarkdown("*", "*")}
                className="h-7 w-7 p-0"
                title="Italic"
              >
                <Italic className="w-3.5 h-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => insertMarkdown("`", "`")}
                className="h-7 w-7 p-0"
                title="Inline Code"
              >
                <Code className="w-3.5 h-3.5" />
              </Button>
              <div className="w-px h-4 bg-border mx-0.5" />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => insertMarkdown("## ")}
                className="h-7 w-7 p-0"
                title="Heading"
              >
                <Heading2 className="w-3.5 h-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => insertMarkdown("- ")}
                className="h-7 w-7 p-0"
                title="Bullet List"
              >
                <List className="w-3.5 h-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => insertMarkdown("1. ")}
                className="h-7 w-7 p-0"
                title="Numbered List"
              >
                <ListOrdered className="w-3.5 h-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => insertMarkdown("> ")}
                className="h-7 w-7 p-0"
                title="Quote"
              >
                <Quote className="w-3.5 h-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => insertMarkdown("[", "](url)")}
                className="h-7 w-7 p-0"
                title="Link"
              >
                <Link2 className="w-3.5 h-3.5" />
              </Button>

              <div className="w-px h-4 bg-border mx-1" />

              <Button
                type="button"
                variant={showPreview ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setShowPreview(!showPreview)}
                className="h-7 px-2"
                title={showPreview ? "Edit" : "Preview"}
              >
                {showPreview ? (
                  <Edit3 className="w-3.5 h-3.5" />
                ) : (
                  <Eye className="w-3.5 h-3.5" />
                )}
              </Button>
            </div>

            {/* Editor / Preview */}
            {showPreview ? (
              <div className="min-h-[150px] p-3 border border-border rounded-md bg-muted/20 prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown>{body || "*No description*"}</ReactMarkdown>
              </div>
            ) : (
              <Textarea
                id="edit-body"
                ref={textareaRef}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Describe the task in markdown..."
                className="min-h-[150px]"
              />
            )}
            <p className="text-xs text-muted-foreground">
              Supports Markdown. Use the toolbar above for formatting.
            </p>
          </div>

          {/* Priority */}
          <div className="grid gap-2">
            <Label>Priority</Label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger>
                <SelectValue placeholder="Select priority" />
              </SelectTrigger>
              <SelectContent>
                {PRIORITY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Labels */}
          <div className="grid gap-2">
            <Label>Labels</Label>
            <div className="flex flex-wrap gap-1.5">
              {availableLabels.map((label) => {
                const labelData = label as unknown as {
                  name: string;
                  color: string;
                };
                const isSelected = labels.includes(
                  typeof labelData === "string" ? labelData : labelData.name,
                );
                return (
                  <button
                    key={
                      typeof labelData === "string" ? labelData : labelData.name
                    }
                    type="button"
                    onClick={() =>
                      toggleLabel(
                        typeof labelData === "string"
                          ? labelData
                          : labelData.name,
                      )
                    }
                    className={cn(
                      "px-2 py-1 rounded-full text-xs font-medium transition-colors border",
                      isSelected
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted text-muted-foreground border-border hover:bg-muted/80",
                    )}
                  >
                    {typeof labelData === "string" ? labelData : labelData.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Assignees */}
          <div className="grid gap-2">
            <Label>Assignees</Label>
            <div className="flex flex-wrap gap-1.5">
              {collaborators.slice(0, 10).map((user) => {
                const isSelected = assignees.includes(user.login);
                return (
                  <button
                    key={user.login}
                    type="button"
                    onClick={() => toggleAssignee(user.login)}
                    className={cn(
                      "flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition-colors border",
                      isSelected
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted text-muted-foreground border-border hover:bg-muted/80",
                    )}
                  >
                    <Avatar className="w-4 h-4">
                      <AvatarImage src={user.avatar_url} />
                      <AvatarFallback className="text-[10px]">
                        {user.login.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    {user.login}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!title.trim() || updateTask.isPending}
            >
              {updateTask.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Changes"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
