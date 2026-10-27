# Loan Payoff

A student loan payoff planner: debt-free date, what to pay each month, payoff strategies, cash flow and a payment log.

This repo holds **app code only**. Personal data lives in a separate private repo and is never committed here (`local-data.json` and `*.sqlite` are git-ignored).

## Layout

| Path | What it is |
|---|---|
| `index.html` | App shell: sidebar on desktop, tab bar on phones |
| `css/app.css` | Design system ("evergreen glass") with light and dark themes |
| `js/engine.js` | Payoff math. Pure functions, no DOM or storage |
| `js/format.js` | Money, duration and percent formatting |
| `js/charts.js` | SVG charts |
| `js/screens/` | One module per screen |
| `js/store/` | Where data is loaded and saved |
| `tests/` | Engine tests |

No build step: the files are served as-is.

## Where data lives

- `planner.sqlite` in a **private** repo, opened in the browser with [sql.js](https://sql.js.org/) (`js/store/db.js`). The schema is versioned; older files upgrade on open.
- The app reads and commits that file through GitHub's contents API with a fine-grained token limited to that one repo (`js/store/github.js`). The token stays in the browser that entered it.
- `js/store/sync.js` keeps a copy on the device, batches edits into one commit per pause, and never overwrites a newer version saved from another device. It asks which version to keep instead.

## Tests

- **In a browser:** serve the folder (for example `python -m http.server`) and open `/tests/`.
- **With Node 20+:** `npm test`. GitHub Actions runs this on every push.

## How the math works

- Interest accrues monthly on principal. Payments cover unpaid interest first, then principal.
- Direct Subsidized loans accrue no interest before repayment starts. Other loans accrue from day one, and that unpaid interest is added to principal when repayment starts.
- If no minimum payment is given, it is estimated from the loan term (federal standard is 120 months).
- The monthly loan budget is (income − costs) × the share you send to loans, plus any fixed extra. Minimums are always paid.
- Payments you log are split with simple daily interest since the loan's last balance date, the way servicers do.
