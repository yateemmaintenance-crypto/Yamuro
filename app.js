/* ============================================================
   YAMURO Admin Desktop PWA
   Firebase + GAS Image Upload
   ============================================================ */

const CONFIG = {
  apiKey: "AIzaSyDG1qiy5NYm1maN4JFq1v-eRPMBe34qGcY",
  databaseURL: "https://yateemmaintenance-bfd95-default-rtdb.firebaseio.com",
  serviceGasUrl: "https://script.google.com/macros/s/AKfycbwEjCRv2hV33ivAzmBvmLCjl52mlew0Z9aZXA1hDeLplerdAuWJRZ-Q5AWENOjoQm_Y/exec",
  utilityGasUrl: "https://script.google.com/macros/s/AKfycbz4Cwm-Hmw8R5nMbM8DFaXIKBcnKQy2CLxCRipmg9D3ceV-RZ_oe2q14vRa9JtrIdC_4w/exec"
};

// ---------- STATE ----------
let currentUser = null;
let idToken = "";
let currentTab = "service";
let selectedRecordId = "";
let tableMode = "editable"; // "editable" | "readonly"
let masterCache = {}; // assetNo (lower) -> { date, asstCat, asstName, asstFlatNo, recordId }

const TYPE_OF_WORK = [
  "INSTALLATION", "REPAIR", "SERVICE", "REMOVAL", "REPLACEMENT",
  "TESTING", "CLEANING", "INSPECTION", "COATING", "FILLING"
];

const UTILITY_NAMES = [
  "KITCHEN MIXER", "BATHROOM MIXER", "TAP", "PAINT", "WC",
  "ZINC", "FAN", "WATER HEATER", "EXHAUST FAN", "OTHER"
];

// ---------- HELPERS ----------
function $(id) { return document.getElementById(id); }
function show(el) { if (el) el.classList.add("show"); }
function hide(el) { if (el) el.classList.remove("show"); }
function toast(msg, type = "") {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast show " + type;
  setTimeout(() => t.classList.remove("show"), 3200);
}
function loading(on) {
  $("loading").classList.toggle("show", on);
}
function today() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}
function formatDateDisplay(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}
function toIso(dmy) {
  if (!dmy) return "";
  if (dmy.includes("-") && dmy.length === 10 && dmy[4] === "-") return dmy;
  const p = dmy.split(/[-\/]/);
  if (p.length === 3) {
    if (p[0].length === 4) return dmy;
    return `${p[2]}-${p[1]}-${p[0]}`;
  }
  return dmy;
}
function escapeHtml(s) {
  if (s == null) return "";
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function escapeCSV(val) {
  if (val == null) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function downloadCSV(filename, columns, rows) {
  const header = columns.map(c => escapeCSV(c.label)).join(",");
  const lines = rows.map(row =>
    columns.map(c => escapeCSV(row[c.key] ?? "")).join(",")
  );
  const csv = [header, ...lines].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  toast("CSV downloaded", "success");
}

// Keep last table data for export
let lastTableData = { columns: [], rows: [], name: "export" };

// ---------- FIREBASE REST ----------
async function fbGet(path) {
  const url = `${CONFIG.databaseURL}/${path}.json?auth=${idToken}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}
async function fbPut(path, data) {
  const url = `${CONFIG.databaseURL}/${path}.json?auth=${idToken}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error(`PUT ${path} failed: ${res.status}`);
  return res.json();
}
async function fbDelete(path) {
  const url = `${CONFIG.databaseURL}/${path}.json?auth=${idToken}`;
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status}`);
  return true;
}
async function fbPost(path, data) {
  const url = `${CONFIG.databaseURL}/${path}.json?auth=${idToken}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return res.json();
}

// ---------- AUTH ----------
async function signIn(email, password) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${CONFIG.apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "Login failed");
  idToken = data.idToken;
  currentUser = {
    uid: data.localId,
    email: data.email,
    refreshToken: data.refreshToken
  };
  // fetch profile
  try {
    const profile = await fbGet(`users/${currentUser.uid}`);
    if (profile) {
      currentUser.username = profile.username || email.split("@")[0];
      currentUser.role = profile.role || "user";
      currentUser.accountId = profile.accountId || "";
    }
  } catch (e) {
    currentUser.username = email.split("@")[0];
    currentUser.role = "user";
  }
  localStorage.setItem("yamuro_token", idToken);
  localStorage.setItem("yamuro_user", JSON.stringify(currentUser));
  return currentUser;
}

