'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateEnv } = require('../config/env');

function createBaseEnv() {
  return {
    GOOGLE_CLIENT_ID: 'client-id',
    GOOGLE_CLIENT_SECRET: 'client-secret',
    GOOGLE_REFRESH_TOKEN: 'refresh-token',
    GOOGLE_SHEET_ID: 'sheet-id',
  };
}

test('validateEnv accepts the minimum supported configuration', () => {
  const { env, warnings } = validateEnv(createBaseEnv());

  assert.equal(env.PORT, 3000);
  assert.equal(env.POLL_INTERVAL, 30000);
  assert.deepEqual(warnings, []);
});

test('validateEnv rejects partial SeaTalk configuration', () => {
  assert.throws(
    () => validateEnv({ ...createBaseEnv(), SEATALK_APP_ID: 'seatalk-app' }),
    /SeaTalk bot integration requires/
  );
});

test('validateEnv warns when a Google proxy key is missing', () => {
  const { warnings } = validateEnv({
    ...createBaseEnv(),
    GOOGLE_API_PROXY: 'https://proxy.example.com',
  });

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /GOOGLE_API_PROXY_KEY/);
});

test('validateEnv rejects partial Google login configuration when enabled', () => {
  assert.throws(
    () => validateEnv({
      ...createBaseEnv(),
      GOOGLE_LOGIN_ENABLED: 'true',
      GOOGLE_LOGIN_CLIENT_ID: 'google-login-client',
    }),
    /Google login requires/
  );
});
