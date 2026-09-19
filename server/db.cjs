const mongoose = require("mongoose");

let connecting = null;

/**
 * Shared mongoose connection for the realtime server. Resolves from
 * MONGODB_URI; rejects when it is unset so callers can answer 503
 * instead of crashing — the realtime server must keep serving rooms
 * even with no database configured.
 */
function connectDb(uri = process.env.MONGODB_URI) {
  if (mongoose.connection.readyState === 1) {
    return Promise.resolve(mongoose.connection);
  }
  if (!uri) {
    return Promise.reject(new Error("MONGODB_URI is not set"));
  }
  if (!connecting) {
    connecting = mongoose.connect(uri).catch((error) => {
      connecting = null;
      throw error;
    });
  }
  return connecting;
}

module.exports = { connectDb };
