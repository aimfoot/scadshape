// Projekt: flera modeller i webbläsarens lagring (IndexedDB via kv.ts). Ett index (namn, senast
// ändrad) och ett dokument per projekt; det gamla enda dokumentet ("scadshape.doc") blir det första projektet.
// Export/import som .scadshape.json för att flytta eller säkerhetskopiera en modell.

import { emptyDoc, migrate, type Doc } from './doc';
import { kv } from './kv';

export interface ProjectInfo {
  id: string;
  name: string;
  /** Senast sparad (ms sedan 1970). */
  updated: number;
}

const INDEX_KEY = 'scadshape.projects';
const CURRENT_KEY = 'scadshape.current';
const LEGACY_DOC_KEY = 'scadshape.doc';
const docKey = (id: string) => `scadshape.doc.${id}`;

const newProjectId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function readIndex(): ProjectInfo[] {
  try {
    const list = JSON.parse(kv.get(INDEX_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter(p => p && typeof p.id === 'string' && typeof p.name === 'string') : [];
  } catch {
    return [];
  }
}
const writeIndex = (list: ProjectInfo[]) => kv.set(INDEX_KEY, JSON.stringify(list));

/** Alla projekt, senast ändrade först. */
export const listProjects = () => readIndex().sort((a, b) => b.updated - a.updated);

/** Ett unikt namn: "Modell", "Modell 2" … */
export function uniqueProjectName(base: string, except?: string) {
  const taken = new Set(readIndex().filter(p => p.id !== except).map(p => p.name));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

export function createProject(name: string, doc: Doc = emptyDoc()): string {
  const id = newProjectId();
  kv.set(docKey(id), JSON.stringify(doc));
  writeIndex([...readIndex(), { id, name: uniqueProjectName(name), updated: Date.now() }]);
  return id;
}

/** Aktuellt projekt; skapas (eller flyttas från det gamla enda dokumentet) om det inte finns. */
export function currentProjectId(defaultName: string): string {
  const list = readIndex();
  const cur = kv.get(CURRENT_KEY);
  if (cur && list.some(p => p.id === cur)) return cur;
  if (list.length) return setCurrentProject(listProjects()[0].id);
  let doc = emptyDoc();
  try {
    doc = migrate(JSON.parse(kv.get(LEGACY_DOC_KEY) ?? 'null')) ?? doc;
  } catch {
    /* trasigt gammalt dokument: börja tomt */
  }
  const id = createProject(defaultName, doc);
  kv.remove(LEGACY_DOC_KEY);
  return setCurrentProject(id);
}

export function setCurrentProject(id: string) {
  kv.set(CURRENT_KEY, id);
  return id;
}

export const projectInfo = (id: string) => readIndex().find(p => p.id === id);

export function loadProject(id: string): Doc {
  try {
    return migrate(JSON.parse(kv.get(docKey(id)) ?? 'null')) ?? emptyDoc();
  } catch {
    return emptyDoc();
  }
}

export function saveProject(id: string, doc: Doc) {
  kv.set(docKey(id), JSON.stringify(doc));
  writeIndex(readIndex().map(p => (p.id === id ? { ...p, updated: Date.now() } : p)));
}

export function renameProject(id: string, name: string) {
  const clean = name.trim();
  if (!clean) return;
  writeIndex(readIndex().map(p => (p.id === id ? { ...p, name: uniqueProjectName(clean, id) } : p)));
}

export function duplicateProject(id: string, copySuffix: string): string {
  const info = projectInfo(id);
  return createProject(`${info?.name ?? ''} ${copySuffix}`.trim(), loadProject(id));
}

export function deleteProject(id: string) {
  kv.remove(docKey(id));
  writeIndex(readIndex().filter(p => p.id !== id));
}

// ---- Fil ------------------------------------------------------------------------------------

interface ProjectFile {
  format: 'scadshape';
  v: 1;
  name: string;
  doc: Doc;
}

export function exportProject(id: string): string {
  const file: ProjectFile = { format: 'scadshape', v: 1, name: projectInfo(id)?.name ?? 'scadshape', doc: loadProject(id) };
  return JSON.stringify(file, null, 1);
}

/** Läs en projektfil; null om den inte är en scadshape-modell. */
export function parseProjectFile(text: string): { name: string; doc: Doc } | null {
  try {
    const o = JSON.parse(text) as Partial<ProjectFile>;
    if (o?.format !== 'scadshape') return null;
    const doc = migrate(o.doc);
    return doc ? { name: typeof o.name === 'string' && o.name.trim() ? o.name.trim() : 'scadshape', doc } : null;
  } catch {
    return null;
  }
}
