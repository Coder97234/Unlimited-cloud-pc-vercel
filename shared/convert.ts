import { formatNumber } from './calculator.ts';

type Unit = { kind: string; symbol: string; factor: number };
const units = new Map<string, Unit>();
const key = (text: string) => text.toLowerCase().trim().replace(/\bdegrees?\s*|°/g, '').replace(/\./g, '').replace(/\s+/g, ' ');
function register(kind: string, symbol: string, factor: number, aliases: string) {
  const unit = { kind, symbol, factor };
  for (const alias of [symbol, ...aliases.split('|')]) units.set(key(alias), unit);
}
register('distance', 'm', 1, 'meter|meters|metre|metres');
register('distance', 'km', 1000, 'kilometer|kilometers|kilometre|kilometres');
register('distance', 'cm', .01, 'centimeter|centimeters|centimetre|centimetres');
register('distance', 'mm', .001, 'millimeter|millimeters|millimetre|millimetres');
register('distance', 'mi', 1609.344, 'mile|miles');
register('distance', 'yd', .9144, 'yard|yards');
register('distance', 'ft', .3048, 'foot|feet');
register('distance', 'in', .0254, 'inch|inches');
register('mass', 'kg', 1, 'kilogram|kilograms');
register('mass', 'g', .001, 'gram|grams');
register('mass', 'mg', .000001, 'milligram|milligrams');
register('mass', 'lb', .45359237, 'lbs|pound|pounds');
register('mass', 'oz', .028349523125, 'ounce|ounces');
register('volume', 'L', 1, 'liter|liters|litre|litres');
register('volume', 'mL', .001, 'milliliter|milliliters|millilitre|millilitres');
register('volume', 'US gal', 3.785411784, 'gal|gallon|gallons|us gallon|us gallons');
register('volume', 'US cup', .2365882365, 'cup|cups|us cups');
register('volume', 'US tbsp', .01478676478125, 'tbsp|tablespoon|tablespoons');
register('volume', 'US tsp', .00492892159375, 'tsp|teaspoon|teaspoons');
register('volume', 'US fl oz', .0295735295625, 'fl oz|fluid ounce|fluid ounces');
register('speed', 'm/s', 1, 'mps');
register('speed', 'km/h', 1000 / 3600, 'kph|kmh');
register('speed', 'mph', .44704, 'mi/h');
register('duration', 's', 1, 'sec|second|seconds');
register('duration', 'min', 60, 'minute|minutes');
register('duration', 'h', 3600, 'hr|hour|hours');
register('duration', 'd', 86400, 'day|days');
register('temperature', '°C', 1, 'celsius|centigrade');
register('temperature', '°F', 5 / 9, 'fahrenheit');
register('temperature', 'K', 1, 'kelvin');

const conversion = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*([^\d\r\n]{1,35}?)\s+(?:in|to|into)\s+([^\d\r\n]{1,35})$/i;
export function conversionArgument(prompt: string) {
  const input = prompt.replace(/^(?:convert|what(?:'s| is)|how much is)\s+/i, '').replace(/[?.]+$/, '').trim();
  const match = conversion.exec(input);
  if (match && units.has(key(match[2])) && units.has(key(match[3]))) return input;
}

export function convert(input: string) {
  const match = conversion.exec(input);
  const usage = 'Try `/convert 5 miles to km`, `/convert 72 F to C`, or `/convert 2 cups to mL`.';
  if (!match) return usage;
  const from = units.get(key(match[2]));
  const to = units.get(key(match[3]));
  const value = Number(match[1]);
  if (!from || !to || !Number.isFinite(value)) return `I couldn’t recognize that value or one of those units. ${usage}`;
  if (from.kind !== to.kind) return `**${from.symbol}** measures ${from.kind}, while **${to.symbol}** measures ${to.kind}. Choose units of the same type.`;
  let converted: number;
  if (from.kind === 'temperature') {
    const celsius = from.symbol === '°F' ? (value - 32) * (5 / 9) : from.symbol === 'K' ? value - 273.15 : value;
    if (celsius < -273.15 - 1e-9) return 'That temperature is below absolute zero.';
    const base = Math.max(-273.15, celsius);
    converted = from === to ? value : to.symbol === '°F' ? base * (9 / 5) + 32 : to.symbol === 'K' ? base + 273.15 : base;
  } else converted = value * (from.factor / to.factor);
  if (!Number.isFinite(converted)) return 'That value is outside the supported range.';
  return `**${formatNumber(value)} ${from.symbol} = ${formatNumber(converted)} ${to.symbol}**`;
}
