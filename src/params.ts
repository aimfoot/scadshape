// Variables (parameters) in the document: name = expression. A variable may use the variables above
// it in the list.

import { t } from './i18n';
import { isIdentifier, parseExpr, type Vars } from './expr';

export interface Param {
  name: string;
  expr: string;
}

export interface ParamEval {
  vars: Map<string, number>;
  errors: Map<string, string>; // name → error
}

const RESERVED = new Set(['PI', 'true', 'false', 'undef']);

export function validateParamName(name: string, params: Param[], self?: Param): string | null {
  if (!isIdentifier(name)) return t('params.badName');
  if (RESERVED.has(name)) return t('params.reserved');
  if (params.some(p => p !== self && p.name === name)) return t('params.exists');
  return null;
}

export function evalParams(params: Param[]): ParamEval {
  const vars = new Map<string, number>();
  const errors = new Map<string, string>();
  for (const p of params) {
    const r = parseExpr(p.expr, vars as Vars);
    if (r.value === null) errors.set(p.name, r.error ?? t('expr.invalid'));
    else vars.set(p.name, r.value);
  }
  return { vars, errors };
}
