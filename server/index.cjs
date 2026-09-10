const express = require("express");
const http = require("node:http");
const { createSocketServer } = require("./socket.cjs");

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

httpServer.listen(port, () => {
  console.log(`SyncSpace realtime server listening on port ${port}`);
});
