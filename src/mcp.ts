import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  ApiError,
  getAvailableDays,
  getAvailableSlots,
  getCaptchaToken,
  listOffices,
  listServices,
} from "./api.js";
import { config } from "./config.js";
import { fmtDate, fmtTime } from "./format.js";

const server = new Server(
  { name: "muc-termin-finder", version: "2.0.0" },
  { capabilities: { tools: {} } },
);

// ── tool list ─────────────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "check_availability",
      description:
        "Check available appointment slots for a München city service. Solves the ALTCHA captcha and returns all slots within the look-ahead window.",
      inputSchema: {
        type: "object",
        properties: {
          serviceId: {
            type: "number",
            description: `Service ID (default: ${config.SERVICE_ID} — Verpflichtungserklärung abgeben)`,
          },
          officeId: {
            type: "number",
            description: `Office ID (default: ${config.OFFICE_ID} — KVR Schnellschalter, Ruppertstraße 19)`,
          },
          lookAheadDays: {
            type: "number",
            description: "Days ahead to search (1–180, default: 90)",
          },
        },
      },
    },
    {
      name: "list_services",
      description: "Search the München appointment service catalogue by name.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Partial name to filter by (case-insensitive). Omit to list all.",
          },
        },
      },
    },
    {
      name: "list_offices",
      description: "List all München appointment offices with addresses.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
  ],
}));

// ── tool dispatch ─────────────────────────────────────────────────────────────

const CheckAvailabilityInput = z.object({
  serviceId: z.number().int().optional(),
  officeId: z.number().int().optional(),
  lookAheadDays: z.number().int().min(1).max(180).optional(),
});

const ListServicesInput = z.object({
  query: z.string().optional(),
});

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  try {
    if (name === "check_availability") {
      const { serviceId, officeId, lookAheadDays } =
        CheckAvailabilityInput.parse(args ?? {});
      const svcId = serviceId ?? config.SERVICE_ID;
      const offId = officeId ?? config.OFFICE_ID;
      const days = lookAheadDays ?? config.LOOK_AHEAD_DAYS;

      const token = await getCaptchaToken();
      const availDays = await getAvailableDays(token, offId, svcId, days);

      if (availDays.length === 0) {
        return text("No available appointments found in the next " + days + " days.");
      }

      const lines: string[] = [
        `Available appointments (serviceId=${svcId}, officeId=${offId}):`,
      ];
      for (const date of availDays) {
        const slots = await getAvailableSlots(token, date, offId, svcId);
        const times = slots.map(fmtTime).join(", ");
        lines.push(`  ${fmtDate(date)}: ${times || "(no time slots returned)"}`);
      }
      return text(lines.join("\n"));
    }

    if (name === "list_services") {
      const { query } = ListServicesInput.parse(args ?? {});
      const services = await listServices(query);
      if (services.length === 0) return text("No services matched.");
      const lines = services.map((s) => `  ${s.id}  ${s.name}`);
      return text(`Services:\n${lines.join("\n")}`);
    }

    if (name === "list_offices") {
      const offices = await listOffices();
      const lines = offices.map(
        (o) =>
          `  ${o.id}  ${o.name} — ${o.address?.street ?? ""} ${o.address?.house_number ?? ""}, ${o.address?.city ?? ""}`,
      );
      return text(`Offices:\n${lines.join("\n")}`);
    }

    return text(`Unknown tool: ${name}`);
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : String(err);
    return text(`Error: ${msg}`);
  }
});

function text(content: string) {
  return { content: [{ type: "text" as const, text: content }] };
}

// ── start ─────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[mcp] muc-termin-finder MCP server running on stdio");
}

main().catch((err) => {
  console.error("[mcp] fatal:", err);
  process.exit(1);
});
