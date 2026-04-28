import { logger } from "../logger.js";
import { normalizeMcpToolResult } from "./normalize-tool-result.js";

export type McpStatus = "disabled" | "timeout" | "error" | "ok";

export interface McpConfig {
  enabled: boolean;
  timeoutMs: number;
  strategyEnrichEnabled: boolean;
  calendarEnrichEnabled: boolean;
  baseUrl: string | null;
  apiKey: string | null;
  workspaceId: string | null;
  localEnabled: boolean;
  localUrl: string | null;
  instagramToolEnabled: boolean;
  websiteToolEnabled: boolean;
}

export interface StrategyMcpInput {
  clientId: string;
  templateType: string | null;
  raw: Record<string, unknown>;
  enriched: Record<string, unknown>;
  businessDna?: Record<string, unknown> | null;
}

export interface StrategyMcpResult {
  used: boolean;
  status: McpStatus;
  toolName?: string | null;
  timestamp: string;
  toolResultSummary?: Record<string, unknown> | null;
  enriched: StrategyMcpInput;
}

export interface CalendarMcpInput {
  clientId: string;
  month: string;
  goal?: string | null;
  notes?: string | null;
  instagramHandle?: string | null;
  enriched: Record<string, unknown>;
  structuredStrategy: Record<string, unknown>;
}

export interface CalendarMcpResult {
  used: boolean;
  status: McpStatus;
  toolName?: string | null;
  timestamp: string;
  toolResultSummary?: Record<string, unknown> | null;
  enriched: CalendarMcpInput;
}

type JsonRpcResponse = {
  jsonrpc?: string;
  id?: string | number | null;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
};

type McpToolDescriptor = {
  name?: string;
  description?: string;
  inputSchema?: unknown;
};

let nextRequestId = 1;

function readBoolean(value: string | undefined, fallback = false): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function readNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readOptionalString(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || /timeout/i.test(error.message));
}

function mergeMcpData<T extends { enriched: Record<string, unknown> }>(
  input: T,
  toolName: string,
  toolResult: unknown,
): T {
  const existingMcp = asRecord(input.enriched.mcp) ?? {};
  const normalized = normalizeMcpToolResult(toolResult);
  return {
    ...input,
    enriched: {
      ...input.enriched,
      mcp: {
        ...existingMcp,
        [toolName]: normalized ?? toolResult,
      },
    },
  };
}

function summarizeToolResult(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    return {
      kind: "array",
      length: value.length,
    };
  }

  const record = asRecord(value);
  if (record) {
    return {
      kind: "object",
      keys: Object.keys(record).slice(0, 10),
    };
  }

  return {
    kind: typeof value,
    value: value == null ? null : String(value).slice(0, 200),
  };
}

function findToolByKeyword(tools: McpToolDescriptor[], keywords: string[]): McpToolDescriptor | null {
  for (const keyword of keywords) {
    const tool = tools.find(
      (candidate) =>
        typeof candidate.name === "string" && candidate.name.toLowerCase().includes(keyword.toLowerCase()),
    );
    if (tool) return tool;
  }
  return null;
}

/** Prefer exact `instagram.profile` (or `instagram_profile`) when present. */
function findInstagramProfileTool(tools: McpToolDescriptor[]): McpToolDescriptor | null {
  const exact = tools.find(
    (c) => typeof c.name === "string" && /^instagram[._]profile$/i.test(c.name.trim()),
  );
  if (exact) return exact;
  return findToolByKeyword(tools, ["instagram", "social"]);
}

function chooseStrategyTool(
  tools: McpToolDescriptor[],
  config: McpConfig,
  input: StrategyMcpInput,
): { name: string; args: Record<string, unknown> } | null {
  if (config.instagramToolEnabled && typeof input.raw.instagramHandle === "string") {
    const tool = findInstagramProfileTool(tools);
    if (tool?.name) {
      return {
        name: tool.name,
        args: {
          clientId: input.clientId,
          workspaceId: config.workspaceId ?? null,
          instagramHandle: String(input.raw.instagramHandle).trim(),
          templateType: input.templateType ?? null,
        },
      };
    }
  }

  if (config.websiteToolEnabled && typeof input.raw.websiteUrl === "string") {
    const tool = findToolByKeyword(tools, ["website", "site", "crawl"]);
    if (tool?.name) {
      return {
        name: tool.name,
        args: {
          clientId: input.clientId,
          workspaceId: config.workspaceId,
          websiteUrl: input.raw.websiteUrl,
          templateType: input.templateType,
        },
      };
    }
  }

  return null;
}

