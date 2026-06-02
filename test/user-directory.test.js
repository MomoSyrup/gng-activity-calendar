'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  ROLE_ADMIN,
  ROLE_OWNER,
  ROLE_USER,
  createUserDirectoryStore,
} = require('../lib/user-directory');

function createTempStore(ownerEmails) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gng-user-dir-'));
  const filePath = path.join(tempDir, 'users.json');
  const store = createUserDirectoryStore({ filePath, ownerEmails });
  return { filePath, store, tempDir };
}

function createIdentity(overrides) {
  return {
    sub: 'user-1',
    email: 'user-1@garena.com',
    name: 'User One',
    hostedDomain: 'garena.com',
    provider: 'google',
    ...(overrides || {}),
  };
}

test('first recorded user becomes owner when no owner is configured', () => {
  const { store, tempDir } = createTempStore('');
  try {
    const first = store.recordSession(createIdentity(), { markLogin: true });
    assert.equal(first.role, ROLE_OWNER);
    assert.equal(first.permissions.manageUsers, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('configured owner email is always treated as owner', () => {
  const { store, tempDir } = createTempStore('boss@garena.com');
  try {
    const owner = store.recordSession(createIdentity({
      sub: 'owner-1',
      email: 'boss@garena.com',
      name: 'Boss',
    }), { markLogin: true });
    assert.equal(owner.role, ROLE_OWNER);

    const user = store.recordSession(createIdentity({
      sub: 'user-2',
      email: 'member@garena.com',
      name: 'Member',
    }), { markLogin: true });
    assert.equal(user.role, ROLE_USER);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('admin can promote a regular user but cannot edit another admin', () => {
  const { store, tempDir } = createTempStore('');
  try {
    const owner = store.recordSession(createIdentity({
      sub: 'owner-1',
      email: 'owner@garena.com',
      name: 'Owner',
    }), { markLogin: true });
    store.recordSession(createIdentity({
      sub: 'admin-1',
      email: 'admin@garena.com',
      name: 'Admin',
    }), { markLogin: true });
    store.recordSession(createIdentity({
      sub: 'user-2',
      email: 'user2@garena.com',
      name: 'User Two',
    }), { markLogin: true });

    store.updateUserRole(owner, 'admin-1', ROLE_ADMIN);
    const updatedUser = store.updateUserRole(
      createIdentity({ sub: 'admin-1', email: 'admin@garena.com', name: 'Admin' }),
      'user-2',
      ROLE_ADMIN
    );
    assert.equal(updatedUser.role, ROLE_ADMIN);

    assert.throws(
      () => store.updateUserRole(
        createIdentity({ sub: 'admin-1', email: 'admin@garena.com', name: 'Admin' }),
        'user-2',
        ROLE_USER
      ),
      /Admins can only edit regular users/
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('owner can demote an admin back to user', () => {
  const { store, tempDir } = createTempStore('');
  try {
    const owner = store.recordSession(createIdentity({
      sub: 'owner-1',
      email: 'owner@garena.com',
      name: 'Owner',
    }), { markLogin: true });
    store.recordSession(createIdentity({
      sub: 'admin-1',
      email: 'admin@garena.com',
      name: 'Admin',
    }), { markLogin: true });

    store.updateUserRole(owner, 'admin-1', ROLE_ADMIN);
    const downgraded = store.updateUserRole(owner, 'admin-1', ROLE_USER);
    assert.equal(downgraded.role, ROLE_USER);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
