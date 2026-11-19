const cities: Readonly<Record<string, string>> = {
  'baton rouge': 'America/Chicago', 'new orleans': 'America/Chicago', 'new york city': 'America/New_York',
  nyc: 'America/New_York', 'washington dc': 'America/New_York', 'san francisco': 'America/Los_Angeles',
  'las vegas': 'America/Los_Angeles', 'salt lake city': 'America/Denver', houston: 'America/Chicago',
  dallas: 'America/Chicago', mumbai: 'Asia/Kolkata', delhi: 'Asia/Kolkata', 'new delhi': 'Asia/Kolkata',
  kolkata: 'Asia/Kolkata', beijing: 'Asia/Shanghai', gmt: 'UTC', utc: 'UTC',
};

export function validTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 80 || !/^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)*$/.test(value)) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; }
  catch { return false; }
}

function zoneForPlace(place: string, localZone: string) {
  const name = place.toLowerCase().replace(/_/g, ' ').replace(/\./g, '').trim();
  if (/^(?:here|my (?:local )?time ?zone)$/.test(name)) return localZone;
  if (validTimeZone(place) && (place.includes('/') || /^(utc|gmt)$/i.test(place))) return place;
  if (Object.hasOwn(cities, name)) return cities[name];
  return Intl.supportedValuesOf('timeZone').find((zone) => zone.split('/').at(-1)?.replace(/_/g, ' ').toLowerCase() === name);
}

const timeQuestion = /^(?:what time is it|what(?:'?s| is) (?:the )?(?:current |local )?time|tell me the time|(?:current |local )?time)(?: (?:right )?now)?(?:(?: in (.+))| here)?$/i;
const dateQuestion = /^(?:what(?:'s| is) (?:the |today's |the current )?date(?: today)?|what (?:date|day) is (?:it|today)|today's date|date today|current date)(?: in (.+))?$/i;
const zoneQuestion = /^(?:what time ?zone am i in|what(?:'s| is) my time ?zone|my time ?zone)$/i;

export function clockReply(prompt: string, timeZone: string, now: Date): string | undefined {
  const text = prompt.trim().replace(/’/g, "'").replace(/[?!.,]+$/, '').trim();
  const time = timeQuestion.exec(text);
  const date = dateQuestion.exec(text);
  if (zoneQuestion.test(text)) return `Your chat is using **${timeZone}** from your device's time zone, or UTC if none was provided.`;
  if (!time && !date) return;
  const place = (time ?? date)?.[1]?.trim();
  const zone = place ? zoneForPlace(place.replace(/ (?:right )?now$/i, ''), timeZone) : timeZone;
  if (!zone) return 'I couldn’t match that place to a time zone. Try a city such as Tokyo or a time zone such as `America/Chicago`.';
  const day = new Intl.DateTimeFormat('en-US', { timeZone: zone, dateStyle: 'full' }).format(now);
  if (date) return `Today is **${day}** in **${zone}**.`;
  const localTime = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(now);
  return `It’s **${localTime}** on **${day}** in **${zone}**.`;
}

export function contextualClock(prompt: string, timeZone: string, now: Date) {
  if (!/\b(?:today|tomorrow|yesterday|current date|time zone|right now)\b/i.test(prompt)) return;
  return new Intl.DateTimeFormat('en-US', { timeZone, dateStyle: 'full', timeStyle: 'short' }).format(now) + ` (${timeZone})`;
}
