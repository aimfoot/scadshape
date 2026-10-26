// Unit tests for the code colours (scadhl.ts): what each piece of OpenSCAD becomes.
import assert from 'node:assert/strict';
import { scadHtml, scadPieces } from '../src/scadhl';

let n = 0;
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok', name); };
const classes = (src: string) => scadPieces(src).filter(p => p.cls).map(p => `${p.cls}:${p.text}`);

test('the pieces join to the code again, whatever it is', () => {
  for (const src of ['', 'cube(10);', '/* open comment', '"open string', 'x = 1;\n\n// end\n', 'a<b && c>d', 'include <BOSL2/std.scad>\n']) assert.equal(scadPieces(src).map(p => p.text).join(''), src);
});

test('keywords, shapes, transforms, functions, numbers, strings, $ variables', () => {
  assert.deepEqual(classes('difference() { cube([10, 2.5, 1e3]); translate([0, 0, -1]) cylinder(d = 4, h = sin(30), $fn = 48); }'), [
    't:difference', 'g:cube', 'n:10', 'n:2.5', 'n:1e3', 't:translate', 'n:0', 'n:0', 'n:1', 'g:cylinder', 'n:4', 'f:sin', 'n:30', 'v:$fn', 'n:48',
  ]);
  assert.deepEqual(classes('for (i = [0:3]) if (i > 1) echo(str("i = ", i));'), ['k:for', 'n:0', 'n:3', 'k:if', 'n:1', 'k:echo', 'f:str', 's:"i = "']);
  assert.deepEqual(classes('text("a \\"b\\" c");'), ['g:text', 's:"a \\"b\\" c"']);
});

test('comments hide what is in them; names being defined', () => {
  assert.deepEqual(classes('// cube(1)\n/* sphere(2)\n */ module lid(h = 2) {}\nfunction area(r) = PI * r * r;\nf = function(x) x;'), [
    'c:// cube(1)', 'c:/* sphere(2)\n */', 'k:module', 'd:lid', 'n:2', 'k:function', 'd:area', 'k:PI', 'k:function',
  ]);
});

test('include/use paths are strings; names with digits are not numbers', () => {
  assert.deepEqual(classes('include <BOSL2/std.scad>\nuse <a.scad>\nx1 = r2d;'), ['k:include', 's:<BOSL2/std.scad>', 'k:use', 's:<a.scad>']);
});

test('HTML: escaped, a span per coloured piece', () => {
  assert.equal(scadHtml('a < b; // <x>'), 'a &lt; b; <span class="hl-c">// &lt;x&gt;</span>');
});

console.log(`${n} code colour tests ok`);
