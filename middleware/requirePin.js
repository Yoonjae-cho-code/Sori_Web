'use strict';

import bcrypt from 'bcryptjs';
import User from '../models/User.js';

const PIN_REGEX = /^\d{4}$/;

export default async function requirePin(req, res, next) {

  const uuid = req.cookies?.sori_uid;
  const pin = (req.body?.pin || req.headers['x-sori-pin'] || '').toString().trim();

  // ── 형식 검사 ──────────────────────────────────────────────────────────────
  if (!PIN_REGEX.test(pin)) {
    return res.status(400).json({ error: 'PIN must be exactly 4 digits.' });
  }

  // ── 쿠키 검사 ──────────────────────────────────────────────────────────────
  if (!uuid) {
    return res.status(401).json({ error: 'PIN incorrect.' });
  }

  try {
    const user = await User.findOne({ uuid });

    if (!user || !user.pinHash) {
      return res.status(401).json({ error: 'PIN incorrect.' });
    }

    const match = await bcrypt.compare(pin, user.pinHash);
    if (!match) {
      return res.status(401).json({ error: 'PIN incorrect.' });
    }

    req.soriUser = user;
    next();

  } catch (err) {
    console.error('[Sori requirePin] DB error:', err.message);
    return res.status(500).json({ error: 'Could not verify PIN. Please try again.' });
  }
}