function chooseCalendarTool(
  tools: McpToolDescriptor[],
  config: McpConfig,
  input: CalendarMcpInput,
): { name: string; args: Record<string, unknown> } | null {
  if (config.instagramToolEnabled && typeof input.instagramHandle === "string") {
    const tool = findInstagramProfileTool(tools);
    if (tool?.name) {
      return {
        name: tool.name,
        args: {
          clientId: input.clientId,
          workspaceId: config.workspaceId ?? null,
          instagramHandle: String(input.instagramHandle).trim(),
          templateType: null,
        },
      };
    }
  }

  if (config.websiteToolEnabled) {
    const tool = findToolByKeyword(tools, ["website", "site", "crawl"]);
    if (tool?.name) {
      return {
        name: tool.name,
        args: {
          clientId: input.clientId,
          workspaceId: config.workspaceId,
          month: input.month,
          notes: input.notes,
        },
      };
    }
  }

  return null;
}

export function getMcpConfigFromEnv(): McpConfig {
  return {
    enabled: readBoolean(process.env.MCP_ENABLED, false),
    timeoutMs: readNumber(process.env.MCP_TIMEOUT_MS, 15_000),
    strategyEnrichEnabled: readBoolean(process.env.MCP_STRATEGY_ENRICH_ENABLED, false),
    calendarEnrichEnabled: readBoolean(process.env.MCP_CALENDAR_ENRICH_ENABLED, false),
    baseUrl: readOptionalString(process.env.MCP_BASE_URL),
    apiKey: readOptionalString(process.env.MCP_API_KEY),
    workspaceId: readOptionalString(process.env.MCP_WORKSPACE_ID),
    localEnabled: readBoolean(process.env.MCP_LOCAL_ENABLED, false),
    localUrl: readOptionalString(process.env.MCP_LOCAL_URL),
    instagramToolEnabled: readBoolean(process.env.MCP_INSTAGRAM_TOOL_ENABLED, false),
    websiteToolEnabled: readBoolean(process.env.MCP_WEBSITE_TOOL_ENABLED, false),
  };
}

async function postJsonRpc(
  targetUrl: string,
  method: string,
  params: Record<string, unknown> | undefined,
  config: McpConfig,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const headers: Record<string, string> = {
      accept: "application/json",
      "content-type": "application/json",
    };
    if (config.apiKey) {
      headers.authorization = `Bearer ${config.apiKey}`;
    }

    const response = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: nextRequestId++,
        method,
        params,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`MCP HTTP ${response.status}: ${await response.text()}`);
    }

    const payload = (await response.json()) as JsonRpcResponse;
    if (payload.error) {
      throw new Error(`MCP ${method} error: ${payload.error.message ?? "Unknown error"}`);
    }
    if (!("result" in payload)) {
      throw new Error(`MCP ${method} returned no result`);
    }

    return payload.result;
  } finally {
    clearTimeout(timeout);
  }
}

