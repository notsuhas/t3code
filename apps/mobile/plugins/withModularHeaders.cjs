const { withDangerousMod } = require("expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

const MARKER = "use_modular_headers!";

/**
 * Clerk's iOS SDK pulls in Firebase's `AppCheckCore`, a Swift pod that depends
 * on `GoogleUtilities` and `RecaptchaInterop`. Those do not define module maps,
 * so `pod install` fails when integrating them as static libraries. CocoaPods
 * recommends opting into module-map generation via `use_modular_headers!`.
 *
 * The Podfile is regenerated on every `expo prebuild --clean`, so we inject the
 * directive at the top level (before the first `target`) on each prebuild.
 */
module.exports = function withModularHeaders(config) {
  return withDangerousMod(config, [
    "ios",
    (nextConfig) => {
      const podfilePath = path.join(
        nextConfig.modRequest.platformProjectRoot,
        "Podfile",
      );

      let contents = fs.readFileSync(podfilePath, "utf8");

      if (contents.includes(MARKER)) {
        return nextConfig;
      }

      const anchor = "prepare_react_native_project!";
      if (!contents.includes(anchor)) {
        throw new Error(
          `withModularHeaders: could not find "${anchor}" in the Podfile to anchor "${MARKER}".`,
        );
      }

      contents = contents.replace(anchor, `${anchor}\n\n${MARKER}`);
      fs.writeFileSync(podfilePath, contents);

      return nextConfig;
    },
  ]);
};
