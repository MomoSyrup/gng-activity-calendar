#!/usr/bin/env node
'use strict';

require('dotenv').config();
const fs = require('fs');
const seatalkBot = require('../seatalk-bot');

const groupId = process.argv[2];
const imagePath = process.argv[3];

if (!groupId || !imagePath) {
  console.error('Usage: node scripts/send-image-only.js <group_id> <image_path>');
  process.exit(1);
}

const b64 = fs.readFileSync(imagePath).toString('base64');
seatalkBot.sendGroupImageMessageBase64(groupId, b64)
  .then((r) => {
    console.log(JSON.stringify(r));
    process.exit(0);
  })
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
