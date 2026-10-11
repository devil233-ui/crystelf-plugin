import path from "path";

// 单个路径片段的白名单：首字符为字母、数字、下划线或连字符，其余还允许点。
// 不含 / 与 \，也天然排除 "." 与 ".."，保证拼接结果无法逃出预期目录。
const SAFE_SEGMENT_PATTERN = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

function toSegment(value) {
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "string") return value.trim();
    return "";
}

/**
 * 判断一个值能否安全地作为路径片段使用
 * @param {string|number} value 待检查的值，例如群号、配置名
 * @returns {boolean}
 */
export function isSafeSegment(value) {
    return SAFE_SEGMENT_PATTERN.test(toSegment(value));
}

/**
 * 校验并返回可安全拼接的路径片段；不合法时抛错（失败关闭）
 * @param {string|number} value 待校验的值，例如群号、配置名
 * @param {string} label 出错信息中显示的字段名
 * @returns {string}
 */
export function safeSegment(value, label = "路径片段") {
    const segment = toSegment(value);
    if (!SAFE_SEGMENT_PATTERN.test(segment)) {
        throw new Error(`[crystelf-plugin] 拒绝不安全的${label}: ${segment.slice(0, 32) || "(空)"}`);
    }
    return segment;
}

/**
 * 逐个校验片段后再拼接路径，避免外部输入逃出基准目录
 * @param {string} base 基准目录
 * @param {...(string|number)} segments 路径片段
 * @returns {string}
 */
export function safeJoin(base, ...segments) {
    const safeSegments = segments.map((segment, index) => safeSegment(segment, `路径片段${index + 1}`));
    return path.join(base, ...safeSegments);
}
