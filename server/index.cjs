require("dotenv").config();
const express = require("express");
const http = require("node:http");
const { createSocketServer } = require("./socket.cjs");
const { connectMongo } = require("./db/mongodb.cjs");

const app = express();

const port = Number(process.env.PORT) || 3000;

app.get("/", (_request, response) => {
  response.status(200).json({
    service: "syncspace-realtime",
    status: "ok",
  });
});

const httpServer = http.createServer(app);

createSocketServer(httpServer);

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

httpServer.listen(port, () => {
  console.log(`SyncSpace realtime server listening on port ${port}`);
});
