import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTwoFilesPatch, applyPatch } from 'diff';
import { handleWorkspaceTools } from '../server/workspace.ts';
import { repositoryName, repositoryPath } from '../shared/repositories.ts';
import { publicApiTarget, workspaceIntent } from '../shared/workspace-tools.ts';
import { platformPost } from './platform-fixture.ts';

const path = '/api/workspace';
const post = (body: object, headers = {}) => handleWorkspaceTools(platformPost(path, body, headers), undefined, { limit: false });

test('GitHub workbench reads only bounded public GitHub resources after approval', async (t) => {
  const endpoint = 'https://api.github.com/repos/octocat/Hello-World';
  const requestBody = { action: 'repository', operation: 'overview', repo: 'https://github.com/octocat/Hello-World', approved: true };
  const readme = '# Hello world\nUntrusted repository text.\n';
  let lookups = 0;
  t.mock.method(globalThis, 'fetch', async (input: string, options: RequestInit) => {
    lookups++;
    assert.equal(options.redirect, 'error');
    assert.equal(options.method ?? 'GET', 'GET');
    assert.equal(new Headers(options.headers).get('authorization'), null);
    const routes: Record<string, object> = {
      '': { full_name: 'octocat/Hello-World', private: false, description: 'Example', default_branch: 'main', stargazers_count: 5 },
      '/contents?ref=main': [{ type: 'dir', name: 'src', path: 'src' }, { type: 'file', name: 'README.md', path: 'README.md', size: readme.length }, { type: 'file', name: '.env.local', path: '.env.local' }, { type: 'file', path: 'linked', submodule_git_url: 'https://github.com/sample/not-this' }],
      '/contents/README.md?ref=main': { type: 'file', path: 'README.md', encoding: 'base64', content: Buffer.from(readme).toString('base64'), size: readme.length, sha: '1'.repeat(40) },
      '/contents/src/binary?ref=main': { type: 'file', path: 'src/binary', encoding: 'base64', content: '/w==', size: 1, sha: '2'.repeat(40) },
      '/contents/src/huge?ref=main': { type: 'file', path: 'src/huge', encoding: 'base64', content: 'YQ==', size: 24_001, sha: '2'.repeat(40) },
      '/issues?state=open&sort=updated&per_page=8': [{ number: 7, user: { login: 'reviewer' }, title: 'Add a note', body: 'Do not collect issue bodies' }, { number: 8, pull_request: {}, title: 'Not an issue' }],
    };
    assert.ok(input.startsWith(endpoint));
    assert.ok(Object.hasOwn(routes, input.slice(endpoint.length)), `Unexpected GitHub API request: ${input}`);
    return Response.json(routes[input.slice(endpoint.length)]);
  });
  assert.equal((await post({ ...requestBody, approved: false })).status, 403);
  assert.equal((await post(requestBody, { Origin: 'https://outside.invalid' })).status, 403);
  for (const name of ['foo/..', 'https://github.com@evil.invalid/owner/repo', 'https://www.github.com/a/b', 'https://github.com/a/b#tag', 'a/%2e%2e', 'a/b/raw']) {
    assert.equal(repositoryName(name), undefined);
    assert.equal((await post({ ...requestBody, repo: name })).status, 400);
  }
  for (const name of ['../README.md', 'a/.env.local', 'folder/%2e', 'a/.git/config', 'a/cert.pem', '/a']) assert.equal(repositoryPath(name), undefined);
  assert.equal((await post({ ...requestBody, operation: 'file', path: 'src/../.env', ref: 'main' })).status, 400);
  assert.equal((await post({ ...requestBody, operation: 'file', path: 'README.md', ref: 'main&secret=test' })).status, 400);
  assert.equal((await post({ ...requestBody, operation: 'push' })).status, 400);
  assert.equal(lookups, 0);
  assert.deepEqual(workspaceIntent('/repo octocat/Hello-World'), { id: 'repo', input: 'octocat/Hello-World' });
  assert.equal((await (await post(requestBody)).json()).repo.branch, 'main');
  const { entries } = await (await post({ ...requestBody, operation: 'files', ref: 'main' })).json();
  assert.deepEqual(entries.map((entry: { path: string }) => entry.path), ['src', 'README.md']);
  const { file } = await (await post({ ...requestBody, operation: 'file', path: 'README.md', ref: 'main' })).json();
  assert.equal(file.text, readme);
  const revised = readme + '\nOne reviewed change.\n';
  const patch = createTwoFilesPatch('a/README.md', 'b/README.md', file.text, revised);
  assert.equal(applyPatch(readme, patch), revised);
  for (const name of ['src/binary', 'src/huge']) assert.equal((await post({ ...requestBody, operation: 'file', path: name, ref: 'main' })).status, 400);
  const { issues } = await (await post({ ...requestBody, operation: 'issues' })).json();
  assert.deepEqual(issues, [{ title: 'Add a note', number: 7, author: 'reviewer', url: 'https://github.com/octocat/Hello-World/issues/7' }]);
  assert.equal(lookups, 6);
});

test('API Explorer supports approved npm reads without a generic URL forwarder', async (t) => {
  const endpoint = 'https://registry.npmjs.org/@scope%2fpackage/latest';
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (input: string, options: RequestInit) => {
    requests++;
    assert.equal(input, endpoint);
    assert.equal(options.redirect, 'error');
    return Response.json({ name: '@scope/package', version: '1.1.1', description: 'Package metadata', license: 'MIT', scripts: { preinstall: 'ignored' }, dist: { integrity: 'ignored' } });
  });
  for (const value of ['https://registry.npmjs.org.evil.invalid/react/latest', 'https://registry.npmjs.org/-/whoami', 'https://registry.npmjs.org/react/latest?private=true', 'https://registry.npmjs.org/%2e/latest']) assert.equal(publicApiTarget(value), undefined);
  const approved = { action: 'api', method: 'GET', target: 'https://registry.npmjs.org/@scope/package/latest', approved: true };
  assert.equal((await post({ ...approved, method: 'POST' })).status, 400);
  const response = await post(approved);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { endpoint, data: { name: '@scope/package', version: '1.1.1', description: 'Package metadata', license: 'MIT' } });
  assert.equal(requests, 1);
});
