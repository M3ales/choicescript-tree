import type { Scene } from "../scanner/scene";
import { OpfsIO } from "../io/opfs-io";

const folderInput = document.getElementById("folder-input") as HTMLInputElement;
const folderLabel = document.getElementById("folder-label")!;
const urlInput = document.getElementById("url-input") as HTMLInputElement;
const extraScenesInput = document.getElementById("extra-scenes") as HTMLInputElement;
const runBtn = document.getElementById("run-btn") as HTMLButtonElement;
const clearBtn = document.getElementById("clear-btn") as HTMLButtonElement;
const statusEl = document.getElementById("status")!;
const logPanel = document.getElementById("log-panel")!;
const resultsPanel = document.getElementById("results-panel")!;
const tabSaved = document.getElementById("tab-saved") as HTMLButtonElement;
const tabFolder = document.getElementById("tab-folder") as HTMLButtonElement;
const tabUrl = document.getElementById("tab-url") as HTMLButtonElement;
const savedInfo = document.getElementById("saved-info")!;
const browseBtn = document.getElementById("browse-btn") as HTMLButtonElement;

let mode: "saved" | "folder" | "url" = "saved";
let localFiles = new Map<string, string>();
let savedCount = 0;
let worker: Worker | null = null;
let cachedScenes: Scene[] | null = null;

// --- Check OPFS on load ---

checkSaved();

async function checkSaved() {
  try {
    const opfs = await OpfsIO.create();
    const hasData = await opfs.exists("raw-scenes.json");
    if (hasData) {
      const raw = await opfs.readFile("raw-scenes.json");
      const scenes = JSON.parse(raw) as Scene[];
      cachedScenes = scenes;
      savedCount = scenes.length;
      savedInfo.textContent = `${savedCount} scenes in OPFS`;
      tabSaved.classList.remove("disabled");
      setMode("saved");
      browseOpfs();
    } else {
      savedCount = 0;
      savedInfo.textContent = "No saved data";
      tabSaved.classList.add("disabled");
      setMode("folder");
    }
  } catch {
    savedCount = 0;
    savedInfo.textContent = "No saved data";
    tabSaved.classList.add("disabled");
    setMode("folder");
  }
  updateRunState();
}

// --- Source mode tabs ---

for (const tab of [tabSaved, tabFolder, tabUrl]) {
  tab.addEventListener("click", () => {
    const target = tab.dataset.mode as "saved" | "folder" | "url";
    if (target === "saved" && savedCount === 0) return;
    setMode(target);
    updateRunState();
  });
}

function setMode(m: "saved" | "folder" | "url") {
  mode = m;
  tabSaved.classList.toggle("active", mode === "saved");
  tabFolder.classList.toggle("active", mode === "folder");
  tabUrl.classList.toggle("active", mode === "url");
  savedInfo.classList.toggle("hidden", mode !== "saved");
  folderLabel.classList.toggle("hidden", mode !== "folder");
  urlInput.classList.toggle("hidden", mode !== "url");
  clearBtn.classList.toggle("hidden", mode !== "saved");
  browseBtn.classList.toggle("hidden", mode !== "saved" || savedCount === 0);
}

// --- Folder selection ---

folderInput.addEventListener("change", async () => {
  const files = folderInput.files;
  if (!files || files.length === 0) return;

  localFiles = new Map();
  for (const file of files) {
    if (file.name.endsWith(".txt")) {
      const name = file.name.replace(/\.txt$/, "");
      localFiles.set(name, await file.text());
    }
  }

  statusEl.textContent = `${localFiles.size} scene files selected`;
  folderLabel.textContent = `${localFiles.size} files`;
  updateRunState();
});

urlInput.addEventListener("input", updateRunState);

function updateRunState() {
  if (mode === "saved") {
    runBtn.disabled = savedCount === 0;
  } else if (mode === "folder") {
    runBtn.disabled = localFiles.size === 0;
  } else {
    runBtn.disabled = urlInput.value.trim().length === 0;
  }
}

