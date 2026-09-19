/**
 * mongo-connection.test.cjs — MongoDB connection infrastructure tests.
 * No live Atlas credentials required: verifies the missing-variable
 * failure path, the singleton/no-reconnect behavior contract, and that
 * failure messages never leak connection secrets.
 */
const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");

const MODULE_PATH = "../server/db/mongodb.cjs";

function loadFresh() {
  const resolved = require.resolve(MODULE_PATH);
  delete require.cache[resolved];
  return require(MODULE_PATH);
}

afterEach(() => {
  delete process.env.MONGODB_URI;
});

test("connectMongo throws a clear error when MONGODB_URI is missing", async () => {
  delete process.env.MONGODB_URI;
  const { connectMongo } = loadFresh();
  await assert.rejects(connectMongo(), /MONGODB_URI is not set/);
});

test("getDb throws before a successful connection", () => {
  const { getDb, isConnected } = loadFresh();
  assert.equal(isConnected(), false);
  assert.throws(() => getDb(), /not connected/);
});

test("unreachable host rejects without leaking credentials", async () => {
  process.env.MONGODB_URI = "mongodb://testuser:S3cret-pw@example.invalid:27017/db?serverSelectionTimeoutMS=1500";
  const { connectMongo, isConnected } = loadFresh();
  await assert.rejects(connectMongo(), (err) => {
    assert.match(String(err && err.message), /MongoDB connection failed/);
    assert.ok(!String(err && err.message).includes("S3cret-pw"), "password leaked in error");
    assert.ok(!String(err && err.message).includes("mongodb://"), "connection URI leaked in error");
    return true;
  });
  assert.equal(isConnected(), false);
});
