'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const appAuth = require('../lib/app-auth');

test('createSignedToken and verifySignedToken round-trip payloads', () => {
  const secret = 'session-secret';
  const token = appAuth.createSignedToken({ sub: 'user-1', exp: Date.now() + 1000 }, secret);
  const payload = appAuth.verifySignedToken(token, secret);

  assert.equal(payload.sub, 'user-1');
  assert.ok(payload.exp > Date.now());
});

test('verifySignedToken rejects tampered payloads', () => {
  const secret = 'session-secret';
  const token = appAuth.createSignedToken({ sub: 'user-1' }, secret);
  const parts = token.split('.');
  const tamperedPayload = parts[0].slice(0, -1) + (parts[0].slice(-1) === 'a' ? 'b' : 'a');
  const tampered = `${tamperedPayload}.${parts[1]}`;

  assert.equal(appAuth.verifySignedToken(tampered, secret), null);
});

test('parseCookieHeader and serializeCookie handle simple cookie values', () => {
  const cookie = appAuth.serializeCookie('gng', 'hello world', {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 60,
  });

  assert.match(cookie, /^gng=hello%20world;/);
  const parsed = appAuth.parseCookieHeader('foo=bar; gng=hello%20world');
  assert.equal(parsed.foo, 'bar');
  assert.equal(parsed.gng, 'hello world');
});

test('sanitizeNextPath blocks external redirects', () => {
  assert.equal(appAuth.sanitizeNextPath('/calendar?tab=ops'), '/calendar?tab=ops');
  assert.equal(appAuth.sanitizeNextPath('https://evil.example.com'), '/');
  assert.equal(appAuth.sanitizeNextPath('//evil.example.com'), '/');
  assert.equal(appAuth.sanitizeNextPath('calendar'), '/');
});

test('normalizeAllowedEmailDomains trims and lowercases entries', () => {
  assert.deepEqual(
    appAuth.normalizeAllowedEmailDomains(' garena.com , Garena-External.com '),
    ['garena.com', 'garena-external.com']
  );
  assert.equal(appAuth.isAllowedGoogleEmail('user@garena.com', ['garena.com']), true);
  assert.equal(appAuth.isAllowedGoogleEmail('user@example.com', ['garena.com']), false);
});
