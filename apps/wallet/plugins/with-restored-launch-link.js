const { withMainActivity } = require("expo/config-plugins");

const MARKER = "restored launch link";
const ANCHOR = "super.onCreate(null)";

/**
 * Keeps Android from opening an old link again when it brings the app back.
 *
 * An activity recreated from saved state after the system stopped the app, or
 * started from Recents even after a restart, is handed the intent its task
 * first started with, link included. That link belongs to an earlier visit, so
 * it is dropped before the link module reads the intent. A link that brings
 * the app back arrives as a new intent and is not affected. The cost is a link
 * the app had no time to show before it was stopped: it has to be opened again.
 */
function withRestoredLaunchLink(config) {
  return withMainActivity(config, (activity) => {
    const { contents, language } = activity.modResults;
    if (language !== "kt") {
      throw new Error("with-restored-launch-link: expected a Kotlin MainActivity");
    }
    if (contents.includes(MARKER)) return activity;

    const anchor = contents.indexOf(ANCHOR);
    if (anchor === -1) {
      throw new Error(`with-restored-launch-link: "${ANCHOR}" not found in MainActivity`);
    }
    const lineStart = contents.lastIndexOf("\n", anchor) + 1;
    const indent = contents.slice(lineStart, anchor);
    const inserted =
      `${indent}// ${MARKER}: a recreated or Recents start still carries its first link.\n` +
      `${indent}val restored = savedInstanceState != null ||\n` +
      `${indent}  (intent.flags and android.content.Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0\n` +
      `${indent}if (restored) intent.data = null\n`;
    activity.modResults.contents =
      contents.slice(0, lineStart) + inserted + contents.slice(lineStart);
    return activity;
  });
}

module.exports = withRestoredLaunchLink;
