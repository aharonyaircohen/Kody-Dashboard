# CMS

Kody CMS is a schema-driven CRUD layer for repo-owned content.

It is intentionally generic. Kody does not hard-code A-Guy collections, Payload
models, or project-specific content rules. A repo enables CMS by adding a state
repo config file, and the Dashboard renders UI, chat tools, and MCP tools from
that same contract.

## Ownership Boundary

Kody owns:

- CMS configuration in the repo's configured Kody state repo.
- Generic list, detail, create, edit, delete UI.
- Generic filters, search, sorting, relation inputs, and schema-derived forms.
- Permission policy for who can read, write, and refresh schema.
- Chat tools and MCP tools generated from the CMS contract.

The adapter owns:

- Connecting to the content source.
- Translating IDs, dates, arrays, objects, relations, filters, and writes.
- Returning normalized JSON documents to Kody.

The source database owns:

- The real data.
- Indexes, migrations, validation, constraints, and production scale concerns.

Kody state owns the CMS shape, not database migrations. Schema generation can
infer the initial shape from MongoDB, and refresh can update the config, but
Kody should not silently mutate production database tables or collections.

## Files

CMS state lives under the connected repo's state repo:

```text
cms/config.json
cms/permissions.json
```

`cms/config.json` is the main schema contract. `cms/permissions.json` is merged
into the schema policy when present.

The consumer repo does not need a `.kody/` folder for CMS. Dashboard reads and
writes through the configured state repo, for example:

- `aharonyaircohen/kody-state` for Kody Dashboard.
- `A-Guy-educ/kody-state` for A-Guy projects.

## Setup

1. Open the Dashboard CMS page for a connected repo.
2. If CMS is not configured, click the create action.
3. Click generate schema.
4. Kody reads `DATABASE_URL` from the Dashboard secret vault or environment.
5. Kody samples MongoDB collections and writes `cms/config.json` into the state
   repo.
6. Review collections, fields, permissions, and write policy before using writes.

The schema generator assumes the Mongo connection string already includes the
database name when the URI is database-scoped.

## MongoDB Adapter

The current adapter is `mongodb`.

Adapter settings are stored in CMS config and point at a secret name, not a raw
database URI:

```json
{
  "adapters": {
    "mongodb": {
      "databaseUriSecret": "DATABASE_URL"
    }
  }
}
```

The adapter handles:

- MongoDB `_id` as ObjectId-backed IDs.
- Date and date string fields.
- ObjectId relations and ObjectId arrays.
- Primitive arrays.
- Nested objects and JSON fields.
- Projection from configured fields.
- Search, filters, sort, pagination, create, update, and delete.

## Schema Contract

A minimal generated config looks like this:

```json
{
  "version": 1,
  "name": "Example CMS",
  "environment": "default",
  "defaultAdapter": "mongodb",
  "writePolicy": "enabled",
  "permissions": {
    "content": {
      "list": ["viewer", "editor", "admin"],
      "get": ["viewer", "editor", "admin"],
      "search": ["viewer", "editor", "admin"],
      "create": ["editor", "admin"],
      "update": ["editor", "admin"],
      "delete": ["admin"]
    },
    "schema": {
      "generate": ["admin"],
      "refresh": ["admin"],
      "edit": ["admin"]
    }
  },
  "adapters": {
    "mongodb": {
      "databaseUriSecret": "DATABASE_URL"
    }
  },
  "collections": {
    "lessons": {
      "name": "lessons",
      "label": "Lessons",
      "adapter": "mongodb",
      "mcpName": "lessons",
      "titleField": "title",
      "searchFields": ["title"],
      "writePolicy": "enabled",
      "source": {
        "collection": "lessons",
        "idField": "_id"
      },
      "operations": {
        "list": true,
        "get": true,
        "search": true,
        "create": true,
        "update": true,
        "delete": true
      },
      "defaultSort": [{ "field": "updatedAt", "direction": "desc" }],
      "fields": [
        {
          "name": "_id",
          "type": "id",
          "label": "ID",
          "readOnly": true,
          "storage": { "kind": "objectId" }
        },
        {
          "name": "title",
          "type": "text",
          "label": "Title",
          "required": true,
          "storage": { "kind": "string" }
        }
      ],
      "filters": []
    }
  }
}
```

## Fields

Supported field types:

```text
id
text
textarea
number
boolean
date
select
multiSelect
relation
relationMany
json
object
array
```

Supported storage kinds:

```text
string
stringArray
number
boolean
date
dateString
objectId
objectIdArray
json
object
array
```

Relations are generic field metadata:

```json
{
  "name": "course",
  "type": "relation",
  "label": "Course",
  "target": "courses",
  "valueField": "_id",
  "labelField": "title",
  "storage": { "kind": "objectId" }
}
```