async function mcpPost(method: string, params: Record<string, unknown> | undefined, config: McpConfig) {
  const errors: string[] = [];

  if (config.baseUrl) {
    try {
      return await postJsonRpc(config.baseUrl, method, params, config);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (config.localEnabled && config.localUrl) {
    try {
      return await postJsonRpc(config.localUrl, method, params, config);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (!config.baseUrl && !(config.localEnabled && config.localUrl)) {
    throw new Error("MCP_BASE_URL is required");
  }

  throw new Error(errors.join(" | ") || "MCP request failed");
}

async function mcpListTools(config: McpConfig): Promise<McpToolDescriptor[]> {
  logger.info(
    {
      targetUrl: config.baseUrl ?? config.localUrl,
      baseUrl: config.baseUrl,
      localUrl: config.localUrl,
    },
    "MCP chosen base URL",
  );
  const result = await mcpPost("tools/list", undefined, config);
  const record = asRecord(result);
  const tools = record?.tools;
  return Array.isArray(tools) ? (tools as McpToolDescriptor[]) : [];
}

async function mcpCallTool(name: string, args: Record<string, unknown>, config: McpConfig) {
  if (/instagram|social/i.test(name)) {
    logger.info(
      {
        toolName: name,
        targetUrl: config.baseUrl ?? config.localUrl,
        instagramHandle: args.instagramHandle ?? null,
      },
      "Instagram MCP request start",
    );
  }
  return mcpPost(
    "tools/call",
    {
      name,
      arguments: args,
    },
    config,
  );
}

export function isMcpAvailable(config: McpConfig = getMcpConfigFromEnv()): boolean {
  const available = config.enabled && (!!config.baseUrl || (config.localEnabled && !!config.localUrl));
  logger.info(
    {
      enabled: config.enabled,
      baseUrl: config.baseUrl,
      localEnabled: config.localEnabled,
      localUrl: config.localUrl,
      available,
    },
    "MCP enabled/disabled decision",
  );
  return available;
}

export async function orchestrateStrategyEnrichment(
  input: StrategyMcpInput,
  config: McpConfig = getMcpConfigFromEnv(),
): Promise<StrategyMcpResult> {
  const timestamp = new Date().toISOString();
  if (!isMcpAvailable(config) || !config.strategyEnrichEnabled) {
    return {
      used: false,
      status: "disabled",
      toolName: null,
      timestamp,
      toolResultSummary: null,
      enriched: input,
    };
  }

  try {
    const tools = await mcpListTools(config);
    const selection = chooseStrategyTool(tools, config, input);
    if (!selection) {
      return {
        used: false,
        status: "ok",
        toolName: null,
        timestamp,
        toolResultSummary: null,
        enriched: input,
      };
    }

    const toolResult = await mcpCallTool(selection.name, selection.args, config);
    const normalized = normalizeMcpToolResult(toolResult);
    if (/instagram|social/i.test(selection.name)) {
      logger.info(
        {
          toolName: selection.name,
          targetUrl: config.baseUrl ?? config.localUrl,
          rawSummary: summarizeToolResult(toolResult),
          normalizedSummary: summarizeToolResult(normalized),
        },
        "Instagram MCP request success (raw + normalized for extraction)",
      );
    }
    return {
      used: true,
      status: "ok",
      toolName: selection.name,
      timestamp,
      toolResultSummary: summarizeToolResult(normalized ?? toolResult),
      enriched: mergeMcpData(input, selection.name, toolResult),
    };
  } catch (error) {
    logger.warn(
      {
        targetUrl: config.baseUrl ?? config.localUrl,
        error: error instanceof Error ? `${error.name}:${error.message}` : String(error),
      },
      "Instagram MCP request failure",
    );
    return {
      used: false,
      status: isTimeoutError(error) ? "timeout" : "error",
      toolName: null,
      timestamp,
      toolResultSummary: null,
      enriched: input,
    };
  }
}

export async function orchestrateCalendarEnrichment(
  input: CalendarMcpInput,
  config: McpConfig = getMcpConfigFromEnv(),
): Promise<CalendarMcpResult> {
  const timestamp = new Date().toISOString();
  if (!isMcpAvailable(config) || !config.calendarEnrichEnabled) {
    return {
      used: false,
      status: "disabled",
      toolName: null,
      timestamp,
      toolResultSummary: null,
      enriched: input,
    };
  }

  try {
    const tools = await mcpListTools(config);
    const selection = chooseCalendarTool(tools, config, input);
    if (!selection) {
      return {
        used: false,
        status: "ok",
        toolName: null,
        timestamp,
        toolResultSummary: null,
        enriched: input,
      };
    }

    const toolResult = await mcpCallTool(selection.name, selection.args, config);
    const normalizedCal = normalizeMcpToolResult(toolResult);
    if (/instagram|social/i.test(selection.name)) {
      logger.info(
        {
          toolName: selection.name,
          targetUrl: config.baseUrl ?? config.localUrl,
          rawSummary: summarizeToolResult(toolResult),
          normalizedSummary: summarizeToolResult(normalizedCal),
        },
        "Instagram MCP calendar: raw + normalized",
      );
    }
    return {
      used: true,
      status: "ok",
      toolName: selection.name,
      timestamp,
      toolResultSummary: summarizeToolResult(normalizedCal ?? toolResult),
      enriched: mergeMcpData(input, selection.name, toolResult),
    };
  } catch (error) {
    logger.warn(
      {
        targetUrl: config.baseUrl ?? config.localUrl,
        error: error instanceof Error ? `${error.name}:${error.message}` : String(error),
      },
      "Instagram MCP request failure (calendar)",
    );
    return {
      used: false,
      status: isTimeoutError(error) ? "timeout" : "error",
      toolName: null,
      timestamp,
      toolResultSummary: null,
      enriched: input,
    };
  }
}
