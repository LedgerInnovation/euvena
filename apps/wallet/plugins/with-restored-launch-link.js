const { withMainActivity } = require("expo/config-plugins");

const MARKER = "restored launch link";
const ANCHOR = "super.onCreate(null)";

/**
 * Keeps Android from opening an old link again when it restores the app.
 *
 * Once the system has stopped the app in the background, returning to it
 * recreates the activity with the intent that first started it, link
 * included, whether the return comes from Recents or from the launcher. That
 * link was read by the process that saved the activity, so it is dropped
 * before the link module reads the intent. A link that brings the app back
 * arrives as a new intent and is not affected.
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
      `${indent}// ${MARKER}: already read before the system stopped the app.\n` +
      `${indent}if (savedInstanceState != null) intent.data = null\n`;
    activity.modResults.contents =
      contents.slice(0, lineStart) + inserted + contents.slice(lineStart);
    return activity;
  });
}

module.exports = withRestoredLaunchLink;
