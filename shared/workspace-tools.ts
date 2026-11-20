export const PLUGINS = {
  script: { name: 'Script Lab', summary: 'Run JavaScript on this device in an isolated engine. No network, account access, or shell.', example: '/run console.log(20 * 6)' },
  image: { name: 'Image Studio', summary: 'Generate or analyze images with a configured provider, or make local 4K graphics.', example: '/image Violet mountains at dusk' },
  repo: { name: 'GitHub workbench', summary: 'Inspect public repositories and issues, bring a file into chat, and export reviewed edits as a patch.', example: '/repo octocat/Hello-World' },
  api: { name: 'API Explorer', summary: 'Review read-only requests for GitHub repositories, releases, and npm package metadata.', example: '/api https://api.github.com/repos/octocat/Hello-World' },
  gmail: { name: 'Gmail', summary: 'Read up to five inbox subjects, senders, and dates. No message bodies, drafts, or sending.', example: 'Show my latest Gmail messages' },
  vercel: { name: 'Vercel', summary: 'View the connected profile and list the projects it has read access to.', example: 'List my Vercel projects' },
} as const;

export type PluginId = keyof typeof PLUGINS;
export type Provider = 'gmail' | 'vercel';
export type PluginIntent = { id: PluginId; input?: string };
export type ConnectionStatus = 'unconfigured' | 'disconnected' | 'connected';
export type WorkspaceStatus = { connections: Record<Provider, ConnectionStatus>; hostedImages: boolean; hostedVision: boolean };
export const isProvider = (value: unknown): value is Provider => value === 'gmail' || value === 'vercel';

// Read only the user's current message. Never interpret a generated reply,
// search result, external data, or an attached document as an invocation.
export function workspaceIntent(prompt: string): PluginIntent | undefined {
  const text = prompt.trim();
  const command = /^\/(run|image|api|repo|gmail|vercel)(?:\s+([\s\S]*))?$/i.exec(text);
  if (command) {
    const id = command[1].toLowerCase();
    const input = command[2]?.trim();
    if (id === 'run') return { id: 'script', input: input ? unfence(input) : undefined };
    if (id === 'image' || id === 'api' || id === 'repo') return { id, input };
    if (isProvider(id)) return { id };
  }
  const script = /^(?:please )?run (?:this )?(?:javascript|js|script|code|the attached (?:javascript(?: file)?|script))(?:\s*:\s*([\s\S]+))?[.!?]?$/i.exec(text);
  if (script) return { id: 'script', input: script[1] ? unfence(script[1]) : undefined };
  const image = /^(?:please )?(?:generate|create|make) (?:an? )?(?:image|picture|poster)(?:\s+(?:of|for)|\s*:)?\s+(.{1,1200})$/i.exec(text);
  if (image) return { id: 'image', input: image[1] };
  const api = /^(?:please )?(?:get|fetch|call|send a get request to) (https:\/\/\S+)$/i.exec(text);
  if (api) return { id: 'api', input: api[1] };
  if (/^(?:please )?(?:show|list|check|read)(?: me)? (?:my )?(?:recent |latest )?(?:gmail(?: inbox| messages| emails)?|inbox messages in gmail)[.!?]?$/i.test(text)) return { id: 'gmail' };
  if (/^(?:please )?(?:show|list|check)(?: me)? (?:my )?vercel(?: projects| profile)?[.!?]?$/i.test(text)) return { id: 'vercel' };
}

function unfence(text: string) {
  return /^```(?:javascript|js)?\s*\r?\n([\s\S]*?)\r?\n```$/i.exec(text)?.[1] ?? text;
}

export const PUBLIC_API_EXAMPLE = 'https://api.github.com/repos/octocat/Hello-World';

// A registry, not a URL proxy. Rebuild the outbound URL from allowlisted
// parameters, reject credentials, ports, encoded paths, and any redirects.
export function publicApiTarget(raw: string) {
  if (raw.length > 360) return;
  const match = /^https:\/\/api\.github\.com\/repos\/([\da-z][\da-z-]{0,38})\/([\da-z_.-]{1,100})(\/releases\/latest)?$/i.exec(raw);
  if (match && match[2] !== '.' && match[2] !== '..') {
    const endpoint = `https://api.github.com/repos/${match[1]}/${match[2]}${match[3] ?? ''}`;
    return { endpoint, type: match[3] ? 'release' : 'repository' } as const;
  }
  const pkg = /^https:\/\/registry\.npmjs\.org\/((?:@[a-z0-9][a-z0-9._-]{0,80}\/)?[a-z0-9][a-z0-9._-]{0,150})\/latest$/.exec(raw);
  if (pkg) return { endpoint: `https://registry.npmjs.org/${pkg[1].replace('/', '%2f')}/latest`, type: 'npm' as const };
}
