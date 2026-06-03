---
staff: []
---

* **Critical:** Pass only explicitly approved secrets to Fly Previews through an allowlist, never the full repository vault.
* **High:** Protect every preview with authenticated access or a short-lived token, rather than exposing a public unrestricted URL.
* **High:** Do not publish open preview links in GitHub comments; links must require authorized access.
* **High:** Choose one primary preview build path and keep alternative build paths disabled as fallbacks until the main flow is stable.
* **High:** Freeze non-core extensions for now, including static uploads, PDF previews, and dev-mode previews.
* **Medium:** Add controlled retries and clear failure reporting for Fly Runner machine creation.
* **Medium:** Complete one full end-to-end validation flow: task → build → protected preview → approval → merge.
* **Medium:** Measure actual build times and Fly costs before expanding infrastructure usage.
