import Parser from "rss-parser";
import http2 from "node:http2";
import configControl from "../../lib/config/configControl.js";

const parser = new Parser();
const HTTP2_TIMEOUT = 60000;
const MAX_REDIRECTS = 5;
const DEFAULT_USER_AGENT = "Mozilla/5.0 (compatible; crystelf-plugin RSS reader)";

export function buildFeedAuthHeaders(feedUrl, authConfig = {}) {
  const url = new URL(feedUrl);
  const hostname = url.hostname.toLowerCase();
  const configKey = authConfig.aliases?.[hostname] || hostname;
  const siteConfig = authConfig.sites?.[configKey];
  const cookie = String(siteConfig?.cookie || "").trim();
  if (!siteConfig || siteConfig.enabled === false || !cookie) return {};

  const referer = String(siteConfig.referer || `${url.origin}/`).trim();
  const userAgent = String(siteConfig.userAgent || DEFAULT_USER_AGENT).trim();
  return {
    "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
    "Cookie": cookie,
    "Referer": referer,
    "User-Agent": userAgent,
  };
}

const fetchWithAuth = async(feedUrl, headers, redirectCount = 0) => {
  const response = await fetch(feedUrl, {
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(HTTP2_TIMEOUT),
  });

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) throw new Error(`Status code ${response.status}`);
    if (redirectCount >= MAX_REDIRECTS) throw new Error("Too many redirects");

    const nextUrl = new URL(location, feedUrl);
    const nextHeaders = nextUrl.origin === new URL(feedUrl).origin
      ? headers
      : Object.fromEntries(Object.entries(headers).filter(([ key ]) => key !== "Cookie"));
    return fetchWithAuth(nextUrl.href, nextHeaders, redirectCount + 1);
  }

  if (!response.ok) throw new Error(`Status code ${response.status}`);
  return response.text();
};

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
  const authHeaders = buildFeedAuthHeaders(url, configControl.get("rssAuth") || {});
  if (authHeaders.Cookie) {
    return parser.parseString(await fetchWithAuth(url, authHeaders));
  }

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
