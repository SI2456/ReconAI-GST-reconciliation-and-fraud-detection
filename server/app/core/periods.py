import re
from datetime import datetime

MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
]
MONTH_ABBR = [m[:3].lower() for m in MONTH_NAMES]
MONTH_LOOKUP = {m.lower(): i + 1 for i, m in enumerate(MONTH_NAMES)}
for i, abbr in enumerate(MONTH_ABBR):
    MONTH_LOOKUP[abbr] = i + 1


def parse_month_year(val: str) -> tuple[int, int] | None:
    """Extract (month 1-12, year) from various string representations."""
    if not val:
        return None
    s = str(val).strip()
    if not s or s.upper() in ("ALL", "ALL UPLOADED DATA"):
        return None

    # Strip surrounding quotes or brackets if single item array
    if (s.startswith("[") and s.endswith("]")) or (s.startswith('"') and s.endswith('"')) or (s.startswith("'") and s.endswith("'")):
        try:
            import json
            parsed_json = json.loads(s)
            if isinstance(parsed_json, list) and parsed_json:
                return parse_month_year(str(parsed_json[0]))
            elif isinstance(parsed_json, str):
                s = parsed_json.strip()
        except Exception:
            s = s.strip("[]'\" ")

    # Try ISO date YYYY-MM-DD or DD-MM-YYYY or DD/MM/YYYY
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%m/%d/%Y", "%d.%m.%Y", "%Y/%m/%d"):
        try:
            dt = datetime.strptime(s[:10], fmt)
            return dt.month, dt.year
        except Exception:
            pass

    # Try MM-YYYY or MM/YYYY or MM_YYYY
    m = re.match(r"^(\d{1,2})[\-_/](\d{4})$", s)
    if m:
        month, year = int(m.group(1)), int(m.group(2))
        if 1 <= month <= 12:
            return month, year

    # Try YYYY-MM or YYYY/MM or YYYY_MM
    m = re.match(r"^(\d{4})[\-_/](\d{1,2})$", s)
    if m:
        year, month = int(m.group(1)), int(m.group(2))
        if 1 <= month <= 12:
            return month, year

    # Try Month YYYY (e.g. "April 2026", "Apr 2026", "April_2026", "June 2026")
    m = re.match(r"^([A-Za-z]+)[\s_\-]+(\d{4})$", s)
    if m:
        name, year = m.group(1).lower(), int(m.group(2))
        if name in MONTH_LOOKUP:
            return MONTH_LOOKUP[name], year

    # Search pattern inside longer strings (e.g., file names like "Vantage_PR_06_2026.csv")
    m = re.search(r"(\d{2})[\-_/](\d{4})", s)
    if m:
        month, year = int(m.group(1)), int(m.group(2))
        if 1 <= month <= 12:
            return month, year

    m = re.search(r"(\d{4})[\-_/](\d{2})", s)
    if m:
        year, month = int(m.group(1)), int(m.group(2))
        if 1 <= month <= 12:
            return month, year

    m = re.search(r"\b([A-Za-z]+)[\s_\-]+(\d{4})\b", s)
    if m:
        name, year = m.group(1).lower(), int(m.group(2))
        if name in MONTH_LOOKUP:
            return MONTH_LOOKUP[name], year

    return None


def normalize_period(val: str) -> str:
    """Return standard 'Month Year', e.g. 'April 2026'."""
    parsed = parse_month_year(val)
    if parsed:
        m, y = parsed
        return f"{MONTH_NAMES[m - 1]} {y}"
    return str(val or "").strip()


def period_to_mm_yyyy(val: str) -> str:
    """Return 'MM-YYYY', e.g. '04-2026', or empty string if invalid."""
    parsed = parse_month_year(val)
    if parsed:
        m, y = parsed
        return f"{m:02d}-{y}"
    return ""


def expand_period_range(val: str) -> list[tuple[int, int]]:
    """Parse ranges like 'April–September 2026', JSON lists, or comma-separated lists into list of (month, year)."""
    s = str(val or "").strip()
    if not s:
        return []

    # Check for JSON array string
    if s.startswith("[") and s.endswith("]"):
        try:
            import json
            items = json.loads(s)
            result = []
            for it in items:
                p = parse_month_year(str(it).strip())
                if p and p not in result:
                    result.append(p)
            if result:
                return result
        except Exception:
            pass

    single = parse_month_year(s)
    if single:
        return [single]

    # Check for range with dash/en-dash/to: "April–September 2026" or "April-September 2026"
    m = re.match(r"^([A-Za-z]+)\s*[\-–—~to]+\s*([A-Za-z]+)[\s_\-]+(\d{4})$", s, re.IGNORECASE)
    if m:
        m1_name, m2_name, year_str = m.group(1).lower(), m.group(2).lower(), m.group(3)
        if m1_name in MONTH_LOOKUP and m2_name in MONTH_LOOKUP:
            m1, m2, year = MONTH_LOOKUP[m1_name], MONTH_LOOKUP[m2_name], int(year_str)
            if m1 <= m2:
                return [(m, year) for m in range(m1, m2 + 1)]
            else:
                return [(m, year) for m in range(m1, 13)] + [(m, year + 1) for m in range(1, m2 + 1)]

    # Comma separated list of periods
    if "," in s:
        result = []
        for part in s.split(","):
            p = parse_month_year(part.strip())
            if p and p not in result:
                result.append(p)
        if result:
            return result

    return []


def periods_match(p1: str, p2: str) -> bool:
    """Check if two period specifications match or overlap."""
    s1, s2 = str(p1 or "").strip(), str(p2 or "").strip()
    if not s1 or not s2:
        return False
    if s1.upper() in ("ALL", "ALL UPLOADED DATA") or s2.upper() in ("ALL", "ALL UPLOADED DATA"):
        return True
    if s1.lower() == s2.lower():
        return True

    r1 = expand_period_range(s1)
    r2 = expand_period_range(s2)

    if r1 and r2:
        return any(item in r2 for item in r1)

    return False
