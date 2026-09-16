/**
 * dashboard-rooms.test.mjs — Day 3 Dashboard helpers (no network, no DOM).
 * Covers the frontend-only seams in src/lib/room.js: generateRoomId and
 * the browser-local recent-rooms list. Persistence here is localStorage
 * display-only, never backend/MongoDB.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  RECENT_ROOMS_LIMIT,
  RECENT_ROOMS_STORAGE_KEY,
  generateRoomId,
  getLastRoom,
  getRecentRooms,
  isValidRoomId,
  recordRecentRoom,
} from '../src/lib/room.js';

function installMemoryStorage() {
  const store = {};
  globalThis.localStorage = {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => {
      store[key] = String(value);
    },
    removeItem: (key) => {
      delete store[key];
    },
    clear: () => {
      for (const key of Object.keys(store)) delete store[key];
    },
  };
}

beforeEach(() => {
  installMemoryStorage();
});

test('generateRoomId produces valid, unique room ids', () => {
  const a = generateRoomId();
  const b = generateRoomId();
  assert.equal(isValidRoomId(a), true);
  assert.equal(isValidRoomId(b), true);
  assert.notEqual(a, b);
});

test('recent rooms start empty; last room is null', () => {
  assert.deepEqual(getRecentRooms(), []);
  assert.equal(getLastRoom(), null);
});

test('recordRecentRoom prepends, dedupes, and exposes last room', () => {
  recordRecentRoom('team-standup');
  recordRecentRoom('design-review');
  assert.deepEqual(getRecentRooms(), ['design-review', 'team-standup']);
  assert.equal(getLastRoom(), 'design-review');

  // re-recording moves to front without duplicates
  recordRecentRoom('team-standup');
  assert.deepEqual(getRecentRooms(), ['team-standup', 'design-review']);
});

test('recordRecentRoom ignores invalid ids', () => {
  recordRecentRoom('ok-room');
  recordRecentRoom('');
  recordRecentRoom('no spaces allowed!');
  recordRecentRoom(null);
  assert.deepEqual(getRecentRooms(), ['ok-room']);
});

test('recent rooms are capped at RECENT_ROOMS_LIMIT', () => {
  for (let i = 0; i < RECENT_ROOMS_LIMIT + 4; i += 1) recordRecentRoom(`room-${i}`);
  const rooms = getRecentRooms();
  assert.equal(rooms.length, RECENT_ROOMS_LIMIT);
  assert.equal(rooms[0], `room-${RECENT_ROOMS_LIMIT + 3}`);
});

test('recent rooms survive as JSON under the documented storage key', () => {
  recordRecentRoom('alpha');
  const raw = globalThis.localStorage.getItem(RECENT_ROOMS_STORAGE_KEY);
  assert.deepEqual(JSON.parse(raw), ['alpha']);
});
