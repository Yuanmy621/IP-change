#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
task_commit=e475b071ef092090e459836d1c4c48bc89f490b8
task_archive=ios/Vendor/idevice/libidevice_ffi.a
task_hash=eacd72e90c4ce5531e7f8a59e90d2afb7e6cc8f45412729b63ac0839d1a00874
if [ -f "$task_archive" ] && [ "$(shasum -a 256 "$task_archive" | awk '{print $1}')" = "$task_hash" ]; then
  exit 0
fi
mkdir -p .tools/ios-dependency
task_cache="$(mktemp -d "$PWD/.tools/ios-dependency/fetch.XXXXXX")"
trap 'rm -rf "$task_cache"' EXIT HUP INT TERM
git -C "$task_cache" init -q
git -C "$task_cache" fetch --depth 1 https://github.com/AuroraNest/Aurora-Location.git "$task_commit"
git -C "$task_cache" checkout -q --detach FETCH_HEAD
task_source="$task_cache/Vendor/idevice/libidevice_ffi.a"
test "$(shasum -a 256 "$task_source" | awk '{print $1}')" = "$task_hash"
# The generated C declarations must match the pinned native ABI exactly.
cmp ios/Vendor/idevice/idevice.h "$task_cache/Vendor/idevice/idevice.h"
cp "$task_source" "$task_archive"
printf '%s\n' 'iOS 原生依赖已下载并校验。'
