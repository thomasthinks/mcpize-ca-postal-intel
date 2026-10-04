import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { Request, Response } from "express";
import { z } from "zod";
import chalk from "chalk";
import {
  handleLookupPostalCode,
  handleValidatePostalCode,
  handleFsaToRegion,
  type ToolResponse,
} from "./tools.js";
import { checkFreeQuota, quotaStatus } from "./lib/postal.js";

// ============================================================================
// Dev Logging Utilities
// ============================================================================

const isDev = process.env.NODE_ENV !== "production";

function timestamp(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

function formatLatency(ms: number): string {
  if (ms < 100) return chalk.green(`${ms}ms`);
  if (ms < 500) return chalk.yellow(`${ms}ms`);
  return chalk.red(`${ms}ms`);
}

function truncate(str: string, maxLen = 60): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

function logRequest(method: string, params?: unknown): void {
  if (!isDev) return;

  const paramsStr = params ? chalk.gray(` ${truncate(JSON.stringify(params))}`) : "";
  console.log(`${chalk.gray(`[${timestamp()}]`)} ${chalk.cyan("→")} ${method}${paramsStr}`);
}

function logResponse(method: string, result: unknown, latencyMs: number): void {
  if (!isDev) return;

  const latency = formatLatency(latencyMs);

  // For tool calls, show the result
  if (method === "tools/call" && result) {
    const resultStr = typeof result === "string" ? result : JSON.stringify(result);
    console.log(
      `${chalk.gray(`[${timestamp()}]`)} ${chalk.green("←")} ${truncate(resultStr)} ${chalk.gray(`(${latency})`)}`
    );
  } else {
    console.log(`${chalk.gray(`[${timestamp()}]`)} ${method} ${chalk.gray(`(${latency})`)}`);
  }
}

function logError(method: string, error: unknown, latencyMs: number): void {
  if (!isDev) return;

  const latency = formatLatency(latencyMs);

  let errorMsg: string;
  if (error instanceof Error) {
    errorMsg = error.message;
  } else if (typeof error === "object" && error !== null) {
    // JSON-RPC error object has { code, message, data? }
    const rpcError = error as { message?: string; code?: number };
    errorMsg = rpcError.message || `Error ${rpcError.code || "unknown"}`;
  } else {
    errorMsg = String(error);
  }

  console.log(
    `${chalk.gray(`[${timestamp()}]`)} ${chalk.red("✖")} ${method} ${chalk.red(truncate(errorMsg))} ${chalk.gray(`(${latency})`)}`
  );
}

// ============================================================================
// MCP Server Setup
// ============================================================================

/**
 * Wraps a tool handler with freemium quota enforcement.
 * All three tools count as lookups against the free daily limit
 * (FREE_DAILY_LIMIT env var, default 50).
 */
function withQuota(
  handler: (args: never) => Promise<ToolResponse>
): (args: Record<string, unknown>) => Promise<ToolResponse> {
  return async (args) => {
    try {
      checkFreeQuota();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const body = {
        error: message,
        suggestion: "Subscribe to Pro for unlimited access, or try again tomorrow.",
      };
      return {
        content: [{ type: "text", text: JSON.stringify(body) }],
        structuredContent: body,
        isError: true,
      };
    }
    return handler(args as never);
  };
}

// Build a FRESH MCP server per request.
//
// In stateless streamable-HTTP mode the MCP SDK allows a Server to be connected
// to exactly ONE transport. Reusing a single module-scope instance throws
// "Already connected to a transport" on the second connection — and Cloud Run
// opens several (startup probe + real requests). So always create a new server
// (and a new transport) inside the request handler below.
function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "ca-postal-intel",
    version: "1.0.0",
  });

  server.registerTool(
    "lookup_postal_code",
    {
      title: "Look Up Canadian Postal Code",
      description:
        "Look up a Canadian postal code and return FSA-level intelligence: community, province, " +
        "approximate IANA timezone, centroid latitude/longitude, urban/rural classification, and " +
        "NANP area codes. Accepts full codes like 'K1A 0B1' or 3-character FSAs like 'K1A'. " +
        "Data is community-sourced (GeoNames, not Canada Post official) and FSA-level.",
      inputSchema: {
        postal_code: z
          .string()
          .describe("Canadian postal code, e.g. 'K1A 0B1', 'k1a0b1', or an FSA like 'K1A'"),
      },
      outputSchema: {
        postal_code: z.string(),
        fsa: z.string(),
        city: z.string(),
        province_code: z.string().nullable(),
        province_name: z.string().nullable(),
        timezone: z.string().nullable(),
        latitude: z.number().nullable(),
        longitude: z.number().nullable(),
        urban_rural: z.enum(["urban", "rural"]),
        area_codes: z.array(z.string()),
        granularity_note: z.string(),
      },
    },
    withQuota(handleLookupPostalCode)
  );

  server.registerTool(
    "validate_postal_code",
    {
      title: "Validate Canadian Postal Code",
      description:
        "Validate the format of a Canadian postal code and check whether its FSA (forward sortation area) " +
        "exists in the index. Returns the normalized code.",
      inputSchema: {
        postal_code: z
          .string()
          .describe("Canadian postal code to validate, e.g. 'M5V 2T6' or 'XYZ'"),
      },
      outputSchema: {
        valid_format: z.boolean(),
        fsa_exists: z.boolean(),
        normalized: z.string().nullable(),
      },
    },
    withQuota(handleValidatePostalCode)
  );

  server.registerTool(
    "fsa_to_region",
    {
      title: "FSA to Region",
      description:
        "Resolve a 3-character Canadian forward sortation area (FSA) like 'K1A', 'M5V' or 'V6B' " +
        "to its province and region name with the representative community/communities.",
      inputSchema: {
        fsa: z.string().describe("3-character FSA, e.g. 'K1A', 'M5V', 'V6B'"),
      },
      outputSchema: {
        fsa: z.string(),
        province_code: z.string().nullable(),
        province_name: z.string().nullable(),
        region_name: z.string(),
        communities: z.array(z.string()),
      },
    },
    withQuota(handleFsaToRegion)
  );

  return server;
}

