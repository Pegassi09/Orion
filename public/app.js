/** Cliente SPA: estado, chamadas autenticadas e comportamentos da interface. */
let csrf = "",
  page = 1,
  pages = 1,
  editing = null,
  charts = [];
// Metadados únicos do formulário, usados para gerar inputs sem duplicar HTML.
const fields = [
  ["hostname", "Nome do computador *"],
  ["department", "Departamento *"],
  ["location", "Localização *"],
  ["responsible", "Responsável *"],
  ["proprietary", "Proprietário"],
  ["brand", "Marca *"],
  ["model", "Modelo *"],
  ["serial_number", "Número de Série *"],
  ["processor", "Processador *"],
  ["ram_gb", "Memória RAM (GB) *", "number"],
  ["ram_type", "Tipo de memória", "select", "DDR3|DDR4|DDR5"],
  [
    "storage_type",
    "Armazenamento principal *",
    "select",
    "HD|SSD SATA|SSD NVMe",
  ],
  ["storage_capacity", "Capacidade do armazenamento *"],
  ["operating_system", "Sistema Operacional *"],
  ["windows_version", "Versão Windows"],
  ["windows_build", "Build"],
  ["ip_address", "Endereço IP ou MAC"],
  ["computer_password", "Senha do computador", "password"],
];
const $ = (s) => document.querySelector(s);
// Safe binding helper: no-op if element missing
const bind = (selector, event, listener) => {
  const el = document.querySelector(selector);
  if (!el) return null;
  el.addEventListener(event, listener);
  return el;
};
// Cliente fetch centralizado: inclui CSRF e padroniza mensagens de erro.
const api = async (url, opt = {}) => {
  opt.headers = {
    ...(opt.headers || {}),
    "Content-Type": "application/json",
    ...(csrf ? { "X-CSRF-Token": csrf } : {}),
  };
  const r = await fetch(url, opt);
  if (!r.ok)
    throw new Error(
      (await r.json().catch(() => ({}))).error || "Erro na operação",
    );
  return r.headers.get("content-type")?.includes("json") ? r.json() : r;
};
function toast(message, type = "success") {
  const d = document.createElement("div");
  d.className = `toast rounded-xl px-4 py-3 text-sm font-medium shadow-lg ${type === "success" ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"}`;
  d.textContent = message;
  $("#toastRoot").append(d);
  setTimeout(() => d.remove(), 3500);
}
function icon() {
  lucide.createIcons();
}
function download(u) {
  window.open(u, "_blank");
}
function resetAuthView() {
  $("#authFormShell").classList.add("hidden");
  $("#authSub").textContent = "Escolha uma opção para continuar";
  document.querySelectorAll(".auth-flow-btn").forEach((btn) => btn.classList.remove("active"));
}
function setAuthView(mode) {
  const isSignup = mode === "signup";
  $("#authFormShell").classList.remove("hidden");
  document.querySelectorAll(".auth-flow-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.flow === mode);
  });
  $("#setupName").classList.toggle("hidden", !isSignup);
  $("#setupCompany").classList.toggle("hidden", !isSignup);
  $("#authSub").textContent = isSignup
    ? "Crie sua conta para começar"
    : "Entre com suas credenciais";
  $("#loginForm").dataset.setup = String(isSignup);
  $("#submitButton").textContent = isSignup ? "Criar conta" : "Entrar com segurança";
  location.hash = isSignup ? "#signup" : "#login";
}
function syncAuthView() {
  if (location.hash === "#signup") return setAuthView("signup");
  if (location.hash === "#login") return setAuthView("login");
  return resetAuthView();
}
// Decide entre tela de acesso e aplicação autenticada.
async function boot() {
  const s = await api("/api/auth/status");
  if (!s.user) {
    $("#auth").classList.remove("hidden");
    syncAuthView();
    return;
  }
  csrf = s.csrf;
  $("#auth").classList.add("hidden");
  $("#app").classList.remove("hidden");
  $("#userName").textContent = s.user.name;
  await dashboard();
  icon();
}
bind("#loginForm", "submit", async (e) => {
  e.preventDefault();
  let f = Object.fromEntries(new FormData(e.target));
  if (f.companyName) f.companyName = f.companyName.trim();
  try {
    const r = await api(
      e.target.dataset.setup === "true" ? "/api/auth/setup" : "/api/auth/login",
      { method: "POST", body: JSON.stringify(f) },
    );
    csrf = r.csrf;
    boot();
  } catch (e) {
    toast(e.message, "error");
  }
});
bind("#flowLogin", "click", () => setAuthView("login"));
bind("#flowSignup", "click", () => setAuthView("signup"));
window.addEventListener("hashchange", () => {
  if (!$("#auth").classList.contains("hidden")) syncAuthView();
});
bind("#logout", "click", async () => {
  await api("/api/auth/logout", { method: "POST" });
  location.reload();
});
bind("#theme", "click", () => {
  document.documentElement.classList.toggle("dark");
  localStorage.theme = document.documentElement.classList.contains("dark")
    ? "dark"
    : "light";
});
if (localStorage.theme === "dark") document.documentElement.classList.add("dark");
bind("#menu", "click", () => $("#sidebar").classList.toggle("-translate-x-full"));
// Attach navigation handlers
document.querySelectorAll("[data-page]").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll("[data-page]").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    ["dashboard", "inventory", "reports"].forEach((x) =>
      $("#" + x + "Page").classList.toggle("hidden", x !== b.dataset.page),
    );
    $("#title").textContent = {
      dashboard: "Visão geral",
      inventory: "Computadores",
      reports: "Exportações",
    }[b.dataset.page];
    if (b.dataset.page === "inventory") {
      page = 1;
      load();
    }
  });
});
// Atualiza gráficos do dashboard descartando a instância anterior.
function graph(id, data, type = "bar") {
  let c = $(id);
  charts.find((x) => x.canvas === c)?.destroy();
  let ch = new Chart(c, {
    type,
    data: {
      labels: data.map((x) => x.label || "Não informado"),
      datasets: [
        {
          data: data.map((x) => x.value),
          backgroundColor: [
            "#2563eb",
            "#14b8a6",
            "#8b5cf6",
            "#f59e0b",
            "#ef4444",
            "#06b6d4",
          ],
        },
      ],
    },
    options: {
      plugins: { legend: { display: type === "doughnut" } },
      responsive: true,
      maintainAspectRatio: true,
    },
  });
  charts.push(ch);
}
async function dashboard() {
  const s = await api("/api/computers/stats");
  const cards = [
    ["Total de computadores", s.total, "laptop", "#2563eb"],
    ["Departamentos", s.department.length, "building-2", "#8b5cf6"],
    ["Marcas", s.brand.length, "badge-check", "#06b6d4"],
    ["Sistemas operacionais", s.operating_system.length, "monitor", "#10b981"],
    ["Tipos de armazenamento", s.storage.length, "hard-drive", "#f59e0b"],
  ];
  $("#cards").innerHTML = cards
    .map(
      (x) =>
        `<div class="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"><div class="flex justify-between"><span class="text-sm text-slate-500">${x[0]}</span><i data-lucide="${x[2]}" style="color:${x[3]}" class="h-5 w-5"></i></div><b class="mt-3 block text-3xl">${x[1]}</b></div>`,
    )
    .join("");
  graph("#departmentChart", s.department);
  graph("#statusChart", s.storage, "doughnut");
  graph("#osChart", s.operating_system);
  graph("#ramChart", s.ram);
  icon();
}
// Carrega a tabela respeitando filtros e paginação atuais.
async function load() {
  let p = new URLSearchParams({
    page,
    limit: 10,
    q: $("#search").value,
    department: $("#fDept").value,
    brand: $("#fBrand").value,
  });
  const r = await api("/api/computers?" + p);
  pages = r.pages || 1;
  $("#counter").textContent = `${r.total} computador(es) encontrado(s)`;
  $("#rows").innerHTML = r.rows.length
    ? r.rows
        .map((c) => {
          const id = c.id;
          return `<tr class="border-t border-slate-100 dark:border-slate-800">
            <td><b>${c.hostname}</b><small class="block text-slate-500">${c.brand} ${c.model}</small></td>
            <td>${c.department}</td>
            <td>${c.location}</td>
            <td>${c.responsible}</td>
            <td>${c.operating_system}</td>
            <td>${c.processor}<small class="block text-slate-500">${c.ram_gb} GB • ${c.storage_type}</small></td>
            <td>${c.ip_address || "—"}</td>
            <td>
              <div class="flex gap-1">
                <button type="button" title="Visualizar" data-action="view" data-id="${id}"><i data-lucide="eye"></i></button>
                <button type="button" title="Editar" data-action="edit" data-id="${id}"><i data-lucide="pencil"></i></button>
                <button type="button" title="Duplicar" data-action="duplicate" data-id="${id}"><i data-lucide="copy"></i></button>
                <button type="button" title="PDF" data-action="pdf" data-id="${id}"><i data-lucide="file-text"></i></button>
                <button type="button" title="Excluir" class="text-rose-600" data-action="remove" data-id="${id}"><i data-lucide="trash-2"></i></button>
              </div>
            </td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="8" class="py-12 text-center text-slate-500">Nenhum computador encontrado.</td></tr>`;
  $("#pagination").textContent = `Página ${page} de ${pages}`;
  $("#prev").disabled = page <= 1;
  $("#next").disabled = page >= pages;
  icon();
  populateFilters(r.rows);
}
function populateFilters(rows) {
  for (const [id, k] of [
    ["fDept", "department"],
    ["fBrand", "brand"],
  ]) {
    const s = $("#" + id),
      v = s.value;
    [...new Set(rows.map((x) => x[k]).filter(Boolean))].forEach((x) => {
      if (![...s.options].some((o) => o.value === x)) s.add(new Option(x, x));
    });
    s.value = v;
  }
}
bind("#search", "input", debounce(() => {
  page = 1;
  load();
}, 250));
["fDept", "fBrand"].forEach((x) =>
  bind("#" + x, "change", () => {
    page = 1;
    load();
  }),
);
bind("#prev", "click", () => {
  if (page > 1) {
    page--;
    load();
  }
});
bind("#next", "click", () => {
  if (page < pages) {
    page++;
    load();
  }
});
// action buttons
bind("#newComputer", "click", () => openForm());
bind("#importBtn", "click", () => $("#importFile").click());
bind("#exportPdf", "click", () => download("/api/export/pdf"));
bind("#exportCsv", "click", () => download("/api/export/csv"));
bind("#exportExcel", "click", () => download("/api/export/excel"));
bind("#backup", "click", () => download("/api/backup"));
// Delegated handler for buttons with data-action, including close-modal
const actionRoot = document.documentElement;
actionRoot.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  const id = btn.dataset.id;
  try {
    if (action === "view") return window.view(id);
    if (action === "edit") return window.edit(id);
    if (action === "duplicate") return window.duplicate(id);
    if (action === "pdf") return download(`/api/computers/${id}/pdf`);
    if (action === "remove") return window.removeComputer(id);
    if (action === "close-modal") return closeModal();
  } catch (err) {
    console.error(err);
    toast(err.message || "Erro na ação", "error");
  }
});
function debounce(fn, t) {
  let x;
  return (...a) => {
    clearTimeout(x);
    x = setTimeout(() => fn(...a), t);
  };
}
// Monta o formulário dinamicamente para criação, edição ou visualização.
function openForm(c = {}) {
  editing = c.id || null;
  if (!editing && !c.hostname) {
    try {
      c = JSON.parse(localStorage.draftComputer || "{}");
    } catch {}
  }
  $("#modalTitle").textContent = editing
    ? "Editar computador"
    : "Cadastrar computador";
  $("#computerForm").reset();
  $("#computerForm [name=id]").value = editing || "";
  $("#formFields").innerHTML = fields
    .map(([key, label, type = "text", opts]) => {
      let control;
      if (type === "select") {
        let raw = opts.split("|"),
          pairs =
            raw.length === 4 && ["0", "1"].includes(raw[0])
              ? [
                  [raw[0], raw[1]],
                  [raw[2], raw[3]],
                ]
              : raw.map((v) => [v, v]);
        control = `<select name="${key}" class="input">${pairs.map(([v, l]) => `<option value="${v}" ${String(c[key]) === v ? "selected" : ""}>${l}</option>`).join("")}</select>`;
      } else if (type === "textarea")
        control = `<textarea name="${key}" rows="4" class="input">${c[key] || ""}</textarea>`;
      else if (type === "password")
        control = `<div class="flex gap-1"><input id="${key}" name="${key}" type="password" class="input" value="${c[key] ?? ""}"><button type="button" class="btn btn-secondary" onclick="togglePassword('${key}')" title="Mostrar/ocultar senha"><i data-lucide="eye"></i></button><button type="button" class="btn btn-secondary" onclick="copyPassword('${key}')" title="Copiar senha"><i data-lucide="copy"></i></button></div>`;
      else
        control = `<input name="${key}" type="${type}" class="input" value="${c[key] ?? ""}">`;
      return `<div class="${type === "textarea" ? "md:col-span-2" : ""}"><label class="label">${label}</label>${control}</div>`;
    })
    .join("");
  document
    .querySelectorAll(
      "#computerForm input,#computerForm select,#computerForm textarea",
    )
    .forEach((x) => (x.disabled = false));
  $("#modal").classList.add("open");
  icon();
}
function closeModal() {
  $("#modal").classList.remove("open");
}
window.openForm = openForm;
window.closeModal = closeModal;
$("#computerForm").onsubmit = async (e) => {
  e.preventDefault();
  let d = Object.fromEntries(new FormData(e.target));
  try {
    await api(editing ? "/api/computers/" + editing : "/api/computers", {
      method: editing ? "PUT" : "POST",
      body: JSON.stringify(d),
    });
    localStorage.removeItem("draftComputer");
    toast("Computador salvo com sucesso");
    closeModal();
    load();
    dashboard();
  } catch (e) {
    toast(e.message, "error");
  }
};
window.togglePassword = (id) => {
  let x = $("#" + id);
  x.type = x.type === "password" ? "text" : "password";
};
window.copyPassword = async (id) => {
  try {
    await navigator.clipboard.writeText($("#" + id).value);
    toast("Senha copiada para a área de transferência");
  } catch {
    toast("Não foi possível copiar a senha", "error");
  }
};
$("#computerForm").addEventListener("input", () => {
  if (!editing) {
    let d = Object.fromEntries(new FormData($("#computerForm")));
    delete d.computer_password;
    delete d.bios_password;
    localStorage.draftComputer = JSON.stringify(d);
  }
});
window.edit = async (id) => {
  try {
    openForm(await api("/api/computers/" + id + "?reveal=true"));
  } catch (e) {
    toast(e.message, "error");
  }
};
window.view = async (id) => {
  let c = await api("/api/computers/" + id);
  openForm(c);
  document
    .querySelectorAll(
      "#computerForm input,#computerForm select,#computerForm textarea",
    )
    .forEach((x) => (x.disabled = true));
  $("#modalTitle").textContent = "Detalhes do computador";
};
window.duplicate = async (id) => {
  if (confirm("Duplicar este computador?")) {
    await api("/api/computers/" + id + "/duplicate", { method: "POST" });
    toast("Computador duplicado");
    load();
  }
};
window.removeComputer = async (id) => {
  if (confirm("Excluir este computador? Esta ação não pode ser desfeita.")) {
    await api("/api/computers/" + id, { method: "DELETE" });
    toast("Computador excluído");
    load();
    dashboard();
  }
};
$("#importFile").onchange = async (e) => {
  let fd = new FormData();
  fd.append("file", e.target.files[0]);
  try {
    const r = await fetch("/api/import/csv", {
      method: "POST",
      headers: { "X-CSRF-Token": csrf },
      body: fd,
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.error);
    toast(`${d.count} registros importados`);
    load();
    dashboard();
  } catch (e) {
    toast(e.message, "error");
  }
};
boot();
