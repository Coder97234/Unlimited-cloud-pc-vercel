// A small numeric language, not JavaScript. No strings, property access, IO,
// assignment, executable code, or user-defined functions are accepted.
function tokenize(expression: string): string[] | undefined {
  if (!expression || expression.length > 256) return;
  const text = expression.toLowerCase().replace(/\s+/g, ' ').trim()
    .replace(/[×·]/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-').replace(/√/g, 'sqrt').replace(/\*\*/g, '^');
  const scan = /\s+|(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|sqrt\b|pi\b|π|of\b|[()+\-*/^%]/y;
  const tokens: string[] = [];
  for (let i = 0; i < text.length;) {
    scan.lastIndex = i;
    const match = scan.exec(text);
    if (!match || tokens.length >= 100) return;
    if (match[0].trim()) tokens.push(match[0]);
    i = scan.lastIndex;
  }
  return tokens;
}

export function formatNumber(value: number) {
  // Discard floating-point artifacts (e.g. 0.1 + 0.2) without long displays.
  return Number(value.toPrecision(12)).toString();
}

export function naturalCalculation(prompt: string) {
  if (prompt.length > 256) return;
  const input = prompt.replace(/^(?:what(?:'?s| is)|calculate|compute|solve)\s+/i, '').replace(/[?=]+$/, '').trim()
    .replace(/\b(?:divided by|over)\b/gi, '/').replace(/\b(?:multiplied by|times)\b/gi, '*')
    .replace(/\bplus\b/gi, '+').replace(/\bminus\b/gi, '-').replace(/\s+percent\b/gi, '%');
  if (!/[+\-×·÷*/^%√()−–]|\bsqrt\b/i.test(input) || !/\d|π|\bpi\b/i.test(input)) return;
  return tokenize(input) ? input : undefined;
}

export function calculate(input: string): string {
  const tokens = tokenize(input);
  const example = 'Try `/calc (12 + 8) / 4` or `/calc 18% of 84.50`.';
  if (!tokens?.length) return `I couldn’t read that arithmetic expression. ${example}`;
  const inputTokens = tokens;
  let i = 0;
  const finite = (value: number) => {
    if (!Number.isFinite(value)) throw new RangeError();
    return value;
  };
  function primary(): number {
    const token = inputTokens[i++];
    let value: number;
    if (token === '(' || token === 'sqrt') {
      if (token === 'sqrt' && inputTokens[i++] !== '(') throw new Error();
      value = sum();
      if (inputTokens[i++] !== ')') throw new Error();
      if (token === 'sqrt') value = finite(Math.sqrt(value));
    } else if (token === 'π' || token === 'pi') value = Math.PI;
    else if (token && Number.isFinite(Number(token))) value = Number(token);
    else throw new Error();
    if (inputTokens[i] === '%') { i++; value /= 100; }
    return value;
  }
  function power(): number {
    const value = primary();
    if (inputTokens[i] !== '^') return value;
    i++;
    return finite(value ** unary());
  }
  function unary(): number {
    if (inputTokens[i] === '-') { i++; return -unary(); }
    if (inputTokens[i] === '+') { i++; return unary(); }
    return power();
  }
  function product(): number {
    let value = unary();
    while (inputTokens[i] === '*' || inputTokens[i] === '/' || inputTokens[i] === 'of') {
      const op = inputTokens[i++];
      const other = unary();
      value = op === '/' ? value / other : value * other;
      if (!Number.isFinite(value)) throw new RangeError();
    }
    return value;
  }
  function sum(): number {
    let value = product();
    while (inputTokens[i] === '+' || inputTokens[i] === '-') {
      const op = inputTokens[i++];
      const other = product();
      value = finite(value + (op === '+' ? other : -other));
    }
    return value;
  }
  try {
    const result = sum();
    if (i !== tokens.length) throw new Error();
    if (!Number.isFinite(result)) throw new RangeError();
    return `**${formatNumber(result)}**`;
  } catch (error) {
    return error instanceof RangeError ? 'That expression does not have a finite real-number result.' : `I couldn’t read that arithmetic expression. ${example}`;
  }
}
