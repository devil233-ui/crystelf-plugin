import assert from "node:assert/strict";
import test from "node:test";

global.plugin = class {};
global.logger = { error() {}, warn() {} };

const { formatRssContent, renderMiyousheStructuredContent } = await import("../apps/rssPush.js");

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

    assert.equal(formatRssContent(html), "正文最后一句。\n标签：游戏心得 · 萌新指南 · 每日一水\n原文");
});
