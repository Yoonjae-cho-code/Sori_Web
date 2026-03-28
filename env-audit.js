/**
 * SORI · Environment Variable Audit
 * ============================================================
 *
 *  VARIABLE         USED IN        STATUS
 *  ─────────────────────────────────────────────────────────
 *  OPENAI_API_KEY   server.js      ✅ Required — Whisper + GPT-4o
 *  MONGODB_URI      server.js      ❌ MISSING from env.example
 *                                     Default: mongodb://localhost:27017/sori
 *  PORT             server.js      ✅ Optional — default 3000
 *  CLIENT_ORIGIN    server.js      ✅ Optional — default http://localhost:5500
 *  ANTHROPIC_API_KEY (none)        ❌ STALE — listed in old env.example
 *                                     but not used anywhere in server.js v6
 *                                     Remove it from your .env file.
 *
 *  ADDITIONAL BUGS FOUND
 *  ─────────────────────────────────────────────────────────
 *  requirePin.js (middleware file):
 *    Line 3: const bcrypt = require('bcrypt');
 *            ↑ Wrong package name. package.json installs `bcryptjs`,
 *              not `bcrypt`. Change to: const bcrypt = require('bcryptjs');
 *
 *    Line 4: const User = require('../models/User');
 *            ↑ CommonJS require() — but server.js uses ES modules (type:"module").
 *              If this file is ever imported by server.js it will throw.
 *              Change to ES module syntax:
 *                import bcrypt from 'bcryptjs';
 *                import User from '../models/User.js';
 *              And change module.exports to export default.
 *
 *  NOTE: requirePin.js is NOT currently imported by server.js v6.
 *  The server does PIN verification inline. But if you plan to use it,
 *  fix both issues above first.
 *
 *  MODELS CHECKLIST (not uploaded — verify these exist):
 *    ./models/User.js   — must export a Mongoose model with fields:
 *                         { uuid: String, pinHash: String (default: null) }
 *    ./models/Entry.js  — must export a Mongoose model with fields:
 *                         { userId: ObjectId, emotion: String, narrative: String, date: Date }
 *
 *  hasPin BUG in /api/user/init:
 *    BEFORE: res.json({ hasPin: user.pinHash !== null });
 *    AFTER:  res.json({ hasPin: Boolean(user.pinHash) });
 *    WHY: user.pinHash is `undefined` (not null) for new users — so
 *         `undefined !== null` incorrectly returns true (hasPin: true)
 *         for a brand-new user who hasn't set a PIN yet.
 */
