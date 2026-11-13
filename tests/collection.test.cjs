"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeItem, parseImport, mergeItems, filterItems, stats } = require("../collection.js");

function item(overrides = {}) {
  return {
    id: "item-1",
    title: "A book",
    category: "books",
    status: "wishlist",
    rating: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

function backup(items, version = 1) {
  return JSON.stringify({ version, items });
}

test("normalization preserves configurable categories and creates independent tag arrays", () => {
  const source = item({ category: "唱片", tags: [" Jazz ", "Jazz", "Live"], year: 1999 });
  const result = normalizeItem(source);
  assert.equal(result.category, "唱片");
  assert.equal(result.year, "1999");
  assert.deepEqual(result.tags, ["Jazz", "Live"]);
  assert.deepEqual(source.tags, [" Jazz ", "Jazz", "Live"]);
  assert.equal(result.cover, "");
});

test("invalid fields are rejected instead of silently replaced", () => {
  for (const invalid of [
    { title: "  " }, { category: "" }, { id: "../../bad" },
    { rating: 2.5 }, { rating: "5" }, { rating: 6 }, { status: "deleted" },
    { title: "x".repeat(121) }, { notes: "x".repeat(10001) },
    { year: "yesterday" }, { tags: "tag" }, { tags: [""] },
  ]) {
    assert.throws(() => normalizeItem(item(invalid)));
  }
});

test("invalid calendar dates and timezone-free timestamps are rejected", () => {
  for (const date of ["2026-02-30T00:00:00Z", "2025-02-29T00:00:00Z", "2026-13-01T00:00:00Z", "2026-01-01", "2026-01-01T24:00:00Z"]) {
    assert.throws(() => normalizeItem(item({ updatedAt: date })));
  }
  assert.equal(normalizeItem(item({ updatedAt: "2024-02-29T08:00:00+08:00" })).updatedAt, "2024-02-29T00:00:00.000Z");
});

test("unsafe image sources and forged embedded formats are rejected", () => {
  for (const cover of [
    "javascript:alert(1)", "data:image/svg+xml,<svg/>", "//example.com/image.png",
    "assets/../secret.png", "assets/%2e%2e/secret.png", "assets/test.svg",
    "https://example.com/cover.svg", "https://user:password@example.com/cover.jpg",
    "data:image/png;base64," + Buffer.from("<svg></svg>").toString("base64"),
    "data:image/jpeg;base64,not-base64!", "https://",
  ]) {
    assert.throws(() => normalizeItem(item({ cover })), cover);
  }
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
  for (const cover of [png, "assets/cover-1.webp", "assets/covers.png#3", "https://example.com/cover.jpg?size=800"]) {
    assert.equal(normalizeItem(item({ cover })).cover, cover);
  }
});

test("import validates the entire backup and leaves existing data untouched", () => {
  const existing = [normalizeItem(item())];
  const before = JSON.stringify(existing);
  for (const text of [
    "broken JSON", "null", "[]", backup([], 2), backup({}),
    backup([item(), item()]), backup([item(), item({ id: "item-2", title: "" })]),
    backup(Array.from({ length: 1001 }, (_, index) => item({ id: `item-${index}` }))),
    " ".repeat(20 * 1024 * 1024 + 1),
  ]) {
    assert.throws(() => parseImport(text));
  }
  assert.equal(JSON.stringify(existing), before);
  assert.deepEqual(parseImport(backup([])), []);
  assert.equal(parseImport(backup([item()]))[0].title, "A book");
});

test("merge retains newer local records, updates newer incoming records and appends new ids", () => {
  const current = [item({ title: "Local" }), item({ id: "item-2", title: "Old second" })];
  const incoming = [
    item({ title: "Stale", updatedAt: "2026-01-01T12:00:00Z" }),
    item({ id: "item-2", title: "Updated second", updatedAt: "2026-02-01T00:00:00Z" }),
    item({ id: "item-3", title: "Third" }),
  ];
  const merged = mergeItems(current, incoming);
  assert.deepEqual(merged.map((entry) => entry.title), ["Local", "Updated second", "Third"]);
  assert.equal(current[1].title, "Old second");
  assert.equal(mergeItems(current, [item({ title: "Same timestamp" })])[0].title, "Local");
});

test("merge rejects oversized combined collections before returning any result", () => {
  const current = Array.from({ length: 1000 }, (_, index) => item({ id: `item-${index}` }));
  assert.throws(() => mergeItems(current, [item({ id: "new" })]), /1000/);
  assert.equal(current.length, 1000);
});

test("search combines category and status, covers notes and tags, and sorting is nonmutating", () => {
  const entries = [
    normalizeItem(item({ id: "z", title: "Z book", creator: "Writer", tags: ["Space"], rating: 5 })),
    normalizeItem(item({ id: "a", title: "A film", category: "films", notes: "SPACE adventure", rating: 3, status: "done", updatedAt: "2026-02-01T00:00:00Z" })),
  ];
  assert.equal(filterItems(entries, { query: " space " }).length, 2);
  assert.equal(filterItems(entries, { query: "writer" })[0].id, "z");
  assert.deepEqual(filterItems(entries, { query: "space", category: "films", status: "done" }).map((entry) => entry.id), ["a"]);
  assert.equal(filterItems(entries, { sort: "recent" })[0].id, "a");
  assert.equal(filterItems(entries, { sort: "title" })[0].id, "a");
  assert.equal(filterItems(entries, { sort: "rating" })[0].id, "z");
  assert.equal(entries[0].id, "z");
});

test("statistics exclude unrated records from the average", () => {
  assert.deepEqual(stats([]), { total: 0, done: 0, active: 0, wishlist: 0, rated: 0, average: 0 });
  const entries = [normalizeItem(item({ rating: 5, status: "done" })), normalizeItem(item({ id: "second", rating: 3, status: "active" })), normalizeItem(item({ id: "third" }))];
  assert.deepEqual(stats(entries), { total: 3, done: 1, active: 1, wishlist: 1, rated: 2, average: 4 });
});
