// Tester för projektlagringen (projects.ts) – i Node utan localStorage används minnet.
import assert from 'node:assert/strict';
import { emptyDoc } from '../src/doc';
import {
  createProject, currentProjectId, deleteProject, duplicateProject, exportProject, listProjects, loadProject,
  parseProjectFile, projectInfo, renameProject, saveProject, uniqueProjectName,
} from '../src/projects';

let n = 0;
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok', name); };

test('första start skapar en modell', () => {
  const id = currentProjectId('Min modell');
  assert.equal(projectInfo(id)?.name, 'Min modell');
  assert.equal(currentProjectId('Annat'), id, 'samma modell nästa gång');
  assert.deepEqual(loadProject(id), emptyDoc());
});
test('unika namn, byt namn, spara ändrar ordningen', async () => {
  const a = createProject('Låda'), b = createProject('Låda');
  assert.equal(projectInfo(b)?.name, 'Låda 2');
  renameProject(a, '  Burk  '); assert.equal(projectInfo(a)?.name, 'Burk');
  renameProject(a, '   '); assert.equal(projectInfo(a)?.name, 'Burk', 'tomt namn ignoreras');
  renameProject(b, 'Burk'); assert.equal(projectInfo(b)?.name, 'Burk 2');
  assert.equal(uniqueProjectName('Burk', a), 'Burk');
  const doc = emptyDoc(); doc.params.push({ name: 'b', expr: '40' });
  const before = projectInfo(b)!.updated;
  while (Date.now() === before) { /* vänta en ms */ }
  saveProject(b, doc);
  assert.equal(listProjects()[0].id, b);
  assert.deepEqual(loadProject(b).params, [{ name: 'b', expr: '40' }]);
});
test('duplicera, ta bort, fil fram och tillbaka', () => {
  const src = listProjects()[0];
  const d = duplicateProject(src.id, 'kopia');
  assert.equal(projectInfo(d)?.name, `${src.name} kopia`);
  assert.deepEqual(loadProject(d), loadProject(src.id));
  const file = exportProject(d);
  const back = parseProjectFile(file)!;
  assert.equal(back.name, `${src.name} kopia`); assert.deepEqual(back.doc, loadProject(d));
  deleteProject(d); assert.equal(projectInfo(d), undefined);
  assert.equal(parseProjectFile('{"format":"annat"}'), null);
  assert.equal(parseProjectFile('inte json'), null);
  assert.equal(parseProjectFile(JSON.stringify({ format: 'scadshape', v: 1, name: '', doc: { v: 9 } })), null);
});
console.log(`${n} projekttester ok`);
