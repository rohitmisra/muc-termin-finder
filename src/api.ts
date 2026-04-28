import { createHash } from "node:crypto";

const BASE = "https://www48.muenchen.de/buergeransicht/api/citizen";
const H = { Accept: "application/json" };
const HJ = { ...H, "Content-Type": "application/json" };

export class ApiError extends Error {}

export interface Slot {
  date: string;   // "YYYY-MM-DD"
  ts: number;     // unix seconds
}

export interface Reservation {
  processId: number;
  authKey: string;
  timestamp: string;
  scope: Record<string, unknown>;
}

// ── ALTCHA PoW ───────────────────────────────────────────────────────────────

function solvePow(
  challenge: string,
  salt: string,
  algorithm: string,
  maxnumber: number,
): number | null {
  const alg = algorithm.replace("-", "").toLowerCase();
  for (let n = 0; n <= maxnumber; n++) {
    if (createHash(alg).update(`${salt}${n}`).digest("hex") === challenge) {
      return n;
    }
  }
  return null;
}

export async function getCaptchaToken(): Promise<string> {
  const ch = await get<{
    algorithm: string;
    challenge: string;
    salt: string;
    maxnumber: number;
    signature: string;
  }>("captcha-challenge/");

  const t0 = Date.now();
  const n = solvePow(
    ch.challenge,
    ch.salt,
    ch.algorithm ?? "SHA-256",
    ch.maxnumber ?? 500_000,
  );
  if (n === null) throw new ApiError("ALTCHA: solution not found");

  const solution = { ...ch, number: n, took: Date.now() - t0 };
  const payload = Buffer.from(JSON.stringify(solution)).toString("base64");

  const result = await post<{
    meta?: { success?: boolean };
    data?: { valid?: boolean };
    token?: string;
  }>("captcha-verify/", { payload });

  if (!result.meta?.success || !result.data?.valid) {
    throw new ApiError(`captcha-verify failed: ${JSON.stringify(result)}`);
  }
  if (!result.token) throw new ApiError("captcha-verify: no token in response");
  return result.token;
}

// ── catalogue ────────────────────────────────────────────────────────────────

export async function getServiceName(serviceId: number): Promise<string> {
  const data = await get<{ services: Array<{ id: number; name: string }> }>(
    "services/",
  );
  const svc = data.services.find((s) => s.id === serviceId);
  if (!svc) throw new ApiError(`service ${serviceId} not found`);
  return svc.name;
}

export async function listServices(
  query?: string,
): Promise<Array<{ id: number; name: string }>> {
  const data = await get<{ services: Array<{ id: number; name: string }> }>(
    "services/",
  );
  if (!query) return data.services;
  const q = query.toLowerCase();
  return data.services.filter((s) => s.name.toLowerCase().includes(q));
}

export async function listOffices(): Promise<
  Array<{ id: number; name: string; address: Record<string, string> }>
> {
  const data = await get<{
    offices: Array<{ id: number; name: string; address: Record<string, string> }>;
  }>("offices-and-services/");
  return data.offices;
}

// ── availability ─────────────────────────────────────────────────────────────

export async function getAvailableDays(
  token: string,
  officeId: number,
  serviceId: number,
  lookAheadDays: number,
): Promise<string[]> {
  const today = isoDate(new Date());
  const end = isoDate(addDays(new Date(), lookAheadDays));
  const data = await get<{
    availableDays?: Array<{ time: string }>;
    errors?: unknown;
  }>("available-days-by-office/", {
    startDate: today,
    endDate: end,
    officeId,
    serviceId,
    serviceCount: "1",
    captchaToken: token,
  });
  if (data.errors) throw new ApiError(`available-days: ${JSON.stringify(data.errors)}`);
  return (data.availableDays ?? []).map((d) => d.time);
}

export async function getAvailableSlots(
  token: string,
  date: string,
  officeId: number,
  serviceId: number,
): Promise<number[]> {
  const data = await get<{
    offices?: Array<{ appointments?: number[] }>;
    errors?: unknown;
  }>("available-appointments-by-office/", {
    date,
    officeId,
    serviceId,
    serviceCount: "1",
    captchaToken: token,
  });
  if (data.errors) throw new ApiError(`available-slots: ${JSON.stringify(data.errors)}`);
  const out = new Set<number>();
  for (const office of data.offices ?? []) {
    for (const ts of office.appointments ?? []) out.add(ts);
  }
  return [...out].sort((a, b) => a - b);
}

// ── booking (reserve → update → preconfirm) ──────────────────────────────────

export async function reserve(
  ts: number,
  captchaToken: string,
  officeId: number,
  serviceId: number,
): Promise<Reservation> {
  const data = await postRaw<Reservation & { processId?: number }>(
    "reserve-appointment/",
    {
      timestamp: ts,
      serviceCount: [1],
      officeId,
      serviceId: [serviceId],
      captchaToken,
    },
  );
  if (!data.processId || !data.authKey) {
    throw new ApiError(`reserve: unexpected response ${JSON.stringify(data)}`);
  }
  return data as Reservation;
}

function bookingBody(
  res: Reservation,
  familyName: string,
  email: string,
  telephone: string,
  serviceName: string,
  officeId: number,
  serviceId: number,
  status: "reserved" | "preconfirmed",
) {
  const provider = (res.scope as { provider?: { name?: string } }).provider;
  return {
    processId: res.processId,
    timestamp: res.timestamp,
    authKey: res.authKey,
    familyName,
    customTextfield: "",
    customTextfield2: "",
    email,
    telephone,
    officeName: provider?.name ?? "",
    officeId,
    scope: res.scope,
    subRequestCounts: [],
    serviceId,
    serviceName,
    serviceCount: 1,
    status,
    captchaToken: "",
    slotCount: 1,
  };
}

async function updateAppointment(
  res: Reservation,
  familyName: string,
  email: string,
  telephone: string,
  serviceName: string,
  officeId: number,
  serviceId: number,
): Promise<void> {
  await postRaw(
    "update-appointment/",
    bookingBody(res, familyName, email, telephone, serviceName, officeId, serviceId, "reserved"),
  );
}

async function preconfirmAppointment(
  res: Reservation,
  familyName: string,
  email: string,
  telephone: string,
  serviceName: string,
  officeId: number,
  serviceId: number,
): Promise<Record<string, unknown>> {
  return postRaw(
    "preconfirm-appointment/",
    bookingBody(res, familyName, email, telephone, serviceName, officeId, serviceId, "preconfirmed"),
  );
}

export async function book(
  ts: number,
  familyName: string,
  email: string,
  telephone: string,
  serviceName: string,
  officeId: number,
  serviceId: number,
): Promise<{ processId: number }> {
  const captchaToken = await getCaptchaToken();
  const reservation = await reserve(ts, captchaToken, officeId, serviceId);
  await updateAppointment(reservation, familyName, email, telephone, serviceName, officeId, serviceId);
  const result = await preconfirmAppointment(reservation, familyName, email, telephone, serviceName, officeId, serviceId);
  return { ...result, processId: reservation.processId } as { processId: number };
}

// ── http helpers ─────────────────────────────────────────────────────────────

async function get<T>(
  path: string,
  params?: Record<string, string | number>,
): Promise<T> {
  const url = new URL(`${BASE}/${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url, { headers: H });
  if (!res.ok) throw new ApiError(`GET ${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}/${path}`, {
    method: "POST",
    headers: HJ,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(`POST ${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function postRaw<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}/${path}`, {
    method: "POST",
    headers: HJ,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(`POST ${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

// ── utils ────────────────────────────────────────────────────────────────────

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}