async function tryAutoLogin() {
  const token = localStorage.getItem("yamuro_token");
  const user = localStorage.getItem("yamuro_user");
  if (!token || !user) return false;
  idToken = token;
  currentUser = JSON.parse(user);
  // quick check token still valid
  try {
    await fbGet("users/" + currentUser.uid);
    return true;
  } catch {
    localStorage.removeItem("yamuro_token");
    localStorage.removeItem("yamuro_user");
    return false;
  }
}

function signOut() {
  idToken = "";
  currentUser = null;
  localStorage.removeItem("yamuro_token");
  localStorage.removeItem("yamuro_user");
  location.reload();
}

// ---------- IMAGE UPLOAD ----------
async function uploadImage(file, gasUrl, tag) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64 = reader.result.split(",")[1];
        const payload = {
          action: "upload",
          image64: base64,
          filename: file.name || `img_${Date.now()}.jpg`
        };
        const res = await fetch(gasUrl, {
          method: "POST",
          body: JSON.stringify(payload)
        });
        const json = await res.json();
        if (json.status === "success") resolve(json.url || "");
        else reject(new Error(json.message || "Upload failed"));
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = () => reject(new Error("File read error"));
    reader.readAsDataURL(file);
  });
}

// ---------- VALIDATION ----------
function validateFlatNo(val) {
  if (!val || !val.trim()) return true; // optional in some forms
  const parts = val.trim().split("/");
  if (parts.length !== 2) return false;
  const [flat, bldg] = parts;
  if (!/^\d{2}$/.test(flat)) return false;
  if (!/^\d{3,4}$/.test(bldg)) return false;
  return true;
}

// ---------- MASTER CACHE ----------
async function loadMasterCache() {
  try {
    const data = await fbGet("MasterRecords");
    masterCache = {};
    if (data) {
      Object.keys(data).forEach(rid => {
        const r = data[rid];
        if (r && r.AssetNo) {
          masterCache[r.AssetNo.toLowerCase()] = {
            date: r.Date || "",
            asstCat: r.AsstCat || "",
            asstName: r.AsstName || "",
            asstFlatNo: r.AsstFlatNo || "",
            recordId: rid
          };
        }
      });
    }
  } catch (e) {
    console.warn("Master cache load failed", e);
  }
}

// ---------- UI INIT ----------
function initDropdowns() {
  const tow = $("svc-typeofwork");
  const utow = $("util-typeofwork");
  const uname = $("util-name");
  [tow, utow].forEach(sel => {
    if (!sel) return;
    sel.innerHTML = `<option value="">SELECT</option>` +
      TYPE_OF_WORK.map(t => `<option value="${t}">${t}</option>`).join("");
  });
  if (uname) {
    uname.innerHTML = `<option value="">SELECT</option>` +
      UTILITY_NAMES.map(t => `<option value="${t}">${t}</option>`).join("");
  }
}

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".panel").forEach(p => p.classList.toggle("active", p.id === "panel-" + tab));
  closeTable();
  resetForm(tab);
}

function resetForm(tab) {
  selectedRecordId = "";
  tableMode = "editable";
  if (tab === "service") {
    $("svc-date").value = today();
    $("svc-asstno").value = "";
    $("svc-typeofwork").value = "";
    $("svc-parts").value = "";
    $("svc-asstname").value = "";
    $("svc-flatno").value = "";
    $("svc-cost").value = "";
    $("svc-image").value = "";
    $("svc-image-url").value = "";
    $("svc-image-preview").innerHTML = "";
  } else if (tab === "utility") {
    $("util-date").value = today();
    $("util-name").value = "";
    $("util-specify").value = "";
    $("util-typeofwork").value = "";
    $("util-parts").value = "";
    $("util-flatno").value = "";
    $("util-cost").value = "";
    $("util-image").value = "";
    $("util-image-url").value = "";
    $("util-image-preview").innerHTML = "";
  } else if (tab === "master") {
    $("mst-date").value = today();
    $("mst-flatno").value = "";
    $("mst-asstno").value = "";
    $("mst-asstcat").value = "";
    $("mst-asstname").value = "";
  }
  updateFormButtons(tab);
}

function updateFormButtons(tab) {
  const isEdit = !!selectedRecordId;
  const prefix = tab === "service" ? "svc" : tab === "utility" ? "util" : "mst";
  const createBtn = $(prefix + "-btn-create");
  const editBtn = $(prefix + "-btn-edit");
  const deleteBtn = $(prefix + "-btn-delete");
  if (createBtn) createBtn.disabled = isEdit;
  if (editBtn) editBtn.disabled = !isEdit;
  if (deleteBtn) deleteBtn.disabled = !isEdit;
}

