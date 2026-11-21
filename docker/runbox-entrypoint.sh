#!/bin/sh
# Entrypoint for the runbox container.
#
# On a cgroup v2 host the container gets its own cgroup namespace, and its
# root cgroup holds the container's processes. cgroup v2's "no internal
# processes" rule then forbids enabling controllers for child cgroups, which
# runbox needs (memory, pids, cpu per job). The standard fix, used by
# docker-in-docker too: move every process into a leaf cgroup ("init") and
# then delegate the controllers from the root. On cgroup v1 hosts this is a
# no-op and runbox uses its v1 fallback.
set -eu
cg=/sys/fs/cgroup
if [ -f "$cg/cgroup.controllers" ] && [ -w "$cg/cgroup.subtree_control" ]; then
  mkdir -p "$cg/init"
  for pid in $(cat "$cg/cgroup.procs"); do
    echo "$pid" > "$cg/init/cgroup.procs" 2>/dev/null || true
  done
  for c in $(cat "$cg/cgroup.controllers"); do
    echo "+$c" > "$cg/cgroup.subtree_control" 2>/dev/null || true
  done
fi
mkdir -p /tmp/runbox
exec "$@"
