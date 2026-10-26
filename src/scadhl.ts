// Syntax colours for OpenSCAD code (the editor in Code, ui/codehl.ts): the code split into pieces,
// each with a class – c comment, s string, n number, v special variable ($fn), k keyword, g shape,
// t transform or boolean, f function, d the name of a module/function being defined. Everything
// else is plain text. A single pass with one regex, so it keeps up with typing in long files.

const KEYWORDS = ['module', 'function', 'if', 'else', 'for', 'intersection_for', 'let', 'each', 'assert', 'echo', 'include', 'use', 'true', 'false', 'undef', 'children', 'PI'];
const SHAPES = ['cube', 'sphere', 'cylinder', 'polyhedron', 'square', 'circle', 'polygon', 'text', 'import', 'surface', 'linear_extrude', 'rotate_extrude', 'projection', 'roof'];
const TRANSFORMS = ['translate', 'rotate', 'scale', 'resize', 'mirror', 'multmatrix', 'color', 'offset', 'hull', 'minkowski', 'union', 'difference', 'intersection', 'render'];
const FUNCTIONS = [
  'abs', 'sign', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'floor', 'round', 'ceil', 'ln', 'log', 'pow', 'sqrt', 'exp', 'min', 'max', 'norm', 'cross',
  'len', 'concat', 'lookup', 'str', 'chr', 'ord', 'search', 'version', 'version_num', 'parent_module', 'rands', 'is_undef', 'is_bool', 'is_num', 'is_string', 'is_list', 'is_function',
];
const WORD_CLASS = new Map<string, string>([
  ...KEYWORDS.map(w => [w, 'k'] as const),
  ...SHAPES.map(w => [w, 'g'] as const),
  ...TRANSFORMS.map(w => [w, 't'] as const),
  ...FUNCTIONS.map(w => [w, 'f'] as const),
]);

export type Piece = { cls: string; text: string };

// comment | string | include/use <path> | $variable | number | word
const TOKEN = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|("(?:\\.|[^"\\\n])*"?)|\b(include|use)(\s*)(<[^>\n]*>?)|(\$\w+)|((?:\b\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)|([A-Za-z_]\w*)/g;

/** The code in pieces with their classes ('' = plain text); joined, they are the code again. */
export function scadPieces(src: string): Piece[] {
  const out: Piece[] = [];
  const push = (cls: string, text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.cls === cls) last.text += text;
    else out.push({ cls, text });
  };
  let at = 0, defining = false;
  for (const m of src.matchAll(TOKEN)) {
    const gap = src.slice(at, m.index);
    push('', gap);
    if (defining && /[^\s]/.test(gap)) defining = false;
    at = m.index + m[0].length;
    if (m[1]) push('c', m[1]);
    else if (m[2]) push('s', m[2]);
    else if (m[3]) {
      push('k', m[3]);
      push('', m[4]);
      push('s', m[5]);
    } else if (m[6]) push('v', m[6]);
    else if (m[7]) push('n', m[7]);
    else {
      const w = m[8];
      if (defining) push('d', w);
      else push(WORD_CLASS.get(w) ?? '', w);
      defining = w === 'module' || w === 'function';
      continue;
    }
    defining = false;
  }
  push('', src.slice(at));
  return out;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The code as HTML with a span per coloured piece (classes hl-c, hl-k …). */
export const scadHtml = (src: string) => scadPieces(src).map(p => (p.cls ? `<span class="hl-${p.cls}">${escapeHtml(p.text)}</span>` : escapeHtml(p.text))).join('');
