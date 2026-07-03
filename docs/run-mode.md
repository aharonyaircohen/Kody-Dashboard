# Run Mode

Run Mode controls whether Kody starts work by itself.

## Modes

| Mode     | Meaning                                  |
| -------- | ---------------------------------------- |
| `Auto`   | Kody can start this item without asking. |
| `Manual` | Kody must wait for approval first.       |

## Where users see it

Show Run Mode on the item the user runs:

- Loop
- Goal
- Workflow
- Capability

If a loop runs capabilities through a goal or workflow, the dashboard should
show the mode on the loop and save the needed capability permissions behind the
scenes.

## Storage

Run Mode is repo-specific state.

The dashboard stores it in the configured Kody state repo:

```text
state/trust.json
```

The engine still checks capability permission at runtime.

## UI rule

Use simple labels:

- `Auto`
- `Manual`

Use a small icon on list items. Avoid showing trust history controls in the
main row.
