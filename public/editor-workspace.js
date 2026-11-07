export function setupStudioShell(actions) {
  const root = document.querySelector('.editor-page');
  const $ = selector => document.querySelector(selector);
  const prefsKey = 'gym-editor-layout-v1';
  const defaults = {'--media-width':245,'--inspector-width':310,'--timeline-height':310};
  let layout = {...defaults};
  try { const saved = JSON.parse(localStorage.getItem(prefsKey) || '{}');
    for (const key of Object.keys(defaults)) if (Number.isFinite(saved[key])) layout[key] = saved[key];
  } catch {}
  const limit = (value, key) => Math.max(key === '--timeline-height' ? 240 : 200,
    Math.min(value, key === '--timeline-height' ? innerHeight * .6 : innerWidth * .35));
  const applyLayout = () => {
    for (const key of Object.keys(layout)) root.style.setProperty(key, `${limit(layout[key],key)}px`);
    actions.resize?.();
  };
  const persistLayout = () => { try { localStorage.setItem(prefsKey,JSON.stringify(layout)); } catch {} };
  function inspector(name) {
    for (const button of document.querySelectorAll('[data-inspector-tab]')) {
      const selected = button.dataset.inspectorTab === name;
      button.setAttribute('aria-selected',String(selected)); button.tabIndex = selected ? 0 : -1;
    }
    for (const panel of document.querySelectorAll('[data-inspector-panel]')) panel.hidden = panel.dataset.inspectorPanel !== name;
  }
  const tabs = [...document.querySelectorAll('[data-inspector-tab]')];
  tabs.forEach((button,index) => {
    button.onclick = () => inspector(button.dataset.inspectorTab);
    button.onkeydown = event => {
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault();
      const target = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 :
        (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[target].click(); tabs[target].focus();
    };
  });
  function workspace(name) {
    root.dataset.workspace = name;
    for (const button of document.querySelectorAll('button[data-workspace]')) button.setAttribute('aria-pressed',String(button.dataset.workspace === name));
    inspector(name === 'audio' ? 'audio' : name === 'deliver' ? 'export' : 'clip');
    actions.resize?.();
  }
  for (const button of document.querySelectorAll('button[data-workspace]')) button.onclick = () => workspace(button.dataset.workspace);
  function jobs(show = true) { $('#render-drawer').hidden = !show; $('#workspace-jobs')?.setAttribute('aria-expanded',String(show)); }
  $('#workspace-jobs').onclick = () => jobs($('#render-drawer').hidden);
  $('#render-drawer-close').onclick = () => jobs(false);
  $('#workspace-export').onclick = () => workspace('deliver');
  $('#workspace-reset').onclick = () => { layout = {...defaults}; root.classList.remove('monitor-maximized'); applyLayout(); persistLayout(); workspace('edit'); };
  $('#workspace-fullscreen').onclick = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch { actions.message('Fullscreen is unavailable. Use the desktop launcher for a separate app window.'); }
  };
  $('#monitor-fullscreen').onclick = () => { root.classList.toggle('monitor-maximized'); actions.resize?.(); };
  function help(show = $('#keyboard-help').hidden) {
    $('#keyboard-help').hidden = !show; $('.editor-shortcuts').open = show;
    $('#workspace-keyboard-help').setAttribute('aria-expanded',String(show));
  }
  $('#workspace-keyboard-help').onclick = () => help();
  $('#project-new').onclick = actions.newProject;
  $('#project-save').onclick = actions.saveProject;
  $('#project-open').onclick = () => $('#project-file').click();
  $('#project-file').onchange = actions.openProject;
  $('#project-recover').onclick = actions.recoverProject;
  $('#project-relink-button').onclick = () => $('#project-media-file').click();
  $('#project-media-file').onchange = actions.relinkProject;
  $('#project-name').addEventListener('change', actions.projectChanged);
  $('#timeline-fit').onclick = actions.fitTimeline;
  for (const [id,key,direction] of [['#media-resizer','--media-width',1],['#inspector-resizer','--inspector-width',-1],['#timeline-resizer','--timeline-height',-1]]) {
    const handle = $(id); let drag;
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault(); drag = {position:key === '--timeline-height' ? event.clientY : event.clientX, value:layout[key]};
      handle.setPointerCapture(event.pointerId); root.classList.add('resizing');
    });
    handle.addEventListener('pointermove', event => {
      if (!drag) return;
      const position = key === '--timeline-height' ? event.clientY : event.clientX;
      layout[key] = limit(drag.value + (position - drag.position) * direction,key); applyLayout();
    });
    const finish = () => { if (!drag) return; drag = null; root.classList.remove('resizing'); persistLayout(); };
    handle.addEventListener('pointerup',finish); handle.addEventListener('pointercancel',finish);
    handle.addEventListener('dblclick', () => { layout[key] = defaults[key]; applyLayout(); persistLayout(); });
    handle.addEventListener('keydown', event => {
      if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
      event.preventDefault(); layout[key] = limit(layout[key] + (['ArrowRight','ArrowDown'].includes(event.key) ? 20 : -20) * direction,key);
      applyLayout(); persistLayout();
    });
  }
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { jobs(false); help(false); root.classList.remove('monitor-maximized'); actions.resize?.(); }
    if (event.target.closest('input,textarea,select,[contenteditable]')) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); actions.saveProject(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); $('#project-file').click(); }
    if (event.shiftKey && event.key.toLowerCase() === 'z' && !event.ctrlKey && !event.metaKey) { event.preventDefault(); actions.fitTimeline(); }
    if (event.key === '?') { event.preventDefault(); help(); }
  });
  window.addEventListener('resize',applyLayout);
  applyLayout(); workspace('edit');
  return {inspector,workspace,jobs};
}