// ============================================================================
// Express App Setup
// ============================================================================

const app = express();
app.use(express.json());

// Health check endpoint (required for MCPize Cloud)
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "healthy" });
});

// Quota status endpoint (debug/ops visibility)
app.get("/quota", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok", quota: quotaStatus() });
});

// MCP endpoint with dev logging
app.post("/mcp", async (req: Request, res: Response) => {
  const startTime = Date.now();
  const body = req.body;

  // Extract method and params from JSON-RPC request
  const method = body?.method || "unknown";
  const params = body?.params;

  // Log incoming request
  if (method === "tools/call") {
    const toolName = params?.name || "unknown";
    const toolArgs = params?.arguments;
    logRequest(`tools/call ${chalk.bold(toolName)}`, toolArgs);
  } else if (method !== "notifications/initialized") {
    logRequest(method, params);
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  // Capture response body for logging
  let responseBody = "";
  const originalWrite = res.write.bind(res) as typeof res.write;
  const originalEnd = res.end.bind(res) as typeof res.end;

  res.write = function (chunk: unknown, encodingOrCallback?: BufferEncoding | ((error: Error | null | undefined) => void), callback?: (error: Error | null | undefined) => void) {
    if (chunk) {
      responseBody += typeof chunk === "string" ? chunk : Buffer.from(chunk as ArrayBuffer).toString();
    }
    return originalWrite(chunk as string, encodingOrCallback as BufferEncoding, callback);
  };

  res.end = function (chunk?: unknown, encodingOrCallback?: BufferEncoding | (() => void), callback?: () => void) {
    if (chunk) {
      responseBody += typeof chunk === "string" ? chunk : Buffer.from(chunk as ArrayBuffer).toString();
    }

    // Log response
    if (method !== "notifications/initialized") {
      const latency = Date.now() - startTime;

      try {
        const rpcResponse = JSON.parse(responseBody) as { result?: unknown; error?: unknown };

        if (rpcResponse?.error) {
          logError(method, rpcResponse.error, latency);
        } else if (method === "tools/call") {
          const content = (rpcResponse?.result as { content?: Array<{ text?: string }> })?.content;
          const resultText = content?.[0]?.text;
          logResponse(method, resultText, latency);
        } else {
          logResponse(method, null, latency);
        }
      } catch {
        logResponse(method, null, latency);
      }
    }

    return originalEnd(chunk as string, encodingOrCallback as BufferEncoding, callback);
  };

  res.on("close", () => {
    transport.close();
  });

  // Fresh server instance per request (see createMcpServer above) — required for
  // stateless streamable-HTTP so a second connection never reuses a transport.
  const server = createMcpServer();
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// JSON error handler (Express defaults to HTML errors)
app.use((_err: unknown, _req: Request, res: Response, _next: Function) => {
  res.status(500).json({ error: "Internal server error" });
});

// ============================================================================
// Start Server
// ============================================================================

const port = parseInt(process.env.PORT || "8080");
const httpServer = app.listen(port, () => {
  console.log();
  console.log(chalk.bold("MCP Server running on"), chalk.cyan(`http://localhost:${port}`));
  console.log(`  ${chalk.gray("Health:")} http://localhost:${port}/health`);
  console.log(`  ${chalk.gray("MCP:")}    http://localhost:${port}/mcp`);

  if (isDev) {
    console.log();
    console.log(chalk.gray("─".repeat(50)));
    console.log();
  }
});

// Graceful shutdown for MCPize Cloud (SIGTERM before kill)
process.on("SIGTERM", () => {
  console.log("Received SIGTERM, shutting down...");
  httpServer.close(() => {
    process.exit(0);
  });
});
