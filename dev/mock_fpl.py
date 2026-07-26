"""Mock Fantasy Premier League API + static server for local development.

Serves the repo's index.html and answers every FPL endpoint the app calls
with deterministic fake data, so you can run and test Gameweek Edge offline
without hitting (or depending on) the real FPL API.

Usage:
    python3 dev/mock_fpl.py            # serves on http://127.0.0.1:8700
    PRESEASON=1 python3 dev/mock_fpl.py  # models the state before the GW1 deadline

Then open http://127.0.0.1:8700 and, in the browser console, point the app at
this server and link the demo team:

    localStorage.setItem('ge-api-base','http://127.0.0.1:8700');
    localStorage.setItem('ge-mid','101');
    localStorage.setItem('ge-tier','pro');
    localStorage.setItem('ge-onboarded','1');
    location.reload();

The dataset is synthetic — good for exercising rendering, sorting, filtering,
the model plumbing and every panel, not for judging real projections.
"""
import http.server
import json
import os
import random

# Pre-season mode (PRESEASON=1): models the state before the GW1 deadline —
# every player minutes/form/ownership at zero (ep_next still provisionally
# seeded), no event finished or current, no fixture played, and the picks
# endpoint 404s (a squad only unlocks once teams lock). Use it to exercise the
# pre-season readiness paths (banners, PRE-SEASON chip, season-scoped storage,
# the "squad unlocks after the deadline" state) that the live-season data hides.
PRESEASON = os.environ.get("PRESEASON") == "1"

# ── Reference data ───────────────────────────────────────────────────────
TEAMS = ["Arsenal", "Aston Villa", "Bournemouth", "Brentford", "Brighton",
         "Chelsea", "Coventry", "Crystal Palace", "Everton", "Fulham",
         "Hull", "Ipswich", "Leeds", "Liverpool", "Man City", "Man Utd",
         "Newcastle", "Nott'm Forest", "Spurs", "Sunderland"]
SHORT = ["ARS", "AVL", "BOU", "BRE", "BHA", "CHE", "COV", "CRY", "EVE", "FUL",
         "HUL", "IPS", "LEE", "LIV", "MCI", "MUN", "NEW", "NFO", "TOT", "SUN"]
# Official PL team codes (drive real crest URLs when online).
CODES = [3, 7, 91, 94, 36, 8, 102, 31, 11, 54, 88, 40, 2, 14, 43, 1, 4, 17, 6, 56]

teams = [{"id": i + 1, "name": n, "short_name": SHORT[i], "code": CODES[i],
          "strength_attack_home": 1100, "strength_attack_away": 1100,
          "strength_defence_home": 1100, "strength_defence_away": 1100}
         for i, n in enumerate(TEAMS)]

# squad_select / squad_min_play / squad_max_play are the fields the app reads
# to learn the squad shape and legal formations, rather than hard-coding them.
element_types = [{"id": k, "singular_name_short": s, "plural_name": p,
                  "squad_select": sel, "squad_min_play": lo, "squad_max_play": hi}
                 for k, s, p, sel, lo, hi in [(1, "GKP", "Goalkeepers", 2, 1, 1),
                                              (2, "DEF", "Defenders", 5, 3, 5),
                                              (3, "MID", "Midfielders", 5, 2, 5),
                                              (4, "FWD", "Forwards", 3, 1, 3)]]

# The rules the game publishes about itself: squad size, XI size, the per-club
# cap, the budget in tenths, the sell-on fee and the money display divisor.
game_settings = {"squad_squadsize": 15, "squad_squadplay": 11, "squad_team_limit": 3,
                 "squad_total_spend": 1000, "transfers_sell_on_fee": 0.5,
                 "ui_currency_multiplier": 10, "transfers_cap": 20}

# Six players per club (GKP, 2 DEF, 2 MID, FWD) → a legal Team-of-the-Week is
# always formable, so every panel (incl. Scout AI) renders.
SQUAD = [(1, "Gkp", "4.5"), (2, "Def", "4.5"), (2, "Dfn", "5.0"),
         (3, "Mid", "6.0"), (3, "Wng", "7.0"), (4, "Fwd", "6.5")]

