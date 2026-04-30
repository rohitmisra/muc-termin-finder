import { Telegraf } from "telegraf";
import type { Slot } from "./api.js";
import {
  ApiError,
  book,
  getAvailableDays,
  getAvailableSlots,
  getCaptchaToken,
  getServiceName,
} from "./api.js";
import { config } from "./config.js";
import { fmtDate, fmtTime } from "./format.js";
import { State } from "./state.js";

const bot = new Telegraf(config.TELEGRAM_BOT_TOKEN);
const state = new State(`${config.STATE_DIR}/state.json`);
let serviceName = "Verpflichtungserklärung abgeben";

const isMe = (id: number) => id === config.TELEGRAM_CHAT_ID;

const stats = {
  startedAt: new Date(),
  totalPolls: 0,
  failedPolls: 0,
  lastPollAt: null as Date | null,
  lastSuccessAt: null as Date | null,
  lastError: null as string | null,
  slotsFoundAllTime: 0,
};

function ago(d: Date | null): string {
  if (!d) return "never";
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
}

// ── alert builder ─────────────────────────────────────────────────────────────

type KeyboardRow = Array<{ text: string; callback_data: string }>;

function buildAlert(slots: Slot[]): { text: string; keyboard: KeyboardRow[] } {
  const byDate = new Map<string, number[]>();
  for (const { date, ts } of slots) {
    (byDate.get(date) ?? byDate.set(date, []).get(date)!).push(ts);
  }

  const lines = [`🇩🇪 *${serviceName}* — KVR Schnellschalter`];
  const keyboard: KeyboardRow[] = [];

  for (const [date, tss] of [...byDate.entries()].sort()) {
    lines.push(`\n*${fmtDate(date)}* — ${tss.length} slot(s)`);
    const sorted = [...tss].sort((a, b) => a - b);
    let row: KeyboardRow = [];
    for (const ts of sorted) {
      row.push({ text: fmtTime(ts), callback_data: `book:${ts}` });
      if (row.length === 3) {
        keyboard.push(row);
        row = [];
      }
    }
    if (row.length) keyboard.push(row);
  }

  keyboard.push([
    { text: "🔄 Refresh", callback_data: "refresh" },
    { text: "🔇 Mute 1h", callback_data: "mute1h" },
  ]);

  return { text: lines.join("\n"), keyboard };
}

// ── commands ─────────────────────────────────────────────────────────────────

bot.command("start", async (ctx) => {
  if (!isMe(ctx.chat.id)) {
    console.log(`[bot] unauthorized /start from chat_id=${ctx.chat.id}`);
    return;
  }
  await ctx.reply(
    "Watching for slots.\n" +
      "/status — slot count and mute state\n" +
      "/mute [hours] — silence alerts (default 1)\n" +
      "/unmute — re-enable alerts",
  );
});

bot.command("status", async (ctx) => {
  if (!isMe(ctx.chat.id)) return;
  const upSec = Math.floor((Date.now() - stats.startedAt.getTime()) / 1000);
  const upStr = upSec < 3600
    ? `${Math.floor(upSec / 60)}m ${upSec % 60}s`
    : `${Math.floor(upSec / 3600)}h ${Math.floor((upSec % 3600) / 60)}m`;
  const health = stats.lastError && stats.lastSuccessAt === null ? "🔴" :
    stats.failedPolls > 0 && stats.lastError ? "🟡" : "🟢";
  await ctx.reply(
    `${health} *muc-termin-finder*\n` +
    `\n*Polling*\n` +
    `  Interval    : every ${config.POLL_SECONDS}s\n` +
    `  Last poll   : ${ago(stats.lastPollAt)}\n` +
    `  Last success: ${ago(stats.lastSuccessAt)}\n` +
    `  Total       : ${stats.totalPolls} (${stats.failedPolls} failed)\n` +
    (stats.lastError ? `  Last error  : \`${stats.lastError.slice(0, 80)}\`\n` : "") +
    `\n*Slots*\n` +
    `  Currently   : ${state.previousSlotCount}\n` +
    `  Found total : ${stats.slotsFoundAllTime}\n` +
    `  In flight   : ${state.inFlight.size}\n` +
    `\n*Bot*\n` +
    `  Uptime      : ${upStr}\n` +
    `  Muted until : ${state.muteUntilStr ?? "—"}`,
    { parse_mode: "Markdown" },
  );
});

bot.command("mute", async (ctx) => {
  if (!isMe(ctx.chat.id)) return;
  const arg = ctx.message.text.split(" ")[1] ?? "1";
  const hours = parseFloat(arg.replace("h", ""));
  if (isNaN(hours) || hours <= 0) {
    await ctx.reply("Usage: /mute [hours]  e.g. /mute 2");
    return;
  }
  state.setMute(hours);
  await ctx.reply(`Muted for ${hours}h.`);
});

bot.command("unmute", async (ctx) => {
  if (!isMe(ctx.chat.id)) return;
  state.clearMute();
  await ctx.reply("Unmuted.");
});

