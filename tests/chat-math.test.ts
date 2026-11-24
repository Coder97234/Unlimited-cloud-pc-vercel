import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import remarkMath from 'remark-math';
import { rehypeChatMath } from '../src/lib/chat-math.ts';

const render = (children: string) => renderToStaticMarkup(createElement(Markdown, {
  children, remarkPlugins: [[remarkMath, { singleDollarTextMath: false }]], rehypePlugins: [rehypeChatMath], skipHtml: true,
  unwrapDisallowed: true, disallowedElements: ['img'],
}));

test('MathML formats double-dollar equations without treating ordinary currency or fences as math', () => {
  const html = render('It costs $12 to $15. Inline $$x^2$$.\n\n$$\n\\frac{1}{2}\n$$\n\n```math\nx^2\n```');
  assert.match(html, /costs \$12 to \$15/);
  assert.match(html, /<math[^>]*>.*?<msup>/);
  assert.match(html, /display="block".*?<mfrac>/);
  assert.equal([...html.matchAll(/<math\b/g)].length, 2);
  assert.match(html, /<pre><code class="language-math">x\^2\n<\/code><\/pre>/);
});

test('untrusted equations cannot add links or images; expression size and count are bounded', () => {
  const html = render('$$\\href{https://math.example.org/link}{label}$$ $$\\includegraphics{https://math.example.org/image.png}$$\n\n<img src="https://math.example.org/raw.png">');
  assert.doesNotMatch(html, /<a[ >]|<img|<script| (?:src|href)=/);
  const large = 'x'.repeat(1_501);
  const bounded = render([`$$${large}$$`, ...Array.from({ length: 28 }, () => '$$1+2$$')].join('\n\n'));
  assert.equal([...bounded.matchAll(/<math\b/g)].length, 24);
  assert.match(bounded, /<code class="language-math math-inline">x{1501}<\/code>/);
});
