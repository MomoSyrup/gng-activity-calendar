'use strict';

const fs = require('fs');

const ROLE_OWNER = 'owner';
const ROLE_ADMIN = 'admin';
const ROLE_USER = 'user';
const EDITABLE_ROLES = new Set([ROLE_ADMIN, ROLE_USER]);

function normalizeOwnerEmails(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function roleRank(role) {
  switch (role) {
    case ROLE_OWNER: return 0;
    case ROLE_ADMIN: return 1;
    default: return 2;
  }
}

function permissionsForRole(role) {
  return {
    manageData: role === ROLE_OWNER || role === ROLE_ADMIN,
    manageUsers: role === ROLE_OWNER || role === ROLE_ADMIN,
    manageAdmins: role === ROLE_OWNER,
  };
}

function loadState(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return { users: {} };
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const users = {};
    const source = parsed && typeof parsed === 'object' ? parsed.users : null;
    if (Array.isArray(source)) {
      source.forEach((entry) => {
        if (entry && entry.accountId) users[String(entry.accountId)] = { ...entry };
      });
    } else if (source && typeof source === 'object') {
      Object.keys(source).forEach((key) => {
        if (!source[key]) return;
        users[String(key)] = { ...source[key] };
      });
    }
    return { users };
  } catch {
    return { users: {} };
  }
}