function fillFormFromRow(tab, row) {
  selectedRecordId = row.recordId || "";
  if (tab === "service") {
    $("svc-date").value = toIso(row.date) || today();
    $("svc-asstno").value = row.asstNo || "";
    $("svc-typeofwork").value = row.typeOfWork || "";
    $("svc-parts").value = row.partsUsed || "";
    $("svc-asstname").value = row.asstName || "";
    $("svc-flatno").value = row.flatNo || "";
    $("svc-cost").value = row.cost || "";
    $("svc-image-url").value = row.imageUrl || "";
    $("svc-image-preview").innerHTML = row.imageUrl
      ? `<a href="${escapeHtml(row.imageUrl)}" target="_blank" rel="noopener" style="color:var(--primary);font-weight:600;">View Image ↗</a>` : "";
  } else if (tab === "utility") {
    $("util-date").value = toIso(row.date) || today();
    $("util-name").value = row.utilityName || "";
    $("util-specify").value = row.specifyName || "";
    $("util-typeofwork").value = row.typeOfWork || "";
    $("util-parts").value = row.partsUsed || "";
    $("util-flatno").value = row.flatNo || "";
    $("util-cost").value = row.cost || "";
    $("util-image-url").value = row.imageUrl || "";
    $("util-image-preview").innerHTML = row.imageUrl
      ? `<a href="${escapeHtml(row.imageUrl)}" target="_blank" rel="noopener" style="color:var(--primary);font-weight:600;">View Image ↗</a>` : "";
  } else if (tab === "master") {
    $("mst-date").value = toIso(row.date) || today();
    $("mst-flatno").value = row.asstFlatNo || "";
    $("mst-asstno").value = row.assetNo || "";
    $("mst-asstcat").value = row.asstCat || "";
    $("mst-asstname").value = row.asstName || "";
  }
  updateFormButtons(tab);
}

// ---------- TABLE ----------
function closeTable() {
  document.querySelectorAll(".table-card").forEach(c => c.classList.remove("show"));
  tableMode = "editable";
}

function renderTable(containerId, columns, rows, readonly = false, exportName = "export") {
  const card = $(containerId);
  const thead = card.querySelector("thead");
  const tbody = card.querySelector("tbody");
  thead.innerHTML = "<tr>" + columns.map(c => `<th>${c.label}</th>`).join("") + "</tr>";
  tbody.innerHTML = "";
  lastTableData = { columns, rows, name: exportName };

  if (!rows.length) {
    tbody.innerHTML = `<tr class="readonly"><td colspan="${columns.length}" style="text-align:center;color:#64748b;padding:24px;">No records found</td></tr>`;
  } else {
    rows.forEach((row, idx) => {
      const tr = document.createElement("tr");
      if (readonly) tr.classList.add("readonly");
      tr.dataset.idx = idx;
      tr.innerHTML = columns.map(c => {
        const val = row[c.key] ?? "";
        // Make image URLs clickable
        if (c.key === "imageUrl" && val) {
          return `<td><a href="${escapeHtml(val)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">View Image</a></td>`;
        }
        return `<td>${escapeHtml(val)}</td>`;
      }).join("");
      if (!readonly) {
        tr.addEventListener("click", () => {
          tbody.querySelectorAll("tr").forEach(r => r.classList.remove("selected"));
          tr.classList.add("selected");
          fillFormFromRow(currentTab, row);
        });
      }
      tbody.appendChild(tr);
    });
  }
  card.classList.add("show");
  tableMode = readonly ? "readonly" : "editable";
}

// ---------- SEARCH / LOAD DATA ----------
async function searchService() {
  loading(true);
  try {
    const q = ($("svc-search").value || "").trim().toLowerCase();
    const from = $("svc-from").value;
    const to = $("svc-to").value;
    const advance = $("svc-advance").checked;

    const data = await fbGet("ServiceRecords");
    let rows = [];
    if (data) {
      Object.keys(data).forEach(assetKey => {
        const records = data[assetKey];
        if (!records) return;
        Object.keys(records).forEach(rid => {
          const r = records[rid];
          if (!r) return;
          const row = {
            recordId: rid,
            date: r.Date || "",
            asstNo: r.AsstNo || assetKey,
            asstName: r.AsstName || "",
            flatNo: r.FlatNo || "",
            typeOfWork: r.TypeOfWork || "",
            partsUsed: r.PartsUsed || "",
            cost: r.Cost || "",
            imageUrl: r.ImageURL || ""
          };
          // filters
          if (advance) {
            if (from && toIso(row.date) < from) return;
            if (to && toIso(row.date) > to) return;
          }
          if (q) {
            const blob = Object.values(row).join(" ").toLowerCase();
            if (!blob.includes(q)) return;
          }
          rows.push(row);
        });
      });
    }
    rows.sort((a, b) => toIso(b.date).localeCompare(toIso(a.date)));
    renderTable("svc-table", [
      { key: "date", label: "Date" },
      { key: "asstNo", label: "Asst.No" },
      { key: "asstName", label: "Asst.Name" },
      { key: "flatNo", label: "Flat.No" },
      { key: "typeOfWork", label: "Type of Work" },
      { key: "partsUsed", label: "Parts Used" },
      { key: "cost", label: "Cost" },
      { key: "imageUrl", label: "Image" }
    ], rows, false, "Service_Records");
  } catch (e) {
    toast(e.message || "Search failed", "error");
  } finally {
    loading(false);
  }
}

