/**
 * cors.test.cjs — Express CORS origin-policy tests (no network, no database).
 * Verifies server/cors.cjs: explicit FRONTEND_ORIGIN allow-list plus the
 * development loopback rule (any localhost port while NOT in production).
 */
const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  normalizeOrigin,
  isLocalhostOrigin,
  parseAllowedOrigins,
  isProductionEnv,
  createOriginChecker,
  createCorsDelegate,
} = require("../server/cors.cjs");

test("normalizeOrigin trims whitespace and trailing slashes", () => {
  assert.equal(normalizeOrigin("  https://example.com/  "), "https://example.com");
  assert.equal(normalizeOrigin("http://localhost:5173///"), "http://localhost:5173");
  assert.equal(normalizeOrigin(null), "");
  assert.equal(normalizeOrigin(undefined), "");
  assert.equal(normalizeOrigin(42), "");
});

test("isLocalhostOrigin accepts loopback http(s) origins on any port", () => {
  for (const origin of [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
    "http://localhost:3000",
    "http://localhost",
    "https://localhost:5174",
    "http://127.0.0.1:5174",
    "http://127.0.0.1",
    "http://[::1]:5174",
  ]) {
    assert.equal(isLocalhostOrigin(origin), true, `expected loopback: ${origin}`);
  }
});

test("isLocalhostOrigin rejects non-loopback and non-http(s) origins", () => {
  for (const origin of [
    "https://axlero-ps1.onrender.com",
    "https://attacker.example.com",
    "http://attacker.example.com:5173",
    "http://localhost.example.com:5173",
    "http://example-localhost.com",
    "http://192.168.1.10:5173",
    "ftp://localhost:21",
    "not-a-url",
    "",
    null,
    undefined,
  ]) {
    assert.equal(isLocalhostOrigin(origin), false, `expected non-loopback: ${origin}`);
  }
});

test("parseAllowedOrigins splits comma-separated values and drops empties", () => {
  assert.deepEqual(parseAllowedOrigins("https://a.example, https://b.example/"), [
    "https://a.example",
    "https://b.example",
  ]);
  assert.deepEqual(parseAllowedOrigins(""), []);
  assert.deepEqual(parseAllowedOrigins(null), []);
  assert.deepEqual(parseAllowedOrigins("http://localhost:5173,,http://localhost:5174"), [
    "http://localhost:5173",
    "http://localhost:5174",
  ]);
});

test("development checker allows listed origins and any localhost port", () => {
  const isAllowed = createOriginChecker(["http://localhost:5173"], { allowLocalhost: true });
  assert.equal(isAllowed("http://localhost:5173"), true);
  assert.equal(isAllowed("http://localhost:5174"), true);
  assert.equal(isAllowed("http://127.0.0.1:9999"), true);
  assert.equal(isAllowed("https://axlero-ps1.onrender.com"), false);
  assert.equal(isAllowed("https://attacker.example.com"), false);
});

test("production checker allows ONLY the explicit FRONTEND_ORIGIN list", () => {
  const isAllowed = createOriginChecker(["https://app.example.com"], { allowLocalhost: false });
  assert.equal(isAllowed("https://app.example.com"), true);
  assert.equal(isAllowed("https://app.example.com/"), true);
  assert.equal(isAllowed("http://localhost:5173"), false);
  assert.equal(isAllowed("http://localhost:5174"), false);
  assert.equal(isAllowed("http://127.0.0.1:5174"), false);
  assert.equal(isAllowed("https://evil.example.com"), false);
});

test("checker defaults follow NODE_ENV (localhost allowed unless production)", () => {
  const prev = process.env.NODE_ENV;
  try {
    delete process.env.NODE_ENV;
    assert.equal(createOriginChecker([])("http://localhost:5174"), true);
    process.env.NODE_ENV = "production";
    assert.equal(createOriginChecker([])("http://localhost:5174"), false);
    process.env.NODE_ENV = "development";
    assert.equal(createOriginChecker([])("http://localhost:5174"), true);
  } finally {
    if (prev === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prev;
  }
});

test("isProductionEnv treats Render-hosted services as production", () => {
  assert.equal(isProductionEnv({}), false);
  assert.equal(isProductionEnv({ NODE_ENV: "development" }), false);
  assert.equal(isProductionEnv({ NODE_ENV: "test" }), false);
  assert.equal(isProductionEnv(undefined), false);
  assert.equal(isProductionEnv(null), false);
  assert.equal(isProductionEnv({ NODE_ENV: "production" }), true);
  // Render sets RENDER=true even when the service never sets NODE_ENV.
  assert.equal(isProductionEnv({ RENDER: "true" }), true);
  assert.equal(isProductionEnv({ NODE_ENV: "development", RENDER: "true" }), true);
  assert.equal(isProductionEnv({ RENDER: "false" }), false);
});

test("Render-hosted service without NODE_ENV still enforces explicit origins", () => {
  const prevNode = process.env.NODE_ENV;
  const prevRender = process.env.RENDER;
  try {
    delete process.env.NODE_ENV;
    process.env.RENDER = "true";
    const isAllowed = createOriginChecker(["https://app.example.com"]);
    assert.equal(isAllowed("https://app.example.com"), true);
    assert.equal(isAllowed("http://localhost:5173"), false);
    assert.equal(isAllowed("http://localhost:5174"), false);
    assert.equal(isAllowed("http://127.0.0.1:5174"), false);
  } finally {
    if (prevNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNode;
    if (prevRender === undefined) delete process.env.RENDER;
    else process.env.RENDER = prevRender;
  }
});

test("explicit allowLocalhost option always wins over environment detection", () => {
  const prevNode = process.env.NODE_ENV;
  const prevRender = process.env.RENDER;
  try {
    process.env.NODE_ENV = "production";
    process.env.RENDER = "true";
    assert.equal(
      createOriginChecker([], { allowLocalhost: true })("http://localhost:5174"),
      true
    );
    delete process.env.NODE_ENV;
    delete process.env.RENDER;
    assert.equal(
      createOriginChecker([], { allowLocalhost: false })("http://localhost:5174"),
      false
    );
  } finally {
    if (prevNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNode;
    if (prevRender === undefined) delete process.env.RENDER;
    else process.env.RENDER = prevRender;
  }
});

test("requests without an Origin header are always allowed", () => {
  const strict = createOriginChecker([], { allowLocalhost: false });
  assert.equal(strict(undefined), true);
  assert.equal(strict(null), true);
  assert.equal(strict(""), true);
});

test("cors delegate adapts the predicate to the cors package shape", () => {
  const delegate = createCorsDelegate((origin) => !origin || origin === "https://ok.example");
  delegate("https://ok.example", (err, result) => {
    assert.ifError(err);
    assert.equal(result, true);
  });
  delegate("https://nope.example", (err) => {
    assert.ok(err instanceof Error);
  });
  delegate(undefined, (err, result) => {
    assert.ifError(err);
    assert.equal(result, true);
  });
});