function createError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function createUserDirectoryStore(options) {
  const settings = options || {};
  const filePath = settings.filePath;
  const ownerEmailSet = new Set(normalizeOwnerEmails(settings.ownerEmails));
  const state = loadState(filePath);

  function save() {
    fs.writeFileSync(
      filePath,
      JSON.stringify({ users: state.users }, null, 2),
      'utf8'
    );
  }

  function listRecords() {
    return Object.values(state.users);
  }

  function hasOwner() {
    return listRecords().some((record) => getEffectiveRole(record) === ROLE_OWNER) || ownerEmailSet.size > 0;
  }

  function getAccountId(identity) {
    return String((identity && (identity.sub || identity.accountId || identity.email)) || '').trim();
  }

  function getEmail(identity) {
    return String((identity && identity.email) || '').trim().toLowerCase();
  }

  function getEffectiveRole(record) {
    if (!record) return ROLE_USER;
    if (ownerEmailSet.has(String(record.email || '').trim().toLowerCase())) return ROLE_OWNER;
    if (record.assignedRole === ROLE_OWNER) return ROLE_OWNER;
    if (record.assignedRole === ROLE_ADMIN) return ROLE_ADMIN;
    return ROLE_USER;
  }

  function buildUserView(record) {
    const role = getEffectiveRole(record);
    return {
      accountId: record.accountId,
      name: record.name || '',
      email: record.email || '',
      picture: record.picture || '',
      provider: record.provider || 'google',
      hostedDomain: record.hostedDomain || '',
      firstLoginAt: record.firstLoginAt || '',
      lastLoginAt: record.lastLoginAt || '',
      lastSeenAt: record.lastSeenAt || '',
      assignedRole: record.assignedRole || ROLE_USER,
      role,
      roleUpdatedAt: record.roleUpdatedAt || '',
      roleUpdatedBy: record.roleUpdatedBy || '',
      permissions: permissionsForRole(role),
      isProtectedOwner: role === ROLE_OWNER,
    };
  }

  function ensureRecord(identity) {
    const accountId = getAccountId(identity);
    if (!accountId) {
      throw createError(400, 'missing_account_id', 'Missing account id');
    }
    const email = getEmail(identity);
    const now = new Date().toISOString();
    const existing = state.users[accountId];
    const record = existing ? { ...existing } : {
      accountId,
      assignedRole: ROLE_USER,
      firstLoginAt: now,
    };

    record.accountId = accountId;
    record.email = email;
    record.name = String((identity && identity.name) || record.name || email || accountId);
    record.picture = String((identity && identity.picture) || record.picture || '');
    record.provider = String((identity && identity.provider) || record.provider || 'google');
    record.hostedDomain = String((identity && identity.hostedDomain) || record.hostedDomain || '');

    if (!existing && !hasOwner()) {
      record.assignedRole = ROLE_OWNER;
      record.roleUpdatedAt = now;
      record.roleUpdatedBy = 'bootstrap';
    }

    return { existing, record, now };
  }

  function recordSession(identity, options) {
    const settings = options || {};
    const { existing, record, now } = ensureRecord(identity);

    if (!record.firstLoginAt) record.firstLoginAt = now;
    record.lastSeenAt = now;
    if (settings.markLogin || !record.lastLoginAt) {
      record.lastLoginAt = now;
    }

    state.users[record.accountId] = record;
    if (
      !existing ||
      JSON.stringify(existing) !== JSON.stringify(record)
    ) {
      save();
    }
    return buildUserView(record);
  }

  function resolveSession(identity) {
    if (!identity) return null;
    const accountId = getAccountId(identity);
    if (!accountId) return null;

    const existing = state.users[accountId];
    if (!existing) {
      return buildUserView({
        accountId,
        email: getEmail(identity),
        name: String((identity && identity.name) || ''),
        picture: String((identity && identity.picture) || ''),
        provider: String((identity && identity.provider) || 'google'),
        hostedDomain: String((identity && identity.hostedDomain) || ''),
        assignedRole: hasOwner() ? ROLE_USER : ROLE_OWNER,
      });
    }

    return buildUserView(existing);
  }

  function listUsers() {
    return listRecords()
      .map((record) => buildUserView(record))
      .sort((left, right) => {
        const rankDiff = roleRank(left.role) - roleRank(right.role);
        if (rankDiff !== 0) return rankDiff;
        const rightSeen = String(right.lastSeenAt || '');
        const leftSeen = String(left.lastSeenAt || '');
        if (leftSeen !== rightSeen) return rightSeen.localeCompare(leftSeen);
        return String(left.email || '').localeCompare(String(right.email || ''));
      });
  }

  function updateUserRole(actorIdentity, targetAccountId, nextRole) {
    const actor = resolveSession(actorIdentity);
    if (!actor || !actor.permissions.manageUsers) {
      throw createError(403, 'forbidden', 'Only admins or the owner can manage users');
    }

    const normalizedRole = String(nextRole || '').trim().toLowerCase();
    if (!EDITABLE_ROLES.has(normalizedRole)) {
      throw createError(400, 'invalid_role', 'Role must be admin or user');
    }

    const target = state.users[String(targetAccountId || '')];
    if (!target) {
      throw createError(404, 'user_not_found', 'Target user not found');
    }

    const targetView = buildUserView(target);
    if (targetView.accountId === actor.accountId) {
      throw createError(400, 'cannot_edit_self', 'You cannot change your own role');
    }
    if (targetView.role === ROLE_OWNER) {
      throw createError(403, 'cannot_edit_owner', 'Owner accounts cannot be changed');
    }

    if (actor.role === ROLE_ADMIN && targetView.role !== ROLE_USER) {
      throw createError(403, 'admin_cannot_edit_admin', 'Admins can only edit regular users');
    }

    target.assignedRole = normalizedRole;
    target.roleUpdatedAt = new Date().toISOString();
    target.roleUpdatedBy = actor.email || actor.accountId || 'system';
    state.users[target.accountId] = target;
    save();

    return buildUserView(target);
  }

  return {
    ROLE_ADMIN,
    ROLE_OWNER,
    ROLE_USER,
    listUsers,
    permissionsForRole,
    recordSession,
    resolveSession,
    updateUserRole,
  };
}

module.exports = {
  ROLE_ADMIN,
  ROLE_OWNER,
  ROLE_USER,
  createUserDirectoryStore,
  normalizeOwnerEmails,
  permissionsForRole,
};