// log unknown senders so user can find their chat_id
bot.on("message", (ctx) => {
  console.log(
    `[bot] message from chat_id=${ctx.chat.id} (authorized=${isMe(ctx.chat.id)})`,
  );
});

// ── booking callback ──────────────────────────────────────────────────────────

bot.action(/^book:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  if (!ctx.chat || !isMe(ctx.chat.id)) return;

  const ts = parseInt(ctx.match[1]);
  if (state.inFlight.has(ts)) {
    await ctx.answerCbQuery("Already booking this slot.", true);
    return;
  }
  state.inFlight.add(ts);

  const slotStr = fmtTime(ts);
  try {
    await ctx.editMessageText(`⏳ Booking ${slotStr}…`);
    const result = await book(
      ts,
      config.FAMILY_NAME,
      config.EMAIL,
      config.TELEPHONE,
      serviceName,
      config.OFFICE_ID,
      config.SERVICE_ID,
    );
    await ctx.editMessageText(
      `✅ Booked ${slotStr}\nProcess ID: \`${result.processId}\`\n` +
        `Confirmation email sent to ${config.EMAIL}.\n` +
        `_Click the link in that email to finalise._`,
      { parse_mode: "Markdown" },
    );
    console.log(`[bot] booked ts=${ts} processId=${result.processId}`);
  } catch (err) {
    console.error("[bot] booking error:", err);
    const msg = err instanceof ApiError ? err.message : String(err);
    await ctx.editMessageText(`❌ Booking ${slotStr} failed:\n\`${msg}\``, {
      parse_mode: "Markdown",
    });
  } finally {
    state.inFlight.delete(ts);
    state.clearActiveMessage();
  }
});

bot.action("mute1h", async (ctx) => {
  await ctx.answerCbQuery("Muted 1h.");
  state.setMute(1);
});

bot.action("refresh", async (ctx) => {
  await ctx.answerCbQuery("Refreshing…");
  await pollOnce();
});

// ── watcher ──────────────────────────────────────────────────────────────────

async function fetchCurrentSlots(): Promise<Slot[]> {
  const token = await getCaptchaToken();
  const days = await getAvailableDays(
    token,
    config.OFFICE_ID,
    config.SERVICE_ID,
    config.LOOK_AHEAD_DAYS,
  );
  const slots: Slot[] = [];
  for (const date of days) {
    const tss = await getAvailableSlots(token, date, config.OFFICE_ID, config.SERVICE_ID);
    for (const ts of tss) slots.push({ date, ts });
  }
  return slots;
}

async function pollOnce(): Promise<void> {
  stats.totalPolls++;
  stats.lastPollAt = new Date();
  let current: Slot[];
  try {
    current = await fetchCurrentSlots();
    stats.lastSuccessAt = new Date();
    stats.lastError = null;
  } catch (err) {
    stats.failedPolls++;
    stats.lastError = err instanceof Error ? err.message : String(err);
    console.error("[watcher] poll failed:", stats.lastError);
    return;
  }

  const newSlots = state.updateSlots(current);
  stats.slotsFoundAllTime += newSlots.length;
  console.log(`[watcher] ${current.length} slots, ${newSlots.length} new`);

  if (state.isMuted()) return;

  const shouldAlert =
    newSlots.length > 0 ||
    (state.activeMessageId === null && current.length > 0);

  if (shouldAlert && current.length > 0) {
    const { text, keyboard } = buildAlert(current);
    const extra = {
      parse_mode: "Markdown" as const,
      reply_markup: { inline_keyboard: keyboard },
    };
    if (state.activeMessageId !== null) {
      try {
        await bot.telegram.editMessageText(
          config.TELEGRAM_CHAT_ID,
          state.activeMessageId,
          undefined,
          text,
          extra,
        );
        return;
      } catch {
        /* message too old or deleted — fall through to send new */
      }
    }
    const sent = await bot.telegram.sendMessage(
      config.TELEGRAM_CHAT_ID,
      text,
      extra,
    );
    state.setActiveMessage(sent.message_id);
  } else if (current.length === 0 && state.activeMessageId !== null) {
    try {
      await bot.telegram.editMessageText(
        config.TELEGRAM_CHAT_ID,
        state.activeMessageId,
        undefined,
        "(Slots no longer available.)",
      );
    } catch {
      /* ignore */
    }
    state.clearActiveMessage();
  }
}

function scheduleNextPoll() {
  setTimeout(async () => {
    await pollOnce();
    scheduleNextPoll();
  }, config.POLL_SECONDS * 1000);
}

// ── start ─────────────────────────────────────────────────────────────────────

async function main() {
  serviceName = await getServiceName(config.SERVICE_ID);
  console.log(`[bot] service: ${serviceName} (id=${config.SERVICE_ID})`);
  console.log(`[bot] office id=${config.OFFICE_ID}`);
  console.log(`[bot] alerting chat_id=${config.TELEGRAM_CHAT_ID}`);
  console.log(`[bot] polling every ${config.POLL_SECONDS}s`);

  // first poll immediately, then on schedule
  pollOnce().then(scheduleNextPoll);

  bot.launch();

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

main().catch((err) => {
  console.error("[bot] fatal:", err);
  process.exit(1);
});