async function searchUtility() {
  loading(true);
  try {
    const q = ($("util-search").value || "").trim().toLowerCase();
    const from = $("util-from").value;
    const to = $("util-to").value;
    const advance = $("util-advance").checked;

    const data = await fbGet("UtilityRecords");
    let rows = [];
    if (data) {
      Object.keys(data).forEach(ym => {
        const monthObj = data[ym];
        if (!monthObj) return;
        Object.keys(monthObj).forEach(rid => {
          const r = monthObj[rid];
          if (!r) return;
          const row = {
            recordId: rid,
            yearMonth: ym,
            date: r.Date || "",
            utilityName: r.UtilityName || "",
            specifyName: r.SpecifyName || "",
            typeOfWork: r.TypeOfWork || "",
            partsUsed: r.PartsUsed || "",
            cost: r.Cost || "",
            flatNo: r.FlatNo || "",
            imageUrl: r.ImageURL || ""
          };
          if (advance) {
            if (from && toIso(row.date) < from) return;
            if (to && toIso(row.date) > to) return;
          }
          if (q) {
            const blob = Object.values(row).join(" ").toLowerCase();
            if (!blob.includes(q)) return;
          }
          rows.push(row);
        });
      });
    }
    rows.sort((a, b) => toIso(b.date).localeCompare(toIso(a.date)));
    renderTable("util-table", [
      { key: "date", label: "Date" },
      { key: "utilityName", label: "Utility Name" },
      { key: "specifyName", label: "Specify" },
      { key: "typeOfWork", label: "Type of Work" },
      { key: "partsUsed", label: "Parts Used" },
      { key: "flatNo", label: "Flat.No" },
      { key: "cost", label: "Cost" },
      { key: "imageUrl", label: "Image" }
    ], rows, false, "Utility_Records");
  } catch (e) {
    toast(e.message || "Search failed", "error");
  } finally {
    loading(false);
  }
}

async function searchMaster() {
  loading(true);
  try {
    const q = ($("mst-search").value || "").trim().toLowerCase();
    const from = $("mst-from").value;
    const to = $("mst-to").value;
    const advance = $("mst-advance").checked;

    const data = await fbGet("MasterRecords");
    let rows = [];
    if (data) {
      Object.keys(data).forEach(rid => {
        const r = data[rid];
        if (!r) return;
        const row = {
          recordId: rid,
          date: r.Date || "",
          assetNo: r.AssetNo || "",
          asstCat: r.AsstCat || "",
          asstName: r.AsstName || "",
          asstFlatNo: r.AsstFlatNo || ""
        };
        if (advance) {
          if (from && toIso(row.date) < from) return;
          if (to && toIso(row.date) > to) return;
        }
        if (q) {
          const blob = Object.values(row).join(" ").toLowerCase();
          if (!blob.includes(q)) return;
        }
        rows.push(row);
      });
    }
    rows.sort((a, b) => (a.assetNo || "").localeCompare(b.assetNo || ""));
    renderTable("mst-table", [
      { key: "date", label: "Date" },
      { key: "assetNo", label: "Asst.No" },
      { key: "asstCat", label: "Asst.Cat" },
      { key: "asstName", label: "Asst.Name" },
      { key: "asstFlatNo", label: "Flat.No" }
    ], rows, false, "Master_Records");
  } catch (e) {
    toast(e.message || "Search failed", "error");
  } finally {
    loading(false);
  }
}

