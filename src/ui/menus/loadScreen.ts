import { audio } from '../../audio/audio';
import { scenarios } from '../../data/scenarios';
import { cloudSaves } from '../../auth/account';
import { cloudSaveStore, deleteSave, exportSave, getSave, importSave, listSaves, localSaves, putSave, type SaveMeta } from '../../game/saves';
import { fill, h } from '../dom';
import { confirmDialog } from '../modal';
import { openPanel } from './shell';

export const timeAgo = (ms: number) => {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

/** Saved games list: load, rename, export, delete, import a file. */
export function openLoadScreen(onLoad: (id: string) => void) {
  const panel = openPanel('Load game', { wide: true });
  const list = h('div', { class: 'save-list' });
  const file = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none' }) as HTMLInputElement;
  const status = h('p', { class: 'setting-hint' });
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    try {
      await importSave(f, scenarios.map((s) => s.id));
      status.textContent = `Imported "${f.name}".`;
      void refresh();
    } catch (e) {
      status.textContent = (e as Error).message;
      audio.play('error');
    }
    file.value = '';
  });
  // signed in: saves made in this browser before signing in can be moved to the account
  const upload = h('button', { class: 'btn', style: 'display:none', title: 'Copies them to your account so every device sees them' }) as HTMLButtonElement;
  const offerUpload = async () => {
    if (!cloudSaves()) return;
    const local = await localSaves.list().catch(() => []);
    upload.style.display = local.length ? '' : 'none';
    upload.textContent = `Upload ${local.length} save${local.length === 1 ? '' : 's'} from this browser`;
    upload.onclick = async () => {
      upload.disabled = true;
      let done = 0;
      try {
        for (const m of local) {
          const rec = await localSaves.get(m.id);
          if (!rec) continue;
          await cloudSaveStore.put(rec);
          await localSaves.delete(m.id);
          done++;
        }
        status.textContent = `Uploaded ${done} save${done === 1 ? '' : 's'} to your account.`;
      } catch (e) {
        status.textContent = `Uploaded ${done}; then: ${(e as Error).message}`;
        audio.play('error');
      }
      upload.disabled = false;
      void refresh();
      void offerUpload();
    };
  };
  fill(panel.body, list, h('div', { class: 'setting-actions' }, h('button', { class: 'btn', onclick: () => file.click() }, 'Import a save file…'), upload, file), status);
  void offerUpload();

  const row = (m: SaveMeta) => {
    const theme = scenarios.find((s) => s.id === m.scenarioId)?.theme ?? 'sepia';
    return h('div', { class: `save-row theme-${theme}` },
      h('button', { class: 'save-main', title: 'Load this game', onclick: () => { panel.close(); onLoad(m.id); } },
        h('div', { class: 'save-name' }, m.auto ? h('span', { class: 'chip' }, 'Autosave') : null, m.name),
        h('div', { class: 'save-sub' }, `${m.scenarioName} · ${m.nation ?? 'no nation chosen'} · ${m.gameDate}`),
        h('div', { class: 'save-sub dim' }, `Saved ${timeAgo(m.savedAt)}`),
      ),
      h('div', { class: 'save-actions' },
        h('button', { class: 'btn', title: 'Rename', onclick: async () => {
          const name = window.prompt('Name this save', m.name)?.trim();
          if (!name) return;
          const rec = await getSave(m.id);
          if (rec) { await putSave({ ...rec, name }); void refresh(); }
        } }, 'Rename'),
        h('button', { class: 'btn', title: 'Download as a file', onclick: async () => { const rec = await getSave(m.id); if (rec) exportSave(rec); } }, 'Export'),
        h('button', { class: 'btn danger', title: 'Delete', onclick: async () => {
          if (!(await confirmDialog({ title: `Delete "${m.name}"?`, body: [h('p', null, 'This cannot be undone.')], confirmLabel: 'Delete', danger: true }))) return;
          await deleteSave(m.id);
          void refresh();
        } }, 'Delete'),
      ),
    );
  };

  const refresh = async () => {
    try {
      const saves = await listSaves();
      fill(list, ...(saves.length ? saves.map(row) : [h('p', { class: 'dim' }, 'No saved games yet. Save from the in-game menu (Esc) or with Ctrl+S.')]));
    } catch (e) {
      fill(list, h('p', { class: 'danger-text' }, `Saves are unavailable in this browser: ${(e as Error).message}`));
    }
  };
  void refresh();
  return panel.closed;
}
