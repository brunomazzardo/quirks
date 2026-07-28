//! Owned build graph from `native eject`. Opt into live `<terminal>`
//! sessions (QK-NAT-005) — requires the lazy ghostty pin in build.zig.zon.
//! Overlays wiring/ts_core_main.zig onto the SDK so web_panes snaps the
//! preview webview (QK-NAT-002) — keep the dest path in sync with
//! build.zig.zon's native_sdk.path.

const std = @import("std");
const native_sdk = @import("native_sdk");

pub fn build(b: *std.Build) void {
    overlayTsCoreMain(b);
    native_sdk.addApp(b, b.dependency("native_sdk", .{}), .{
        .name = "workbench",
        .terminal_sessions = true,
    });
}

fn overlayTsCoreMain(b: *std.Build) void {
    // Same relative path as build.zig.zon `.native_sdk.path` + wiring entry.
    const dest = "../../../../.nvm/versions/node/v26.3.0/lib/node_modules/@native-sdk/cli/src/app_runner/ts_core_main.zig";
    const result = std.process.run(b.allocator, b.graph.io, .{
        .argv = &.{ "cp", "wiring/ts_core_main.zig", dest },
    }) catch {
        std.log.warn("workbench: could not overlay ts_core_main.zig (copy failed to start) — using existing SDK wiring", .{});
        return;
    };
    defer b.allocator.free(result.stdout);
    defer b.allocator.free(result.stderr);
    if (result.term != .exited or result.term.exited != 0) {
        std.log.warn("workbench: overlay cp failed ({s}) — using existing SDK wiring", .{result.stderr});
    }
}
