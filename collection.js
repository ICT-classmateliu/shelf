(function (root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.ShelfCore = api;
  }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const MAX_ITEMS = 1000;
  const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
  const MAX_COVER_LENGTH = 2 * 1024 * 1024;
  const STATUSES = ["wishlist", "active", "done"];

  function textField(value, label, maximum, required = false) {
    if (value === undefined && !required) return "";
    if (typeof value !== "string") {
      throw new Error(`${label}需要使用文字。`);
    }
    const text = value.trim();
    if (required && !text) throw new Error(`请填写${label}。`);
    if (text.length > maximum) {
      throw new Error(`${label}最多允许 ${maximum} 个字符。`);
    }
    return text;
  }

  function timestamp(value, label) {
    const text = textField(value, label, 40, true);
    const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(text);
    if (!parts) throw new Error(`${label}必须是包含时区的 ISO 日期。`);

    const year = Number(parts[1]);
    const month = Number(parts[2]);
    const day = Number(parts[3]);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const time = Date.parse(text);
    if (
      month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1] ||
      Number(parts[4]) > 23 || Number(parts[5]) > 59 || Number(parts[6]) > 59 ||
      !Number.isFinite(time)
    ) {
      throw new Error(`${label}包含无效日期。`);
    }
    return new Date(time).toISOString();
  }

  function coverField(value) {
    const cover = textField(value, "封面", MAX_COVER_LENGTH);
    if (!cover) return "";

    if (/^https?:\/\//i.test(cover)) {
      let url;
      try {
        url = new URL(cover);
      } catch {
        throw new Error("封面网址无效。");
      }
      if (url.username || url.password || /\.svgz?$/i.test(url.pathname)) {
        throw new Error("请使用普通图片网址，且网址中不要包含账号密码。");
      }
      return url.href;
    }

    if (/^assets\/[a-zA-Z0-9/_ .()-]+\.(?:png|jpe?g|webp|gif|avif)(?:#\d+)?$/i.test(cover)) {
      if (cover.split("/").some((segment) => segment === ".." || segment === ".")) {
        throw new Error("封面路径必须位于 assets 文件夹内。");
      }
      return cover;
    }

    const embedded = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(cover);
    if (!embedded || embedded[2].length % 4 !== 0) {
      throw new Error("封面需要使用图片网址、assets 图片路径或 PNG / JPEG / WebP 图片数据。");
    }

    let bytes;
    try {
      bytes = atob(embedded[2]);
    } catch {
      throw new Error("封面图片数据损坏。");
    }
    const format = embedded[1];
    const isPng = bytes.startsWith("\x89PNG\r\n\x1a\n");
    const isJpeg = bytes.startsWith("\xff\xd8\xff");
    const isWebp = bytes.startsWith("RIFF") && bytes.slice(8, 12) === "WEBP";
    if (!(format === "png" && isPng || format === "jpeg" && isJpeg || format === "webp" && isWebp)) {
      throw new Error("封面图片格式与内容不匹配。");
    }
    return cover;
  }

  function normalizeItem(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("每条收藏都需要是一个对象。");
    }
    const id = textField(raw.id, "收藏编号", 128, true);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(id)) {
      throw new Error("收藏编号只能包含字母、数字、点、下划线、冒号和连字符。");
    }
    const status = raw.status === undefined ? "wishlist" : raw.status;
    if (!STATUSES.includes(status)) throw new Error("收藏状态无效。");
    const rating = raw.rating === undefined ? 0 : raw.rating;
    if (!Number.isInteger(rating) || rating < 0 || rating > 5) {
      throw new Error("评分需要是 0 到 5 之间的整数，0 表示尚未评分。");
    }
    const year = raw.year === undefined ? "" : String(raw.year);
    if (year && !/^[1-9]\d{3}$/.test(year)) {
      throw new Error("年份需要是四位数，也可以留空。");
    }
    const rawTags = raw.tags === undefined ? [] : raw.tags;
    if (!Array.isArray(rawTags) || rawTags.length > 20) {
      throw new Error("标签需要是数组，每条收藏最多允许 20 个标签。");
    }
    const tags = [...new Set(rawTags.map((tag) => textField(tag, "标签", 40, true)))];

    return {
      id,
      title: textField(raw.title, "标题", 120, true),
      category: textField(raw.category, "分类", 40, true),
      status,
      rating,
      year,
      creator: textField(raw.creator, "作者或创作者", 120),
      tags,
      notes: textField(raw.notes, "收藏心得", 10000),
      cover: coverField(raw.cover),
      createdAt: timestamp(raw.createdAt, "创建时间"),
      updatedAt: timestamp(raw.updatedAt, "更新时间"),
    };
  }

  function normalizeItems(items) {
    if (!Array.isArray(items) || items.length > MAX_ITEMS) {
      throw new Error(`收藏列表需要是数组，最多允许 ${MAX_ITEMS} 条收藏。`);
    }
    const ids = new Set();
    return items.map((raw, index) => {
      let item;
      try {
        item = normalizeItem(raw);
      } catch (error) {
        throw new Error(`第 ${index + 1} 条收藏有误：${error.message}`);
      }
      if (ids.has(item.id)) throw new Error(`收藏编号重复：${item.id}`);
      ids.add(item.id);
      return item;
    });
  }

  function parseImport(text) {
    if (typeof text !== "string") throw new Error("请导入 JSON 文本文件。");
    if (text.length > MAX_IMPORT_BYTES || new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) {
      throw new Error("导入文件不能超过 20 MB。");
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("无法读取文件，请选择有效的 JSON 备份。");
    }
    if (!data || typeof data !== "object" || Array.isArray(data) || data.version !== 1) {
      throw new Error("备份版本无效。需要 version 为 1 的 Shelf 备份。");
    }
    return normalizeItems(data.items);
  }

  function mergeItems(current, incoming) {
    const merged = new Map(normalizeItems(current).map((item) => [item.id, item]));
    for (const item of normalizeItems(incoming)) {
      const previous = merged.get(item.id);
      if (!previous || Date.parse(item.updatedAt) > Date.parse(previous.updatedAt)) {
        merged.set(item.id, item);
      }
    }
    if (merged.size > MAX_ITEMS) {
      throw new Error(`合并后超过 ${MAX_ITEMS} 条收藏，请减少导入数量。`);
    }
    return [...merged.values()];
  }

  function filterItems(items, options = {}) {
    const query = String(options.query || "").trim().toLocaleLowerCase();
    const filtered = items.filter((item) => {
      if (options.category && options.category !== "all" && item.category !== options.category) return false;
      if (options.status && options.status !== "all" && item.status !== options.status) return false;
      const content = [item.title, item.creator, item.notes, ...item.tags].join(" ").toLocaleLowerCase();
      return !query || content.includes(query);
    });
    const recentFirst = (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    if (options.sort === "title") {
      return filtered.sort((a, b) => a.title.localeCompare(b.title, "zh-Hans", { numeric: true }));
    }
    if (options.sort === "rating") {
      return filtered.sort((a, b) => b.rating - a.rating || recentFirst(a, b));
    }
    return filtered.sort(recentFirst);
  }

  function stats(items) {
    const result = { total: items.length, done: 0, active: 0, wishlist: 0, rated: 0, average: 0 };
    let sum = 0;
    for (const item of items) {
      result[item.status] += 1;
      if (item.rating > 0) {
        result.rated += 1;
        sum += item.rating;
      }
    }
    result.average = result.rated ? sum / result.rated : 0;
    return result;
  }

  return Object.freeze({ normalizeItem, parseImport, mergeItems, filterItems, stats });
});