// --- Run ---

runBtn.addEventListener("click", () => {
  if (mode === "saved") runFromSaved();
  else if (mode === "folder") runFromFolder();
  else runFromUrl();
});

clearBtn.addEventListener("click", async () => {
  try {
    const opfs = await OpfsIO.create();
    await opfs.clear();
    savedCount = 0;
    cachedScenes = null;
    savedInfo.textContent = "No saved data";
    tabSaved.classList.add("disabled");
    setMode("folder");
    updateRunState();
    appendLog("info", "OPFS cleared");
  } catch (err) {
    appendLog("error", `Clear failed: ${err}`);
  }
});

function getExtraScenes(): string[] {
  return extraScenesInput.value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseSceneList(startupContent: string): string[] {
  const tag = "*scene_list";
  const start = startupContent.indexOf(tag);
  if (start === -1) return [];
  const afterTag = start + tag.length;
  const nextCmd = startupContent.indexOf("*", afterTag);
  const block = nextCmd === -1
    ? startupContent.slice(afterTag)
    : startupContent.slice(afterTag, nextCmd);
  return block
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function buildSceneList(
  startupContent: string,
  availableNames: Iterable<string>,
  extras: string[],
): string[] {
  const listed = parseSceneList(startupContent);
  const ordered = new Set(listed);

  for (const extra of extras) {
    if (!ordered.has(extra)) ordered.add(extra);
  }

  for (const name of availableNames) {
    if (!ordered.has(name)) ordered.add(name);
  }

  ordered.delete("startup");
  const result = ["startup", ...ordered];

  if (!result.includes("choicescript_stats")) {
    result.push("choicescript_stats");
  }

  return result;
}

// --- Saved mode (OPFS) ---

function runFromSaved() {
  logPanel.innerHTML = "";
  resultsPanel.innerHTML = "";

  if (!cachedScenes) {
    appendLog("error", "No saved scenes found");
    return;
  }

  appendLog("info", `Running pipeline from ${cachedScenes.length} saved scenes`);
  startPipeline(cachedScenes);
}

// --- Folder mode ---

async function runFromFolder() {
  logPanel.innerHTML = "";
  resultsPanel.innerHTML = "";

  const startupContent = localFiles.get("startup");
  if (!startupContent) {
    appendLog("error", "No startup.txt found in selected folder");
    return;
  }

  const extras = getExtraScenes();
  const sceneNames = buildSceneList(startupContent, localFiles.keys(), extras);

  const scenes: Scene[] = [];
  const missing: string[] = [];

  for (const name of sceneNames) {
    const content = localFiles.get(name);
    if (content === undefined) {
      missing.push(name);
      scenes.push({
        sourceUrl: `local://${name}.txt`,
        name,
        content: "",
        error: { message: `File not found in selected folder`, code: 404 },
        flow: [],
      });
    } else {
      scenes.push({
        sourceUrl: `local://${name}.txt`,
        name,
        content,
        error: undefined,
        flow: [],
      });
    }
  }

  if (missing.length > 0) {
    appendLog("warn", `Missing files: ${missing.join(", ")}`);
  }

  appendLog("info", `${scenes.length} scenes (${scenes.filter((s) => !s.error).length} loaded, ${missing.length} missing)`);
  await saveScenesToOpfs(scenes);
  startPipeline(scenes);
}

// --- URL mode ---

async function runFromUrl() {
  logPanel.innerHTML = "";
  resultsPanel.innerHTML = "";
  runBtn.disabled = true;
  statusEl.textContent = "Fetching scenes…";

  const baseUrl = urlInput.value.trim().replace(/\/+$/, "");
  const extras = getExtraScenes();

  try {
    appendLog("info", `Fetching startup from ${baseUrl}`);
    const startup = await fetchScene("startup", baseUrl);
    if (startup.error) {
      appendLog("error", `Failed to load startup.txt: ${startup.error.message}`);
      runBtn.disabled = false;
      statusEl.textContent = "Error";
      return;
    }

    const sceneNames = buildSceneList(startup.content, [], extras);
    appendLog("info", `Scene list: ${sceneNames.length} scenes`);

    statusEl.textContent = `Fetching ${sceneNames.length} scenes…`;
    const scenes = await Promise.all(
      sceneNames.map((name) =>
        name === "startup" ? Promise.resolve(startup) : fetchScene(name, baseUrl),
      ),
    );

    const loaded = scenes.filter((s) => !s.error).length;
    const failed = scenes.filter((s) => s.error).length;
    for (const s of scenes) {
      if (s.error) appendLog("warn", `${s.name}: ${s.error.message}`);
    }
    appendLog("info", `${scenes.length} scenes (${loaded} loaded, ${failed} failed)`);

    await saveScenesToOpfs(scenes);
    startPipeline(scenes);
  } catch (err) {
    appendLog("error", `Fetch error: ${err}`);
    runBtn.disabled = false;
    statusEl.textContent = "Error";
  }
}

async function fetchScene(name: string, baseUrl: string): Promise<Scene> {
  const sourceUrl = `${baseUrl}/scenes/${name}.txt`;
  const fetchUrl = `/cors-proxy?url=${encodeURIComponent(sourceUrl)}`;
  try {
    const resp = await fetch(fetchUrl);
    const contentType = resp.headers.get("content-type") ?? "";
    const text = await resp.text();
    const isHtml = contentType.toLowerCase().includes("html");

    if (!resp.ok || isHtml) {
      return {
        sourceUrl,
        name,
        content: text,
        error: {
          message: isHtml
            ? "Response was HTML, not a ChoiceScript scene"
            : `${resp.status} ${resp.statusText}`,
          code: resp.status,
        },
        flow: [],
      };
    }

    return { sourceUrl, name, content: text, error: undefined, flow: [] };
  } catch (err) {
    return {
      sourceUrl,
      name,
      content: "",
      error: { message: String(err), code: 0 },
      flow: [],
    };
  }
}

async function saveScenesToOpfs(scenes: Scene[]) {
  try {
    const opfs = await OpfsIO.create();
    await opfs.writeFile("raw-scenes.json", JSON.stringify(scenes, null, 2));
    cachedScenes = scenes;
    savedCount = scenes.length;
    savedInfo.textContent = `${savedCount} scenes in OPFS`;
    tabSaved.classList.remove("disabled");
  } catch (err) {
    appendLog("warn", `Failed to save to OPFS: ${err}`);
  }
}

async function saveResultsToOpfs(files: Record<string, string>) {
  try {
    const opfs = await OpfsIO.create();
    for (const [path, content] of Object.entries(files)) {
      await opfs.writeFile(path, content);
    }
  } catch (err) {
    appendLog("warn", `Failed to save results to OPFS: ${err}`);
  }
}

// --- Pipeline ---

function makeWorker(): Worker {
  return new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
}

function startPipeline(scenes: Scene[]) {
  runBtn.disabled = true;
  statusEl.textContent = "Running…";

  if (worker) worker.terminate();
  worker = makeWorker();

  worker.onmessage = async (e) => {
    const msg = e.data;
    switch (msg.type) {
      case "log":
        appendLog(msg.level, msg.text);
        break;
      case "stage":
        appendLog("stage", `── ${msg.name} ──`);
        statusEl.textContent = msg.name;
        break;
      case "done":
        statusEl.textContent = `Done in ${msg.elapsed}ms`;
        runBtn.disabled = false;
        await saveResultsToOpfs(msg.files);
        showResults(msg.files);
        break;
      case "error":
        appendLog("error", msg.text);
        statusEl.textContent = "Error";
        runBtn.disabled = false;
        break;
    }
  };

  worker.onerror = (e) => {
    appendLog("error", `Worker error: ${e.message}`);
    statusEl.textContent = "Error";
    runBtn.disabled = false;
  };

  worker.postMessage({ type: "run", scenes });
}

// --- UI helpers ---

function appendLog(level: string, text: string) {
  const el = document.createElement("div");
  el.className = `log-${level}`;
  el.textContent = text;
  logPanel.appendChild(el);
  logPanel.scrollTop = logPanel.scrollHeight;
}

function showResults(files: Record<string, string>) {
  resultsPanel.innerHTML = "";

  const summaryMd = files["out/summary.md"];
  if (summaryMd) {
    const section = document.createElement("div");
    section.innerHTML = `<h2>Summary</h2>`;
    const rendered = document.createElement("div");
    rendered.className = "md-view";
    rendered.innerHTML = renderMarkdown(summaryMd);
    section.appendChild(rendered);
    resultsPanel.appendChild(section);
  }

  const outputFiles = Object.keys(files).sort();
  if (outputFiles.length > 0) {
    const section = document.createElement("div");
    section.innerHTML = `<h2>Output files (${outputFiles.length})</h2>`;
    for (const f of outputFiles) {
      if (f === "out/summary.md") continue;
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      const size = files[f].length;
      summary.textContent = `${f} (${formatSize(size)})`;
      details.appendChild(summary);
      const pre = document.createElement("pre");
      pre.textContent =
        files[f].length > 200_000
          ? files[f].slice(0, 200_000) + "\n… (truncated)"
          : files[f];
      details.appendChild(pre);
      section.appendChild(details);
    }
    resultsPanel.appendChild(section);
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// --- OPFS directory browser ---

browseBtn.addEventListener("click", browseOpfs);

async function browseOpfs() {
  resultsPanel.innerHTML = "<h2>Loading OPFS…</h2>";
  try {
    const opfs = await OpfsIO.create();
    const entries = await opfs.listAll();
    renderTree(entries);
  } catch (err) {
    appendLog("error", `Browse failed: ${err}`);
  }
}

function renderTree(entries: { path: string; size: number }[]) {
  resultsPanel.innerHTML = "";

  const totalSize = entries.reduce((sum, e) => sum + e.size, 0);
  const header = document.createElement("h2");
  header.textContent = `OPFS (${entries.length} files, ${formatSize(totalSize)})`;
  resultsPanel.appendChild(header);

  const grouped = new Map<string, { path: string; name: string; size: number }[]>();
  for (const e of entries) {
    const slash = e.path.lastIndexOf("/");
    const dir = slash === -1 ? "" : e.path.slice(0, slash);
    const name = slash === -1 ? e.path : e.path.slice(slash + 1);
    if (!grouped.has(dir)) grouped.set(dir, []);
    grouped.get(dir)!.push({ path: e.path, name, size: e.size });
  }

  const dirs = [...grouped.keys()].sort();

  const table = document.createElement("table");
  table.className = "opfs-table";
  table.innerHTML = `<thead><tr><th class="col-name">Name</th><th class="col-size">Size</th><th class="col-actions"></th></tr></thead>`;
  const tbody = document.createElement("tbody");

  for (const dir of dirs) {
    const files = grouped.get(dir)!.sort((a, b) => a.name.localeCompare(b.name));
    const dirSize = files.reduce((s, f) => s + f.size, 0);

    const dirRow = document.createElement("tr");
    dirRow.className = "dir-row";
    dirRow.innerHTML = `<td class="col-name" colspan="3"><span class="dir-toggle">▸</span> ${dir || "/"} <span class="size">(${files.length} files, ${formatSize(dirSize)})</span></td>`;

    const fileRows: HTMLTableRowElement[] = [];
    for (const f of files) {
      const tr = document.createElement("tr");
      tr.className = "file-row";
      const tdName = document.createElement("td");
      tdName.className = "col-name";
      const nameLink = document.createElement("a");
      nameLink.href = "#";
      nameLink.className = "file-link";
      nameLink.textContent = f.name;
      nameLink.addEventListener("click", (ev) => { ev.preventDefault(); viewOpfsFile(f.path); });
      tdName.appendChild(nameLink);
      const tdSize = document.createElement("td");
      tdSize.className = "col-size";
      tdSize.textContent = formatSize(f.size);
      const tdActions = document.createElement("td");
      tdActions.className = "col-actions";

      const dlLink = document.createElement("a");
      dlLink.href = "#";
      dlLink.textContent = "dl";
      dlLink.addEventListener("click", (ev) => { ev.preventDefault(); downloadOpfsFile(f.path); });

      tdActions.appendChild(dlLink);
      tr.append(tdName, tdSize, tdActions);
      fileRows.push(tr);
    }

    let open = true;
    dirRow.addEventListener("click", () => {
      open = !open;
      dirRow.querySelector(".dir-toggle")!.textContent = open ? "▾" : "▸";
      for (const r of fileRows) r.classList.toggle("hidden", !open);
    });
    dirRow.querySelector(".dir-toggle")!.textContent = "▾";

    tbody.appendChild(dirRow);
    for (const r of fileRows) tbody.appendChild(r);
  }

  table.appendChild(tbody);
  resultsPanel.appendChild(table);
}

async function readOpfsFile(path: string): Promise<string> {
  const opfs = await OpfsIO.create();
  return opfs.readFile(path);
}

async function viewOpfsFile(path: string) {
  try {
    const content = await readOpfsFile(path);
    resultsPanel.innerHTML = "";
    const header = document.createElement("h2");
    header.textContent = path;
    const back = document.createElement("a");
    back.className = "file-action";
    back.textContent = "back to tree";
    back.href = "#";
    back.addEventListener("click", (ev) => { ev.preventDefault(); browseOpfs(); });
    resultsPanel.append(header, back);

    if (path.endsWith(".svg")) {
      const container = document.createElement("div");
      container.className = "svg-view";
      container.innerHTML = content;
      resultsPanel.appendChild(container);
    } else if (path.endsWith(".md")) {
      const container = document.createElement("div");
      container.className = "md-view";
      container.innerHTML = renderMarkdown(content);
      resultsPanel.appendChild(container);
    } else {
      const pre = document.createElement("pre");
      pre.textContent = content.length > 500_000
        ? content.slice(0, 500_000) + "\n… (truncated)"
        : content;
      resultsPanel.appendChild(pre);
    }
  } catch (err) {
    appendLog("error", `View failed: ${err}`);
  }
}

function renderMarkdown(src: string): string {
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const lines = src.split("\n");
  const out: string[] = [];
  let inCode = false;
  let inList = false;

  for (const raw of lines) {
    if (raw.startsWith("```")) {
      if (inCode) { out.push("</code></pre>"); inCode = false; }
      else { out.push("<pre><code>"); inCode = true; }
      continue;
    }
    if (inCode) { out.push(escape(raw)); continue; }

    const line = raw;

    if (line.trim() === "") {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push("");
      continue;
    }

    const hMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (hMatch) {
      if (inList) { out.push("</ul>"); inList = false; }
      const level = hMatch[1].length;
      out.push(`<h${level}>${inlineMarkdown(escape(hMatch[2]))}</h${level}>`);
      continue;
    }

    const liMatch = line.match(/^(\s*)[-*]\s+(.*)/);
    if (liMatch) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${inlineMarkdown(escape(liMatch[2]))}</li>`);
      continue;
    }

    if (inList) { out.push("</ul>"); inList = false; }
    out.push(`<p>${inlineMarkdown(escape(line))}</p>`);
  }

  if (inCode) out.push("</code></pre>");
  if (inList) out.push("</ul>");
  return out.join("\n");
}

function inlineMarkdown(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
}

async function downloadOpfsFile(path: string) {
  try {
    const content = await readOpfsFile(path);
    const filename = path.split("/").pop() ?? "file";
    const blob = new Blob([content], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    appendLog("error", `Download failed: ${err}`);
  }
}