async function loadAllAssets() {
  loading(true);
  try {
    const data = await fbGet("MasterRecords");
    let rows = [];
    if (data) {
      Object.keys(data).forEach(rid => {
        const r = data[rid];
        if (!r) return;
        rows.push({
          recordId: rid,
          date: r.Date || "",
          assetNo: r.AssetNo || "",
          asstCat: r.AsstCat || "",
          asstName: r.AsstName || "",
          asstFlatNo: r.AsstFlatNo || ""
        });
      });
    }
    rows.sort((a, b) => (a.assetNo || "").localeCompare(b.assetNo || ""));
    renderTable("mst-table", [
      { key: "date", label: "Date" },
      { key: "assetNo", label: "Asst.No" },
      { key: "asstCat", label: "Asst.Cat" },
      { key: "asstName", label: "Asst.Name" },
      { key: "asstFlatNo", label: "Flat.No" }
    ], rows, true, "All_Assets");
    toast(`Loaded ${rows.length} assets (read-only)`);
  } catch (e) {
    toast(e.message || "Failed to load assets", "error");
  } finally {
    loading(false);
  }
}

async function loadRemovedAssets() {
  loading(true);
  try {
    const data = await fbGet("DeletedMaster");
    let rows = [];
    if (data) {
      Object.keys(data).forEach(rid => {
        const r = data[rid];
        if (!r) return;
        rows.push({
          recordId: rid,
          date: r.Date || "",
          asstNo: r.AsstNo || "",
          asstName: r.AsstName || "",
          asstCat: r.AsstCat || "",
          username: r.Username || "",
          accountId: r.AccountId || ""
        });
      });
    }
    rows.sort((a, b) => toIso(b.date).localeCompare(toIso(a.date)));
    renderTable("mst-table", [
      { key: "date", label: "Date" },
      { key: "asstNo", label: "Asst.No" },
      { key: "asstName", label: "Asst.Name" },
      { key: "asstCat", label: "Asst.Cat" },
      { key: "username", label: "Removed By" },
      { key: "accountId", label: "Account Id" }
    ], rows, true, "Removed_Assets");
    toast(`Loaded ${rows.length} removed assets (read-only)`);
  } catch (e) {
    toast(e.message || "Failed to load removed assets", "error");
  } finally {
    loading(false);
  }
}

// ---------- CRUD SERVICE ----------
async function saveService(isEdit) {
  const date = $("svc-date").value;
  const asstNo = ($("svc-asstno").value || "").trim();
  const typeOfWork = $("svc-typeofwork").value;
  const parts = ($("svc-parts").value || "").trim();
  const asstName = ($("svc-asstname").value || "").trim();
  const flatNo = ($("svc-flatno").value || "").trim();
  const cost = ($("svc-cost").value || "").trim();
  let imageUrl = ($("svc-image-url").value || "").trim();

  if (!date || !asstNo || !typeOfWork) {
    toast("Date, Asst.No and Type of Work are required", "error");
    return;
  }
  if (flatNo && !validateFlatNo(flatNo)) {
    toast("Flat.No must be in format XX/XXX or XX/XXXX (e.g. 12/1145)", "error");
    return;
  }

  loading(true);
  try {
    // image upload if new file selected
    const fileInput = $("svc-image");
    if (fileInput.files && fileInput.files[0]) {
      imageUrl = await uploadImage(fileInput.files[0], CONFIG.serviceGasUrl, "service");
      $("svc-image-url").value = imageUrl;
    }

    const payload = {
      RecordID: isEdit ? selectedRecordId : "",
      Date: formatDateDisplay(date),
      AsstNo: asstNo,
      AsstName: asstName,
      FlatNo: flatNo,
      TypeOfWork: typeOfWork,
      PartsUsed: parts,
      Cost: cost,
      ImageURL: imageUrl
    };

    if (isEdit) {
      const encoded = encodeURIComponent(asstNo).replace(/%20/g, "%20");
      await fbPut(`ServiceRecords/${asstNo}/${selectedRecordId}`, {
        ...payload,
        RecordID: selectedRecordId
      });
      toast("Service record updated", "success");
    } else {
      // uniqueness: same AsstNo + Date
      const all = await fbGet("ServiceRecords");
      if (all) {
        for (const ak of Object.keys(all)) {
          const recs = all[ak];
          for (const rid of Object.keys(recs || {})) {
            const r = recs[rid];
            if (r && r.AsstNo && r.AsstNo.toLowerCase() === asstNo.toLowerCase() &&
                (r.Date || "") === payload.Date) {
              throw new Error("Service already exists for this AssetNo on this Date.");
            }
          }
        }
      }
      const newId = Date.now() + "_" + Math.floor(Math.random() * 1000);
      payload.RecordID = newId;
      await fbPut(`ServiceRecords/${asstNo}/${newId}`, payload);
      toast("Service record created", "success");
    }
    resetForm("service");
    closeTable();
  } catch (e) {
    toast(e.message || "Save failed", "error");
  } finally {
    loading(false);
  }
}

