import { html, nothing } from "lit";
import { formatMs, formatRelativeTimestamp } from "../format.ts";
import type { CalendarEvent } from "../types.ts";

export type CalendarProps = {
  loading: boolean;
  error: string | null;
  feedUrl: string;
  events: CalendarEvent[];
  lastLoadedAt: number | null;
  onFeedUrlChange: (next: string) => void;
  onReload: () => void;
};

function formatEventWindow(event: CalendarEvent): string {
  if (event.allDay) {
    return `${formatMs(event.startMs)} (all day)`;
  }
  if (typeof event.endMs === "number") {
    return `${formatMs(event.startMs)} - ${formatMs(event.endMs)}`;
  }
  return formatMs(event.startMs);
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

export function renderCalendar(props: CalendarProps) {
  return html`
    <section class="card">
      <div class="card-title">Calendar feeds</div>
      <div class="card-sub">Load one ICS feed URL per line (Radicale or static files).</div>
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
      <div class="row" style="margin-top: 10px;">
        <button class="btn" ?disabled=${props.loading} @click=${props.onReload}>
          ${props.loading ? "Loading..." : "Reload calendar"}
        </button>
        ${
          props.lastLoadedAt
            ? html`<span class="muted">Last loaded ${formatRelativeTimestamp(props.lastLoadedAt)}</span>`
            : nothing
        }
      </div>
      ${props.error ? html`<div class="muted" style="margin-top: 10px;">${props.error}</div>` : nothing}
    </section>

    <section class="card" style="margin-top: 12px;">
      <div class="card-title">Upcoming events</div>
      <div class="card-sub">${props.events.length} event${props.events.length === 1 ? "" : "s"}</div>
      ${
        props.events.length === 0
          ? html`<div class="muted" style="margin-top: 12px;">No upcoming events found.</div>`
          : html`
              <div class="list" style="margin-top: 12px;">
                ${props.events.map(
                  (event) => html`
                    <div class="list-item">
                      <div class="list-main">
                        <div class="list-title">${event.summary}</div>
                        <div class="list-sub">${formatEventWindow(event)}</div>
                        <div class="muted">${formatRelativeTimestamp(event.startMs)}</div>
                        ${event.location ? html`<div class="muted">Location: ${event.location}</div>` : nothing}
                        ${
                          event.description
                            ? html`<div class="muted">${event.description.slice(0, 240)}</div>`
                            : nothing
                        }
                      </div>
                      <div class="list-meta">
                        <span class="chip">${formatSource(event.source)}</span>
                      </div>
                    </div>
                  `,
                )}
              </div>
            `
      }
    </section>
  `;
}
