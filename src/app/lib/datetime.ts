// Dates and times are always shown in Indian Standard Time (Asia/Kolkata), whatever the
// viewer's computer is set to, e.g. "07 Oct 2026, 10:05 PM IST". The API sends UTC
// timestamps ending in "Z".

const IST = "Asia/Kolkata";

const dateTimeFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: IST,
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

const dateFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: IST,
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  let input: string | number = value;
  // A timestamp without a zone ("2026-10-07T16:35:01") is UTC from our API.
  if (typeof value === "string" && /T\d{2}:\d{2}/.test(value) && !/(Z|[+-]\d{2}:?\d{2})$/.test(value)) {
    input = `${value}Z`;
  }
  const date = new Date(input);
  return isNaN(date.getTime()) ? null : date;
}

/** "07 Oct 2026, 10:05 PM IST", or the fallback when there is no time. */
export function formatIST(value: string | number | Date | null | undefined, fallback = "—"): string {
  const date = toDate(value);
  if (!date) return fallback;
  return `${dateTimeFormat.format(date).replace(/\b(am|pm)\b/i, m => m.toUpperCase())} IST`;
}

/** "07 Oct 2026" (date only, in IST). */
export function formatISTDate(value: string | number | Date | null | undefined, fallback = "—"): string {
  const date = toDate(value);
  return date ? dateFormat.format(date) : fallback;
}