The UI should render relation fields as searchable dropdowns. The adapter still
writes the stored value shape required by the source.

## Views

Collections can define list, detail, and form views:

```json
{
  "views": {
    "list": {
      "fields": [
        { "name": "title", "display": "primary", "width": "lg" },
        { "name": "status", "display": "badge", "width": "sm" }
      ]
    },
    "detail": {
      "fields": [{ "name": "title" }, { "name": "description" }]
    },
    "form": {
      "fields": [{ "name": "title" }, { "name": "course" }]
    }
  }
}
```

If a view is missing, Kody falls back to schema-derived fields. Hidden fields do
not render, read-only fields are excluded from forms, and ID fields are treated
as read-only.

## Permissions

Kody maps GitHub collaborator permission to CMS role:

```text
admin or maintain -> admin
write             -> editor
read or unknown   -> viewer
```

Content permissions are operation-based:

```json
{
  "content": {
    "list": ["viewer", "editor", "admin"],
    "get": ["viewer", "editor", "admin"],
    "search": ["viewer", "editor", "admin"],
    "create": ["editor", "admin"],
    "update": ["editor", "admin"],
    "delete": ["admin"]
  }
}
```

Schema permissions are separate:

```json
{
  "schema": {
    "generate": ["admin"],
    "refresh": ["admin"],
    "edit": ["admin"]
  }
}
```

Writes also require the collection `writePolicy` to be `enabled`. A collection
with `writePolicy: "read-only"` will not allow create, update, or delete even if
the actor role allows the operation.

## Dashboard UI

The CMS page is generic:

- Collection list comes from `cms/config.json`.
- Table columns come from `views.list.fields` when present.
- Detail and edit forms come from `views.detail.fields` and
  `views.form.fields`.
- Search uses collection `searchFields`.
- Field filters use configured filters.
- Relation fields use searchable dropdowns against their target collection.
- Create and edit use the same schema contract as the adapter.

When CMS is not configured, the page offers setup actions instead of failing
with only a missing-file message.

## Kody Chat Tools

Kody chat intentionally uses a compact generic CMS tool set:

```text
cms_list_collections
cms_describe_collection
cms_list_documents
cms_get_document
cms_mutate_document
```

These tools take `collection` as an input. They do not generate one chat tool
per collection, because that would make Kody's normal chat tool list too heavy.

Good chat prompts:

```text
List the configured CMS collections.
```

```text
Describe the lessons collection and show fields, searchable fields, and allowed operations.
```

```text
Search the lessons collection for "course" and show the first 10 results.
```

```text
Before writing, show me the exact CMS mutation you plan to send for lesson "<id>".
```

## MCP

The external CMS MCP endpoint exposes schema-derived tools from the same config.

Unlike Kody chat, external MCP clients can receive generated collection-specific
tools:

```text
cms_list_collections
cms_list_<collection>
cms_get_<collection>
cms_create_<collection>
cms_update_<collection>
cms_delete_<collection>
```

The endpoint is:

```text
/api/kody/cms/mcp
```

It supports the Streamable HTTP basics used by MCP clients:

- `initialize`
- `ping`
- `tools/list`
- `tools/call`
- initialized notification
- SSE `GET`
- session close `DELETE`

## API Routes

Dashboard CRUD routes:

```text
GET    /api/kody/cms
POST   /api/kody/cms
PATCH  /api/kody/cms
POST   /api/kody/cms/schema
GET    /api/kody/cms/:collection
POST   /api/kody/cms/:collection
GET    /api/kody/cms/:collection/:id
PATCH  /api/kody/cms/:collection/:id
DELETE /api/kody/cms/:collection/:id
```

The routes require Dashboard auth and repo context headers. Writes also verify
the actor token owner before mutating content.

## Operating Rules

- Keep CMS configuration source-neutral.
- Put source-specific behavior in adapters.
- Do not add A-Guy-specific logic to Dashboard CMS.
- Do not store database URLs in `cms/config.json`; store secret names.
- Prefer schema refresh over hand-editing large generated configs.
- Review generated fields before enabling production writes.
- Keep write policy explicit per collection.
- Treat scheduled schema refresh as an operator choice, not an automatic default.

## Troubleshooting

`CMS is not configured`

: Create CMS config from the CMS page, then generate schema.

`Secret "DATABASE_URL" is not configured`

: Add `DATABASE_URL` to the Dashboard secret vault or environment.

`No MongoDB collections found DATABASE_URL`

: Verify the MongoDB URI includes the intended database name or that the target
database has collections.

`cms_write_disabled`

: The collection write policy is not `enabled`.

`cms_forbidden`

: The actor's GitHub repo permission does not map to a role allowed by CMS
permissions.

`rate_limited`

: GitHub state reads or writes hit rate limits. CMS data may come from MongoDB,
but the schema and permissions still live in the state repo.
