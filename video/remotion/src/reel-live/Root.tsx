import { Composition } from "remotion";
import "../fonts";
import { ReelLive } from "./ReelLive";
import { FPS, TOTAL_S } from "./plan";

export const RemotionRoot: React.FC = () => (
  <Composition
    id="ReelLive"
    component={ReelLive}
    durationInFrames={Math.round(TOTAL_S * FPS)}
    fps={FPS}
    width={1080}
    height={1920}
  />
);
