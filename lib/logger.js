'use strict';

function write(level, message, meta) {
  const entry = {
    time: new Date().toISOString(),
    level,
    message,
  };

  if (meta && Object.keys(meta).length > 0) {
    entry.meta = meta;
  }

  const line = JSON.stringify(entry);
  const target = level === 'error' ? process.stderr : process.stdout;
  target.write(line + '\n');
}

function child(bindings) {
  const base = bindings || {};
  return {
    info(message, meta) {
      write('info', message, { ...base, ...(meta || {}) });
    },
    warn(message, meta) {
      write('warn', message, { ...base, ...(meta || {}) });
    },
    error(message, meta) {
      write('error', message, { ...base, ...(meta || {}) });
    },
  };
}

module.exports = {
  info(message, meta) {
    write('info', message, meta);
  },
  warn(message, meta) {
    write('warn', message, meta);
  },
  error(message, meta) {
    write('error', message, meta);
  },
  child,
};
