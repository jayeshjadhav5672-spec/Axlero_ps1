require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("node:http");
const { createSocketServer } = require("./socket.cjs");
const { connectMongo, isConnected } = require("./db/mongodb.cjs");
const { verifyToken } = require("./auth/tokens.cjs");
const { createAuthRouter } = require("./auth/routes.cjs");

const app = express();

// CORS for the browser frontend. Explicit origins from FRONTEND_ORIGIN
// (comma-separated) are always honored — never a wildcard, and no
// cookies/credentials are used (JWT travels in the Authorization header),
// so cross-origin auth calls succeed without unsafe wildcard+credentials.
// Development nicety: Vite picks any free port (5173, 5174, ...), so any
// http(s) localhost/loopback origin is also allowed while NOT in
// production. Production (NODE_ENV=production) allows ONLY the explicit
// FRONTEND_ORIGIN list.
const { parseAllowedOrigins, createOriginChecker, createCorsDelegate } = require("./cors.cjs");
const frontendOrigins = parseAllowedOrigins(
  process.env.CORS_ORIGIN || process.env.FRONTEND_ORIGIN || "http://localhost:5173"
);
const isOriginAllowed = createOriginChecker(frontendOrigins);
app.use(cors({ origin: createCorsDelegate(isOriginAllowed) }));

const port = Number(process.env.PORT) || 3000;

// Lightweight uptime endpoint. It intentionally does not depend on MongoDB
// so platform health checks and external monitors can reach it during DB
// outages or cold starts. Requests without an Origin (typical monitors) are
// allowed by the CORS policy above.
app.get("/health", (_request, response) => {
  response.status(200).json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: Date.now(),
  });
});

app.get("/", (_request, response) => {
  response.status(200).json({
    service: "syncspace-realtime",
    status: "ok",
  });
});

// Readiness probe: 200 only when the database handle is live, 503 while
// degraded. Credential-free by construction (boolean status only).
app.get("/ready", (_request, response) => {
  let connected = false;
  try {
    connected = isConnected();
  } catch {
    connected = false;
  }
  response.status(connected ? 200 : 503).json({
    status: connected ? "ready" : "degraded",
    mongo: connected,
  });
});

const httpServer = http.createServer(app);

app.use("/api/auth", createAuthRouter());

// Socket.IO handshake CORS mirrors the HTTP policy above (explicit
// allowlist, never a wildcard): same isOriginAllowed predicate, adapted
// by createCorsDelegate to socket.io's (origin, callback) shape.
// Requests without an Origin header remain allowed (native clients).
const { io } = createSocketServer(httpServer, {
  cors: { origin: createCorsDelegate(isOriginAllowed), credentials: true },
});

// Socket identity: verify an optional handshake JWT into socket.user so
// presence/room logic can attribute authenticated users. Guests (no
// token, invalid token) connect exactly as before — authentication is
// additive and never rejects the transport.
const { createHandshakeMiddleware } = require("./auth/handshake.cjs");
io.use(createHandshakeMiddleware({ verifyToken }));

// MongoDB Atlas (connection infrastructure only — no schemas/auth yet).
// Non-fatal: the realtime service stays up even if the database is
// unreachable; the error below never includes credentials.
if (process.env.MONGODB_URI) {
  connectMongo().then(
    () => console.log("MongoDB connected"),
    (err) => console.warn(`MongoDB not connected (${err && err.message ? err.message : "unknown error"}); continuing without persistence`)
  );
} else {
  console.warn("MONGODB_URI is not set; continuing without persistence (see .env.example)");
}

httpServer.listen(port, '0.0.0.0', () => {
  console.log(`SyncSpace realtime server listening on port ${port}`);
});