async function deleteService() {
  if (!selectedRecordId) return;
  const asstNo = ($("svc-asstno").value || "").trim();
  if (!confirm("Delete this service record?")) return;
  loading(true);
  try {
    await fbDelete(`ServiceRecords/${asstNo}/${selectedRecordId}`);
    toast("Service record deleted", "success");
    resetForm("service");
    closeTable();
  } catch (e) {
    toast(e.message || "Delete failed", "error");
  } finally {
    loading(false);
  }
}

// ---------- CRUD UTILITY ----------
async function saveUtility(isEdit) {
  const date = $("util-date").value;
  const utilityName = $("util-name").value;
  const specify = ($("util-specify").value || "").trim();
  const typeOfWork = $("util-typeofwork").value;
  const parts = ($("util-parts").value || "").trim();
  const flatNo = ($("util-flatno").value || "").trim();
  const cost = ($("util-cost").value || "").trim();
  let imageUrl = ($("util-image-url").value || "").trim();

  if (!date || !utilityName || !typeOfWork) {
    toast("Date, Utility Name and Type of Work are required", "error");
    return;
  }
  if (flatNo && !validateFlatNo(flatNo)) {
    toast("Flat.No must be in format XX/XXX or XX/XXXX (e.g. 12/1145)", "error");
    return;
  }

  const dmy = formatDateDisplay(date);
  const yearMonth = date.slice(0, 7); // yyyy-mm

  loading(true);
  try {
    const fileInput = $("util-image");
    if (fileInput.files && fileInput.files[0]) {
      imageUrl = await uploadImage(fileInput.files[0], CONFIG.utilityGasUrl, "utility");
      $("util-image-url").value = imageUrl;
    }

    const payload = {
      RecordID: isEdit ? selectedRecordId : "",
      Date: dmy,
      UtilityName: utilityName,
      SpecifyName: specify,
      TypeOfWork: typeOfWork,
      PartsUsed: parts,
      Cost: cost,
      FlatNo: flatNo,
      ImageURL: imageUrl
    };

    if (isEdit) {
      // need yearMonth of original – we store it when filling
      const ym = $("util-yearmonth") ? $("util-yearmonth").value : yearMonth;
      await fbPut(`UtilityRecords/${ym}/${selectedRecordId}`, {
        ...payload,
        RecordID: selectedRecordId
      });
      toast("Utility record updated", "success");
    } else {
      // uniqueness check
      const all = await fbGet("UtilityRecords");
      if (all) {
        for (const ym of Object.keys(all)) {
          const month = all[ym];
          for (const rid of Object.keys(month || {})) {
            const r = month[rid];
            if (r && r.Date === dmy &&
                (r.UtilityName || "").toLowerCase() === utilityName.toLowerCase() &&
                (r.SpecifyName || "").toLowerCase() === specify.toLowerCase() &&
                (r.FlatNo || "").toLowerCase() === flatNo.toLowerCase()) {
              throw new Error("Utility record already exists for this Date + Utility + Flat.");
            }
          }
        }
      }
      const newId = Date.now() + "_" + Math.floor(Math.random() * 1000);
      payload.RecordID = newId;
      await fbPut(`UtilityRecords/${yearMonth}/${newId}`, payload);
      toast("Utility record created", "success");
    }
    resetForm("utility");
    closeTable();
  } catch (e) {
    toast(e.message || "Save failed", "error");
  } finally {
    loading(false);
  }
}

async function deleteUtility() {
  if (!selectedRecordId) return;
  const date = $("util-date").value;
  const yearMonth = date ? date.slice(0, 7) : ($("util-yearmonth")?.value || "");
  if (!yearMonth) {
    toast("Cannot determine record path", "error");
    return;
  }
  if (!confirm("Delete this utility record?")) return;
  loading(true);
  try {
    await fbDelete(`UtilityRecords/${yearMonth}/${selectedRecordId}`);
    toast("Utility record deleted", "success");
    resetForm("utility");
    closeTable();
  } catch (e) {
    toast(e.message || "Delete failed", "error");
  } finally {
    loading(false);
  }
}

