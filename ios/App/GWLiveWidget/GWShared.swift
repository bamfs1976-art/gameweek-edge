// GWShared.swift — types shared by the app and the widget/Live Activity.
//
// The web app (via the GWLive Capacitor plugin) writes a small JSON
// snapshot into the shared App Group container; the widget and the Live
// Activity both read it. Keep this file in BOTH targets (App + Widget).

import Foundation
import ActivityKit

/// App Group id — must match the entitlement added to the App target AND
/// the widget extension target in Xcode (Signing & Capabilities → App Groups).
public let kGWAppGroup = "group.app.gameweekedge"
/// Key the snapshot is stored under in the shared UserDefaults.
public let kGWSnapshotKey = "gw_live_snapshot"

/// A compact live-matchday snapshot. Mirrors the object the JS bridge sends.
public struct GWLiveSnapshot: Codable, Hashable {
    public var gw: Int          // gameweek number
    public var points: Int      // live GW points (incl. provisional bonus)
    public var rankText: String // e.g. "~top 12%" or "3.1M" — display-ready
    public var toPlay: Int      // XI players yet to play
    public var playing: Int     // XI players currently on the pitch
    public var captain: String  // captain web_name (may be empty)
    public var updated: Date    // when the snapshot was written

    public init(gw: Int = 0, points: Int = 0, rankText: String = "—",
                toPlay: Int = 0, playing: Int = 0, captain: String = "",
                updated: Date = Date()) {
        self.gw = gw; self.points = points; self.rankText = rankText
        self.toPlay = toPlay; self.playing = playing
        self.captain = captain; self.updated = updated
    }

    /// Read the latest snapshot the app wrote, if any.
    public static func load() -> GWLiveSnapshot? {
        guard let d = UserDefaults(suiteName: kGWAppGroup)?.data(forKey: kGWSnapshotKey),
              let s = try? JSONDecoder().decode(GWLiveSnapshot.self, from: d) else { return nil }
        return s
    }

    /// Persist a snapshot to the shared container.
    public func save() {
        guard let d = try? JSONEncoder().encode(self) else { return }
        UserDefaults(suiteName: kGWAppGroup)?.set(d, forKey: kGWSnapshotKey)
    }
}

/// Live Activity attributes. The dynamic content is GWLiveSnapshot fields we
/// care to animate; static attributes carry the season/team label.
public struct GWLiveActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        public var points: Int
        public var rankText: String
        public var toPlay: Int
        public var playing: Int
        public init(points: Int, rankText: String, toPlay: Int, playing: Int) {
            self.points = points; self.rankText = rankText
            self.toPlay = toPlay; self.playing = playing
        }
    }
    public var teamName: String
    public var gw: Int
    public init(teamName: String, gw: Int) { self.teamName = teamName; self.gw = gw }
}
