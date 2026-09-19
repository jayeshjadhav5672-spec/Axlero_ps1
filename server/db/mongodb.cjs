/**
 * mongodb.cjs — MongoDB Atlas connection infrastructure (no schemas,
 * no auth, no persistence yet — connection only).
 *
 * Single shared MongoClient for the process: call `connectMongo()` once
 * at backend startup, then use `getDb()` anywhere. Never creates a
 * connection per request/operation.
 *
 * Reads `process.env.MONGODB_URI`. Fails with a clear, credential-free
 * error when the variable is missing; connection failures likewise never
 * include the URI, username, or password in the thrown message.
 */

const { MongoClient } = require("mongodb");

const DB_NAME = process.env.MONGO_DB_NAME || "axlero";

let clientPromise = null;
let cachedDb = null;

function readUri() {
  const uri = process.env.MONGODB_URI;
  if (!uri || typeof uri !== "string" || uri.trim().length === 0) {
    throw new Error(
      "MONGODB_URI is not set. Copy .env.example to .env and set MONGODB_URI (see README/docs)."
    );
  }
  return uri;
}

/**
 * Connect once and cache the database handle. Concurrent callers share
 * the same in-flight connection attempt. Resolves to the `axlero` Db
 * (or `MONGO_DB_NAME` override). Rejects with a sanitized error that
 * never contains connection credentials.
 */
async function connectMongo() {
  if (cachedDb) return cachedDb;
  if (!clientPromise) {
    const uri = readUri();
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
    clientPromise = client
      .connect()
      .then(() => {
        cachedDb = client.db(DB_NAME);
        return cachedDb;
      })
      .catch((err) => {
        clientPromise = null;
        throw sanitizedError(err);
      });
  }
  return clientPromise;
}

/** Return the cached Db handle, or throw if not connected yet. */
function getDb() {
  if (!cachedDb) {
    throw new Error("MongoDB is not connected. Call connectMongo() at backend startup first.");
  }
  return cachedDb;
}

/** True once connectMongo() has resolved successfully. */
function isConnected() {
  return cachedDb !== null;
}

/**
 * Explicitly redact credential-bearing material from arbitrary text
 * (driver error messages, topology descriptions). Truncation alone is
 * not a guarantee, so URIs, userinfo, and credential parameters are
 * pattern-redacted first, then the result is single-lined and capped.
 */
function redactCredentials(text) {
  let out = String(text ?? "");
  // Full connection strings, including any embedded userinfo:
  // mongodb://user:pass@host/... and mongodb+srv://user:pass@host/...
  out = out.replace(/mongodb(\+srv)?:\/\/[^\s"'`\\]*/gi, "mongodb://<redacted>");
  // Bare userinfo fragments outside a matched URI (drop the whole
  // user:password@ token, not just the password).
  out = out.replace(/(^|[\s"'`(])[A-Za-z0-9_.%+-]+:[^@\s"'`\\]+@/g, "$1<redacted>@");
  // Credential-bearing query/connection parameters, whether &-joined,
  // whitespace-separated, or at the start of the message.
  out = out.replace(/(^|[\s?&;])(password|passwd|pwd|secret|token|authMechanismProperties)=[^&\s"'`\\]*/gi, "$1$2=<redacted>");
  const firstLine = out.split("\n")[0].slice(0, 300);
  return firstLine;
}

/** Strip any credential-like material from driver error messages. */
function sanitizedError(err) {
  const message = err && err.message ? String(err.message) : "MongoDB connection failed";
  const error = new Error(`MongoDB connection failed: ${redactCredentials(message)}`);
  if (err && err.code !== undefined) error.code = err.code;
  return error;
}

module.exports = { connectMongo, getDb, isConnected, DB_NAME, sanitizedError };
