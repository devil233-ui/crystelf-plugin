import assert from "node:assert/strict";
import test from "node:test";

const values = new Map();
global.redis = {
  async get(key) {
    return values.get(key) ?? null;
  },
  async set(key, value, options = {}) {
    if (options.NX && values.has(key)) return null;
    values.set(key, value);
    return "OK";
  },
  async eval(script, { keys, arguments: args }) {
    if (values.get(keys[0]) !== args[0]) return 0;
    values.delete(keys[0]);
    return 1;
  },
};
global.logger = { error() {}, info() {} };

const { default: rssCache } = await import("../lib/rss/rssCache.js");

test.beforeEach(() => values.clear());

test("同一文章并发占位时只有一个通道成功", async() => {
  const link = "https://example.com/posts/1";
  const [ first, second ] = await Promise.all([
    rssCache.reserve(link),
    rssCache.reserve(link),
  ]);

  assert.equal([ first, second ].filter(Boolean).length, 1);
});

test("只能用匹配的 token 释放文章占位", async() => {
  const link = "https://example.com/posts/2";
  const token = await rssCache.reserve(link);

  await rssCache.release(link, "other-token");
  assert.equal(await rssCache.reserve(link), null);

  await rssCache.release(link, token);
  assert.ok(await rssCache.reserve(link));
});

test("已进入全局去重缓存的文章不能占位", async() => {
  const link = "https://example.com/posts/3";
  values.set(rssCache.urlToKey("global_dedupe"), JSON.stringify([ link ]));

  assert.equal(await rssCache.reserve(link), null);
});
