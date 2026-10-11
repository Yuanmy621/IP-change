#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ -z "${JAVA_HOME:-}" ] && [ -f .tools/java-home.txt ]; then
  JAVA_HOME="$(cat .tools/java-home.txt)"
  export JAVA_HOME
fi
if [ ! -f android/local.properties ] && [ -d .tools/android-sdk ]; then
  printf 'sdk.dir=%s/.tools/android-sdk\n' "$PWD" > android/local.properties
fi
cd android
if [ -x ../.tools/gradle-8.13/bin/gradle ]; then
  ../.tools/gradle-8.13/bin/gradle --no-daemon :app:assembleDebug
else
  ./gradlew --no-daemon :app:assembleDebug
fi
cd ..
mkdir -p dist
cp android/app/build/outputs/apk/debug/app-debug.apk dist/定点-Android.apk
printf '%s\n' '手机版已构建：dist/定点-Android.apk'
