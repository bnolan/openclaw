import { html, nothing } from "lit";
import { formatMs, formatRelativeTimestamp } from "../format.ts";
import type { CalendarDraftEvent, CalendarEvent } from "../types.ts";

export type CalendarProps = {
  loading: boolean;
  error: string | null;
  feedUrl: string;
  events: CalendarEvent[];
  cursorMonthMs: number;
  selectedDate: string;
  draft: CalendarDraftEvent;
  lastLoadedAt: number | null;
  onFeedUrlChange: (next: string) => void;
  onReload: () => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onToday: () => void;
  onSelectDate: (date: string) => void;
  onDraftChange: (patch: Partial<CalendarDraftEvent>) => void;
  onAddEvent: () => void;
  onRemoveLocalEvent: (uid: string) => void;
};

type CalendarCell = {
  date: Date;
  key: string;
  inMonth: boolean;
};

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function dateKeyFromDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function dateKeyFromMs(ms: number): string {
  return dateKeyFromDate(new Date(ms));
}

function parseDateKey(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

function buildMonthCells(cursorMonthMs: number): CalendarCell[] {
  const cursor = new Date(cursorMonthMs);
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  const cells: CalendarCell[] = [];
  for (let i = 0; i < 42; i++) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    cells.push({
      date,
      key: dateKeyFromDate(date),
      inMonth: date.getMonth() === cursor.getMonth(),
    });
  }
  return cells;
}

function formatSource(source: string): string {
  const clean = source.trim();
  if (!clean) {
    return "feed";
  }
  if (clean.includes("/")) {
    const parts = clean.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? clean;
  }
  return clean;
}

function formatEventWindow(event: CalendarEvent): string {
  if (event.allDay) {
    return "All day";
  }
  if (typeof event.endMs === "number") {
    const start = new Date(event.startMs);
    const end = new Date(event.endMs);
    const startLabel = `${pad2(start.getHours())}:${pad2(start.getMinutes())}`;
    const endLabel = `${pad2(end.getHours())}:${pad2(end.getMinutes())}`;
    return `${startLabel} - ${endLabel}`;
  }
  return formatMs(event.startMs);
}

function groupEventsByDate(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const key = dateKeyFromMs(event.startMs);
    const current = map.get(key) ?? [];
    current.push(event);
    map.set(key, current);
  }
  for (const [key, value] of map.entries()) {
    map.set(key, value.toSorted((a, b) => a.startMs - b.startMs));
  }
  return map;
}

