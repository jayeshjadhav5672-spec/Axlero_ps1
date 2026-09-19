const express = require("express");
const http = require("node:http");
const { createSocketServer } = require("./socket.cjs");
const { createAuthRouter } = require("./auth.cjs");
const { connectDb } = require("./db.cjs");

const app = express();

app.use(express.json());

const port = Number(process.env.PORT) || 3000;

app.get("/", (_request, response) => {
  response.status(200).json({
    service: "syncspace-realtime",
    status: "ok",
  });
});

app.use("/api/auth", createAuthRouter());

const httpServer = http.createServer(app);

createSocketServer(httpServer);

// Best-effort at startup: rooms keep working with no database; auth
// endpoints answer 503 until MONGODB_URI is configured.
connectDb()
  .then(() => {
    console.log("SyncSpace auth store connected");
  })
  .catch((error) => {
    console.warn(`SyncSpace auth store unavailable: ${error.message}`);
  });

httpServer.listen(port, () => {
  console.log(`SyncSpace realtime server listening on port ${port}`);
});
