# Gameweek Edge article team: blueprint

Version one, 26 November 2026. One job, four agents, one approval gate.

## START HERE FIRST

Today, do one thing: **run a dry run.**

1. Open Claude Code in this repo on the branch `claude/new-session-1yq8rk`
   (desktop app, terminal or claude.ai/code).
2. Type: `/gameweek-preview dry run`
3. Read the draft it hands you. Note how long it took and one thing you
   would change.

Nothing gets committed or published on a dry run.

---

## 1. The first job

**Gameweek Preview articles for the news page (`/blog/`).**

| Option | Hours saved this month | Verdict |
|---|---|---|
| Articles for the news page | High. Nothing exists yet, each one takes 1 to 2 hours by hand | **Do first** |
| Social posts on X and Bluesky | Low. Already automated (Daily Content, Recap video, Social Studio) | Keep as is |
| Promoting articles on social | Medium | Version two (agent 5, Typefully) |
| Inbox and follow-ups | Low at current volume | Wait |
| Finding leads | Low until there is content to send people to | Wait |
| Personal admin | Not linked to the goal | Wait |

Why articles: the news page is built and empty. Articles show up in search,
give every social post somewhere to link, and show paying subscribers the
thinking behind the model. That is where a paid product earns trust.

## 2. The team map

```
You
 │  /gameweek-preview
 ▼
Team Lead  (.claude/skills/gameweek-preview/SKILL.md)
 ├─► Data Scout  (.claude/agents/gwe-data-scout.md)  → factsheet.md
 ├─► Writer      (.claude/agents/gwe-writer.md)      → content/posts/…md
 └─► Editor      (.claude/agents/gwe-editor.md)      → PASS or FIX
 ▼
You approve → pull request → you merge → article is live
```

| Agent | Owns | Never touches | Gets | Hands back | Passes to |
|---|---|---|---|---|---|
| Team Lead | The run, the checks, your approval | Copy, data, merging | Your request | A draft and a question | Scout, Writer, Editor, you |
| Data Scout | The numbers | Article text | Gameweek, deadline | `factsheet.md` + red flags | Team Lead |
| Writer | The article | Numbers not in the sheet, git | Fact sheet | The draft file | Team Lead |
| Editor | The checks | The article text | Draft + fact sheet | PASS or FIX list | Team Lead |

The prompts are the four files above. Each is split into Job, Never,
Input, Output and Great work. To use one in the Claude app instead, paste
everything below the `---` front matter into a Project's instructions.

## 3. The workflow

1. You type `/gameweek-preview` two days before the deadline (D-2).
2. Team Lead checks the gameweek and deadline. Stops if the deadline has
   passed or is more than 4 days away.
3. Data Scout pulls captain options, differentials, start chances, price
   moves, suspension risk and the model record. Writes the fact sheet.
4. **Checkpoint 1:** any red flag, the Team Lead stops and asks you.
5. Writer drafts 600 to 900 words in the brand voice.
6. **Checkpoint 2:** Editor checks every number and every brand rule.
   FIX goes back to the Writer, twice at most, then to you.
7. **Checkpoint 3:** Team Lead shows you the summary and asks
   "Approve to open the pull request?"
8. On yes: branch, commit, pull request. Netlify builds a free deploy
   preview so you read the article as it will look.
9. **Checkpoint 4:** you merge. That publishes it. Only you merge.

## 4. Tool stack (version one)

| Tool | Why it earns its spot |
|---|---|
| Claude Code (on your existing Claude plan) | Runs the Team Lead and the three agents |
| Gameweekedge connector | Your own model's numbers, so every article starts from real data |
| This GitHub repo | Knowledge base (`BRAND.md`, `docs/MODELLING.md`) and the task record (one pull request per article) |
| Netlify | Free deploy preview for review, then the live site |
| `docs/agents/RUN_LOG.md` | The spreadsheet: one row per run |
| Gmail | GitHub emails you when the pull request is ready |
| Typefully (version two) | Queues X and Bluesky posts for each article, for your approval |

Cost note: each merge to `main` is one production deploy (15 Netlify
credits). One article a week is about 60 credits a month.

## 5. Quality plan

**Most likely ways this breaks**
1. Wrong or stale data: a transfer the model has not caught, or a run
   after the deadline. The Scout flags team changes and timing.
2. A strange headline. Example from the first test pull (GW12): the top
   three captain options were two defenders and a midfielder. Possible,
   but the Scout now flags three or more defenders in the top 5.
3. Double gameweeks: haul and blank chances are missing. The Scout flags it.
4. Brand slips: em dashes, hype words, missing disclaimer. The Editor greps.
5. A future date hides the post. The Writer uses today's date.

**Test by hand before going live**
1. Check two numbers in the draft against the app yourself.
2. Read the deploy preview on your phone.
3. Run one dry run where you answer "stop" at the approval step and
   confirm nothing was committed (`git status` is clean).

**The one number:** your minutes per published article. Target under 20.
Log it in `RUN_LOG.md` after each merge. If it stays over 30 for two
weeks, the team is not saving you time and we fix the prompts.

## 6. Seven-day launch plan (about 15 to 20 minutes a day)

| Day | One task |
|---|---|
| 1 | START HERE FIRST: the dry run. Note time and one change. |
| 2 | Tell the Team Lead your one change. Update the Writer prompt with it. |
| 3 | Test the failure path: dry run again, answer "stop", check `git status`. |
| 4 | Check three numbers from a fresh fact sheet against the app by hand. |
| 5 | Real run on D-2 of the next gameweek. Approve, read the preview, merge. |
| 6 | Read the live article at `/blog/`. Log your minutes in `RUN_LOG.md`. |
| 7 | Decide on agent 5, the Social Promoter (Typefully drafts for X and Bluesky linking the article). Add it only if days 1 to 6 went to plan. |

## 7. Rules for the whole team

- Nothing is published, posted, sent, deleted, paid for or made permanent
  without your yes.
- No agent asks for passwords, tokens or keys in chat.
- No number without a source in the fact sheet.
