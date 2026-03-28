/**
 * ============================================================
 *  SORI · 소리 — User Model  (ESM · mongoose)
 *
 *  A User is identified solely by a UUID stored in an
 *  HTTP-only cookie named `sori_uid`.
 *  No email · no password · no name.
 *
 *  pinHash: bcrypt hash (saltRounds=12) of the user's 4-digit
 *  PIN.  null = PIN not yet configured.
 *
 *  Privacy principle: the UUID is a random v4 string with no
 *  link to any real-world identity.
 * ============================================================
 */

import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    // Random UUID v4 — the sole identifier.
    // Generated on first visit and stored in an HTTP-only
    // cookie named `sori_uid`.
    uuid: {
      type:     String,
      required: true,
      unique:   true,
      index:    true,
    },

    // bcrypt hash of the user's 4-digit PIN.
    //   null   →  PIN not yet configured
    //   String →  bcrypt hash, saltRounds = 12
    pinHash: {
      type:    String,
      default: null,
    },

    createdAt: {
      type:    Date,
      default: Date.now,
    },
  },
  { versionKey: false },
);

const User = mongoose.model('User', userSchema);

export default User;
