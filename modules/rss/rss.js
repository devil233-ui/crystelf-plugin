import Parser from "rss-parser";
import http2 from "node:http2";

const parser = new Parser();
const HTTP2_TIMEOUT = 60000;
const MAX_REDIRECTS = 5;

const fetchWithHTTP2 = (feedUrl, redirectCount = 0) => {
  return new Promise((resolve, reject) => {
    const url = new URL(feedUrl);
    const client = http2.connect(url.origin);
    let body = "";
    let responseHeaders;
    let settled = false;

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      err ? client.destroy() : client.close();
      err ? reject(err) : resolve(value);
    };

    client.on("error", (err) => finish(err));

    const request = client.request({
      [http2.constants.HTTP2_HEADER_METHOD]: "GET",
      [http2.constants.HTTP2_HEADER_PATH]: `${url.pathname}${url.search}`,
      [http2.constants.HTTP2_HEADER_ACCEPT]: "application/rss+xml",
      [http2.constants.HTTP2_HEADER_USER_AGENT]: "rss-parser",
    });

    request.setEncoding("utf8");
    request.setTimeout(HTTP2_TIMEOUT, () => {
      finish(new Error(`Request timed out after ${HTTP2_TIMEOUT}ms`));
    });
    request.on("response", (headers) => {
      responseHeaders = headers;
    });
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const status = responseHeaders?.[http2.constants.HTTP2_HEADER_STATUS];
      const location = responseHeaders?.[http2.constants.HTTP2_HEADER_LOCATION];

      if (status >= 300 && status < 400 && location) {
        if (redirectCount >= MAX_REDIRECTS) {
          finish(new Error("Too many redirects"));
          return;
        }
        client.close();
        settled = true;
        fetchWithHTTP2(new URL(location, feedUrl).href, redirectCount + 1).then(resolve, reject);
        return;
      }
      if (status >= 300) {
        finish(new Error(`Status code ${status}`));
        return;
      }
      finish(null, body);
    });
    request.on("error", (err) => finish(err));
    request.end();
  });
};

const parseURL = async(url) => {
  try {
    return await parser.parseURL(url);
  } catch (err) {
    if (!url.startsWith("https://") || err.message !== "Status code 403") throw err;
    return parser.parseString(await fetchWithHTTP2(url));
  }
};

//去掉不干净的东西
const cleanHTML = (html) => {
  return html
    .replace(/该渲染由.*?<\/blockquote>/gs, "")
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "");
};

const rssTools = {
  /**
   * 拉取rss
   * 已适配Atom&RSS2.0
   * @param url rss地址
   * @returns {Promise<{title: *, link: *, content: *, author, date, feedTitle: string, feedLink: string, image}[]|null>}
   */
  async fetchFeed(url) {
    try {
      const feed = await parseURL(url);
      return feed.items.map((item) => ({
        title: item.title,
        link: item.link,
        content: cleanHTML(item["content:encoded"] || item.content || item.description || ""),
        author: item.creator || item.author || "",
        date: item.pubDate || item.isoDate,
        feedTitle: feed.title,
        feedLink: feed.link,
        image: feed.image?.url || feed.logo || "",
      }));
    } catch (err) {
      logger.error(`RSS 拉取失败: ${url}`, err);
      return null;
    }
  },
};

export default rssTools;
