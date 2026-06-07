# PR #89 CI fix — composer Send layout test

The E2E workflow's vitest suite was failing on `tests/unit/chat/kody-chat-composer.spec.ts`. The test was a source-level structural pin for the issue #65 two-row composer layout. It asserted the input row contained a Send button by matching the regex `/>\s*Send\s*</` (literal "Send" text inside a button).

The PR replaces the old "Send" text button and the "Start" text button with a single inline Send icon (`<Send className="w-5 h-5" />` from lucide-react), and moves it from the input row into the action row alongside Paperclip and VoiceButton. The regex no longer matches because the new element is self-closing with no text content.

Fix: updated the test to reflect the new design — input row must NOT contain `<Send`, action row must contain `<Send`. Header comment updated to describe the new row contents. No source code (KodyChat.tsx) changed; the component already implements the new design correctly. Verify gates (typecheck, lint, vitest) pass clean.