elements = []
eid = 0
for t in teams:
    for et, nm, ep in SQUAD:
        eid += 1
        elements.append({
            "id": eid, "web_name": f"{t['short_name']}{nm}", "team": t["id"],
            "element_type": et, "status": "a", "ep_next": ep, "ep_this": ep,
            "form": str(round(2 + (eid % 7) * 0.5, 1)), "points_per_game": "4.2",
            "selected_by_percent": str(round(2 + (eid % 40) * 0.7, 1)),
            "now_cost": 40 + (eid % 90), "chance_of_playing_next_round": None,
            "chance_of_playing_this_round": None,
            "minutes": 450, "total_points": 20 + (eid % 120), "event_points": eid % 13,
            "transfers_in_event": (eid * 733) % 90000, "transfers_out_event": (eid * 197) % 60000,
            "transfers_in": (eid * 5000) % 900000, "cost_change_event": (eid % 5) - 2,
            "cost_change_start": (eid % 7) - 3, "photo": f"{100000 + eid}.jpg",
            "expected_goals": "0.5", "expected_assists": "0.2",
            "expected_goals_per_90": "0.45" if et == 4 else "0.10",
            "expected_assists_per_90": "0.20",
            "expected_goal_involvements": "0.7",
            "expected_goal_involvements_per_90": "0.65" if et >= 3 else "0.20",
            "expected_goals_conceded": "1.1", "expected_goals_conceded_per_90": "1.05",
            "defensive_contribution": str(10 + eid % 20),
            "defensive_contribution_per_90": str(round(2 + (eid % 10) * 0.3, 1)),
            "recoveries": str(20 + eid % 30), "starts": 1, "news": "",
            "penalties_order": 1 if nm == "Fwd" else None,
            "direct_freekicks_order": 1 if nm == "Wng" else None,
            "corners_and_indirect_freekicks_order": 1 if nm == "Mid" else None,
            "threat": str(40 + eid % 30), "creativity": str(20 + eid % 25),
            "influence": str(30 + eid % 20), "ict_index": str(30 + eid % 60),
            "bps": 50 + eid % 40, "bonus": eid % 7,
            "tackles": str(eid % 8), "clearances_blocks_interceptions": str(eid % 15),
            "saves": "0", "clean_sheets": eid % 3, "goals_conceded": eid % 10,
            "goals_scored": eid % 6, "assists": eid % 4,
            "value_form": str(round(0.4 + (eid % 10) * 0.1, 1)),
            "value_season": str(round(4 + (eid % 12) * 0.5, 1)),
            "form_rank": (eid % 300) + 1, "ict_index_rank": (eid % 300) + 1,
            "now_cost_rank": (eid % 300) + 1,
            "in_dreamteam": eid % 20 == 0, "dreamteam_count": eid % 5,
        })
N = len(elements)

if PRESEASON:
    # Minutes, form and ownership reset for the new season; ep_next stays as a
    # provisional projection (FPL seeds it pre-season), so xP-ranked boards are
    # populated rather than flat.
    for e in elements:
        e.update(minutes=0, total_points=0, event_points=0, starts=0,
                 form="0.0", points_per_game="0.0", selected_by_percent="0.0",
                 clean_sheets=0, goals_conceded=0, goals_scored=0, assists=0,
                 bonus=0, bps=0)

events = [{"id": g, "name": f"Gameweek {g}", "finished": g == 1,
           "is_current": g == 1, "is_next": g == 2,
           "deadline_time": f"2026-08-{14 + g:02d}T17:15:00Z",
           "most_captained": 6, "most_selected": 6, "most_transferred_in": 12,
           "top_element": 6, "top_element_info": {"id": 6, "points": 13},
           "average_entry_score": 50, "highest_score": 100} for g in range(1, 39)]

rng = random.Random(1)
fixtures = []
fid = 0
# GW1 finished with scores; GW2-8 scheduled.
gw1 = [(i * 2 + 1, i * 2 + 2) for i in range(10)]
for i, (h, a) in enumerate(gw1):
    fid += 1
    started = i < 9
    fixtures.append({"id": fid, "event": 1, "team_h": h, "team_a": a,
                     "team_h_difficulty": 3, "team_a_difficulty": 3,
                     "kickoff_time": "2026-08-15T14:00:00Z",
                     "finished": i < 8, "started": started, "minutes": 90 if started else 0,
                     "team_h_score": (i % 4) if started else None,
                     "team_a_score": (i % 3) if started else None})
for g in range(2, 9):
    order = list(range(1, 21))
    rng.shuffle(order)
    for i in range(0, 20, 2):
        fid += 1
        fixtures.append({"id": fid, "event": g, "team_h": order[i], "team_a": order[i + 1],
                         "team_h_score": None, "team_a_score": None,
                         "finished": False, "started": False,
                         "team_h_difficulty": rng.randint(2, 4),
                         "team_a_difficulty": rng.randint(2, 4),
                         "kickoff_time": f"2026-08-{13 + g * 7:02d}T14:00:00Z"})

if PRESEASON:
    # No gameweek is finished or current; GW1 is next, nothing played.
    for ev in events:
        ev.update(finished=False, is_current=False, is_next=(ev["id"] == 1))
    for f in fixtures:
        f.update(finished=False, started=False, minutes=0,
                 team_h_score=None, team_a_score=None)

