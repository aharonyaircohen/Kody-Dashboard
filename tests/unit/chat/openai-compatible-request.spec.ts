import { describe, expect, it } from "vitest";

import { normalizeOpenAICompatibleRequestBody } from "@dashboard/lib/chat/openai-compatible-request";

describe("normalizeOpenAICompatibleRequestBody", () => {
  it("strips validation-only JSON Schema keywords from tool parameters", () => {
    const body = normalizeOpenAICompatibleRequestBody({
      model: "gemini-3.5-flash",
      temperature: 0.2,
      tools: [
        {
          type: "function",
          function: {
            name: "create_or_update_todo_list",
            parameters: {
              $schema: "http://json-schema.org/draft-07/schema#",
              type: "object",
              additionalProperties: false,
              properties: {
                title: {
                  type: "string",
                  minLength: 1,
                  maxLength: 160,
                  default: "",
                },
                items: {
                  type: "array",
                  maxItems: 200,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      assignee: {
                        anyOf: [
                          { type: "string", maxLength: 120 },
                          { type: "null" },
                        ],
                      },
                    },
                  },
                },
              },
              required: ["title"],
            },
          },
        },
      ],
    });

    expect(body).toEqual({
      model: "gemini-3.5-flash",
      temperature: 0.2,
      tools: [
        {
          type: "function",
          function: {
            name: "create_or_update_todo_list",
            parameters: {
              type: "object",
              properties: {
                title: { type: "string" },
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      assignee: {
                        anyOf: [{ type: "string" }, { type: "null" }],
                      },
                    },
                  },
                },
              },
              required: ["title"],
            },
          },
        },
      ],
    });
  });

  it("leaves requests without tools unchanged", () => {
    const body = { model: "gpt-4o", messages: [] };

    expect(normalizeOpenAICompatibleRequestBody(body)).toBe(body);
  });
});
