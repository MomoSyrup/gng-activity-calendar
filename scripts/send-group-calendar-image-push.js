#!/usr/bin/env node
'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const seatalkBot = require('../seatalk-bot');

function runPythonRender(outPath) {
  const pythonBin =
    process.env.CALENDAR_IMAGE_PYTHON_BIN ||
    '/opt/gng-activity-calendar/.venv-image/bin/python';
  const scriptPath = path.join(__dirname, 'render-calendar-image.py');
  const apiUrl = process.env.CALENDAR_IMAGE_API_URL || 'http://127.0.0.1:3000/api/calendar';
  const proc = spawnSync(pythonBin, [scriptPath, outPath, apiUrl], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 8,
  });
  if (proc.error) throw proc.error;
  if (proc.status !== 0) {
    throw new Error(
      `render-calendar-image.py failed (${proc.status}): ${proc.stderr || proc.stdout || 'unknown error'}`
    );
  }
  return proc.stdout;
}

async function main() {
  const groupId = process.argv[2];
  if (!groupId) {
    throw new Error('Usage: node scripts/send-group-calendar-image-push.js <group_id>');
  }

  const outPath = process.env.CALENDAR_IMAGE_OUTPUT_PATH || '/opt/gng-activity-calendar/public/generated/calendar-push-latest.png';
  runPythonRender(outPath);

  const raw = fs.readFileSync(outPath);
  const b64 = raw.toString('base64');
  const imageResp = await seatalkBot.sendGroupImageMessageBase64(groupId, b64);
  if (!imageResp || imageResp.code !== 0) {
    throw new Error(`group image send failed: ${JSON.stringify(imageResp || {})}`);
  }

  const webUrl = String(process.env.CALENDAR_PUBLIC_URL || 'http://101.133.141.32').replace(/\/$/, '');
  const linkResp = await seatalkBot.sendGroupMessage(
    groupId,
    `🔗 [查看网页日历](${webUrl})`,
    true
  );
  if (!linkResp || linkResp.code !== 0) {
    throw new Error(`group link send failed: ${JSON.stringify(linkResp || {})}`);
  }

  console.log(
    JSON.stringify(
      {
        groupId,
        imageMessageId: imageResp.message_id,
        linkMessageId: linkResp.message_id,
        webUrl,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});