bootstrap = {"teams": teams, "elements": elements, "element_types": element_types,
             "game_settings": game_settings,
             "events": events, "total_players": 10_000_000}


def live_el(e):
    return {"id": e["id"],
            "stats": {"total_points": e["id"] % 13, "minutes": 90 if e["id"] % 4 else 0,
                      "bps": 5 + (e["id"] * 7) % 45, "bonus": 0,
                      "goals_scored": 1 if e["id"] % 3 == 0 else 0,
                      "assists": 1 if e["id"] % 5 == 0 else 0,
                      "clean_sheets": 0, "saves": 0, "in_dreamteam": False},
            "explain": [{"fixture": 1, "stats": [
                {"identifier": "minutes", "points": 2, "value": 90},
                {"identifier": "goals_scored", "points": 5,
                 "value": 1 if e["id"] % 3 == 0 else 0}]}]}


live = {"elements": [live_el(e) for e in elements]}
event_status = {"status": [{"bonus_added": False, "event": 1, "date": "2026-08-15"}],
                "leagues": "Updated"}
standings = {"league": {"name": "Test League"}, "standings": {"results": [
    {"entry": 100 + i, "entry_name": f"Team {i}", "player_name": f"Mgr {i}",
     "rank": i + 1, "last_rank": i + 2, "event_total": 40 + i, "total": 500 - i}
    for i in range(8)]}}
h2h_standings = {"league": {"name": "H2H Test League"}, "standings": {"results": [
    {"entry": 100 + i, "entry_name": f"Team {i}", "player_name": f"Mgr {i}",
     "rank": i + 1, "last_rank": i + 2, "matches_won": 6 - i, "matches_drawn": 1,
     "matches_lost": i, "points_for": 500 - i * 10, "total": (6 - i) * 3 + 1}
    for i in range(6)]}}
set_piece_notes = {"last_updated": "2026-08-14T10:00:00Z", "teams": [
    {"id": 1, "notes": [{"info_message": "Fwd is on penalties; Wng takes direct free-kicks.",
                         "source_link": "", "external_link": False}]},
    {"id": 14, "notes": [{"info_message": "First-choice penalty taker confirmed.",
                          "source_link": "", "external_link": False}]}]}


def dream_team_for(gw):
    rr = random.Random(gw)
    picks = rr.sample(range(1, N + 1), 11)
    return {"top_player": {"id": picks[0], "points": 14},
            "team": [{"element": pid, "position": i + 1, "points": rr.randint(2, 13)}
                     for i, pid in enumerate(picks)]}


def summary_for(pid):
    rr = random.Random(pid)
    hist = [{"element": pid, "fixture": g, "opponent_team": ((pid + g) % 20) + 1,
             "round": g, "was_home": g % 2 == 0,
             "total_points": rr.randint(0, 14), "minutes": rr.choice([0, 45, 90, 90]),
             "goals_scored": rr.randint(0, 2), "assists": rr.randint(0, 1),
             "clean_sheets": rr.randint(0, 1), "bps": rr.randint(0, 40),
             "expected_goals": str(round(rr.random(), 2)),
             "expected_assists": str(round(rr.random() * 0.5, 2)),
             "value": 70 + g, "selected": 100000, "kickoff_time": None}
            for g in range(1, 6)]
    past = [{"season_name": "2024/25", "total_points": rr.randint(80, 240),
             "minutes": rr.randint(1500, 3200), "goals_scored": rr.randint(2, 20),
             "assists": rr.randint(1, 14)},
            {"season_name": "2023/24", "total_points": rr.randint(60, 210),
             "minutes": rr.randint(1000, 3000), "goals_scored": rr.randint(1, 18),
             "assists": rr.randint(0, 12)}]
    upcoming = [{"event": 2 + i, "team_h": ((pid + i) % 20) + 1,
                 "team_a": ((pid + i + 5) % 20) + 1, "is_home": i % 2 == 0,
                 "difficulty": rng.randint(2, 5), "kickoff_time": "2026-08-22T14:00:00Z"}
                for i in range(5)]
    return {"history": hist, "history_past": past, "fixtures": upcoming}


def history_for(entry):
    rr = random.Random(entry)
    cur, total, orank = [], 0, 500000
    for g in range(1, 39):
        pts = rr.randint(20, 95)
        total += pts
        orank = max(1000, orank + rr.randint(-40000, 30000))
        cur.append({"event": g, "points": pts, "total_points": total,
                    "rank": rr.randint(1, 400000), "overall_rank": orank,
                    "event_transfers": rr.randint(0, 2),
                    "event_transfers_cost": rr.choice([0, 0, 0, 4]),
                    "points_on_bench": rr.randint(0, 18),
                    "value": 1000 + g, "bank": rr.randint(0, 30)})
    return {"current": cur, "chips": [{"name": "wildcard", "event": 8},
            {"name": "3xc", "event": 30}], "past": []}


