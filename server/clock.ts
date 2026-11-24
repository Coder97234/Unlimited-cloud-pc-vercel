import { LANGUAGES } from '../shared/experience.ts';
import type { ReplyLanguage } from '../shared/experience.ts';
import { readSkillCommand } from '../shared/skill-catalog.ts';

const cities: Readonly<Record<string, string>> = {
  'baton rouge': 'America/Chicago', 'new orleans': 'America/Chicago', 'new york city': 'America/New_York',
  nyc: 'America/New_York', 'washington dc': 'America/New_York', 'san francisco': 'America/Los_Angeles',
  'las vegas': 'America/Los_Angeles', 'los angeles': 'America/Los_Angeles', 'salt lake city': 'America/Denver', houston: 'America/Chicago',
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

const timeQuestion = /^(?:what time is it|what(?:'?s| is) (?:the )?(?:current |local )?time|tell me (?:the )?(?:current |local )?time|(?:current |local )?time)(?: (?:right now|now|rn))?(?: in (.+)| here)?$/i;
const dateQuestion = /^(?:(?:what(?:'?s| is)|tell me) (?:the |today's |the current )?date(?: today)?|what (?:date|day) is (?:it|today)|today's date|date today|current date)(?: in (.+))?$/i;
const yearQuestion = /^(?:what year is it|what(?:'s| is) the current year|current year)$/i;
const zoneQuestion = /^(?:what time ?zone am i in|what(?:'s| is) my time ?zone|my time ?zone)$/i;

export function clockReply(prompt: string, timeZone: string, now: Date, language?: ReplyLanguage): string | undefined {
  const lang = language && language !== 'auto' ? language : 'en';
  const locale = LANGUAGES[lang].locale;
  const text = prompt.trim().replace(/’/g, "'").replace(/\s+/g, ' ').replace(/[?!.,]+$/, '').replace(/(?:,? please)$/i, '').trim();
  const command = readSkillCommand(prompt);
  const time = timeQuestion.exec(text) ?? /^(?:¿?qu[eé] hora es|quelle heure est-il|wie sp[aä]t ist es|que horas s[aã]o)$/i.exec(text);
  const date = dateQuestion.exec(text) ?? /^(?:¿?qu[eé] d[ií]a es hoy|quelle est la date aujourd'hui|welches datum haben wir heute|qual [eé] a data de hoje)$/i.exec(text);
  if (zoneQuestion.test(text)) return lang === 'en' ? `Your chat is using **${timeZone}** from your device's time zone, or UTC if none was provided.` : `**${timeZone}**`;
  if (yearQuestion.test(text)) {
    const year = new Intl.DateTimeFormat(locale, { timeZone, year: 'numeric' }).format(now);
    return lang === 'en' ? `It’s **${year}** in **${timeZone}**.` : `**${year}** (${timeZone}).`;
  }
  if (command?.id !== 'time' && !time && !date) return;
  const place = command?.id === 'time' ? command.argument : (time || date)?.[1]?.trim();
  const zone = place ? zoneForPlace(place.replace(/ (?:right now|now|rn)$/i, ''), timeZone) : timeZone;
  if (!zone) return {
    en: 'I couldn’t match that place to a time zone. Try a city such as Tokyo or a time zone such as `America/Chicago`.',
    es: 'No encontré la zona horaria. Prueba con Tokio o `America/Chicago`.', fr: 'Fuseau horaire introuvable. Essayez Tokyo ou `America/Chicago`.',
    de: 'Die Zeitzone wurde nicht gefunden. Versuche Tokio oder `America/Chicago`.', pt: 'Não encontrei o fuso horário. Experimente Tóquio ou `America/Chicago`.',
  }[lang];
  const day = new Intl.DateTimeFormat(locale, { timeZone: zone, dateStyle: 'full' }).format(now);
  if (date) return lang === 'en' ? `Today is **${day}** in **${zone}**.` : `**${day}** (${zone}).`;
  const localTime = new Intl.DateTimeFormat(locale, { timeZone: zone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(now);
  return lang === 'en' ? `It’s **${localTime}** on **${day}** in **${zone}**.` : `**${localTime}** · **${day}** (${zone}).`;
}

export function contextualClock(prompt: string, timeZone: string, now: Date) {
  if (!/\b(?:today|tomorrow|yesterday|current date|current time|time zone|right now)\b/i.test(prompt)) return;
  return new Intl.DateTimeFormat('en-US', { timeZone, dateStyle: 'full', timeStyle: 'short' }).format(now) + ` (${timeZone})`;
}
