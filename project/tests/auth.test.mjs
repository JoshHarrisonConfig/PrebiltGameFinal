import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TOKEN_TTL_MS,
  bearerToken,
  getAdminConfig,
  signToken,
  verifyCredentials,
  verifyToken
} from '../server/auth.mjs';

const NOW = 1_700_000_000_000;
const config = getAdminConfig({ ADMIN_USERNAME: 'boss', ADMIN_PASSWORD: 'correct horse battery' });

test('configured credentials replace the built-in defaults', () => {
  assert.equal(config.usingDefaultPassword, false);
  assert.equal(getAdminConfig({}).usingDefaultPassword, true);
  assert.equal(getAdminConfig({}).username, 'admin');
});

test('only the exact username and password are accepted', () => {
  assert.equal(verifyCredentials(config, 'boss', 'correct horse battery'), true);
  assert.equal(verifyCredentials(config, 'boss', 'correct horse batter'), false);
  assert.equal(verifyCredentials(config, 'Boss', 'correct horse battery'), false);
  assert.equal(verifyCredentials(config, 'admin', 'correct horse battery'), false);
  assert.equal(verifyCredentials(config, '', ''), false);
});

test('a signed token verifies until it expires', () => {
  const { token, expiresAt } = signToken('secret-1', config, NOW);
  assert.equal(expiresAt, NOW + TOKEN_TTL_MS);
  assert.equal(verifyToken('secret-1', config, token, NOW + 1000), true);
  assert.equal(verifyToken('secret-1', config, token, expiresAt - 1), true);
  assert.equal(verifyToken('secret-1', config, token, expiresAt), false);
});

test('tampered, foreign and malformed tokens are rejected', () => {
  const { token } = signToken('secret-1', config, NOW);
  const [payload, signature] = token.split('.');

  const forgedPayload = Buffer.from(JSON.stringify({ u: 'boss', exp: NOW + 10 * TOKEN_TTL_MS })).toString('base64url');
  assert.equal(verifyToken('secret-1', config, `${forgedPayload}.${signature}`, NOW), false);
  assert.equal(verifyToken('secret-1', config, `${payload}.${signature.slice(0, -2)}AA`, NOW), false);
  assert.equal(verifyToken('secret-2', config, token, NOW), false, 'token signed with another secret');

  for (const junk of ['', 'abc', 'a.b.c', `${payload}.`, '.', null, undefined, 42]) {
    assert.equal(verifyToken('secret-1', config, junk, NOW), false, String(junk));
  }
});

test('changing the admin password signs every existing session out', () => {
  const { token } = signToken('secret-1', config, NOW);
  const rotated = getAdminConfig({ ADMIN_USERNAME: 'boss', ADMIN_PASSWORD: 'a brand new password' });
  assert.equal(verifyToken('secret-1', rotated, token, NOW), false);
});

test('extracts a bearer token from the Authorization header', () => {
  const request = (value) => ({ headers: new Headers(value ? { authorization: value } : {}) });
  assert.equal(bearerToken(request('Bearer abc.def')), 'abc.def');
  assert.equal(bearerToken(request('bearer abc')), 'abc');
  assert.equal(bearerToken(request('Basic abc')), null);
  assert.equal(bearerToken(request('Bearer')), null);
  assert.equal(bearerToken(request(null)), null);
});
