import type { CalendarEvent } from "../types.ts";
import { normalizeBasePath } from "../navigation.ts";

const CALENDAR_EVENT_LIMIT = 2000;
const CALENDAR_LOCAL_STORAGE_KEY = "openclaw.control.calendar.local-events.v1";

export type CalendarState = {
  calendarFeedUrl: string;
  calendarLoading: boolean;
  calendarError: string | null;
  calendarEvents: CalendarEvent[];
  calendarLocalEvents: CalendarEvent[];
  calendarLastLoadedAt: number | null;
  basePath?: string;
};

type ParsedDate = {
  ms: number;
  allDay: boolean;
};

function sanitizeText(value: string): string {
  return value.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").trim();
}

function unfoldIcs(raw: string): string[] {
  const normalized = raw.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const unfolded: string[] = [];
  for (const line of lines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += line.slice(1);
      continue;
    }
    unfolded.push(line);
  }
  return unfolded;
}

function parseDateValue(raw: string): ParsedDate | null {
  const value = raw.trim();
  if (!value) {
    return null;
  }
  if (/^\d{8}$/.test(value)) {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6));
    const day = Number(value.slice(6, 8));
    const ms = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
    return Number.isFinite(ms) ? { ms, allDay: true } : null;
  }
  const match = value.match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/,
  );
  if (!match) {
    return null;
  }
  const [, y, m, d, hh, mm, ss = "00", z] = match;
  if (z) {
    const ms = Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss), 0);
    return Number.isFinite(ms) ? { ms, allDay: false } : null;
  }
  const local = new Date(
    Number(y),
    Number(m) - 1,
    Number(d),
    Number(hh),
    Number(mm),
    Number(ss),
    0,
  );
  const ms = local.getTime();
  return Number.isFinite(ms) ? { ms, allDay: false } : null;
}

function parseEvent(lines: string[], source: string, index: number): CalendarEvent | null {
  let uid = "";
  let summary = "";
  let description = "";
  let location = "";
  let start: ParsedDate | null = null;
  let end: ParsedDate | null = null;
  for (const line of lines) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex).toUpperCase();
    const value = sanitizeText(line.slice(separatorIndex + 1));
    if (key.startsWith("UID")) {
      uid = value;
      continue;
    }
    if (key.startsWith("SUMMARY")) {
      summary = value;
      continue;
    }
    if (key.startsWith("DESCRIPTION")) {
      description = value;
      continue;
    }
    if (key.startsWith("LOCATION")) {
      location = value;
      continue;
    }
    if (key.startsWith("DTSTART")) {
      start = parseDateValue(value);
      continue;
    }
    if (key.startsWith("DTEND")) {
      end = parseDateValue(value);
    }
  }
  if (!start) {
    return null;
  }
  return {
    uid: uid || `${source}#${index}`,
    summary: summary || "Untitled event",
    description: description || null,
    location: location || null,
    startMs: start.ms,
    endMs: end?.ms ?? null,
    allDay: start.allDay,
    source,
  };
}

function parseIcsEvents(rawIcs: string, source: string): CalendarEvent[] {
  const lines = unfoldIcs(rawIcs);
  const events: CalendarEvent[] = [];
  let inEvent = false;
  let eventLines: string[] = [];
  for (const line of lines) {
    const upper = line.trim().toUpperCase();
    if (upper === "BEGIN:VEVENT") {
      inEvent = true;
      eventLines = [];
      continue;
    }
    if (upper === "END:VEVENT") {
      if (inEvent) {
        const event = parseEvent(eventLines, source, events.length);
        if (event) {
          events.push(event);
        }
      }
      inEvent = false;
      eventLines = [];
      continue;
    }
    if (inEvent) {
      eventLines.push(line);
    }
  }
  return events;
}

function normalizeSources(input: string): string[] {
  return input
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeFetchUrl(url: string, basePath = ""): string {
  const base = normalizeBasePath(basePath);
  if (/^https?:\/\//i.test(url)) {
    return url;
  }
  const trimmed = url.trim();
  if (!trimmed) {
    return base || "/";
  }
  if (trimmed.startsWith("/")) {
    if (!base || trimmed === base || trimmed.startsWith(`${base}/`)) {
      return trimmed;
    }
    return `${base}${trimmed}`;
  }
  if (!base) {
    return `/${trimmed}`;
  }
  return `${base}/${trimmed}`;
}

export async function loadCalendarEvents(state: CalendarState) {
  const sources = normalizeSources(state.calendarFeedUrl);
  if (sources.length === 0) {
    state.calendarError = "Add at least one ICS feed URL.";
    state.calendarEvents = [];
    return;
  }
  if (state.calendarLoading) {
    return;
  }
  state.calendarLoading = true;
  state.calendarError = null;
  try {
    const fetched = await Promise.all(
      sources.map(async (source) => {
        const res = await fetch(normalizeFetchUrl(source, state.basePath ?? ""), {
          method: "GET",
          headers: {
            Accept: "text/calendar, text/plain;q=0.9, */*;q=0.8",
          },
          credentials: "same-origin",
        });
        if (!res.ok) {
          throw new Error(`Failed to fetch ${source} (${res.status})`);
        }
        const raw = await res.text();
        return parseIcsEvents(raw, source);
      }),
    );
    state.calendarEvents = fetched
      .flat()
      .toSorted((a, b) => a.startMs - b.startMs)
      .slice(0, CALENDAR_EVENT_LIMIT);
    state.calendarLastLoadedAt = Date.now();
  } catch (err) {
    state.calendarError = err instanceof Error ? err.message : String(err);
    state.calendarEvents = [];
  } finally {
    state.calendarLoading = false;
  }
}

function safeParseLocalEvents(raw: string | null): CalendarEvent[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as CalendarEvent[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry) => {
      if (!entry || typeof entry !== "object") {
        return false;
      }
      const event = entry as CalendarEvent;
      return (
        typeof event.uid === "string" &&
        typeof event.summary === "string" &&
        typeof event.startMs === "number" &&
        Number.isFinite(event.startMs) &&
        typeof event.source === "string"
      );
    });
  } catch {
    return [];
  }
}

function persistLocalEvents(events: CalendarEvent[]) {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.setItem(CALENDAR_LOCAL_STORAGE_KEY, JSON.stringify(events));
}

export function loadLocalCalendarEvents(state: CalendarState) {
  if (typeof localStorage === "undefined") {
    state.calendarLocalEvents = [];
    return;
  }
  state.calendarLocalEvents = safeParseLocalEvents(
    localStorage.getItem(CALENDAR_LOCAL_STORAGE_KEY),
  )
    .map((entry) => ({
      ...entry,
      source: "local",
    }))
    .toSorted((a, b) => a.startMs - b.startMs);
}

export function upsertLocalCalendarEvent(state: CalendarState, event: CalendarEvent) {
  const next = [...state.calendarLocalEvents.filter((entry) => entry.uid !== event.uid), event].toSorted(
    (a, b) => a.startMs - b.startMs,
  );
  state.calendarLocalEvents = next;
  persistLocalEvents(next);
}

export function removeLocalCalendarEvent(state: CalendarState, uid: string) {
  const next = state.calendarLocalEvents.filter((entry) => entry.uid !== uid);
  state.calendarLocalEvents = next;
  persistLocalEvents(next);
}
