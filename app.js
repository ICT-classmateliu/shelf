/* UI uses text nodes for user content. Collection rules live in collection.js. */
(() => {
  "use strict";
  const core = window.ShelfCore;
  const config = window.SHELF_CONFIG;
  const storageKey = "shelf.collection.v1";
  const statuses = { wishlist: "想体验", active: "进行中", done: "已完成" };
  const $ = (selector) => document.querySelector(selector);
  const state = { items: [], query: "", category: "all", status: "all", sort: "recent", view: "grid", panel: "gallery" };
  let editingItem = null;
  let selectedCover = "";
  let uploadToken = 0;
  let toastTimer;
  let confirmation = null;
  let unreadableStorage = false;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function notify(message) {
    clearTimeout(toastTimer);
    $("#toast").textContent = message;
    $("#toast").hidden = false;
    toastTimer = setTimeout(() => { $("#toast").hidden = true; }, 4500);
  }

  function warning(message) {
    $("#storage-warning").textContent = message;
    $("#storage-warning").hidden = !message;
  }

  function readItems() {
    const raw = localStorage.getItem(storageKey);
    return raw === null ? null : core.parseImport(raw);
  }

  function persist(nextItems) {
    const checked = core.parseImport(JSON.stringify({ version: 1, items: nextItems }));
    localStorage.setItem(storageKey, JSON.stringify({ version: 1, items: checked }));
    state.items = checked;
    render();
  }

  function latestItems() {
    if (unreadableStorage) throw new Error("浏览器存储无法读取，请检查浏览器的存储权限后刷新。当前内容仍可导出。");
    return readItems() || [];
  }

  function errorMessage(error) {
    if (error.name === "QuotaExceededError") return "浏览器存储空间已满。请先导出备份，或减少图片和收藏后重试。";
    if (error.name === "SecurityError") return "浏览器禁止了本地存储。请允许本站存储数据，或通过本地服务器打开。";
    return error.message || "操作失败，请重试。";
  }

  function categories() {
    const list = config.categories.map((category) => ({ ...category }));
    for (const item of state.items) {
      if (!list.some((category) => category.id === item.category)) list.push({ id: item.category, label: item.category });
    }
    return list;
  }

  function categoryLabel(id) {
    return categories().find((category) => category.id === id)?.label || id;
  }

  function ratingNode(item) {
    const text = item.rating ? "★".repeat(item.rating) + "☆".repeat(5 - item.rating) : "尚未评分";
    const node = element("span", item.rating ? "rating" : "rating unrated", text);
    node.setAttribute("aria-label", item.rating ? `${item.rating} 分，满分 5 分` : "尚未评分");
    return node;
  }

  function progressNode(item) {
    return element("span", `progress ${item.status}`, statuses[item.status]);
  }

  function artwork(item, withBadge = true) {
    const node = element("div", "artwork");
    const sprite = /^assets\/covers\.png#([1-6])$/.exec(item.cover);
    if (sprite) {
      const index = Number(sprite[1]) - 1;
      node.classList.add("sprite");
      node.style.backgroundImage = 'url("assets/covers.png")';
      node.style.backgroundPosition = `${(index % 3) * 50}% ${Math.floor(index / 3) * 100}%`;
    } else if (item.cover) {
      const image = element("img");
      image.src = item.cover;
      image.alt = "";
      image.loading = "lazy";
      image.referrerPolicy = "no-referrer";
      image.addEventListener("error", () => { image.remove(); fallback(); }, { once: true });
      node.append(image);
    } else {
      fallback();
    }
    if (withBadge) node.append(element("span", "category-badge", categoryLabel(item.category)));
    return node;

    function fallback() {
      node.classList.add("fallback");
      node.append(element("span", "cover-initial", Array.from(item.title)[0] || "藏"));
    }
  }

  function renderCategories() {
    const container = $("#categories");
    container.replaceChildren();
    for (const category of categories()) {
      const button = element("button", "nav-button category-button");
      button.classList.toggle("active", state.category === category.id && state.panel === "gallery");
      button.setAttribute("aria-pressed", String(state.category === category.id));
      button.append(element("span", "category-dot"), element("span", "", category.label), element("span", "category-count", state.items.filter((item) => item.category === category.id).length));
      button.addEventListener("click", () => { state.category = state.category === category.id ? "all" : category.id; state.panel = "gallery"; render(); });
      container.append(button);
    }
  }

  function renderSummary() {
    const stats = core.stats(state.items);
    const values = [["全部收藏", stats.total, "件"], ["已完成", stats.done, "件"], ["进行中", stats.active, "件"], ["平均评分", stats.rated ? stats.average.toFixed(1) : "—", "/ 5"]];
    $("#summary").replaceChildren();
    for (const [label, value, unit] of values) {
      const stat = element("div", "stat");
      const number = element("span", "stat-value", value);
      number.append(element("span", "stat-unit", unit));
      stat.append(element("span", "stat-label", label), number);
      $("#summary").append(stat);
    }
  }

  function renderGallery() {
    const filterContainer = $("#status-filters");
    filterContainer.replaceChildren();
    for (const [key, label] of Object.entries({ all: "全部", ...statuses })) {
      const button = element("button", state.status === key ? "active" : "", label);
      button.setAttribute("aria-pressed", String(state.status === key));
      button.addEventListener("click", () => { state.status = key; renderGallery(); });
      filterContainer.append(button);
    }
    const items = core.filterItems(state.items, state);
    $("#result-count").textContent = `${items.length} 件收藏`;
    $("#demo-notice").hidden = !state.items.some((item) => item.id.startsWith("demo-"));
    const grid = $("#collection-grid");
    grid.classList.toggle("list-view", state.view === "list");
    grid.replaceChildren();
    for (const item of items) {
      const card = element("button", "collection-card");
      card.setAttribute("aria-label", `查看 ${item.title}`);
      const content = element("div", "card-content");
      const heading = element("div", "card-heading");
      heading.append(element("h2", "", item.title), element("span", "arrow", "↗"));
      const bottom = element("div", "card-bottom");
      bottom.append(ratingNode(item), progressNode(item));
      content.append(heading, element("p", "creator", [item.creator, item.year].filter(Boolean).join(" · ") || categoryLabel(item.category)), bottom);
      card.append(artwork(item), content);
      card.addEventListener("click", () => openDetail(item.id));
      grid.append(card);
    }
    const filtering = Boolean(state.query || state.category !== "all" || state.status !== "all");
    $("#empty-state").hidden = items.length > 0;
    $("#empty-title").textContent = filtering ? "还没找到这份收藏" : "为你的第一份喜欢留个位置";
    $("#empty-description").textContent = filtering ? "试试其他关键词，或清除筛选条件。" : "一本书、一部电影，或一张反复播放的唱片。";
    $("#empty-action").textContent = filtering ? "清除筛选" : "添加收藏";
    $("#empty-action").onclick = () => {
      if (filtering) { state.query = ""; state.category = "all"; state.status = "all"; $("#search").value = ""; render(); }
      else openEditor();
    };
    for (const view of ["grid", "list"]) {
      $(`#${view}-view`).classList.toggle("selected", state.view === view);
      $(`#${view}-view`).setAttribute("aria-pressed", String(state.view === view));
    }
  }

  function renderStats() {
    const container = $("#stats-panel");
    container.replaceChildren();
    const layout = element("div", "stats-layout");
    const groups = [
      ["收藏分布", categories().map((category) => [category.label, state.items.filter((item) => item.category === category.id).length])],
      ["体验进度", Object.entries(statuses).map(([status, label]) => [label, state.items.filter((item) => item.status === status).length])],
      ["我的评分", [5, 4, 3, 2, 1, 0].map((rating) => [rating ? `${rating} 分` : "尚未评分", state.items.filter((item) => item.rating === rating).length])]
    ];
    for (const [title, rows] of groups) {
      const box = element("section", "stats-box");
      box.append(element("h2", "", title));
      for (const [label, count] of rows) {
        const row = element("div", "bar-row");
        const header = element("div", "bar-label");
        header.append(element("span", "", label), element("span", "", `${count} 件`));
        const track = element("div", "bar-track");
        const fill = element("div", "bar-fill");
        fill.style.width = `${state.items.length ? count / state.items.length * 100 : 0}%`;
        track.append(fill);
        row.append(header, track);
        box.append(row);
      }
      layout.append(box);
    }
    container.append(layout, element("p", "stats-caption", "统计包含展厅中的所有收藏。平均评分只计算已评分的收藏，尚未评分的项目不会拉低均分。"));
  }

  function render() {
    renderCategories();
    renderSummary();
    renderGallery();
    if (state.panel === "stats") renderStats();
    $("#gallery-panel").hidden = state.panel !== "gallery";
    $("#stats-panel").hidden = state.panel !== "stats";
    $("#page-title").textContent = state.panel === "stats" ? "收藏里的小小足迹" : (state.category === "all" ? `${config.owner}收藏展厅` : `${categoryLabel(state.category)}收藏`);
    $("#page-description").textContent = state.panel === "stats" ? "看看你的喜欢，都停留在哪里。" : "书、电影、游戏，以及那些值得留下的喜欢。";
    $("#breadcrumb").textContent = `${config.owner} / ${state.panel === "stats" ? "收藏统计" : "收藏展厅"}`;
    for (const [id, panel] of [["gallery-nav", "gallery"], ["stats-nav", "stats"]]) {
      const active = state.panel === panel && (panel !== "gallery" || state.category === "all");
      $(`#${id}`).classList.toggle("active", active);
      if (active) $(`#${id}`).setAttribute("aria-current", "page");
      else $(`#${id}`).removeAttribute("aria-current");
    }
  }

  function openDetail(id) {
    const item = state.items.find((entry) => entry.id === id);
    if (!item) return;
    const container = $("#detail-content");
    container.replaceChildren();
    const banner = element("div", "detail-art");
    const close = element("button", "icon-button", "×");
    close.setAttribute("aria-label", "关闭详情");
    close.addEventListener("click", () => $("#detail-dialog").close());
    banner.append(artwork(item), close);
    const body = element("div", "detail-body");
    const title = element("h2", "", item.title);
    title.id = "detail-title";
    const metadata = element("div", "detail-meta");
    metadata.append(ratingNode(item), progressNode(item));
    const tags = element("div", "detail-tags");
    item.tags.forEach((tag) => tags.append(element("span", "", tag)));
    body.append(title, element("p", "creator", [item.creator, item.year].filter(Boolean).join(" · ") || categoryLabel(item.category)), metadata, tags, element("h3", "", "收藏笔记"), element("p", "detail-notes", item.notes || "还没有写下笔记。编辑收藏，留下此刻的感受吧。"), element("p", "detail-date", `更新于 ${new Date(item.updatedAt).toLocaleDateString("zh-CN")}`));
    const actions = element("div", "dialog-actions detail-actions");
    const remove = element("button", "text-button", "删除收藏");
    remove.addEventListener("click", async () => {
      if (!await confirmAction("删除这份收藏？", `「${item.title}」会从当前展厅移除。已有导出备份可以重新导入。`, "删除收藏")) return;
      try {
        const latest = latestItems();
        const current = latest.find((entry) => entry.id === item.id);
        if (current && current.updatedAt !== item.updatedAt) throw new Error("这份收藏已在另一个页面更新。请关闭详情后重新查看。");
        persist(latest.filter((entry) => entry.id !== item.id));
        $("#detail-dialog").close();
        notify("收藏已删除");
      } catch (error) { notify(errorMessage(error)); }
    });
    const edit = element("button", "button primary", "编辑收藏");
    edit.addEventListener("click", () => { $("#detail-dialog").close(); openEditor(item); });
    actions.append(remove, edit);
    container.append(banner, body, actions);
    $("#detail-dialog").showModal();
  }

  function openEditor(item = null) {
    editingItem = item;
    selectedCover = item?.cover?.startsWith("data:") ? item.cover : "";
    uploadToken += 1;
    const form = $("#item-form");
    form.reset();
    const select = form.elements.category;
    select.replaceChildren();
    for (const category of categories()) {
      const option = element("option", "", category.label);
      option.value = category.id;
      select.append(option);
    }
    if (item) {
      for (const field of ["title", "category", "status", "rating", "year", "creator", "notes"]) form.elements[field].value = item[field];
      form.elements.tags.value = item.tags.join(", ");
      form.elements.cover.value = selectedCover ? "" : item.cover;
    } else if (state.category !== "all") select.value = state.category;
    $("#edit-title").textContent = item ? "编辑收藏" : "添加收藏";
    $("#cover-info").textContent = selectedCover ? "已保存的本地封面" : "支持 JPG、PNG、WebP，自动缩小保存";
    $("#form-error").hidden = true;
    $("#save-button").disabled = false;
    $("#edit-dialog").showModal();
    form.elements.title.focus();
  }

  function confirmAction(title, text, buttonText = "确定") {
    $("#confirm-title").textContent = title;
    $("#confirm-text").textContent = text;
    $("#confirm-yes").textContent = buttonText;
    return new Promise((resolve) => { confirmation = resolve; $("#confirm-dialog").showModal(); $("#confirm-no").focus(); });
  }

  $("#confirm-no").addEventListener("click", () => $("#confirm-dialog").close());
  $("#confirm-yes").addEventListener("click", () => { const resolve = confirmation; confirmation = null; $("#confirm-dialog").close(); resolve?.(true); });
  $("#confirm-dialog").addEventListener("close", () => { confirmation?.(false); confirmation = null; });
  document.querySelectorAll(".close-edit").forEach((button) => button.addEventListener("click", () => $("#edit-dialog").close()));
  $("#edit-dialog").addEventListener("close", () => { uploadToken += 1; });

  $("#item-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const latest = latestItems();
      const current = latest.find((item) => item.id === editingItem?.id);
      if (editingItem && (!current || current.updatedAt !== editingItem.updatedAt)) throw new Error("这份收藏已在另一个页面修改或删除。请取消编辑并重新打开。");
      const now = new Date().toISOString();
      const item = core.normalizeItem({
        id: editingItem?.id || crypto.randomUUID(),
        createdAt: editingItem?.createdAt || now,
        updatedAt: now,
        title: form.elements.title.value.trim(),
        category: form.elements.category.value,
        status: form.elements.status.value,
        rating: Number(form.elements.rating.value),
        year: form.elements.year.value.trim(),
        creator: form.elements.creator.value.trim(),
        notes: form.elements.notes.value.trim(),
        tags: form.elements.tags.value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean),
        cover: form.elements.cover.value.trim() || selectedCover
      });
      persist([...latest.filter((entry) => entry.id !== item.id), item]);
      $("#edit-dialog").close();
      notify(editingItem ? "收藏已更新" : "新的喜欢，已收入展厅");
    } catch (error) {
      $("#form-error").textContent = errorMessage(error);
      $("#form-error").hidden = false;
    }
  });

  $("#item-form").elements.cover.addEventListener("input", () => { selectedCover = ""; $("#cover-info").textContent = "支持 JPG、PNG、WebP，自动缩小保存"; });
  $("#clear-cover").addEventListener("click", () => {
    uploadToken += 1;
    selectedCover = "";
    $("#item-form").elements.cover.value = "";
    $("#cover-file").value = "";
    $("#cover-info").textContent = "将使用自动生成的文字封面";
    $("#save-button").disabled = false;
  });

  $("#cover-file").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const token = ++uploadToken;
    $("#save-button").disabled = true;
    $("#form-error").hidden = true;
    let url;
    try {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("请选择 JPG、PNG 或 WebP 图片。");
      if (file.size > 10 * 1024 * 1024) throw new Error("图片请小于 10 MB。");
      url = URL.createObjectURL(file);
      const image = new Image();
      image.src = url;
      await image.decode();
      if (token !== uploadToken) return;
      const ratio = Math.min(1, 720 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      selectedCover = canvas.toDataURL("image/jpeg", 0.82);
      $("#item-form").elements.cover.value = "";
      $("#cover-info").textContent = `${file.name} · 已压缩为 ${Math.ceil(selectedCover.length * 0.75 / 1024)} KB`;
    } catch (error) {
      if (token === uploadToken) { $("#form-error").textContent = errorMessage(error); $("#form-error").hidden = false; }
    } finally {
      if (url) URL.revokeObjectURL(url);
      if (token === uploadToken) $("#save-button").disabled = false;
      event.target.value = "";
    }
  });

  $("#export-button").addEventListener("click", () => {
    try {
      const items = unreadableStorage ? state.items : latestItems();
      const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), items }, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = element("a");
      anchor.href = url;
      anchor.download = `shelf-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify(`已导出 ${items.length} 件收藏`);
    } catch (error) { notify(errorMessage(error)); }
  });

  $("#import-button").addEventListener("click", () => $("#import-file").click());
  $("#import-file").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error("备份文件请小于 20 MB。");
      const incoming = core.parseImport(await file.text());
      if (!await confirmAction("导入这份收藏备份？", `共 ${incoming.length} 件收藏。导入会合并到当前展厅，相同编号保留更新时间较新的版本。`, "合并导入")) return;
      persist(core.mergeItems(latestItems(), incoming));
      notify(`已合并备份，展厅共有 ${state.items.length} 件收藏`);
    } catch (error) { notify(errorMessage(error)); }
  });

  $("#remove-demo").addEventListener("click", async () => {
    if (!await confirmAction("移除示例收藏？", "将移除六条示例收藏，包括你对这些示例所做的编辑。", "移除示例")) return;
    try { persist(latestItems().filter((item) => !item.id.startsWith("demo-"))); notify("示例已移除，可以开始自己的收藏了"); }
    catch (error) { notify(errorMessage(error)); }
  });
  $("#load-demo").addEventListener("click", async () => {
    try { persist(core.mergeItems(latestItems(), window.SHELF_DEMO)); notify("示例收藏已加入"); }
    catch (error) { notify(errorMessage(error)); }
  });
  $("#add-button").addEventListener("click", () => openEditor());
  $("#search").addEventListener("input", (event) => { state.query = event.target.value; renderGallery(); });
  $("#sort").addEventListener("change", (event) => { state.sort = event.target.value; renderGallery(); });
  $("#gallery-nav").addEventListener("click", () => { state.panel = "gallery"; state.category = "all"; render(); });
  $("#stats-nav").addEventListener("click", () => { state.panel = "stats"; render(); });
  for (const view of ["grid", "list"]) $(`#${view}-view`).addEventListener("click", () => { state.view = view; renderGallery(); });
  window.addEventListener("storage", (event) => {
    if (event.key !== storageKey && event.key !== null) return;
    try { state.items = readItems() || []; unreadableStorage = false; warning(""); render(); notify("已同步此浏览器其他页面的收藏变更"); }
    catch (error) { unreadableStorage = true; warning(`读取收藏失败。${errorMessage(error)}`); }
  });

  $("#brand-name").textContent = config.name;
  $("#brand-subtitle").textContent = config.subtitle;
  document.title = `${config.name} · ${config.subtitle}`;
  if (/^#[\da-f]{6}$/i.test(config.accent)) document.documentElement.style.setProperty("--accent", config.accent);
  try {
    const stored = readItems();
    state.items = stored === null ? window.SHELF_DEMO.map(core.normalizeItem) : stored;
    if (stored === null) localStorage.setItem(storageKey, JSON.stringify({ version: 1, items: state.items }));
  } catch (error) {
    unreadableStorage = true;
    warning(`本地收藏暂时无法读写。${errorMessage(error)}`);
  }
  render();
})();
