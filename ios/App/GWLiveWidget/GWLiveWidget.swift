// GWLiveWidget.swift — Home Screen + Lock Screen widget and the matchday
// Live Activity (Dynamic Island + Lock Screen) for Gameweek Edge.
//
// This is the widget-extension entry point. Add it to a new "Widget
// Extension" target in Xcode (see docs/IOS_LIVE_ACTIVITY.md). The widget
// reads GWLiveSnapshot from the shared App Group; the app keeps it fresh.

import WidgetKit
import SwiftUI
import ActivityKit

private let brandGreen = Color(red: 0.10, green: 0.56, blue: 0.30)

// MARK: - Timeline (Home / Lock Screen widget)

struct GWEntry: TimelineEntry {
    let date: Date
    let snap: GWLiveSnapshot
}

struct GWProvider: TimelineProvider {
    func placeholder(in context: Context) -> GWEntry {
        GWEntry(date: Date(), snap: GWLiveSnapshot(gw: 38, points: 53, rankText: "~top 12%", toPlay: 3, playing: 2, captain: "Salah"))
    }
    func getSnapshot(in context: Context, completion: @escaping (GWEntry) -> Void) {
        completion(GWEntry(date: Date(), snap: GWLiveSnapshot.load() ?? placeholder(in: context).snap))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<GWEntry>) -> Void) {
        let snap = GWLiveSnapshot.load() ?? placeholder(in: context).snap
        // Refresh cadence: WidgetKit budgets updates; the app also nudges
        // WidgetCenter.reloadAllTimelines() whenever it writes a snapshot.
        let next = Calendar.current.date(byAdding: .minute, value: 10, to: Date())!
        completion(Timeline(entries: [GWEntry(date: Date(), snap: snap)], policy: .after(next)))
    }
}

struct GWWidgetView: View {
    @Environment(\.widgetFamily) var family
    let entry: GWEntry
    var snap: GWLiveSnapshot { entry.snap }

    var body: some View {
        switch family {
        case .accessoryInline:
            Text("GW\(snap.gw)  \(snap.points) pts  ·  \(snap.rankText)")
        case .accessoryCircular:
            Gauge(value: Double(min(snap.points, 120)), in: 0...120) {
                Text("pts")
            } currentValueLabel: { Text("\(snap.points)") }
            .gaugeStyle(.accessoryCircular)
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 2) {
                Text("GW\(snap.gw) LIVE").font(.caption2).bold().foregroundStyle(.secondary)
                Text("\(snap.points) pts").font(.headline)
                Text("\(snap.rankText) · \(snap.toPlay) to play").font(.caption2)
            }
        default: // systemSmall / systemMedium (Home Screen)
            homeView
        }
    }

    private var homeView: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("GAMEWEEK EDGE").font(.system(size: 9, weight: .heavy)).kerning(0.5)
                    .foregroundStyle(brandGreen)
                Spacer()
                if snap.playing > 0 {
                    HStack(spacing: 3) {
                        Circle().fill(.red).frame(width: 6, height: 6)
                        Text("LIVE").font(.system(size: 9, weight: .bold)).foregroundStyle(.red)
                    }
                }
            }
            Text("\(snap.points)").font(.system(size: 38, weight: .black, design: .rounded))
                .foregroundStyle(.primary)
            Text("GW\(snap.gw) points").font(.caption2).foregroundStyle(.secondary)
            Spacer(minLength: 0)
            HStack {
                Label(snap.rankText, systemImage: "chart.line.uptrend.xyaxis")
                    .font(.caption2).foregroundStyle(.secondary)
                Spacer()
                Text("\(snap.toPlay) to play").font(.caption2).foregroundStyle(.secondary)
            }
        }
        .padding(12)
        .containerBackground(for: .widget) { Color(.systemBackground) }
    }
}

struct GWLiveWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "GWLiveWidget", provider: GWProvider()) { entry in
            GWWidgetView(entry: entry)
        }
        .configurationDisplayName("Gameweek Edge — Live")
        .description("Your live gameweek points and rank.")
        .supportedFamilies([.systemSmall, .systemMedium,
                            .accessoryInline, .accessoryCircular, .accessoryRectangular])
    }
}

// MARK: - Live Activity (Dynamic Island + Lock Screen)

struct GWLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: GWLiveActivityAttributes.self) { context in
            // Lock Screen / banner presentation.
            HStack(spacing: 14) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("GW\(context.attributes.gw) LIVE").font(.caption2).bold().foregroundStyle(brandGreen)
                    Text("\(context.state.points) pts").font(.system(size: 26, weight: .black, design: .rounded))
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(context.state.rankText).font(.headline)
                    Text("\(context.state.toPlay) to play · \(context.state.playing) on").font(.caption2).foregroundStyle(.secondary)
                }
            }
            .padding()
            .activityBackgroundTint(Color(.systemBackground))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text("\(context.state.points)").font(.system(size: 22, weight: .black, design: .rounded)).foregroundStyle(brandGreen)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(context.state.rankText).font(.subheadline).bold()
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text("GW\(context.attributes.gw) · \(context.state.toPlay) to play · \(context.state.playing) on the pitch")
                        .font(.caption2).foregroundStyle(.secondary)
                }
            } compactLeading: {
                Text("\(context.state.points)").font(.system(size: 13, weight: .bold)).foregroundStyle(brandGreen)
            } compactTrailing: {
                Image(systemName: "sportscourt").foregroundStyle(brandGreen)
            } minimal: {
                Text("\(context.state.points)").font(.system(size: 12, weight: .bold)).foregroundStyle(brandGreen)
            }
        }
    }
}

// MARK: - Bundle

@main
struct GWWidgets: WidgetBundle {
    var body: some Widget {
        GWLiveWidget()
        GWLiveActivityWidget()
    }
}
