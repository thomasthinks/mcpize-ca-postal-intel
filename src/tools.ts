/**
 * MCP tool handlers for ca-postal-intel.
 *
 * Thin adapters: call the pure functions in lib/postal.ts and shape the
 * result into the MCP tool response format ({ content, structuredContent }).
 * Never throws — every failure becomes an isError response with an
 * LLM-friendly message and a suggested next step.
 */

import {
  lookupPostalCode,
  validatePostalCode,
  fsaToRegion,
  QuotaExceededError,
} from "./lib/postal.js";

export interface ToolResponse {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
  isError?: boolean;
}

function okResult(output: Record<string, unknown>): ToolResponse {
  return {
    content: [{ type: "text", text: JSON.stringify(output) }],
    structuredContent: output,
  };
}

function errorResult(message: string, suggestion?: string): ToolResponse {
  const body: Record<string, unknown> = { error: message };
  if (suggestion) body.suggestion = suggestion;
  return {
    content: [{ type: "text", text: JSON.stringify(body) }],
    structuredContent: body,
    isError: true,
  };
}

function handleToolError(toolName: string, error: unknown): ToolResponse {
  if (error instanceof QuotaExceededError) {
    return errorResult(error.message, "Subscribe to Pro for unlimited lookups, or try again tomorrow.");
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[${toolName}] Error:`, message);
  return errorResult(
    message,
    "Check the input format and try again, or use validate_postal_code to verify FSA coverage."
  );
}

export async function handleLookupPostalCode(args: {
  postal_code: string;
}): Promise<ToolResponse> {
  try {
    const output = lookupPostalCode(args.postal_code);
    return okResult(output);
  } catch (error) {
    return handleToolError("lookup_postal_code", error);
  }
}

export async function handleValidatePostalCode(args: {
  postal_code: string;
}): Promise<ToolResponse> {
  try {
    const output = validatePostalCode(args.postal_code);
    return okResult(output);
  } catch (error) {
    return handleToolError("validate_postal_code", error);
  }
}

export async function handleFsaToRegion(args: { fsa: string }): Promise<ToolResponse> {
  try {
    const output = fsaToRegion(args.fsa);
    return okResult(output);
  } catch (error) {
    return handleToolError("fsa_to_region", error);
  }
}