export function renderCalendar(props: CalendarProps) {
  const cells = buildMonthCells(props.cursorMonthMs);
  const byDate = groupEventsByDate(props.events);
  const selectedEvents = byDate.get(props.selectedDate) ?? [];
  const monthLabel = new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  }).format(new Date(props.cursorMonthMs));
  const selectedDateObj = parseDateKey(props.selectedDate);
  const selectedDateLabel = selectedDateObj
    ? new Intl.DateTimeFormat(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      }).format(selectedDateObj)
    : props.selectedDate;

  return html`
    <section class="card calendar-shell">
      <div class="calendar-toolbar">
        <div class="calendar-toolbar__left">
          <button class="btn btn--sm" @click=${props.onPrevMonth}>Prev</button>
          <button class="btn btn--sm" @click=${props.onToday}>Today</button>
          <button class="btn btn--sm" @click=${props.onNextMonth}>Next</button>
        </div>
        <div class="calendar-toolbar__title">${monthLabel}</div>
        <div class="calendar-toolbar__right">
          <button class="btn btn--sm" ?disabled=${props.loading} @click=${props.onReload}>
            ${props.loading ? "Refreshing..." : "Sync feeds"}
          </button>
          ${
            props.lastLoadedAt
              ? html`<span class="muted">Updated ${formatRelativeTimestamp(props.lastLoadedAt)}</span>`
              : nothing
          }
        </div>
      </div>

      <div class="calendar-grid-wrap">
        <div class="calendar-grid">
          ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
            (label) => html`<div class="calendar-grid__dow">${label}</div>`,
          )}
          ${cells.map((cell) => {
            const events = byDate.get(cell.key) ?? [];
            const isSelected = props.selectedDate === cell.key;
            const isToday = cell.key === dateKeyFromMs(Date.now());
            return html`
              <button
                class="calendar-cell ${cell.inMonth ? "" : "calendar-cell--muted"} ${isSelected ? "calendar-cell--selected" : ""}"
                @click=${() => props.onSelectDate(cell.key)}
              >
                <div class="calendar-cell__day ${isToday ? "calendar-cell__day--today" : ""}">
                  ${cell.date.getDate()}
                </div>
                <div class="calendar-cell__events">
                  ${events.slice(0, 3).map(
                    (event) => html`<div class="calendar-event-pill" title=${event.summary}>
                      ${event.allDay ? "All day" : formatEventWindow(event)} · ${event.summary}
                    </div>`,
                  )}
                  ${events.length > 3
                    ? html`<div class="calendar-event-more">+${events.length - 3} more</div>`
                    : nothing}
                </div>
              </button>
            `;
          })}
        </div>
      </div>
    </section>

    <section class="calendar-details">
      <section class="card">
        <div class="card-title">${selectedDateLabel}</div>
        <div class="card-sub">${selectedEvents.length} event${selectedEvents.length === 1 ? "" : "s"}</div>
        ${
          selectedEvents.length === 0
            ? html`<div class="muted" style="margin-top: 12px;">No events on this day.</div>`
            : html`
                <div class="list" style="margin-top: 12px;">
                  ${selectedEvents.map(
                    (event) => html`
                      <div class="list-item">
                        <div class="list-main">
                          <div class="list-title">${event.summary}</div>
                          <div class="list-sub">${formatEventWindow(event)}</div>
                          ${event.location ? html`<div class="muted">Location: ${event.location}</div>` : nothing}
                          ${event.description ? html`<div class="muted">${event.description}</div>` : nothing}
                        </div>
                        <div class="list-meta">
                          <span class="chip">${formatSource(event.source)}</span>
                          ${
                            event.source === "local"
                              ? html`<button class="btn btn--sm danger" @click=${() => props.onRemoveLocalEvent(event.uid)}>
                                  Delete
                                </button>`
                              : nothing
                          }
                        </div>
                      </div>
                    `,
                  )}
                </div>
              `
        }
      </section>

      <section class="card">
        <div class="card-title">Add event</div>
        <div class="card-sub">Create an event directly in this calendar view.</div>
        <div class="form-grid" style="margin-top: 12px;">
          <label class="field" style="grid-column: 1 / -1;">
            <span>Title</span>
            <input
              .value=${props.draft.summary}
              placeholder="Team sync"
              @input=${(event: Event) =>
                props.onDraftChange({ summary: (event.target as HTMLInputElement).value })}
            />
          </label>
          <label class="field">
            <span>Date</span>
            <input
              type="date"
              .value=${props.draft.date}
              @input=${(event: Event) =>
                props.onDraftChange({ date: (event.target as HTMLInputElement).value })}
            />
          </label>
          <label class="field checkbox">
            <input
              type="checkbox"
              .checked=${props.draft.allDay}
              @change=${(event: Event) =>
                props.onDraftChange({ allDay: (event.target as HTMLInputElement).checked })}
            />
            <span>All day</span>
          </label>
          ${
            props.draft.allDay
              ? nothing
              : html`
                  <label class="field">
                    <span>Start</span>
                    <input
                      type="time"
                      .value=${props.draft.startTime}
                      @input=${(event: Event) =>
                        props.onDraftChange({ startTime: (event.target as HTMLInputElement).value })}
                    />
                  </label>
                  <label class="field">
                    <span>End</span>
                    <input
                      type="time"
                      .value=${props.draft.endTime}
                      @input=${(event: Event) =>
                        props.onDraftChange({ endTime: (event.target as HTMLInputElement).value })}
                    />
                  </label>
                `
          }
          <label class="field">
            <span>Location</span>
            <input
              .value=${props.draft.location}
              @input=${(event: Event) =>
                props.onDraftChange({ location: (event.target as HTMLInputElement).value })}
            />
          </label>
          <label class="field" style="grid-column: 1 / -1;">
            <span>Description</span>
            <textarea
              rows="3"
              .value=${props.draft.description}
              @input=${(event: Event) =>
                props.onDraftChange({ description: (event.target as HTMLTextAreaElement).value })}
            ></textarea>
          </label>
        </div>
        <div class="row" style="margin-top: 10px;">
          <button class="btn primary" @click=${props.onAddEvent}>Add event</button>
        </div>
      </section>

      <section class="card">
        <details>
          <summary class="calendar-feed-summary">Feed settings</summary>
          <div class="card-sub" style="margin-top: 8px;">
            Load one ICS feed URL per line (Radicale or static files).
          </div>
          <div class="form-grid" style="margin-top: 12px;">
            <label class="field" style="grid-column: 1 / -1;">
              <span>ICS feed URLs</span>
              <textarea
                .value=${props.feedUrl}
                rows="3"
                placeholder="/radicale/calendar.ics"
                @input=${(event: Event) =>
                  props.onFeedUrlChange((event.target as HTMLTextAreaElement).value)}
              ></textarea>
            </label>
          </div>
        </details>
        ${props.error ? html`<div class="muted" style="margin-top: 10px;">${props.error}</div>` : nothing}
      </section>
    </section>
  `;
}
