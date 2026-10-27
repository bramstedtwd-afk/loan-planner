// One sheet for every add/edit form, so fields, validation and delete behave the same everywhere.
// fields: [{ name, label, type: 'text'|'number'|'month'|'date'|'select'|'segmented', value, options:[[value,label]], hint, required, min, max, step, prefix, suffix, half, placeholder }]
import { esc } from '../format.js';
import { openSheet } from './sheet.js';

function fieldHtml(f) {
  const id = `f-${f.name}`, req = f.required ? 'required' : '';
  const label = `<span>${esc(f.label)}${f.hint ? ` <em>${esc(f.hint)}</em>` : ''}</span>`;
  if (f.type === 'select') return `<label class="field ${f.half ? 'half' : ''}">${label}<select id="${id}" name="${f.name}">${f.options.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(f.value) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
  if (f.type === 'segmented') return `<div class="field ${f.half ? 'half' : ''}">${label}<div class="seg" role="radiogroup" aria-label="${esc(f.label)}">${f.options.map(([v, t]) => `<label><input type="radio" name="${f.name}" value="${esc(v)}" ${String(v) === String(f.value) ? 'checked' : ''}><span>${esc(t)}</span></label>`).join('')}</div></div>`;
  const input = `<input id="${id}" name="${f.name}" type="${f.type || 'text'}" ${f.type === 'number' ? 'inputmode="decimal"' : ''} value="${esc(f.value ?? '')}" ${req}
    ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''} ${f.step != null ? `step="${f.step}"` : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''} ${f.maxlength ? `maxlength="${f.maxlength}"` : ''} autocomplete="off">`;
  return `<label class="field ${f.half ? 'half' : ''}">${label}${f.prefix || f.suffix ? `<span class="affix">${f.prefix ? `<b>${esc(f.prefix)}</b>` : ''}${input}${f.suffix ? `<b>${esc(f.suffix)}</b>` : ''}</span>` : input}</label>`;
}

// onSubmit(values) may return a string to show as an error; otherwise the sheet closes.
export function formSheet({ title, intro, fields, submitLabel = 'Save', onSubmit, onDelete, deleteLabel = 'Delete', footer, onInput }) {
  return openSheet(`
    <form class="form" data-form novalidate>
      <h2>${esc(title)}</h2>${intro ? `<p class="muted" style="margin:-6px 0 0">${intro}</p>` : ''}
      <div class="fields">${fields.map(fieldHtml).join('')}</div>
      ${footer ? `<div data-footer>${footer}</div>` : ''}
      <p class="err" data-err hidden></p>
      <div class="sheet-actions">
        ${onDelete ? `<button class="btn soft danger" type="button" data-delete style="margin-right:auto">${esc(deleteLabel)}</button>` : ''}
        <button class="btn soft" type="button" data-close>Cancel</button>
        <button class="btn primary" type="submit">${esc(submitLabel)}</button>
      </div>
    </form>`, {
    label: title,
    onOpen: (sheet, close) => {
      const form = sheet.querySelector('[data-form]'), err = sheet.querySelector('[data-err]');
      const values = () => Object.fromEntries(fields.map(f => {
        const el = form.elements[f.name]; const v = el.value ?? '';
        return [f.name, f.type === 'number' ? (v === '' ? '' : +v) : v.trim?.() ?? v];
      }));
      const fail = msg => { err.textContent = msg; err.hidden = false; };
      form.addEventListener('input', () => { err.hidden = true; onInput?.(values(), sheet); });
      onInput?.(values(), sheet);
      form.addEventListener('submit', e => {
        e.preventDefault();
        for (const f of fields) {
          const el = form.elements[f.name], v = el.value;
          if (f.required && !String(v).trim()) { fail(`Enter ${f.label.toLowerCase()}.`); el.focus?.(); return; }
          if (f.type === 'number' && v !== '' && (Number.isNaN(+v) || (f.min != null && +v < f.min) || (f.max != null && +v > f.max))) { fail(`${f.label} must be ${f.min != null && f.max != null ? `between ${f.min} and ${f.max}` : f.min != null ? `at least ${f.min}` : `at most ${f.max}`}.`); el.focus(); return; }
        }
        const res = onSubmit(values());
        if (typeof res === 'string') fail(res); else close();
      });
      const del = sheet.querySelector('[data-delete]');
      del?.addEventListener('click', () => {
        if (!del.dataset.armed) { del.dataset.armed = '1'; del.textContent = 'Tap again to confirm'; return; }
        close(); onDelete();
      });
    },
  });
}
