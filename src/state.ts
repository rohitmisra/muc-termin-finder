import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Slot } from "./api.js";

const slotKey = (s: Slot) => `${s.date}:${s.ts}`;
const parseKey = (k: string): Slot => {
  const i = k.indexOf(":");
  return { date: k.slice(0, i), ts: Number(k.slice(i + 1)) };
};

interface Persisted {
  previousSlots: Array<{ date: string; ts: number }>;
  activeMessageId: number | null;
  muteUntil: string | null;
}

export class State {
  private prevKeys = new Set<string>();
  private _activeMessageId: number | null = null;
  private _muteUntil: Date | null = null;
  readonly inFlight = new Set<number>();

  constructor(private readonly path: string) {
    try {
      const raw: Persisted = JSON.parse(readFileSync(path, "utf8"));
      this.prevKeys = new Set(raw.previousSlots.map(slotKey));
      this._activeMessageId = raw.activeMessageId ?? null;
      this._muteUntil = raw.muteUntil ? new Date(raw.muteUntil) : null;
    } catch {
      /* first run or corrupt file — start fresh */
    }
  }

  get previousSlotCount() {
    return this.prevKeys.size;
  }

  get activeMessageId() {
    return this._activeMessageId;
  }

  updateSlots(current: Slot[]): Slot[] {
    const currentKeys = new Set(current.map(slotKey));
    const newSlots = current.filter((s) => !this.prevKeys.has(slotKey(s)));
    this.prevKeys = currentKeys;
    this.save();
    return newSlots;
  }

  setActiveMessage(id: number): void {
    this._activeMessageId = id;
    this.save();
  }

  clearActiveMessage(): void {
    this._activeMessageId = null;
    this.save();
  }

  isMuted(): boolean {
    return this._muteUntil !== null && new Date() < this._muteUntil;
  }

  setMute(hours: number): void {
    this._muteUntil = new Date(Date.now() + hours * 3_600_000);
    this.save();
  }

  clearMute(): void {
    this._muteUntil = null;
    this.save();
  }

  get muteUntilStr(): string | null {
    return this._muteUntil?.toISOString() ?? null;
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    const data: Persisted = {
      previousSlots: [...this.prevKeys].map(parseKey),
      activeMessageId: this._activeMessageId,
      muteUntil: this._muteUntil?.toISOString() ?? null,
    };
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, this.path);
  }
}
