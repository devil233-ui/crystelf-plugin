import assert from "node:assert/strict";
import test from "node:test";

global.logger = { error() {}, warn() {} };

const { getRssRetryCount, isRetryableFeedError } = await import("../modules/rss/rss.js");

test("RSS重试次数默认两次并限制在0到10", () => {
  assert.equal(getRssRetryCount({}), 2);
  assert.equal(getRssRetryCount({ rssRetryCount: 0 }), 0);
  assert.equal(getRssRetryCount({ rssRetryCount: 4 }), 4);
  assert.equal(getRssRetryCount({ rssRetryCount: -1 }), 0);
  assert.equal(getRssRetryCount({ rssRetryCount: 20 }), 10);
  assert.equal(getRssRetryCount({ rssRetryCount: 1.5 }), 2);
  assert.equal(getRssRetryCount({ rssRetryCount: "invalid" }), 2);
});

test("只重试临时HTTP状态和网络异常", () => {
  for (const status of [ 429, 502, 503, 504, 522, 524 ]) {
    assert.equal(isRetryableFeedError(new Error(`Status code ${status}`)), true);
  }
  assert.equal(isRetryableFeedError(new Error("ERR_HTTP2_STREAM_CANCEL")), true);
  assert.equal(isRetryableFeedError(new Error("Request timed out after 60000ms")), true);
  assert.equal(isRetryableFeedError(new Error("Status code 403")), false);
  assert.equal(isRetryableFeedError(new Error("Invalid XML")), false);
});
