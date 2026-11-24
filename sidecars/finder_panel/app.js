(() => {
  const REFRESH_MS = 4000;
  const $ = (id) => document.getElementById(id);

  const TYPE_META = {
    doc: { label: '文档与笔记', icon: '📄', colorVar: 'var(--fr-doc)' },
    code: { label: '代码与脚本', icon: '</>', colorVar: 'var(--fr-code)' },
    config: { label: '配置与技能', icon: '⚙', colorVar: 'var(--fr-config)' },
    media: { label: '图片与媒体', icon: '🖼', colorVar: 'var(--fr-media)' },
    other: { label: '其他文件', icon: '📁', colorVar: 'var(--fr-other)' },
  };
  const TYPE_ORDER = ['doc', 'code', 'config', 'media', 'other'];

  const state = {
    scope: 'current',
    items: [],
    secondaryExpanded: false,
    contextItem: null,
    pickerItem: null,
    pickerApps: { recommended: [], others: [] },
  };

  const params = new URLSearchParams(location.search);
  const getConversationId = () =>
    window.sidecar?.conversationId || params.get('conversationId') || '';

  async function apiFetch(path, options = {}) {
    const fn = window.sidecar?.fetch ? window.sidecar.fetch.bind(window.sidecar) : fetch;
    const res = await fn(path, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  function syncScheme() {
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;color:var(--background, #f7f7f8)';
    document.documentElement.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    const nums = (color.match(/[\d.]+/g) || []).map(Number);
    if (nums.length < 3) return;
    const scale = color.startsWith('color(') ? 1 : 255;
    const [r, g, b] = nums.slice(0, 3).map((v) => v / scale);
    const lum = 0.2126 * r + 0.7152 * g + 0.7152 * b;
    document.documentElement.dataset.theme = lum < 0.5 ? 'dark' : 'light';
  }
  syncScheme();
  new MutationObserver(() => syncScheme()).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style'],
  });

  let toastTimer = null;
  function showToast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 1800);
  }

  function formatTime(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  async function fileAction(path, mode = 'reveal', appName = '') {
    try {
      const res = await apiFetch('/api/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, mode, appName }),
      });
      if (mode === 'open') {
        showToast(`已用 ${res.appName || '默认应用'} 打开`);
      } else if (res.fallbackToParent) {
        showToast('文件已不存在，已打开所在目录');
      } else {
        showToast('已在访达中打开');
      }
    } catch (err) {
      showToast(`操作失败: ${err.message}`);
    }
  }

  async function copyPath(path) {
    try {
      await navigator.clipboard.writeText(path);
      showToast('已复制完整路径');
    } catch {
      showToast('复制失败');
    }
  }

  function hidePopups() {
    $('contextMenu').classList.add('hidden');
    $('appPicker').classList.add('hidden');
    state.contextItem = null;
    state.pickerItem = null;
  }

  function positionPopup(el, x, y) {
    el.classList.remove('hidden');
    const rect = el.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - rect.width - 8);
    const top = Math.min(y, window.innerHeight - rect.height - 8);
    el.style.left = `${Math.max(8, left)}px`;
    el.style.top = `${Math.max(8, top)}px`;
  }

  function showContextMenu(x, y, item) {
    hidePopups();
    state.contextItem = item;
    positionPopup($('contextMenu'), x, y);
  }

  function renderAppPickerList(query = '') {
    const list = $('appPickerList');
    const q = query.trim().toLowerCase();
    list.innerHTML = '';

    const addOption = (label, appName) => {
      const btn = document.createElement('button');
      btn.className = 'menu-item';
      btn.textContent = label;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = state.pickerItem;
        hidePopups();
        if (item) fileAction(item.path, 'open', appName);
      });
      list.appendChild(btn);
    };

    if (!q) {
      addOption('系统默认应用', '');
    }

    const rec = state.pickerApps.recommended.filter((a) => !q || a.toLowerCase().includes(q));
    const others = state.pickerApps.others.filter((a) => !q || a.toLowerCase().includes(q));

    if (rec.length) {
      const lbl = document.createElement('div');
      lbl.className = 'picker-label';
      lbl.textContent = '推荐应用';
      list.appendChild(lbl);
      for (const appName of rec) addOption(appName, appName);
    }

    if (others.length) {
      const lbl = document.createElement('div');
      lbl.className = 'picker-label';
      lbl.textContent = '本机全部应用';
      list.appendChild(lbl);
      for (const appName of others) addOption(appName, appName);
    }

    if (!rec.length && !others.length && q) {
      const empty = document.createElement('div');
      empty.className = 'picker-label';
      empty.textContent = '未找到匹配应用';
      list.appendChild(empty);
    }
  }

  async function showAppPicker(x, y, item) {
    hidePopups();
    state.pickerItem = item;
    $('appSearch').value = '';
    $('appPickerList').innerHTML = '<div class="picker-label">加载本机应用…</div>';
    positionPopup($('appPicker'), x, y);
    try {
      const data = await apiFetch(`/api/apps?fileType=${encodeURIComponent(item.fileType || 'other')}`);
      state.pickerApps = {
        recommended: Array.isArray(data.recommended) ? data.recommended : [],
        others: Array.isArray(data.others) ? data.others : [],
      };
      renderAppPickerList('');
      $('appSearch').focus();
    } catch {
      $('appPickerList').innerHTML = '<div class="picker-label">无法读取应用列表</div>';
    }
  }

  function createFileRow(item, isPrimary) {
    const fileType = TYPE_META[item.fileType] ? item.fileType : 'other';
    const meta = TYPE_META[fileType];

    const row = document.createElement('div');
    row.className = `file-item type-${fileType} ${isPrimary ? 'primary' : 'secondary'}`;
    row.title = `${item.path}\n左键定位访达 · 右键更多操作`;

    const icon = document.createElement('div');
    icon.className = 'type-icon';
    icon.textContent = meta.icon;
    row.appendChild(icon);

    const main = document.createElement('div');
    main.className = 'file-main';

    const top = document.createElement('div');
    top.className = 'file-top';

    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = item.name;
    top.appendChild(name);

    if (!item.exists) {
      const badge = document.createElement('span');
      badge.className = 'file-badge missing';
      badge.textContent = '已移除';
      top.appendChild(badge);
    } else if (item.tag) {
      const tagBadge = document.createElement('span');
      tagBadge.className = 'file-badge tag';
      tagBadge.textContent = item.tag;
      top.appendChild(tagBadge);
    }

    const timeStr = formatTime(item.updatedAt);
    if (timeStr && item.exists) {
      const timeBadge = document.createElement('span');
      timeBadge.className = 'file-badge';
      timeBadge.textContent = timeStr;
      top.appendChild(timeBadge);
    }

    const dir = document.createElement('div');
    dir.className = 'file-dir';
    dir.textContent = item.dir;

    main.appendChild(top);
    main.appendChild(dir);
    row.appendChild(main);

    const actions = document.createElement('div');
    actions.className = 'file-actions';

    if (item.exists) {
      const split = document.createElement('div');
      split.className = 'split-btn';

      const openBtn = document.createElement('button');
      openBtn.textContent = '打开';
      openBtn.title = '用默认应用打开';
      openBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        fileAction(item.path, 'open', '');
      });

      const caretBtn = document.createElement('button');
      caretBtn.className = 'split-caret';
      caretBtn.textContent = '▾';
      caretBtn.title = '选择应用打开';
      caretBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const rect = caretBtn.getBoundingClientRect();
        showAppPicker(rect.right - 220, rect.bottom + 4, item);
      });

      split.appendChild(openBtn);
      split.appendChild(caretBtn);
      actions.appendChild(split);
    }

    const finderBtn = document.createElement('button');
    finderBtn.className = 'action-btn';
    finderBtn.textContent = '访达';
    finderBtn.title = '在访达中显示';
    finderBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      fileAction(item.path, 'reveal');
    });
    actions.appendChild(finderBtn);

    row.appendChild(actions);

    row.addEventListener('click', () => fileAction(item.path, 'reveal'));
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, item);
    });

    return row;
  }

  function render() {
    const list = $('fileList');
    const primary = state.items.filter((i) => i.category === 'primary');
    const secondary = state.items.filter((i) => i.category !== 'primary');

    $('countBadge').textContent = `主要 ${primary.length} · 全部 ${state.items.length}`;

    if (!state.items.length) {
      list.innerHTML =
        '<div class="empty">暂无修改记录。<br/>当 Agent 新建或编辑文件后会自动出现在这里。</div>';
      return;
    }

    list.innerHTML = '';

    // Group primary files by document type
    if (primary.length) {
      for (const typeKey of TYPE_ORDER) {
        const groupItems = primary.filter((i) => (i.fileType || 'other') === typeKey);
        if (!groupItems.length) continue;

        const meta = TYPE_META[typeKey];
        const sec = document.createElement('section');
        sec.className = 'section';

        const header = document.createElement('div');
        header.className = 'group-header';
        header.innerHTML = `<span class="group-dot" style="background:${meta.colorVar}"></span><span>${meta.label}</span><span class="group-count">(${groupItems.length})</span>`;
        sec.appendChild(header);

        const itemsBox = document.createElement('div');
        itemsBox.className = 'section-items';
        for (const item of groupItems) {
          itemsBox.appendChild(createFileRow(item, true));
        }
        sec.appendChild(itemsBox);
        list.appendChild(sec);
      }
    } else {
      const emptyPrimary = document.createElement('div');
      emptyPrimary.className = 'empty';
      emptyPrimary.textContent = '暂无主要文件，请展开下方过程与辅助文件查看。';
      list.appendChild(emptyPrimary);
    }

    // Secondary / Process collapsible section
    if (secondary.length) {
      const secondarySection = document.createElement('section');
      secondarySection.className = 'section';

      const expanded = state.secondaryExpanded || primary.length === 0;

      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'collapse-toggle';
      toggleBtn.setAttribute('aria-expanded', String(expanded));
      toggleBtn.innerHTML = `<span><span class="collapse-arrow">▸</span>过程与辅助文件</span><span>${secondary.length} 个</span>`;

      const secondaryItems = document.createElement('div');
      secondaryItems.className = `section-items${expanded ? '' : ' collapsed'}`;
      for (const item of secondary) {
        secondaryItems.appendChild(createFileRow(item, false));
      }

      toggleBtn.addEventListener('click', () => {
        state.secondaryExpanded = !expanded;
        render();
      });

      secondarySection.appendChild(toggleBtn);
      secondarySection.appendChild(secondaryItems);
      list.appendChild(secondarySection);
    }
  }

  async function refresh() {
    try {
      const convId = encodeURIComponent(getConversationId());
      const data = await apiFetch(`/api/files?conversationId=${convId}&scope=${state.scope}`);
      state.items = Array.isArray(data.items) ? data.items : [];
      render();
    } catch {
      // Keep previous list on transient polling errors.
    }
  }

  $('refreshBtn').addEventListener('click', () => refresh());

  for (const btn of document.querySelectorAll('.seg-btn')) {
    btn.addEventListener('click', () => {
      state.scope = btn.dataset.scope;
      for (const b of document.querySelectorAll('.seg-btn')) {
        b.classList.toggle('active', b === btn);
      }
      refresh();
    });
  }

  $('contextMenu').addEventListener('click', (e) => {
    const btn = e.target.closest('.menu-item');
    if (!btn || !state.contextItem) return;
    const item = state.contextItem;
    const action = btn.dataset.action;
    const rect = $('contextMenu').getBoundingClientRect();
    hidePopups();
    if (action === 'open') fileAction(item.path, 'open', '');
    else if (action === 'open-with') showAppPicker(rect.left, rect.top, item);
    else if (action === 'reveal') fileAction(item.path, 'reveal');
    else if (action === 'dir') fileAction(item.path, 'dir');
    else if (action === 'copy') copyPath(item.path);
  });

  $('appPicker').addEventListener('click', (e) => e.stopPropagation());
  $('appSearch').addEventListener('input', (e) => renderAppPickerList(e.target.value));

  window.addEventListener('click', hidePopups);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hidePopups();
  });

  refresh();
  setInterval(refresh, REFRESH_MS);
})();
