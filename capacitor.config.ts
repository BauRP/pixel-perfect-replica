import type { CapacitorConfig } from "@capacitor/cli";

// Only the offline client bundle is loaded; there is no remote app server.
const config: CapacitorConfig = {
  appId: "kz.soundworld.ar",
  appName: "SoundWorld AR",
  webDir: "dist-android",
  server: { androidScheme: "https" },
  android: { allowMixedContent: false },
};

export default config;
