import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import screenshot from "../lib/rss/screenshot.js";
import rssCache from "../lib/rss/rssCache.js";
import tools from "../components/tool.js";

global.plugin = class {};
global.logger = { error() {}, warn() {}, info() {} };

const { default: RssPush, formatRssContent, renderMiyousheStructuredContent } = await import("../apps/rssPush.js");

const musicLinks = [
    [ ">>点击前往QQ音乐收听<<", "https://y.qq.com/w/album.html?albumId=102291928&ADTAG=hz_wb_sf&channelId=10081987" ],
    [ ">>点击前往酷狗音乐收听<<", "https://www.kugou.com/album/207236044.html" ],
    [ ">>点击前往Apple Music<<", "https://music.apple.com/cn/album/6810715095" ],
];

function renderMusicLinks() {
    const blocks = musicLinks.flatMap(([ label, url ]) => [
        { insert: label, attributes: { link: url, bold: true, underline: true } },
        { insert: "\n" },
    ]);
    return renderMiyousheStructuredContent(JSON.stringify(blocks)).html;
}

test("结构化正文的单换行保持同一段落", () => {
    const content = JSON.stringify([ { insert: "第一行\n第二行\n第三行\n" } ]);
    const rendered = renderMiyousheStructuredContent(content).html;

    assert.equal(rendered, "<p>第一行<br>第二行<br>第三行</p>");
});

test("结构化正文的连续换行才产生新段落", () => {
    const content = JSON.stringify([ { insert: "第一段\n\n第二段\n" } ]);
    const rendered = renderMiyousheStructuredContent(content).html;

    assert.equal(rendered, "<p>第一段</p><p>第二段</p>");
});

test("标题、引用和列表仍保持独立块", () => {
    const content = JSON.stringify([
        { insert: "标题\n", attributes: { header: 1 } },
        { insert: "引用\n", attributes: { blockquote: true } },
        { insert: "项目\n", attributes: { list: "bullet" } },
        { insert: "正文\n" },
    ]);
    const rendered = renderMiyousheStructuredContent(content).html;

    assert.match(rendered, /^<h2>标题<\/h2><blockquote><p>引用<\/p><\/blockquote><p class="miyoushe-list-item"><span>•<\/span>项目<\/p><p>正文<\/p>$/);
});

test("纯文字消息为米游社标签补充分隔和标签标题", () => {
    const html = "<p>正文最后一句。</p><div class=\"miyoushe-topics\"><span>游戏心得</span><span>萌新指南</span><span>每日一水</span></div><a href=\"https://example.com\">原文</a>";

    assert.equal(formatRssContent(html), "正文最后一句。\n标签：游戏心得 · 萌新指南 · 每日一水\n原文\nhttps://example.com/");
});

test("米游社音乐平台超链接在文字消息中保留网址且不改变截图HTML", () => {
    const html = renderMusicLinks();
    const original = html;

    assert.equal(formatRssContent(html), musicLinks.flat().join("\n"));
    assert.equal(html, original);
    assert.ok(html.includes("&amp;ADTAG=hz_wb_sf&amp;channelId=10081987"));
    assert.ok(html.includes("<u><strong>"));
});

test("常规RSS链接兼容单双引号、无引号、大写属性及数值实体", () => {
    const html = "<p><A HREF = 'https://example.com/one?a=1&#38;b=2'><strong>链接一</strong></A></p>"
        + "<p><a href=https://example.com/two>链接二</a></p>"
        + "<p><a href=\"http://example.com/three?x=1&#x26;y=2\">链接三</a></p>";

    assert.equal(formatRssContent(html), "链接一\nhttps://example.com/one?a=1&b=2\n链接二\nhttps://example.com/two\n链接三\nhttp://example.com/three?x=1&y=2");
});

test("链接文字已经是完整网址时不重复追加", () => {
    const html = "<a href=\"https://example.com/album?a=1&amp;b=2\"><span>https://example.com/album?a=1&amp;b=2</span></a>";

    assert.equal(formatRssContent(html), "https://example.com/album?a=1&b=2");
});

test("图片链接仍保留目标网址但不泄漏图片地址", () => {
    const html = "<a href=\"https://example.com/album\"><img src=\"https://example.com/cover.jpg\"></a>";

    assert.equal(formatRssContent(html), "https://example.com/album");
});

test("不把其他属性中的href误当超链接", () => {
    const html = "<p><a data-href=\"https://example.com/wrong\" title='示例 href=\"https://example.com/fake\"'>普通文字</a></p>"
        + "<p><a title='示例 href=\"https://example.com/fake\"' href=\"https://example.com/right\">真正链接</a></p>";

    assert.equal(formatRssContent(html), "普通文字\n真正链接\nhttps://example.com/right");
});

test("不追加非网页协议、页内锚点或无法解析的相对地址", () => {
    const html = "<p><a href=\"javascript:alert(1)\">脚本</a></p>"
        + "<p><a href=\"mailto:test@example.com\">邮件</a></p>"
        + "<p><a href=\"#section\">本页</a></p>"
        + "<p><a href=\"/album/1\">相对地址</a></p>";

    assert.equal(formatRssContent(html), "脚本\n邮件\n本页\n相对地址");
});

test("转义的HTML示例保持文字而不被当作真实链接", () => {
    const html = "<p>&lt;a href=&quot;https://example.com/fake&quot;&gt;示例&lt;/a&gt;</p>";

    assert.equal(formatRssContent(html), "<a href=\"https://example.com/fake\">示例</a>");
});

test("手动预览与自动推送都发送完整音乐平台网址", async(t) => {
    const rss = Object.create(RssPush.prototype);
    rss.rssTempDir = "/unused-rss-link-test";
    const post = {
        title: "音乐专辑上线",
        content: renderMusicLinks(),
        link: "https://www.miyoushe.com/ys/article/78159163",
        date: "2026-09-14T12:00:00+08:00",
    };
    const originalHtml = post.content;
    const previews = [];
    const pushes = [];
    const previousBot = global.Bot;

    t.mock.method(rss, "getFeedData", async() => [ post ]);
    t.mock.method(rss, "isFiltered", () => false);
    t.mock.method(fs, "existsSync", () => false);
    t.mock.method(screenshot, "generateScreenshot", async() => []);
    t.mock.method(tools, "sleep", async() => {});
    t.mock.method(rssCache, "set", async() => {});
    t.mock.method(rssCache, "release", async() => {});
    global.Bot = { pickGroup: () => ({ sendMsg: async message => pushes.push(message) }) };

    try {
        await rss.pullFeedNow({ msg: "rss拉取https://example.com/feed", reply: async message => previews.push(message) });
        await rss.sendFeedPost({ targetGroups: [ "test-group" ], screenshot: false }, { post, reservation: "test-reservation" });

        const preview = previews.find(message => message.startsWith("[RSS预览]"));
        const push = pushes.find(message => message.startsWith("[RSS推送]"));
        assert.ok(preview);
        assert.ok(push);
        for (const [ label, url ] of musicLinks) {
            assert.ok(preview.includes(`${label}\n${url}`));
            assert.ok(push.includes(`${label}\n${url}`));
        }
        assert.ok(preview.includes(post.link));
        assert.ok(push.includes(post.link));
        assert.equal(post.content, originalHtml);
    } finally {
        if (previousBot === undefined) delete global.Bot;
        else global.Bot = previousBot;
    }
});