// ---------- CRUD MASTER ----------
async function saveMaster(isEdit) {
  const date = $("mst-date").value;
  const flatNo = ($("mst-flatno").value || "").trim();
  const assetNo = ($("mst-asstno").value || "").trim();
  const asstCat = ($("mst-asstcat").value || "").trim();
  const asstName = ($("mst-asstname").value || "").trim();

  if (!date || !assetNo || !asstName) {
    toast("Date, Asst.No and Asst.Name are required", "error");
    return;
  }
  if (flatNo && !validateFlatNo(flatNo)) {
    toast("Flat.No must be in format XX/XXX or XX/XXXX (e.g. 12/1145)", "error");
    return;
  }

  loading(true);
  try {
    if (!isEdit) {
      // uniqueness
      const all = await fbGet("MasterRecords");
      if (all) {
        for (const rid of Object.keys(all)) {
          const r = all[rid];
          if (r && r.AssetNo && r.AssetNo.toLowerCase() === assetNo.toLowerCase()) {
            throw new Error("AssetNo already exists. Duplicate not allowed.");
          }
        }
      }
    } else {
      // when editing, still check uniqueness against other records
      const all = await fbGet("MasterRecords");
      if (all) {
        for (const rid of Object.keys(all)) {
          if (rid === selectedRecordId) continue;
          const r = all[rid];
          if (r && r.AssetNo && r.AssetNo.toLowerCase() === assetNo.toLowerCase()) {
            throw new Error("AssetNo already exists. Duplicate not allowed.");
          }
        }
      }
    }

    const payload = {
      RecordID: isEdit ? selectedRecordId : "",
      Date: formatDateDisplay(date),
      AssetNo: assetNo,
      AsstCat: asstCat,
      AsstName: asstName,
      AsstFlatNo: flatNo
    };

    if (isEdit) {
      payload.RecordID = selectedRecordId;
      await fbPut(`MasterRecords/${selectedRecordId}`, payload);
      toast("Master record updated", "success");
    } else {
      const newId = Date.now() + "_" + Math.floor(Math.random() * 1000);
      payload.RecordID = newId;
      await fbPut(`MasterRecords/${newId}`, payload);
      toast("Master record created", "success");
    }
    await loadMasterCache();
    resetForm("master");
    closeTable();
  } catch (e) {
    toast(e.message || "Save failed", "error");
  } finally {
    loading(false);
  }
}

async function deleteMaster() {
  if (!selectedRecordId) return;
  if (!confirm("Delete this master record? It will be moved to Removed Assets history.")) return;
  loading(true);
  try {
    const assetNo = ($("mst-asstno").value || "").trim();
    const asstName = ($("mst-asstname").value || "").trim();
    const asstCat = ($("mst-asstcat").value || "").trim();

    // log to DeletedMaster
    const histId = Date.now() + "_" + Math.floor(Math.random() * 1000);
    await fbPut(`DeletedMaster/${histId}`, {
      Date: formatDateDisplay(today()),
      AsstNo: assetNo,
      AsstName: asstName,
      AsstCat: asstCat,
      Username: currentUser?.username || "",
      AccountId: currentUser?.accountId || ""
    });

    await fbDelete(`MasterRecords/${selectedRecordId}`);
    await loadMasterCache();
    toast("Master record deleted & logged", "success");
    resetForm("master");
    closeTable();
  } catch (e) {
    toast(e.message || "Delete failed", "error");
  } finally {
    loading(false);
  }
}

// ---------- AUTO FETCH (Service) ----------
async function onServiceAsstNoBlur() {
  const asstNo = ($("svc-asstno").value || "").trim();
  if (!asstNo) return;
  const key = asstNo.toLowerCase();
  if (masterCache[key]) {
    $("svc-asstname").value = masterCache[key].asstName || "";
    $("svc-flatno").value = masterCache[key].asstFlatNo || "";
    return;
  }
  // try live fetch
  try {
    const data = await fbGet("MasterRecords");
    if (data) {
      for (const rid of Object.keys(data)) {
        const r = data[rid];
        if (r && r.AssetNo && r.AssetNo.toLowerCase() === key) {
          $("svc-asstname").value = r.AsstName || "";
          $("svc-flatno").value = r.AsstFlatNo || "";
          masterCache[key] = {
            asstName: r.AsstName || "",
            asstFlatNo: r.AsstFlatNo || "",
            recordId: rid
          };
          return;
        }
      }
    }
    toast("Asset number not found in Master", "error");
    $("svc-asstname").value = "";
    $("svc-flatno").value = "";
  } catch (e) {
    console.warn(e);
  }
}

// ---------- MASTER ASSTNO CHECK ----------
async function onMasterAsstNoBlur() {
  const asstNo = ($("mst-asstno").value || "").trim();
  if (!asstNo || selectedRecordId) return; // skip if editing
  try {
    const data = await fbGet("MasterRecords");
    if (data) {
      for (const rid of Object.keys(data)) {
        const r = data[rid];
        if (r && r.AssetNo && r.AssetNo.toLowerCase() === asstNo.toLowerCase()) {
          toast("Asset number already exists. Duplicates not allowed.", "error");
          $("mst-asstno").value = "";
          return;
        }
      }
    }
  } catch (e) {
    console.warn(e);
  }
}

