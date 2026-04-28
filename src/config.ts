import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_CHAT_ID: z.coerce.number().int(),
  FAMILY_NAME: z.string().min(1),
  EMAIL: z.string().email(),
  TELEPHONE: z.string().default(""),
  SERVICE_ID: z.coerce.number().int().default(1063741),
  OFFICE_ID: z.coerce.number().int().default(10308621),
  POLL_SECONDS: z.coerce.number().int().min(10).default(45),
  LOOK_AHEAD_DAYS: z.coerce.number().int().min(1).max(180).default(90),
  STATE_DIR: z.string().default("./data"),
});

export type Config = z.infer<typeof schema>;
export const config: Config = schema.parse(process.env);
