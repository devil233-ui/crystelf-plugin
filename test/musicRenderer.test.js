import assert from "node:assert/strict";
import test from "node:test";
import MusicRenderer from "../lib/music/musicRenderer.js";

global.logger = { error() {}, warn() {} };

function deferred() {
    let resolve;
    const promise = new Promise(value => { resolve = value; });
    return { promise, resolve };
}

test("并发初始化只启动一个浏览器并共享结果", async() => {
    const gate = deferred();
    let launchCount = 0;
    let closeCount = 0;
    const browser = {
        isConnected: () => true,
        close: async() => { closeCount++; },
    };
    const renderer = new MusicRenderer({
        launchBrowser: async() => {
            launchCount++;
            await gate.promise;
            return browser;
        },
    });

    const first = renderer.init();
    const second = renderer.init();
    assert.equal(launchCount, 1);
    gate.resolve();

    assert.strictEqual(await first, browser);
    assert.strictEqual(await second, browser);
    await renderer.close();
    assert.equal(closeCount, 1);
});

test("浏览器断连后初始化会清理旧实例并创建新实例", async() => {
    let staleCloseCount = 0;
    let launchCount = 0;
    const staleBrowser = {
        isConnected: () => false,
        close: async() => { staleCloseCount++; },
    };
    const freshBrowser = {
        isConnected: () => true,
        close: async() => {},
    };
    const renderer = new MusicRenderer({
        launchBrowser: async() => {
            launchCount++;
            return freshBrowser;
        },
    });
    renderer.browser = staleBrowser;

    assert.strictEqual(await renderer.init(), freshBrowser);
    assert.equal(launchCount, 1);
    assert.equal(staleCloseCount, 1);
    await renderer.close();
});

test("渲染失败时仍然关闭已创建的页面", async() => {
    let pageCloseCount = 0;
    let browserCloseCount = 0;
    const page = {
        async setViewport() {},
        async setContent() { throw new Error("setContent failed"); },
        async close() { pageCloseCount++; },
    };
    const browser = {
        isConnected: () => true,
        newPage: async() => page,
        close: async() => { browserCloseCount++; },
    };
    const renderer = new MusicRenderer({ launchBrowser: async() => browser });

    await assert.rejects(
        renderer.renderMusicList([], "测试", "group"),
        /渲染失败: setContent failed/,
    );
    assert.equal(pageCloseCount, 1);
    await renderer.close();
    assert.equal(browserCloseCount, 1);
});

test("关闭等待中的初始化并只关闭最终浏览器一次", async() => {
    const gate = deferred();
    let closeCount = 0;
    const browser = {
        isConnected: () => true,
        close: async() => { closeCount++; },
    };
    const renderer = new MusicRenderer({
        launchBrowser: async() => {
            await gate.promise;
            return browser;
        },
    });

    const initializing = renderer.init();
    const closing = renderer.close();
    gate.resolve();
    await initializing;
    await closing;
    await renderer.close();
    assert.equal(closeCount, 1);
    assert.equal(renderer.browser, null);
});
