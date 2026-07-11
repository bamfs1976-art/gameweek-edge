// GWLivePlugin.swift — Capacitor bridge between the web app and the
// iOS widget + Live Activity.
//
// JS calls (all no-op safely on web / older iOS):
//   Capacitor.Plugins.GWLive.update({ gw, points, rankText, toPlay, playing, captain })
//   Capacitor.Plugins.GWLive.start({ teamName, gw, ...state })
//   Capacitor.Plugins.GWLive.end()
//
// `update` writes the shared snapshot (Home/Lock-screen widget) and, if a
// Live Activity is running, updates it. Requires the GWShared.swift file to
// be a member of BOTH the App target and the widget target.

import Foundation
import Capacitor
import WidgetKit
import ActivityKit

@objc(GWLivePlugin)
public class GWLivePlugin: CAPPlugin {

    // Held as Any? so the stored property needs no availability annotation.
    private var _activity: Any?

    private func snapshot(from call: CAPPluginCall) -> GWLiveSnapshot {
        GWLiveSnapshot(
            gw: call.getInt("gw") ?? 0,
            points: call.getInt("points") ?? 0,
            rankText: call.getString("rankText") ?? "—",
            toPlay: call.getInt("toPlay") ?? 0,
            playing: call.getInt("playing") ?? 0,
            captain: call.getString("captain") ?? "",
            updated: Date()
        )
    }

    /// Write the latest snapshot and refresh the widget + Live Activity.
    @objc func update(_ call: CAPPluginCall) {
        let snap = snapshot(from: call)
        snap.save()
        if #available(iOS 14.0, *) { WidgetCenter.shared.reloadAllTimelines() }
        if #available(iOS 16.1, *) { updateActivity(snap) }
        call.resolve()
    }

    /// Start a matchday Live Activity (once per gameweek, while in play).
    @objc func start(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *) else { call.resolve(["started": false]); return }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { call.resolve(["started": false, "reason": "disabled"]); return }
        let snap = snapshot(from: call)
        snap.save()
        let attrs = GWLiveActivityAttributes(teamName: call.getString("teamName") ?? "My team", gw: snap.gw)
        let state = GWLiveActivityAttributes.ContentState(points: snap.points, rankText: snap.rankText, toPlay: snap.toPlay, playing: snap.playing)
        do {
            if #available(iOS 16.2, *) {
                _activity = try Activity.request(attributes: attrs, content: .init(state: state, staleDate: nil))
            } else {
                _activity = try Activity.request(attributes: attrs, contentState: state)
            }
            call.resolve(["started": true])
        } catch {
            call.resolve(["started": false, "reason": String(describing: error)])
        }
    }

    /// End the running Live Activity (call at gameweek end / on request).
    @objc func end(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *), let activity = _activity as? Activity<GWLiveActivityAttributes> else { call.resolve(); return }
        Task {
            if #available(iOS 16.2, *) { await activity.end(nil, dismissalPolicy: .immediate) }
            else { await activity.end(dismissalPolicy: .immediate) }
            _activity = nil
            call.resolve()
        }
    }

    @available(iOS 16.1, *)
    private func updateActivity(_ snap: GWLiveSnapshot) {
        guard let activity = _activity as? Activity<GWLiveActivityAttributes> else { return }
        let state = GWLiveActivityAttributes.ContentState(points: snap.points, rankText: snap.rankText, toPlay: snap.toPlay, playing: snap.playing)
        Task {
            if #available(iOS 16.2, *) { await activity.update(.init(state: state, staleDate: nil)) }
            else { await activity.update(using: state) }
        }
    }
}
