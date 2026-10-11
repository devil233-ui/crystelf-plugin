import assert from "node:assert/strict";
import child_process from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

global.plugin = class {};
global.logger = { error() {}, warn() {}, info() {}, mark() {} };

const { isSafeSegment, safeSegment, safeJoin } = await import("../lib/system/safePath.js");
const Path = (await import("../constants/path.js")).default;

// 覆盖路径穿越、绝对路径、分隔符、空值与类型错误
const unsafeSegments = [
    "../evil",
    "../../config/default/config",
    "..",
    ".",
    "",
    "   ",
    "a/b",
    "a\\b",
    "/etc/passwd",
    "a\0b",
    "..%2f..",
    null,
    undefined,
    Number.NaN,
    {},
    [],
];

test("合法群号与配置名可以通过片段校验", () => {
    for (const value of [ 685164226, "685164226", "coreConfig", "60s", "rss_cache-1", "a.b" ]) {
        assert.equal(isSafeSegment(value), true, `${String(value)} 应被接受`);
    }
});

test("路径穿越与其他异常输入一律被拒绝", () => {
    for (const value of unsafeSegments) {
        assert.equal(isSafeSegment(value), false, `${String(value)} 不应通过校验`);
        assert.throws(() => safeSegment(value, "测试字段"), /拒绝不安全的测试字段/);
    }
});

test("safeJoin 的结果始终位于基准目录内", () => {
    const base = path.join("/srv", "config");
    for (const value of unsafeSegments) {
        assert.throws(() => safeJoin(base, value));
    }
    assert.equal(safeJoin(base, "newcomer", 685164226), path.join(base, "newcomer", "685164226"));
});

test("git 以参数数组调用，恶意分支名不会进入 shell", async() => {
    const calls = [];
    const original = {
        execFileSync: child_process.execFileSync,
        execFile: child_process.execFile,
        execSync: child_process.execSync,
        exec: child_process.exec,
    };

    child_process.execFileSync = (file, args, options) => {
        calls.push({ method: "execFileSync", file, args, options });
        return Buffer.from("deadbeef\n");
    };
    child_process.execFile = (file, args, options, callback) => {
        calls.push({ method: "execFile", file, args, options });
        callback(null);
    };
    child_process.execSync = () => { throw new Error("不应再使用 execSync 拼接命令"); };
    child_process.exec = () => { throw new Error("不应再使用 exec 拼接命令"); };

    try {
        const { default: Updater } = await import("../lib/system/updater.js");
        const branch = "main; touch /tmp/crystelf-pwned";

        assert.equal(await Updater.getRemoteHash(branch), "deadbeef");
        assert.equal(calls.at(-1).file, "git");
        assert.deepEqual(calls.at(-1).args, [ "rev-parse", `origin/${branch}` ]);

        assert.equal(await Updater.hasUpdate(), false);
        assert.ok(calls.some(call => call.method === "execFile" && call.args[0] === "fetch"));
        assert.ok(calls.every(call => call.file === "git"));
    } finally {
        child_process.execFileSync = original.execFileSync;
        child_process.execFile = original.execFile;
        child_process.execSync = original.execSync;
        child_process.exec = original.exec;
    }
});

test("欢迎设置拒绝异常群号", async() => {
    const { welcomeNewcomerSetting } = await import("../apps/welcome-set.js");
    const replies = [];
    const instance = new welcomeNewcomerSetting();
    const result = await instance.setWelcome({
        isMaster: true,
        group_id: "../../evil",
        msg: "#设置欢迎图片",
        reply: (...args) => {
            replies.push(args);
            return true;
        },
    });

    assert.equal(result, true);
    assert.match(String(replies[0]?.[0]), /无法识别当前群号/);
});

test("配置写入拒绝越界键名且不产生文件", async() => {
    const configControl = (await import("../lib/config/configControl.js")).default;
    const escapedPath = path.resolve(Path.config, "../../evil.json");

    await assert.rejects(() => configControl.set("../../evil", { hacked: true }), /拒绝不安全的配置名/);
    await assert.rejects(() => configControl.setMultiple({ "../../evil": { hacked: true } }), /拒绝不安全的配置名/);
    assert.equal(fs.existsSync(escapedPath), false);
});

test("锅巴保存配置拒绝携带路径分隔符的配置名", async() => {
    const { setConfigData } = await import("../guoba/configHandler.js");
    const Result = {
        ok: (data, msg) => ({ status: "ok", data, msg }),
        error: (data, msg) => ({ status: "error", data, msg }),
    };

    const result = await setConfigData({ "a/../../evil": { hacked: true } }, { Result });
    assert.equal(result.status, "error");
});