def picks_for(entry):
    rr = random.Random(entry)
    ids = rr.sample(range(1, N + 1), 15)
    return {"picks": [{"element": pid, "position": p + 1,
                       "multiplier": 2 if p == 0 else (1 if p < 11 else 0),
                       "is_captain": p == 0, "is_vice_captain": p == 1}
                      for p, pid in enumerate(ids)],
            "entry_history": {"bank": 5, "value": 1000, "points": 55,
                              "rank": 120000, "event_transfers_cost": 0}}


def transfers_for(entry):
    rr = random.Random(entry * 3)
    out = []
    for g in range(2, 6):
        for _ in range(rr.randint(0, 2)):
            out.append({"element_in": rr.randint(1, N), "element_out": rr.randint(1, N),
                        "element_in_cost": rr.randint(45, 130),
                        "element_out_cost": rr.randint(45, 130),
                        "entry": entry, "event": g, "time": "2026-08-20T10:00:00Z"})
    return out


def entry_for(entry):
    return {"id": entry, "name": f"Team {entry - 99}", "player_first_name": "Demo",
            "summary_overall_points": 2100, "summary_overall_rank": 240000,
            "summary_event_points": 53, "last_deadline_value": 1015,
            "last_deadline_bank": 8,
            "leagues": {"classic": [{"id": 7, "name": "Test League",
                                     "entry_rank": 2, "entry_last_rank": 3}],
                        "h2h": [{"id": 55, "name": "H2H Test League",
                                 "entry_rank": 1, "entry_last_rank": 2}]}}


def route(path):
    p = path.rstrip("/")
    if p.startswith("bootstrap-static"):
        return bootstrap
    if p.startswith("fixtures"):
        return fixtures
    if p.startswith("event/") and p.endswith("live"):
        return live
    if p == "event-status":
        return event_status
    if p.startswith("leagues-classic/"):
        return standings
    if p.startswith("leagues-h2h/"):
        return h2h_standings
    if p == "set-piece-notes":
        return set_piece_notes
    if p.startswith("dream-team/"):
        return dream_team_for(int(p.split("/")[1]))
    if p.startswith("element-summary/"):
        return summary_for(int(p.split("/")[1]))
    if p.startswith("entry/"):
        parts = p.split("/")
        eid_ = int(parts[1])
        if p.endswith("picks"):
            # Pre-season the squad is not yet locked, so the API 404s.
            return None if PRESEASON else picks_for(eid_)
        if p.endswith("transfers"):
            return transfers_for(eid_)
        if p.endswith("history"):
            return history_for(eid_)
        return entry_for(eid_)
    return None


# Our own Netlify functions, mocked so the browser exercises the real code
# paths rather than only the graceful-degradation ones. Deliberately
# synthetic: club Elo spread evenly across the league, and a midweek European
# tie three days before the next fixture for the first four clubs.
def own_api(path):
    if path == "/api/team-elo":
        return {"season": "mock", "elo": {str(t["id"]): 1650 + 22 * i
                                          for i, t in enumerate(teams)}}
    if path.startswith("/api/euro-fixtures"):
        gw = (next((e["id"] for e in events if not e.get("finished")), 1))
        comps = ["UCL", "UEL", "UECL", "EFL"]
        rows = []
        for i, t in enumerate(teams[:4]):
            kick = next((f["kickoff_time"] for f in fixtures
                         if f.get("event") == gw
                         and t["id"] in (f["team_h"], f["team_a"])), None)
            if not kick:
                continue
            import datetime as _dt
            when = _dt.datetime.fromisoformat(kick.replace("Z", "")) - _dt.timedelta(days=3)
            rows.append({"gw": gw, "team": t["id"], "comp": comps[i % 4],
                         "kickoff": when.isoformat(), "home": True, "finished": False})
        return {"season": "mock", "from": gw, "n": 6, "rows": rows}
    return None


class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        own = own_api(self.path.split("?")[0])
        if own is not None:
            data = json.dumps(own).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if self.path.startswith("/api/fpl/"):
            body = route(self.path[len("/api/fpl/"):].split("?")[0])
            if body is None:
                self.send_response(404); self.end_headers(); return
            data = json.dumps(body).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if self.path == "/":
            self.path = "/index.html"
        return super().do_GET()

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(root)
    host, port = "127.0.0.1", int(os.environ.get("PORT", "8700"))
    print(f"Mock FPL server: http://{host}:{port}  (serving {root})")
    http.server.ThreadingHTTPServer((host, port), Handler).serve_forever()
