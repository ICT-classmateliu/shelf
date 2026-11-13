"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");
const core = require("../collection.js");

function setup() {
  const nodes = new Map();
  const uploads = [];
  const storage = new Map();
  const embeddedCover = "data:image/jpeg;base64,/9j/";
  function node() {
    const handlers = new Map();
    return {
      value: "", hidden: true, disabled: false, style: {},
      classList: { add() {}, toggle() {} },
      append() {}, replaceChildren() {}, setAttribute() {}, removeAttribute() {}, close() {},
      addEventListener(type, handler) { handlers.set(type, handler); },
      fire(type) { return handlers.get(type)({ target: this, currentTarget: this, preventDefault() {} }); },
    };
  }
  function $(selector) {
    if (!nodes.has(selector)) nodes.set(selector, node());
    return nodes.get(selector);
  }
  const form = $("#item-form");
  form.elements = Object.fromEntries(
    ["title", "category", "status", "rating", "year", "creator", "notes", "tags", "cover"].map((name) => [name, node()])
  );
  Object.assign(form.elements.title, { value: "New collection" });
  Object.assign(form.elements.category, { value: "books" });
  Object.assign(form.elements.status, { value: "wishlist" });
  Object.assign(form.elements.rating, { value: "0" });
  vm.runInNewContext(readFileSync(require.resolve("../app.js"), "utf8"), {
    window: {
      ShelfCore: core,
      SHELF_CONFIG: { categories: [{ id: "books", label: "Books" }], owner: "Test" },
      SHELF_DEMO: [], addEventListener() {},
    },
    document: {
      querySelector: $, querySelectorAll: () => [],
      createElement(tag) {
        if (tag === "canvas") return {
          getContext: () => ({ fillRect() {}, drawImage() {} }),
          toDataURL: () => embeddedCover,
        };
        return node();
      },
    },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    Image: class {
      naturalWidth = 720;
      naturalHeight = 480;
      decode() { return new Promise((resolve, reject) => uploads.push({ resolve, reject })); }
    },
    URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
    crypto: { randomUUID: () => "new-item" },
    setTimeout() {}, clearTimeout() {},
  });
  return {
    $, form, uploads, embeddedCover,
    startUpload() {
      $("#cover-file").files = [{ type: "image/jpeg", size: 100, name: "cover.jpg" }];
      return $("#cover-file").fire("change");
    },
    savedCover() {
      form.fire("submit");
      return JSON.parse(storage.get("shelf.collection.v1")).items[0]?.cover;
    },
  };
}

test("typing a cover link cancels a pending upload and permits saving immediately", async () => {
  const app = setup();
  const pending = app.startUpload();
  assert.equal(app.$("#save-button").disabled, true);
  const link = "https://example.com/new-cover.jpg";
  app.form.elements.cover.value = link;
  app.form.elements.cover.fire("input");
  assert.equal(app.$("#save-button").disabled, false);
  app.uploads[0].resolve();
  await pending;
  assert.equal(app.form.elements.cover.value, link);
  assert.equal(app.savedCover(), link);
});

test("an obsolete upload failure does not show an error after choosing a link", async () => {
  const app = setup();
  const pending = app.startUpload();
  app.form.elements.cover.value = "https://example.com/cover.jpg";
  app.form.elements.cover.fire("input");
  app.uploads[0].reject(new Error("Image decoding failed"));
  await pending;
  assert.equal(app.$("#form-error").hidden, true);
  assert.equal(app.$("#save-button").disabled, false);
});

test("an uninterrupted upload still saves its compressed cover", async () => {
  const app = setup();
  const pending = app.startUpload();
  app.uploads[0].resolve();
  await pending;
  assert.equal(app.$("#save-button").disabled, false);
  assert.equal(app.savedCover(), app.embeddedCover);
});
