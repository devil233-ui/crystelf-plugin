import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  clearLinuxDoAuthenticatedCache,
  fetchLinuxDoAuthenticatedItems,
  getLinuxDoTopicId,
  getLinuxDoUsername,
  mergeLinuxDoItems,
  runLinuxDoHelper,
} from "../modules/rss/linuxDoAuth.js";

const authConfig = {
  sites: {
    "linux.do": {
      enabled: true,
      cookie: "secret-cookie",
      curlCffiPython: "/opt/python",
    },
  },
};

test.beforeEach(() => clearLinuxDoAuthenticatedCache());

test("只从Linux.do用户主题RSS提取用户名", () => {
  assert.equal(getLinuxDoUsername("https://linux.do/u/zifeiyu2020/activity/topics.rss"), "zifeiyu2020");
  assert.equal(getLinuxDoUsername("https://example.com/u/zifeiyu2020/activity/topics.rss"), null);
  assert.equal(getLinuxDoUsername("https://linux.do/u/zifeiyu2020/activity.rss"), null);
});

test("按topic ID合并并让登录主楼覆盖公开RSS", () => {
  const publicItems = [
    { link: "https://linux.do/t/topic/2730545", content: "公开", date: "2026-08-10T05:55:47Z" },
    { link: "https://linux.do/t/old-topic/2700000", date: "2026-08-04T00:00:00Z" },
  ];
  const authenticatedItems = [
    { link: "https://linux.do/t/real-slug/2730545", content: "登录主楼", date: "2026-08-10T05:55:47Z" },
    { link: "https://linux.do/t/new-topic/2712421", date: "2026-08-06T00:00:00Z" },
  ];

  const merged = mergeLinuxDoItems(publicItems, authenticatedItems);
  assert.deepEqual(merged.map(item => getLinuxDoTopicId(item.link)), [ "2730545", "2712421", "2700000" ]);
  assert.equal(merged[0].content, "登录主楼");
});

test("TTL内缓存结果且并发只调用一次辅助进程", async() => {
  let calls = 0;
  let resolveRunner;
  const runner = () => {
    calls++;
    return new Promise(resolve => { resolveRunner = resolve; });
  };
  const feedUrl = "https://linux.do/u/zifeiyu2020/activity/topics.rss";
  const first = fetchLinuxDoAuthenticatedItems(feedUrl, authConfig, 3, { runner, now: () => 1000 });
  const second = fetchLinuxDoAuthenticatedItems(feedUrl, authConfig, 3, { runner, now: () => 1000 });
  resolveRunner([ { link: "https://linux.do/t/topic/2730545" } ]);

  assert.deepEqual(await first, await second);
  assert.equal(calls, 1);
  await fetchLinuxDoAuthenticatedItems(feedUrl, authConfig, 3, { runner, now: () => 2000 });
  assert.equal(calls, 1);
});

test("Cookie只经stdin传入，不进入argv和env", async() => {
  let spawnArgs;
  let stdin = "";
  const spawnImpl = (...args) => {
    spawnArgs = args;
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdout.setEncoding = () => {};
    child.stderr.setEncoding = () => {};
    child.stdin = new EventEmitter();
    child.stdin.end = value => {
      stdin = value;
      queueMicrotask(() => {
        child.stdout.emit("data", JSON.stringify({ ok: true, items: [] }));
        child.emit("close", 0);
      });
    };
    child.kill = () => {};
    return child;
  };

  await runLinuxDoHelper("/opt/python", { cookie: "secret-cookie", username: "tester" }, spawnImpl);
  assert.equal(spawnArgs[0], "/opt/python");
  assert.equal(spawnArgs[1].some(value => value.includes("secret-cookie")), false);
  assert.equal(Object.hasOwn(spawnArgs[2], "env"), false);
  assert.equal(JSON.parse(stdin).cookie, "secret-cookie");
});

test("未配置辅助Python时不启动补全", async() => {
  let called = false;
  const items = await fetchLinuxDoAuthenticatedItems(
    "https://linux.do/u/tester/activity/topics.rss",
    { sites: { "linux.do": { cookie: "secret-cookie" } } },
    2,
    { runner: async() => { called = true; return []; } },
  );
  assert.deepEqual(items, []);
  assert.equal(called, false);
});
