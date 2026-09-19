/**
 * mongo-connection.test.cjs — MongoDB connection infrastructure tests.
 * No live Atlas credentials required: verifies the missing-variable
 * failure path, concurrent/sequential failure reset (shared in-flight
 * attempt settles for all callers; failures never wedge later calls),
 * and explicit credential redaction in failure messages. Uses fake
 * credentials only.
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

test("sanitizedError redacts credential-bearing URIs, userinfo, and secret params", () => {
  const { sanitizedError } = loadFresh();
  const fakeAwsUri = "mongodb://appuser:F4ke-P4ssw0rd@docdb.local:27017/axlero?retryWrites=true";
  const fakeSrvUri = "mongodb+srv://appuser:F4ke-P4ssw0rd@cluster0.example.net/axlero?appName=Cluster0";
  for (const message of [
    `connect failed ${fakeAwsUri} end`,
    `topology ${fakeSrvUri} unreachable`,
    "auth failed forbruch user appuser:F4ke-P4ssw0rd@host",
    "bad request password=F4ke-P4ssw0rd&retryWrites=true",
  ]) {
    const out = String(sanitizedError(new Error(message)).message);
    assert.ok(out.startsWith("MongoDB connection failed: "), "generic prefix lost");
    assert.ok(out.includes("<redacted>"), `nothing redacted: ${out}`);
    assert.ok(!out.includes("F4ke-P4ssw0rd"), `password leaked: ${out}`);
    assert.ok(!out.includes("appuser:"), `userinfo leaked: ${out}`);
    assert.ok(!out.includes("cluster0.example.net"), `URI host leaked: ${out}`);
    assert.ok(!out.includes("docdb.local"), `URI host leaked: ${out}`);
  }
  // Multiline truncation drops later lines entirely — nothing to redact,
  // and the leaked line must not survive.
  const multi = String(sanitizedError(new Error(`first line ok\nsecond line leaks ${fakeAwsUri}`)).message);
  assert.equal(multi, "MongoDB connection failed: first line ok");
  // Non-URI content and the driver code survive redaction.
  const plain = sanitizedError(Object.assign(new Error("getaddrinfo ENOTFOUND docdb.local"), { code: 42 }));
  assert.match(String(plain.message), /getaddrinfo ENOTFOUND/);
  assert.equal(plain.code, 42);
  assert.ok(String(sanitizedError(null).message).includes("MongoDB connection failed"));
});

test("sanitizedError redacts credential params with spaces around =", () => {
  const { sanitizedError } = loadFresh();
  const cases = [
    ["password = F4kePass", "F4kePass"],
    ["password= F4kePass", "F4kePass"],
    ["password =F4kePass", "F4kePass"],
    ["token = F4keToken", "F4keToken"],
    ["secret = F4keSecret", "F4keSecret"],
    ["pwd = F4kePwd", "F4kePwd"],
    ["passwd = F4kePasswd", "F4kePasswd"],
    ["authMechanismProperties = F4keProps", "F4keProps"],
  ];
  for (const [fragment, secret] of cases) {
    const out = String(sanitizedError(new Error(`connect failed: ${fragment} end`)).message);
    assert.ok(out.startsWith("MongoDB connection failed: "), `prefix lost: ${out}`);
    assert.ok(out.includes("<redacted>"), `nothing redacted: ${out}`);
    assert.ok(!out.includes(secret), `credential leaked: ${out}`);
  }
  // Error code behavior is unchanged by redaction.
  const coded = sanitizedError(Object.assign(new Error("x password = F4kePass y"), { code: "ENOTFOUND" }));
  assert.equal(coded.code, "ENOTFOUND");
  assert.ok(!String(coded.message).includes("F4kePass"));
});

test("concurrent and sequential failures share reset state without hanging", async () => {
  process.env.MONGODB_URI = "mongodb://u:p@127.0.0.1:1/db?serverSelectionTimeoutMS=1500";
  const { connectMongo, isConnected } = loadFresh();
  // Concurrent callers share the single in-flight attempt: both settle.
  const [first, second] = await Promise.allSettled([connectMongo(), connectMongo()]);
  assert.equal(first.status, "rejected");
  assert.equal(second.status, "rejected");
  assert.equal(isConnected(), false);
  // A failed attempt resets so the next call retries instead of hanging
  // on a dead promise.
  await assert.rejects(connectMongo(), /MongoDB connection failed/);
  assert.equal(isConnected(), false);
});
