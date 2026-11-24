import type { Element, Root } from 'hast';
import type { VFile } from 'vfile';
import rehypeKatex from 'rehype-katex';

// MathML needs no remote fonts or raw Markdown HTML. Limit work on untrusted
// replies and leave fenced code (including math fences) available for exact Copy.
export function rehypeChatMath() {
  const render = rehypeKatex({ output: 'mathml', trust: false, maxExpand: 128, maxSize: 8 });
  return (tree: Root, file: VFile) => {
    const hidden: { node: Element; className: Element['properties']['className'] }[] = [];
    let count = 0;
    function prepare(parent: Root | Element) {
      for (const node of parent.children) if (node.type === 'element') {
        const { className } = node.properties;
        if (node.tagName === 'code' && Array.isArray(className) && className.includes('language-math')) {
          const math = className.includes('math-inline') || className.includes('math-display');
          const length = node.children.reduce((sum, child) => sum + (child.type === 'text' ? child.value.length : 0), 0);
          if (!math || length > 1_500 || ++count > 24) {
            hidden.push({ node, className });
            delete node.properties.className;
          }
        }
        prepare(node);
      }
    }
    prepare(tree);
    try { render(tree, file); }
    finally { for (const { node, className } of hidden) node.properties.className = className; }
  };
}
