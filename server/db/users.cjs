/**
 * users.cjs — minimal user store for authentication (no ODM).
 *
 * Collection: `users`, documents:
 *   { _id, email, passwordHash, displayName, createdAt, updatedAt }
 *
 * - Email is normalized (trim + lowercase) everywhere, enforced unique
 *   via a MongoDB unique index AND a duplicate-key guard.
 * - Plaintext passwords never reach this module's callers: hashing lives
 *   here (bcryptjs), comparison via `verifyPassword`.
 * - `toSafeUser` strips `passwordHash` — the only shape ever returned
 *   to HTTP clients.
 * - `createUserStore(collection)` accepts any collection-like object so
 *   tests can inject an in-memory fake; `getUserStore()` wires the real
 *   MongoDB collection lazily.
 */

const bcrypt = require("bcryptjs");
const { getDb } = require("./mongodb.cjs");

const BCRYPT_ROUNDS = 12;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;
const MAX_DISPLAY_NAME_LENGTH = 64;

function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function validateNewUser({ email, password, displayName }) {
  const cleanEmail = normalizeEmail(email);
  if (!cleanEmail) return "Email is required.";
  if (cleanEmail.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(cleanEmail)) {
    return "Enter a valid email address.";
  }
  if (typeof password !== "string" || password.length === 0) return "Password is required.";
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`;
  }
  const cleanName = typeof displayName === "string" ? displayName.trim() : "";
  if (!cleanName) return "Display name is required.";
  if (cleanName.length > MAX_DISPLAY_NAME_LENGTH) {
    return `Display name must be at most ${MAX_DISPLAY_NAME_LENGTH} characters.`;
  }
  return null;
}

function toSafeUser(doc) {
  if (!doc || typeof doc !== "object") return null;
  return {
    id: String(doc._id),
    email: doc.email,
    displayName: doc.displayName,
    createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt ?? null,
    updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : doc.updatedAt ?? null,
  };
}

function createUserStore(collection) {
  if (!collection || typeof collection.findOne !== "function" || typeof collection.insertOne !== "function") {
    throw new Error("createUserStore requires a collection with findOne/insertOne.");
  }

  async function ensureIndexes() {
    try {
      await collection.createIndex({ email: 1 }, { unique: true });
    } catch {
      // Best-effort: concurrent boot or restricted roles must not crash auth.
      // Uniqueness is still enforced by the duplicate-key guard below.
    }
  }

  function isDuplicateKeyError(err) {
    return !!err && (err.code === 11000 || /duplicate key/i.test(String((err && err.message) || "")));
  }

  async function createUser({ email, password, displayName }) {
    const validationError = validateNewUser({ email, password, displayName });
    if (validationError) {
      const err = new Error(validationError);
      err.code = "VALIDATION_ERROR";
      throw err;
    }
    const cleanEmail = normalizeEmail(email);
    const cleanName = displayName.trim();
    const existing = await collection.findOne({ email: cleanEmail });
    if (existing) {
      const err = new Error("An account with this email already exists.");
      err.code = "DUPLICATE_EMAIL";
      throw err;
    }
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const now = new Date();
    const doc = {
      email: cleanEmail,
      passwordHash,
      displayName: cleanName,
      createdAt: now,
      updatedAt: now,
    };
    try {
      const result = await collection.insertOne(doc);
      doc._id = result.insertedId;
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        const dup = new Error("An account with this email already exists.");
        dup.code = "DUPLICATE_EMAIL";
        throw dup;
      }
      throw err;
    }
    return toSafeUser(doc);
  }

  async function findByEmail(email) {
    const cleanEmail = normalizeEmail(email);
    if (!cleanEmail) return null;
    return collection.findOne({ email: cleanEmail });
  }

  async function findById(id) {
    if (id === undefined || id === null || id === "") return null;
    try {
      return await collection.findOne({ _id: coerceId(id) });
    } catch {
      return null;
    }
  }

  // Accept both ObjectId instances and their hex strings without
  // importing ObjectId semantics into callers.
  function coerceId(id) {
    if (id !== null && typeof id === "object" && typeof id.toHexString === "function") return id;
    if (typeof id === "string" && /^[0-9a-fA-F]{24}$/.test(id)) {
      try {
        const { ObjectId } = require("mongodb");
        return new ObjectId(id);
      } catch {
        return id;
      }
    }
    return id;
  }

  async function verifyPassword(doc, password) {
    if (!doc || typeof doc.passwordHash !== "string" || typeof password !== "string") return false;
    try {
      return await bcrypt.compare(password, doc.passwordHash);
    } catch {
      return false;
    }
  }

  return { createUser, findByEmail, findById, verifyPassword, toSafeUser, ensureIndexes, validateNewUser, normalizeEmail };
}

let defaultStore = null;

/** Lazily wire the real MongoDB `users` collection (singleton). */
function getUserStore() {
  if (!defaultStore) {
    const db = getDb();
    defaultStore = createUserStore(db.collection("users"));
  }
  return defaultStore;
}

module.exports = { createUserStore, getUserStore, toSafeUser, normalizeEmail };
