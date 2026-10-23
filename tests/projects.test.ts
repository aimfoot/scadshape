// Tests for the project storage (projects.ts) – in Node without localStorage memory is used.
import assert from 'node:assert/strict';
import { emptyDoc } from '../src/doc';
import {
  createProject, currentProjectId, deleteProject, duplicateProject, exportProject, listProjects, loadProject,
  parseProjectFile, projectInfo, renameProject, saveProject, uniqueProjectName,
} from '../src/projects';

let n = 0;
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok', name); };

test('the first start creates a model', () => {
  const id = currentProjectId('My model');
  assert.equal(projectInfo(id)?.name, 'My model');
  assert.equal(currentProjectId('Other'), id, 'the same model next time');
  assert.deepEqual(loadProject(id), emptyDoc());
});
test('unique names, rename, saving changes the order', async () => {
  const a = createProject('Box'), b = createProject('Box');
  assert.equal(projectInfo(b)?.name, 'Box 2');
  renameProject(a, '  Jar  '); assert.equal(projectInfo(a)?.name, 'Jar');
  renameProject(a, '   '); assert.equal(projectInfo(a)?.name, 'Jar', 'an empty name is ignored');
  renameProject(b, 'Jar'); assert.equal(projectInfo(b)?.name, 'Jar 2');
  assert.equal(uniqueProjectName('Jar', a), 'Jar');
  const doc = emptyDoc(); doc.params.push({ name: 'b', expr: '40' });
  const before = projectInfo(b)!.updated;
  while (Date.now() === before) { /* wait a ms */ }
  saveProject(b, doc);
  assert.equal(listProjects()[0].id, b);
  assert.deepEqual(loadProject(b).params, [{ name: 'b', expr: '40' }]);
});
test('duplicate, delete, file there and back', () => {
  const src = listProjects()[0];
  const d = duplicateProject(src.id, 'copy');
  assert.equal(projectInfo(d)?.name, `${src.name} copy`);
  assert.deepEqual(loadProject(d), loadProject(src.id));
  const file = exportProject(d);
  const back = parseProjectFile(file)!;
  assert.equal(back.name, `${src.name} copy`); assert.deepEqual(back.doc, loadProject(d));
  deleteProject(d); assert.equal(projectInfo(d), undefined);
  assert.equal(parseProjectFile('{"format":"other"}'), null);
  assert.equal(parseProjectFile('not json'), null);
  assert.equal(parseProjectFile(JSON.stringify({ format: 'scadshape', v: 1, name: '', doc: { v: 9 } })), null);
});
console.log(`${n} project tests ok`);
