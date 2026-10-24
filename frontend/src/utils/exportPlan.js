/**
 * Plan export (§4.2 secondary objective, §7.5 F).
 *
 * Builds a print-friendly document in a hidden iframe and opens the browser's
 * print dialog, where the user can "Save as PDF". No external library needed.
 *
 * All model-generated text is HTML-escaped before it is inserted — AI output is
 * untrusted data and is never executed (§19.4).
 */

import { formatDate, formatLongDate } from './dateValidation'
import { formatMoney, formatPercent } from './format'

function escapeHtml(value) {
  if (value === null || value === undefined) return ''
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

const e = escapeHtml

function listSection(title, items) {
  if (!items?.length) return ''
  return `
    <section>
      <h2>${e(title)}</h2>
      <ul class="notes">
        ${items.map((item) => `<li>${e(item)}</li>`).join('')}
      </ul>
    </section>`
}

function buildHtml(plan) {
  const { event_summary: summary, budget } = plan
  const currency = budget.currency ?? 'INR'
  const money = (amount) => e(formatMoney(amount, currency))

  const budgetRows = budget.categories
    .map(
      (category) => `
        <tr${category.is_reserve ? ' class="reserve"' : ''}>
          <td>
            <strong>${e(category.category)}</strong>
            ${category.is_reserve ? ' <span class="tag">Reserve</span>' : ''}
            ${
              category.description
                ? `<div class="muted">${e(category.description)}</div>`
                : ''
            }
          </td>
          <td class="num">${money(category.estimated_amount)}</td>
          <td class="num">${e(formatPercent(category.percent_of_budget, 1))}</td>
        </tr>`,
    )
    .join('')

  const timelineRows = plan.timeline
    .map(
      (item) => `
        <tr>
          <td class="nowrap">${e(formatDate(item.due_date))}</td>
          <td>
            <strong>${e(item.title)}</strong>
            ${item.is_follow_up ? ' <span class="tag">After event</span>' : ''}
            ${item.is_overdue ? ' <span class="tag warn">Overdue</span>' : ''}
            ${
              item.description
                ? `<div class="muted">${e(item.description)}</div>`
                : ''
            }
          </td>
          <td class="nowrap">${e(item.priority)}</td>
          <td class="nowrap">${item.is_completed ? 'Done' : 'Pending'}</td>
        </tr>`,
    )
    .join('')

  const checklistRows = plan.vendor_checklist
    .map(
      (item) => `
        <tr>
          <td class="nowrap">${item.is_completed ? '[x]' : '[ ]'}</td>
          <td class="nowrap">${e(item.category)}</td>
          <td>
            <strong>${e(item.title)}</strong>
            ${
              item.description
                ? `<div class="muted">${e(item.description)}</div>`
                : ''
            }
          </td>
          <td class="nowrap">${e(item.priority)}</td>
        </tr>`,
    )
    .join('')

  const ideaItems = plan.personalized_ideas
    .map(
      (idea) => `
        <li>
          <span class="muted">${e(idea.category)}</span><br />
          <strong>${e(idea.title)}</strong>
          ${idea.description ? `<div>${e(idea.description)}</div>` : ''}
          ${
            idea.estimated_cost != null
              ? `<div class="muted">Rough estimate: ${money(idea.estimated_cost)}</div>`
              : ''
          }
        </li>`,
    )
    .join('')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${e(summary.event_name)} — Festivo AI Plan</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: Inter, "Segoe UI", system-ui, sans-serif;
    color: #25213a; margin: 0; padding: 32px; font-size: 12px; line-height: 1.55;
  }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 26px 0 8px; padding-bottom: 5px;
       border-bottom: 1.5px solid #6d4aff; text-transform: uppercase;
       letter-spacing: .04em; }
  .brand { color: #6d4aff; font-weight: 800; letter-spacing: -.01em; }
  .muted { color: #6b6880; font-size: 11px; }
  .summary { display: grid; grid-template-columns: repeat(3, 1fr);
             gap: 10px; margin-top: 14px; }
  .summary div { border: 1px solid #ece7e0; border-radius: 8px; padding: 9px 11px; }
  .summary dt { font-size: 9px; text-transform: uppercase; letter-spacing: .06em;
                color: #6b6880; font-weight: 700; }
  .summary dd { margin: 3px 0 0; font-weight: 600; }
  .figures { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  .figures div { border: 1px solid #ece7e0; border-radius: 8px; padding: 9px 11px; }
  .figures .label { font-size: 9px; text-transform: uppercase; color: #6b6880;
                    font-weight: 700; letter-spacing: .06em; }
  .figures .value { font-size: 15px; font-weight: 800; margin-top: 3px; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid #ece7e0;
           vertical-align: top; }
  th { font-size: 9px; text-transform: uppercase; letter-spacing: .06em;
       color: #6b6880; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.nowrap { white-space: nowrap; }
  tr.reserve { background: #e6f6ee; }
  tfoot td { font-weight: 800; border-top: 2px solid #25213a; border-bottom: none; }
  .tag { display: inline-block; background: #f1ecff; color: #4c2fd1; font-size: 9px;
         font-weight: 700; padding: 1px 5px; border-radius: 4px; }
  .tag.warn { background: #fdeceb; color: #c0362c; }
  ul { margin: 8px 0 0; padding-left: 18px; }
  ul.notes li, ul.ideas li { margin-bottom: 7px; }
  ul.ideas { list-style: none; padding-left: 0; }
  ul.ideas li { border: 1px solid #ece7e0; border-radius: 8px; padding: 9px 11px; }
  .disclaimer { margin-top: 24px; border: 1px solid #ece7e0; background: #faf8f5;
                border-radius: 8px; padding: 11px 13px; font-size: 10.5px;
                color: #6b6880; }
  section { break-inside: avoid; }
  @page { margin: 14mm; }
</style>
</head>
<body>
  <header>
    <p class="brand">Festivo AI</p>
    <h1>${e(summary.event_name)}</h1>
    <p class="muted">
      ${e(summary.event_type_label)} · ${e(formatLongDate(summary.event_date))} ·
      ${e(summary.location)}
    </p>

    <dl class="summary">
      <div><dt>Date</dt><dd>${e(formatLongDate(summary.event_date))}</dd></div>
      <div><dt>Location</dt><dd>${e(summary.location)}</dd></div>
      <div><dt>Guests</dt><dd>${e(summary.guest_count)}</dd></div>
      <div><dt>Budget</dt><dd>${money(summary.budget)}</dd></div>
      <div><dt>Per guest</dt><dd>${money(summary.budget_per_guest)}</dd></div>
      <div><dt>Theme</dt><dd>${e(summary.theme || 'AI suggested')}</dd></div>
    </dl>
  </header>

  <section>
    <h2>Budget overview</h2>
    <div class="figures">
      <div><p class="label">Total budget</p><p class="value">${money(budget.total_budget)}</p></div>
      <div><p class="label">Planned</p><p class="value">${money(budget.planned_expenditure)}</p></div>
      <div><p class="label">Reserve</p><p class="value">${money(budget.emergency_reserve)}</p></div>
      <div><p class="label">${budget.is_over_budget ? 'Over by' : 'Unallocated'}</p>
        <p class="value">${money(budget.is_over_budget ? budget.overage : budget.unallocated)}</p></div>
    </div>

    <table>
      <thead>
        <tr><th>Category</th><th class="num">Estimate</th><th class="num">Share</th></tr>
      </thead>
      <tbody>${budgetRows}</tbody>
      <tfoot>
        <tr>
          <td>Total allocated</td>
          <td class="num">${money(budget.total_allocated)}</td>
          <td class="num">${e(
            formatPercent(
              budget.total_budget > 0
                ? (budget.total_allocated / budget.total_budget) * 100
                : 0,
              1,
            ),
          )}</td>
        </tr>
      </tfoot>
    </table>
  </section>

  <section>
    <h2>Timeline</h2>
    <table>
      <thead>
        <tr><th>Due</th><th>Task</th><th>Priority</th><th>Status</th></tr>
      </thead>
      <tbody>${timelineRows}</tbody>
    </table>
  </section>

  <section>
    <h2>Vendor checklist</h2>
    <table>
      <thead>
        <tr><th>Done</th><th>Category</th><th>Task</th><th>Priority</th></tr>
      </thead>
      <tbody>${checklistRows}</tbody>
    </table>
  </section>

  <section>
    <h2>Personalized ideas</h2>
    <ul class="ideas">${ideaItems}</ul>
  </section>

  ${listSection('What we assumed', plan.assumptions)}
  ${listSection('Things to watch', plan.warnings)}

  <p class="disclaimer">
    ${e(plan.estimate_disclaimer ?? '')}
    Generated by Festivo AI on ${e(
      new Date(plan.generated_at ?? Date.now()).toLocaleString('en-IN'),
    )}.
  </p>
</body>
</html>`
}

/** Opens the print dialog so the user can save the plan as a PDF. */
export function printPlan(plan) {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  document.body.appendChild(iframe)

  const cleanup = () => {
    window.setTimeout(() => iframe.remove(), 1000)
  }

  iframe.onload = () => {
    try {
      iframe.contentWindow.focus()
      iframe.contentWindow.print()
    } finally {
      cleanup()
    }
  }

  // srcdoc keeps the document same-origin without needing document.write.
  iframe.srcdoc = buildHtml(plan)
}
