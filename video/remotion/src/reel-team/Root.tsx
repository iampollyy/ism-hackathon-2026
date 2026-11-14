import { Composition } from "remotion";
import "../fonts";
import { ReelTeam, TOTAL_FRAMES } from "./ReelTeam";

export const RemotionRoot: React.FC = () => (
  <Composition id="ReelTeam" component={ReelTeam} durationInFrames={TOTAL_FRAMES} fps={30} width={1080} height={1920} />
);
