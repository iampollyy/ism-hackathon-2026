import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

export const fontsReady = Promise.all([
  loadFont({ family: "Space Grotesk", url: staticFile("fonts/SpaceGrotesk-Bold.ttf"), weight: "700" }),
  loadFont({ family: "Inter", url: staticFile("fonts/Inter-SemiBold.ttf"), weight: "600" }),
]);
