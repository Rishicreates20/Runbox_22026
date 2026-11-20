# Code+ web

The React frontend for the Code+ online judge. Submissions are judged by [`runbox`](../README.md), the sandbox in this repo.

```bash
cd web
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build into dist/
npm run preview    # serve dist/ locally
npm run build:static  # hash-routed build in dist-static/ for any static host or sub-path
```

Stack: Vite, React 19, TypeScript, React Router 7 and CodeMirror 6. Fonts are self-hosted through Fontsource: Space Grotesk for headings, Inter for body text and JetBrains Mono for code.

## Screens

| Route | What it does |
|---|---|
| `/login`, `/signup` | Email and password auth with validation, GitHub and Google buttons, and a password strength meter. The hero shows the plus-burst animation: the logo beats and code fragments fly outward from it. |
| `/problems` | Dashboard with solved-by-difficulty ring, a 20-week activity heatmap, streak, daily challenge and weekly-round countdowns. The problem table filters by difficulty, topic, status and search, sorts by acceptance, and keeps its filters in the URL. |
| `/problems/:id` | Workspace with the statement, a CodeMirror editor (C++17, C11, Python 3.12) and drafts autosaved per problem and language. Panels resize. Run checks the editable sample cases. Submit judges the hidden tests one by one and shows the runbox verdict, CPU time, memory and raw JSON. `Ctrl/⌘ + Enter` runs and `Ctrl/⌘ + Shift + Enter` submits. |
| `/submit` | Upload a `.cpp`, `.c` or `.py` file (up to 64 KB), pick the problem, and watch it judged test by test. The language comes from the file extension. |
| `/upload` | Upload a PDF of coding questions. It's read in the browser with pdf.js (no server), split into questions, and each question's task, input/output format, constraints and sample tests are pulled out. Review and fix them, then add them to your problem list. They're private to you and tagged *Imported*; their samples are the judged tests. Scanned PDFs have no text, so you can paste the questions instead. |
| `/submissions` | Every submission, filterable by verdict. Uploaded files are marked. |
| `/admin/problems/new` | Admins only. Write a statement with a live preview, add examples, and upload hidden tests as `1.in`/`1.out` pairs, `input1.txt`/`output1.txt`, or one `.zip`. |
| `/reset-password` | Where the password-reset email lands. |

In the workspace you can also drop a source file onto the editor, or use its upload button, to load it.

## Backends

The app picks one of three backends from its environment variables.

### Supabase (real accounts and uploads)

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (the project's publishable key) in `.env.local`, or in the Vercel project's environment variables. Supabase then provides:

- **Accounts:** email and password with email confirmation, password reset, and GitHub or Google once those providers are switched on. Sessions honour "Keep me signed in".
- **Data:** `profiles` (username and role), `problems` and `problem_tests` for admin-created problems, and `submissions`. Questions imported from a PDF are unpublished `problems` rows owned by the user who uploaded them, with `paper` set to the paper's name.
- **Files:** private buckets `solutions` (each user's uploaded files, in a folder named after their user id) and `testcases` (admins only).

Row-level security limits each user to their own submissions and files. Only admins can create problems or read hidden tests. The schema is in [`supabase/migrations`](../supabase/migrations).

One-time setup in the Supabase dashboard:

1. **Authentication → URL Configuration:** set **Site URL** to the production address. Add the local and preview addresses under **Redirect URLs**, for example `http://localhost:5173/**` and `https://*-<your-team>.vercel.app/**`. Confirmation and reset emails link back to these.
2. **Authentication → Emails:** Supabase's built-in email only reaches members of your Supabase team. Add your own SMTP server so anyone can get confirmation emails, or switch off **Confirm email** under Sign In / Providers → Email.
3. **Optional:** switch on GitHub or Google under Sign In / Providers. The buttons tell users when a provider is off.
4. **Make yourself an admin:** after signing up, run this in the SQL editor:

   ```sql
   update public.profiles set role = 'admin' where username = 'your_username';
   ```

Judging is still simulated in the browser in this mode (see below), so verdicts are not proof of a correct solution until a runbox judge server is connected.

### Demo mode

With no Supabase and no `VITE_API_URL` set, the app runs in **demo mode**. Accounts, sessions, drafts and submissions live in `localStorage`, and an in-browser judge simulates runbox:

- Submitting the untouched starter code gives Wrong Answer. Any other code gives Accepted.
- The **Demo judge** menu in the console forces any verdict (TLE, MLE, RE, SV, OLE, CE, IE) so every result state can be previewed.
- **Try the demo account** on the sign-in page logs in as `ada_l` with sample history.

The demo judge does not execute code. Custom test input needs a real server.

### Custom API

To use your own server instead, set `VITE_API_URL`. The app then calls these endpoints, with cookies included:

| Method & path | Body | Response |
|---|---|---|
| `GET /auth/me` | | `{ user: User \| null }` |
| `POST /auth/login` | `{ email, password, remember }` | `{ user }`, or 4xx with `{ error }` |
| `POST /auth/signup` | `{ username, email, password }` | `{ user }` |
| `POST /auth/logout` | | `{}` |
| `GET /auth/github`, `GET /auth/google` | `?redirect=` | OAuth redirect |
| `POST /run` | `{ problemId, language, source, cases: string[] }` | `RunReport` |
| `POST /submissions` | `{ problemId, language, source }` | `{ id }` |
| `GET /submissions/:id` | | `{ status, tests: TestResult[], report?: JudgeReport }`, polled until `status === "done"` |

The shapes are defined in `src/lib/types.ts`. `JudgeReport.raw` is the JSON object runbox prints, passed through unchanged. Language ids are `cpp`, `c` and `py`.

## Layout

```
src/
  auth/         AuthContext (Supabase, custom API and local backends), demo account seed
  components/   Logo, PlusBurst, TopNav, Dropzone, ProblemStatement, JudgeResult, badges, editor theme, icons
  data/         built-in problem catalog, languages and starter code
  lib/          judge client, Supabase client, problem and submission stores, file and zip helpers, stats
  pages/        AuthPage, Problems, Workspace, Submit, CreateProblem, Submissions, ResetPassword, NotFound
  styles/       design tokens and shared primitives
```

The workspace route is lazy-loaded, so CodeMirror only downloads when a problem is opened. All motion respects `prefers-reduced-motion`.
