//! Owned build graph from `native eject`. Opt into live `<terminal>`
//! sessions (QK-NAT-005) — requires the lazy ghostty pin in build.zig.zon.

const std = @import("std");
const native_sdk = @import("native_sdk");

pub fn build(b: *std.Build) void {
    native_sdk.addApp(b, b.dependency("native_sdk", .{}), .{
        .name = "workbench",
        .terminal_sessions = true,
    });
}