// ---------- EVENT BINDINGS ----------
function bindEvents() {
  // Tabs
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  // Account menu
  $("account-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    $("account-menu").classList.toggle("open");
  });
  document.addEventListener("click", () => $("account-menu").classList.remove("open"));

  $("btn-signout").addEventListener("click", signOut);

  // Advance toggles
  ["svc", "util", "mst"].forEach(p => {
    const chk = $(p + "-advance");
    if (chk) {
      chk.addEventListener("change", () => {
        $(p + "-advance-panel").classList.toggle("show", chk.checked);
      });
    }
  });

  // Search buttons
  $("svc-btn-search").addEventListener("click", searchService);
  $("util-btn-search").addEventListener("click", searchUtility);
  $("mst-btn-search").addEventListener("click", searchMaster);

  // Close table
  document.querySelectorAll(".btn-close-table").forEach(b => {
    b.addEventListener("click", closeTable);
  });

  // Export CSV
  document.querySelectorAll(".btn-export-csv").forEach(b => {
    b.addEventListener("click", () => {
      if (!lastTableData.rows || !lastTableData.rows.length) {
        toast("No data to export", "error");
        return;
      }
      const name = (lastTableData.name || "export") + "_" + today() + ".csv";
      downloadCSV(name, lastTableData.columns, lastTableData.rows);
    });
  });

  // Service CRUD
  $("svc-btn-create").addEventListener("click", () => saveService(false));
  $("svc-btn-edit").addEventListener("click", () => saveService(true));
  $("svc-btn-delete").addEventListener("click", deleteService);
  $("svc-btn-reset").addEventListener("click", () => resetForm("service"));
  $("svc-asstno").addEventListener("blur", onServiceAsstNoBlur);

  // Utility CRUD
  $("util-btn-create").addEventListener("click", () => saveUtility(false));
  $("util-btn-edit").addEventListener("click", () => saveUtility(true));
  $("util-btn-delete").addEventListener("click", deleteUtility);
  $("util-btn-reset").addEventListener("click", () => resetForm("utility"));

  // Master CRUD
  $("mst-btn-create").addEventListener("click", () => saveMaster(false));
  $("mst-btn-edit").addEventListener("click", () => saveMaster(true));
  $("mst-btn-delete").addEventListener("click", deleteMaster);
  $("mst-btn-reset").addEventListener("click", () => resetForm("master"));
  $("mst-asstno").addEventListener("blur", onMasterAsstNoBlur);
  $("mst-btn-assets").addEventListener("click", loadAllAssets);
  $("mst-btn-removed").addEventListener("click", loadRemovedAssets);

  // Login
  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("login-email").value.trim();
    const password = $("login-password").value;
    if (!email || !password) return;
    loading(true);
    try {
      await signIn(email, password);
      $("login-screen").style.display = "none";
      $("app").style.display = "flex";
      updateUserUI();
      await loadMasterCache();
      resetForm("service");
      toast("Welcome, " + (currentUser.username || currentUser.email), "success");
    } catch (err) {
      toast(err.message || "Login failed", "error");
    } finally {
      loading(false);
    }
  });
}

function updateUserUI() {
  if (!currentUser) return;
  const name = currentUser.username || currentUser.email || "User";
  $("user-name").textContent = name;
  const menuName = $("user-name-menu");
  if (menuName) menuName.textContent = name;
  $("user-email").textContent = currentUser.email || "";
  $("user-role").textContent = (currentUser.role || "user").toUpperCase();
  $("user-account").textContent = currentUser.accountId || "";
  const av = $("profile-avatar");
  if (av) av.textContent = name[0].toUpperCase();
  const su = $("settings-username");
  if (su) su.textContent = name;
  const se = $("settings-email");
  if (se) se.textContent = currentUser.email || "";
}

// make switchTab available globally for inline handlers
window.switchTab = switchTab;
window.signOut = signOut;

// ---------- BOOT ----------
async function boot() {
  initDropdowns();
  bindEvents();

  const ok = await tryAutoLogin();
  if (ok) {
    $("login-screen").style.display = "none";
    $("app").style.display = "flex";
    updateUserUI();
    await loadMasterCache();
    resetForm("service");
  } else {
    $("login-screen").style.display = "flex";
    $("app").style.display = "none";
  }
}

document.addEventListener("DOMContentLoaded", boot);

// Service worker
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
